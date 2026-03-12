"""Agent orchestration service — thin proxy to engine layer."""

from __future__ import annotations

import asyncio
import json
import logging
from uuid import uuid4
from dataclasses import replace
from typing import Any, Awaitable, Callable

from app.agents.registry import AGENT_REGISTRY, AgentDef
from app.config import settings
from app.engines import EngineFactory
from app.engines.base import _json
from app.engines.tool_converter import build_tool_defs
from app.services.webagent_core import (
    PROTOCOL_VERSION,
    OrchestratorConfig,
    TenantContext,
    WebAgentPlan,
    WebAgentPlanNode,
    WorkerArtifact,
    build_dag_layers,
    build_plan_output_format,
    compact_plan_for_prompt,
    compact_tenant_context,
    infer_artifact_contract,
    parse_orchestrator_config,
    parse_tenant_context,
    parse_webagent_plan,
    pick_execution_mode,
    summarize_plan_steps,
)
from app.services.webagent_core.orchestrator import (
    calc_worker_trace_cost as core_calc_worker_trace_cost,
    compact_worker_trace as core_compact_worker_trace,
    resolve_worker_tools as core_resolve_worker_tools,
)
from app.services.agent_request_context import (
    AgentRequestContext,
    reset_agent_request_context,
    set_agent_request_context,
)
from app.services.coding_runtime import (
    parse_coding_runtime,
    reset_coding_runtime_context,
    set_coding_runtime_context,
)
from app.services.run_scratchpad import (
    append_reasoning,
    reset_run_scratchpad,
    snapshot_for_prompt,
    start_run_scratchpad,
)

logger = logging.getLogger(__name__)

_RUNTIME_KEY = "_runtime"
_TENANT_KEY = "_tenant"
_ALLOWED_ENGINES = {"claude", "openai"}
_ALLOWED_MODES = {"fast", "balanced", "deep"}
_ALLOWED_CLAUDE_TIERS = {"haiku", "sonnet", "opus"}

_OUTPUT_FORMAT_PRESETS: dict[str, dict[str, Any]] = {
    "advisor_card_v1": {
        "type": "json_schema",
        "schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "analysis": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "next_steps": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "risk_level": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                },
            },
            "required": ["title", "summary", "analysis", "next_steps", "risk_level"],
            "additionalProperties": False,
        },
    }
}

_WORKER_MODE_DEFAULT: dict[str, str] = {
    "reason": "deep",
    "gather": "fast",
    "act": "balanced",
    "synthesize": "deep",
}

_CRITIQUE_OUTPUT_FORMAT: dict[str, Any] = {
    "type": "json_schema",
    "schema": {
        "type": "object",
        "properties": {
            "pass": {"type": "boolean"},
            "score": {"type": "number"},
            "issues": {"type": "array", "items": {"type": "string"}},
            "recommendations": {"type": "array", "items": {"type": "string"}},
            "summary": {"type": "string"},
        },
        "required": ["pass", "score", "issues", "recommendations", "summary"],
        "additionalProperties": False,
    },
}


def _extract_summary(text: str) -> str:
    """Extract a short summary from agent response (first 120 chars of meaningful text)."""
    clean = text.strip().replace("\n", " ")
    return clean[:120] if clean else ""


class AgentService:
    """Orchestrates agent queries via pluggable engines."""

    async def query(
        self,
        agent_name: str,
        prompt: str,
        student_id: str | None = None,
        context: dict | None = None,
        role: str = "student",
    ) -> dict:
        """One-shot agent query. Returns complete response."""
        base_agent = AGENT_REGISTRY[agent_name]
        cleaned_context, runtime, tenant_context = self._split_context_and_runtime(
            context,
            student_id=student_id,
            role=role,
        )

        effective_prompt = prompt
        effective_runtime = dict(runtime) if isinstance(runtime, dict) else None

        coding_ctx = parse_coding_runtime(effective_runtime)
        coding_token = set_coding_runtime_context(coding_ctx)
        scratchpad_token = start_run_scratchpad(prompt=prompt)
        try:
            orchestrator_cfg = parse_orchestrator_config(effective_runtime, _ALLOWED_MODES)
            if orchestrator_cfg.enabled:
                orchestrated = await self._run_orchestrated_query(
                    agent_name=agent_name,
                    base_agent=base_agent,
                    prompt=prompt,
                    student_id=student_id,
                    cleaned_context=cleaned_context,
                    role=role,
                    runtime=effective_runtime,
                    config=orchestrator_cfg,
                    tenant_context=tenant_context,
                )
                if orchestrated is not None:
                    return orchestrated

            agent, mode = self._resolve_runtime_agent(base_agent, effective_runtime)
            output_format, output_format_used = self._resolve_output_format(effective_runtime)

            result = await self._query_once(
                agent_name=agent_name,
                prompt=effective_prompt,
                student_id=student_id,
                cleaned_context=cleaned_context,
                role=role,
                tenant_context=tenant_context,
                agent=agent,
                mode=mode,
                output_format=output_format,
                output_format_used=output_format_used,
                persist_summary=True,
            )
            result["tenant"] = compact_tenant_context(tenant_context)
            return result
        finally:
            reset_run_scratchpad(scratchpad_token)
            reset_coding_runtime_context(coding_token)

    async def stream(
        self,
        agent_name: str,
        prompt: str,
        student_id: str | None = None,
        context: dict | None = None,
        role: str = "student",
        session_id: str | None = None,
    ):
        """Streaming agent query. Yields JSON chunks for SSE."""
        from app.services.shared_memory import (
            append_summary,
            get_context,
            get_graph_feedback_context,
            upsert_session,
        )

        base_agent = AGENT_REGISTRY[agent_name]
        cleaned_context, runtime, tenant_context = self._split_context_and_runtime(
            context,
            student_id=student_id,
            role=role,
        )

        original_prompt = prompt
        effective_prompt = prompt
        effective_runtime = dict(runtime) if isinstance(runtime, dict) else None
        coding_ctx = parse_coding_runtime(effective_runtime)
        coding_token = set_coding_runtime_context(coding_ctx)
        scratchpad_run_id = session_id if isinstance(session_id, str) and session_id else None
        scratchpad_token = start_run_scratchpad(run_id=scratchpad_run_id, prompt=prompt)
        orchestrator_meta: dict[str, Any] | None = None
        orchestrator_events: list[dict[str, Any]] = []

        # ── Inline fast-path: skip orchestration, context fetch, graph feedback ──
        _task_type = str((cleaned_context or {}).get("taskType", "")).lower()
        _is_inline = "inline" in _task_type

        orchestrator_cfg = parse_orchestrator_config(effective_runtime, _ALLOWED_MODES)
        if orchestrator_cfg.enabled and not _is_inline:
            async def _event_sink(payload: dict[str, Any]) -> None:
                orchestrator_events.append(payload)

            orchestration_data = await self._run_orchestration_loop(
                agent_name=agent_name,
                base_agent=base_agent,
                prompt=prompt,
                student_id=student_id,
                cleaned_context=cleaned_context,
                role=role,
                runtime=effective_runtime,
                config=orchestrator_cfg,
                tenant_context=tenant_context,
                event_sink=_event_sink,
            )

            if orchestration_data is not None:
                plan_data = orchestration_data["plan_data"]
                worker_trace = orchestration_data["worker_trace"]
                critique = orchestration_data.get("critique")
                replan_count = int(orchestration_data.get("replan_count") or 0)

                effective_runtime = dict(effective_runtime or {})
                effective_runtime["mode"] = plan_data["selected_mode"]
                effective_runtime.pop("orchestrator", None)

                effective_prompt = self._build_orchestration_execution_prompt(
                    original_prompt=prompt,
                    plan=plan_data["plan"],
                    worker_trace=worker_trace,
                )

                orchestrator_meta = {
                    **plan_data["meta"],
                    "worker_count": len(worker_trace),
                    "worker_cost_usd": self._calc_worker_trace_cost(worker_trace),
                    "workers": self._compact_worker_trace(worker_trace),
                    "replan_count": replan_count,
                    "critique": critique,
                }

        agent, mode = self._resolve_runtime_agent(base_agent, effective_runtime)
        output_format, output_format_used = self._resolve_output_format(effective_runtime)

        # Inline: skip expensive context fetch — stateless completion
        if _is_inline:
            shared_ctx = ""
            graph_feedback_ctx = ""
        else:
            shared_ctx = await get_context(student_id or "")
            graph_feedback_ctx = ""
            if student_id and agent_name == "graph-analyst":
                graph_feedback_ctx = await get_graph_feedback_context(
                    student_id,
                    agent_name=agent_name,
                    session_id=session_id,
                )
        # Inline: use minimal system prompt optimized for [CURSOR] placeholder format
        if _is_inline:
            system = (
                "Code completion engine. "
                "Output ONLY the missing code that replaces [CURSOR] or continues after the last line. "
                "No markdown, no backticks, no explanations, no comments."
            )
        else:
            system = self._build_system_prompt(
                agent,
                student_id,
                cleaned_context,
                self._merge_shared_contexts(shared_ctx, graph_feedback_ctx),
                tenant_context=tenant_context,
            )
        tools = build_tool_defs(agent.tools)
        tools_disabled = False
        if isinstance(effective_runtime, dict):
            if effective_runtime.get("disable_tools") is True or effective_runtime.get("tools_enabled") is False:
                tools_disabled = True
                tools = []
        # Strip tools for inline completion — model should only generate text
        if isinstance(effective_runtime, dict) and effective_runtime.get("mode") == "fast":
            task_type = (cleaned_context or {}).get("taskType", "")
            if "inline" in str(task_type).lower():
                tools = []
        engine = EngineFactory.create(agent)

        accumulated = ""
        structured_preview = ""
        session_used = session_id if isinstance(session_id, str) and session_id else None
        total_cost = 0.0
        input_tokens = 0
        output_tokens = 0
        request_id = f"req_{uuid4().hex[:12]}"
        tool_call_count = 0
        retry_count = 0
        fallback_applied = False
        saw_done = False
        stop_reason = "unknown"

        request_ctx_token = set_agent_request_context(
            AgentRequestContext(
                agent_name=agent_name,
                student_id=student_id or "",
                role=role,
                session_id=session_id or "",
                engine=agent.engine,
                mode=mode,
            )
        )

        try:
            if orchestrator_meta:
                yield _json(
                    {
                        "type": "orchestrator",
                        "stage": "planned",
                        **orchestrator_meta,
                        "tenant": compact_tenant_context(tenant_context),
                    }
                )
                for event in orchestrator_events:
                    event_payload = dict(event)
                    event_payload.setdefault("tenant", compact_tenant_context(tenant_context))
                    yield _json(event_payload)

            meta_payload: dict[str, Any] = {
                "type": "meta",
                "agent": agent_name,
                "engine": agent.engine,
                "model": self._model_label(agent),
                "mode": mode,
                "request_id": request_id,
                "tools_enabled": not tools_disabled,
            }
            if output_format_used:
                meta_payload["output_format"] = output_format_used
            if orchestrator_meta:
                meta_payload["orchestrator_profile"] = orchestrator_meta.get("profile")
            meta_payload["tenant"] = compact_tenant_context(tenant_context)
            yield _json(meta_payload)

            # Detect inline mode for engine optimizations
            _is_inline = "inline" in str((cleaned_context or {}).get("taskType", "")).lower()

            async for event in engine.stream(
                effective_prompt,
                system,
                tools,
                role=role,
                session_id=session_id,
                student_id=student_id,
                agent_name=agent_name,
                output_format=output_format,
                inline_mode=_is_inline,
            ):
                out_event = event
                try:
                    parsed = json.loads(event)
                    event_type = parsed.get("type")
                    if event_type == "text":
                        accumulated += parsed.get("content", "")
                    elif event_type == "structured_output":
                        data = parsed.get("data")
                        structured_preview = _extract_summary(
                            data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
                        )
                    elif event_type == "tool_call":
                        if str(parsed.get("status") or "") == "calling":
                            tool_call_count += 1
                        if str(parsed.get("status") or "") == "done":
                            append_reasoning(
                                f"tool_done: {parsed.get('tool') or ''}",
                                source="stream",
                            )
                    elif event_type == "tool_retry":
                        retry_count += 1
                    elif event_type == "tool_fallback":
                        fallback_applied = True
                    elif event_type == "model_fallback":
                        fallback_applied = True
                        logger.info(
                            "Model cascade: %s → %s (reason=%s) req=%s",
                            parsed.get("from_model"), parsed.get("to_model"),
                            parsed.get("reason"), request_id,
                        )
                    elif event_type == "approval_result":
                        append_reasoning(
                            f"approval: {'approved' if parsed.get('approved') else 'rejected'} {parsed.get('tool') or ''}",
                            source="approval",
                        )
                    elif event_type == "done":
                        saw_done = True
                        sid = parsed.get("session_id")
                        if isinstance(sid, str) and sid.strip():
                            session_used = sid.strip()
                        total_cost = float(parsed.get("cost") or 0.0)
                        input_tokens = int(parsed.get("input_tokens") or 0)
                        output_tokens = int(parsed.get("output_tokens") or 0)
                        stop_reason = str(parsed.get("stop_reason") or "unknown")
                        parsed.setdefault("stop_reason", stop_reason)
                        parsed.setdefault("request_id", request_id)
                        parsed.setdefault("effective_model", self._model_label(agent))
                        parsed.setdefault("fallback_applied", fallback_applied)
                        parsed.setdefault("retry_count", retry_count)
                        parsed.setdefault("tool_call_count", tool_call_count)
                        out_event = _json(parsed)
                except Exception:
                    pass
                yield out_event
        except Exception:
            logger.exception("Agent stream error for %s", agent_name)
            yield _json({"type": "text", "content": "AI 服务出现错误，请稍后再试。"})
            saw_done = True
            stop_reason = "error"
            yield _json({
                "type": "done",
                "cost": 0.0,
                "stop_reason": stop_reason,
                "request_id": request_id,
                "effective_model": self._model_label(agent),
                "fallback_applied": fallback_applied,
                "retry_count": retry_count,
                "tool_call_count": tool_call_count,
            })
        finally:
            if not saw_done:
                if tool_call_count > 0:
                    stop_reason = "tool_use_pending"
                    yield _json({
                        "type": "text",
                        "content": "模型进入工具调用分支，当前回合未完成 tool_result 闭环。",
                    })
                else:
                    stop_reason = "stream_closed"
                yield _json({
                    "type": "done",
                    "session_id": session_used,
                    "cost": total_cost,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "stop_reason": stop_reason,
                    "request_id": request_id,
                    "effective_model": self._model_label(agent),
                    "fallback_applied": fallback_applied,
                    "retry_count": retry_count,
                    "tool_call_count": tool_call_count,
                })

            summary = _extract_summary(accumulated) or structured_preview
            if summary:
                append_reasoning(f"stream_summary: {summary}", source="agent")

            if not session_used and student_id and agent.engine == "openai":
                session_used = f"openai:{agent_name}:{student_id}"

            # Fire-and-forget DB ops — failures logged, never block stream
            async def _persist_session_data():
                try:
                    if summary and student_id and not _is_inline:
                        await append_summary(student_id, agent_name, summary)
                    if student_id and session_used and not _is_inline:
                        await upsert_session(
                            student_id=student_id,
                            session_id=session_used,
                            agent_name=agent_name,
                            engine=agent.engine,
                            model=self._model_label(agent),
                            mode=mode,
                            prompt=original_prompt,
                            summary=summary,
                            cost_usd=total_cost,
                            input_tokens=input_tokens,
                            output_tokens=output_tokens,
                        )
                except Exception:
                    logger.warning(
                        "Failed to persist session data agent=%s sid=%s",
                        agent_name, session_used, exc_info=True,
                    )

            asyncio.create_task(_persist_session_data())

            reset_agent_request_context(request_ctx_token)
            reset_run_scratchpad(scratchpad_token)
            reset_coding_runtime_context(coding_token)

    async def list_sessions(self, student_id: str, limit: int = 20) -> list[dict[str, Any]]:
        """List available sessions for a student."""
        from app.services.shared_memory import list_sessions as list_session_items

        if not student_id:
            return []
        return await list_session_items(student_id, limit=limit)

    async def clear_sessions(
        self,
        student_id: str,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """Clear one session or all sessions (including OpenAI history if needed)."""
        from app.services.shared_memory import (
            clear_context,
            clear_messages,
            clear_sessions as clear_session_items,
            list_sessions as list_session_items,
        )

        if not student_id:
            return {"ok": True, "cleared": 0}

        existing = await list_session_items(student_id, limit=100)
        cleared = await clear_session_items(student_id, session_id=session_id)

        if session_id:
            target = next((s for s in existing if s.get("session_id") == session_id), None)
            if target and str(target.get("engine", "")).lower() == "openai":
                target_agent = str(target.get("agent_name", "")).strip()
                if target_agent:
                    await clear_messages(target_agent, student_id)
            elif session_id.startswith("openai:"):
                parts = session_id.split(":", 2)
                if len(parts) >= 2 and parts[1].strip():
                    await clear_messages(parts[1].strip(), student_id)
        else:
            for item in existing:
                if str(item.get("engine", "")).lower() == "openai":
                    target_agent = str(item.get("agent_name", "")).strip()
                    if target_agent:
                        await clear_messages(target_agent, student_id)
            await clear_context(student_id)

        return {
            "ok": True,
            "cleared": int(cleared),
            "session_id": session_id,
        }

    async def _query_once(
        self,
        agent_name: str,
        prompt: str,
        student_id: str | None,
        cleaned_context: dict[str, Any] | None,
        role: str,
        tenant_context: TenantContext | None,
        agent: AgentDef,
        mode: str,
        output_format: dict[str, Any] | None,
        output_format_used: str | None,
        persist_summary: bool,
    ) -> dict[str, Any]:
        """Execute one query pass against resolved engine."""
        from app.services.shared_memory import (
            append_summary,
            get_context,
            get_graph_feedback_context,
        )

        shared_ctx = await get_context(student_id or "")
        graph_feedback_ctx = ""
        if student_id and agent_name == "graph-analyst":
            graph_feedback_ctx = await get_graph_feedback_context(
                student_id,
                agent_name=agent_name,
            )
        system = self._build_system_prompt(
            agent,
            student_id,
            cleaned_context,
            self._merge_shared_contexts(shared_ctx, graph_feedback_ctx),
            tenant_context=tenant_context,
        )
        tools = build_tool_defs(agent.tools)
        engine = EngineFactory.create(agent)

        request_ctx_token = set_agent_request_context(
            AgentRequestContext(
                agent_name=agent_name,
                student_id=student_id or "",
                role=role,
                session_id="",
                engine=agent.engine,
                mode=mode,
            )
        )

        try:
            result = await engine.query(
                prompt,
                system,
                tools,
                role=role,
                student_id=student_id,
                agent_name=agent_name,
                output_format=output_format,
            )
            result["agent_used"] = agent_name
            result["engine_used"] = agent.engine
            result["model_used"] = self._model_label(agent)
            result["mode_used"] = mode
            if output_format_used:
                result["output_format_used"] = output_format_used
            result["tenant"] = compact_tenant_context(tenant_context)

            summary = _extract_summary(result.get("response", ""))
            if summary:
                append_reasoning(
                    f"query_result({agent.engine}/{mode}): {summary}",
                    source="agent",
                )
            if persist_summary and summary and student_id:
                await append_summary(student_id, agent_name, summary)
            return result
        except Exception:
            logger.exception("Agent query error for %s", agent_name)
            append_reasoning(
                f"query_error({agent.engine}/{mode}): failed",
                source="agent",
            )
            return {
                "response": "AI 服务出现错误，请稍后再试。",
                "structured_output": None,
                "agent_used": agent_name,
                "engine_used": agent.engine,
                "model_used": self._model_label(agent),
                "mode_used": mode,
                "output_format_used": output_format_used,
                "tenant": compact_tenant_context(tenant_context),
                "cost_usd": 0.0,
                "input_tokens": 0,
                "output_tokens": 0,
            }
        finally:
            reset_agent_request_context(request_ctx_token)

    async def _run_orchestrated_query(
        self,
        agent_name: str,
        base_agent: AgentDef,
        prompt: str,
        student_id: str | None,
        cleaned_context: dict[str, Any] | None,
        role: str,
        runtime: dict[str, Any] | None,
        config: OrchestratorConfig,
        tenant_context: TenantContext | None,
    ) -> dict[str, Any] | None:
        """Run planner + worker DAG + final synthesis for query path."""
        orchestration_data = await self._run_orchestration_loop(
            agent_name=agent_name,
            base_agent=base_agent,
            prompt=prompt,
            student_id=student_id,
            cleaned_context=cleaned_context,
            role=role,
            runtime=runtime,
            config=config,
            tenant_context=tenant_context,
            event_sink=None,
        )
        if orchestration_data is None:
            return None

        plan_data = orchestration_data["plan_data"]
        worker_trace = orchestration_data["worker_trace"]
        critique = orchestration_data.get("critique")
        replan_count = int(orchestration_data.get("replan_count") or 0)

        runtime_for_execution: dict[str, Any] = dict(runtime or {})
        runtime_for_execution["mode"] = plan_data["selected_mode"]
        runtime_for_execution.pop("orchestrator", None)

        agent, mode = self._resolve_runtime_agent(base_agent, runtime_for_execution)
        output_format, output_format_used = self._resolve_output_format(runtime_for_execution)

        execution_prompt = self._build_orchestration_execution_prompt(
            original_prompt=prompt,
            plan=plan_data["plan"],
            worker_trace=worker_trace,
        )

        result = await self._query_once(
            agent_name=agent_name,
            prompt=execution_prompt,
            student_id=student_id,
            cleaned_context=cleaned_context,
            role=role,
            tenant_context=tenant_context,
            agent=agent,
            mode=mode,
            output_format=output_format,
            output_format_used=output_format_used,
            persist_summary=True,
        )
        result["orchestrator"] = {
            **plan_data["meta"],
            "tenant": compact_tenant_context(tenant_context),
            "worker_count": len(worker_trace),
            "worker_cost_usd": self._calc_worker_trace_cost(worker_trace),
            "workers": self._compact_worker_trace(worker_trace),
            "replan_count": replan_count,
            "critique": critique,
        }
        return result

    async def _run_orchestration_loop(
        self,
        agent_name: str,
        base_agent: AgentDef,
        prompt: str,
        student_id: str | None,
        cleaned_context: dict[str, Any] | None,
        role: str,
        runtime: dict[str, Any] | None,
        config: OrchestratorConfig,
        tenant_context: TenantContext | None,
        event_sink: Callable[[dict[str, Any]], Awaitable[None]] | None,
    ) -> dict[str, Any] | None:
        """Run DAG execution with critique worker and optional dynamic replan."""
        plan_data = await self._plan_orchestration(
            agent_name=agent_name,
            base_agent=base_agent,
            prompt=prompt,
            student_id=student_id,
            cleaned_context=cleaned_context,
            role=role,
            runtime=runtime,
            config=config,
            tenant_context=tenant_context,
        )
        if plan_data is None:
            return None

        current_plan_data = plan_data
        full_worker_trace: list[dict[str, Any]] = []
        critique_result: dict[str, Any] | None = None
        replan_count = 0

        for round_index in range(config.max_replans + 1):
            round_number = round_index + 1
            if event_sink and round_number > 1:
                await event_sink(
                    {
                        "type": "orchestrator",
                        "stage": "replan_start",
                        "replan_round": round_number,
                        "reason": str((critique_result or {}).get("summary") or "critique requested replan"),
                        "tenant": compact_tenant_context(tenant_context),
                    }
                )

            round_trace = await self._execute_orchestration_dag(
                agent_name=agent_name,
                base_agent=base_agent,
                prompt=prompt,
                student_id=student_id,
                cleaned_context=cleaned_context,
                role=role,
                runtime=runtime,
                plan=current_plan_data["plan"],
                config=config,
                tenant_context=tenant_context,
                event_sink=event_sink,
            )
            for item in round_trace:
                item["plan_round"] = round_number
            full_worker_trace.extend(round_trace)

            if not config.critique_enabled:
                break

            critique_result = await self._run_critique_worker(
                agent_name=agent_name,
                base_agent=base_agent,
                prompt=prompt,
                student_id=student_id,
                cleaned_context=cleaned_context,
                role=role,
                runtime=runtime,
                plan=current_plan_data["plan"],
                worker_trace=full_worker_trace,
                config=config,
                tenant_context=tenant_context,
            )

            should_replan = bool(
                config.dynamic_replan_enabled
                and critique_result
                and not bool(critique_result.get("pass"))
                and replan_count < config.max_replans
            )

            if event_sink:
                await event_sink(
                    {
                        "type": "orchestrator",
                        "stage": "critique_done",
                        "replan_round": round_number,
                        "critique_pass": bool((critique_result or {}).get("pass")),
                        "critique_score": float((critique_result or {}).get("score") or 0.0),
                        "critique_summary": str((critique_result or {}).get("summary") or ""),
                        "critique_issues": (critique_result or {}).get("issues") or [],
                        "critique_recommendations": (critique_result or {}).get("recommendations") or [],
                        "should_replan": should_replan,
                        "tenant": compact_tenant_context(tenant_context),
                    }
                )

            if not should_replan:
                break

            revised_plan_data = await self._replan_orchestration(
                agent_name=agent_name,
                base_agent=base_agent,
                prompt=prompt,
                student_id=student_id,
                cleaned_context=cleaned_context,
                role=role,
                runtime=runtime,
                previous_plan=current_plan_data["plan"],
                worker_trace=full_worker_trace,
                critique_result=critique_result,
                config=config,
                tenant_context=tenant_context,
            )

            if revised_plan_data is None:
                if event_sink:
                    await event_sink(
                        {
                            "type": "orchestrator",
                            "stage": "replan_done",
                            "replan_round": round_number + 1,
                            "success": False,
                            "tenant": compact_tenant_context(tenant_context),
                        }
                    )
                break

            replan_count += 1
            current_plan_data = revised_plan_data
            if event_sink:
                await event_sink(
                    {
                        "type": "orchestrator",
                        "stage": "replan_done",
                        "replan_round": round_number + 1,
                        "success": True,
                        "strategy": str(current_plan_data["plan"].get("strategy") or "replanned"),
                        "complexity": str(current_plan_data["plan"].get("complexity") or "medium"),
                        "selected_mode": current_plan_data.get("selected_mode"),
                        "steps": summarize_plan_steps(current_plan_data["plan"], max_steps=config.max_steps),
                        "tenant": compact_tenant_context(tenant_context),
                    }
                )

        return {
            "plan_data": current_plan_data,
            "worker_trace": full_worker_trace,
            "critique": critique_result,
            "replan_count": replan_count,
        }

    async def _run_critique_worker(
        self,
        agent_name: str,
        base_agent: AgentDef,
        prompt: str,
        student_id: str | None,
        cleaned_context: dict[str, Any] | None,
        role: str,
        runtime: dict[str, Any] | None,
        plan: WebAgentPlan,
        worker_trace: list[dict[str, Any]],
        config: OrchestratorConfig,
        tenant_context: TenantContext | None,
    ) -> dict[str, Any]:
        """Run critique worker and normalize verdict for optional replan."""
        critique_base = AGENT_REGISTRY.get("quick-qa", base_agent)
        critique_base = replace(critique_base, tools=[])

        critique_runtime: dict[str, Any] = {
            "mode": config.critique_mode,
        }
        critique_agent, critique_mode = self._resolve_runtime_agent(critique_base, critique_runtime)

        critique_prompt = self._build_orchestration_critique_prompt(
            original_prompt=prompt,
            plan=plan,
            worker_trace=worker_trace,
        )

        critique_result = await self._query_once(
            agent_name=agent_name,
            prompt=critique_prompt,
            student_id=student_id,
            cleaned_context=cleaned_context,
            role=role,
            tenant_context=tenant_context,
            agent=critique_agent,
            mode=critique_mode,
            output_format=_CRITIQUE_OUTPUT_FORMAT,
            output_format_used="webagent_critique_v1",
            persist_summary=False,
        )

        return self._normalize_critique_result(
            structured_output=critique_result.get("structured_output"),
            text_output=str(critique_result.get("response") or ""),
        )

    def _normalize_critique_result(
        self,
        structured_output: Any,
        text_output: str,
    ) -> dict[str, Any]:
        """Normalize critique worker output to stable contract."""
        if isinstance(structured_output, dict):
            issues = [
                str(item)
                for item in (structured_output.get("issues") or [])
                if isinstance(item, str) and str(item).strip()
            ]
            recommendations = [
                str(item)
                for item in (structured_output.get("recommendations") or [])
                if isinstance(item, str) and str(item).strip()
            ]
            score = float(structured_output.get("score") or 0.0)
            score = max(0.0, min(score, 1.0))
            passed = bool(structured_output.get("pass"))
            summary = str(structured_output.get("summary") or "").strip()
            return {
                "pass": passed,
                "score": round(score, 4),
                "issues": issues,
                "recommendations": recommendations,
                "summary": summary or ("critique pass" if passed else "critique suggests replan"),
            }

        text = str(text_output or "").strip()
        lowered = text.lower()
        likely_fail = any(keyword in lowered for keyword in ("replan", "insufficient", "缺失", "不足", "失败"))
        return {
            "pass": not likely_fail,
            "score": 0.4 if likely_fail else 0.85,
            "issues": ["fallback critique from text output"],
            "recommendations": ["trigger replan" if likely_fail else "continue synthesis"],
            "summary": _extract_summary(text) or ("critique suggests replan" if likely_fail else "critique pass"),
        }

    async def _replan_orchestration(
        self,
        agent_name: str,
        base_agent: AgentDef,
        prompt: str,
        student_id: str | None,
        cleaned_context: dict[str, Any] | None,
        role: str,
        runtime: dict[str, Any] | None,
        previous_plan: WebAgentPlan,
        worker_trace: list[dict[str, Any]],
        critique_result: dict[str, Any],
        config: OrchestratorConfig,
        tenant_context: TenantContext | None,
    ) -> dict[str, Any] | None:
        """Rebuild DAG plan based on critique verdict and existing worker artifacts."""
        planner_base = AGENT_REGISTRY.get("quick-qa", base_agent)
        planner_base = replace(planner_base, tools=[])

        planner_runtime: dict[str, Any] = {
            "mode": config.planner_mode,
            "engine": "openai",
        }
        planner_agent, planner_mode = self._resolve_runtime_agent(planner_base, planner_runtime)

        replan_prompt = self._build_orchestration_replan_prompt(
            agent_name=agent_name,
            prompt=prompt,
            previous_plan=previous_plan,
            worker_trace=worker_trace,
            critique_result=critique_result,
            available_tools=base_agent.tools,
            cleaned_context=cleaned_context,
            max_steps=config.max_steps,
            max_workers=config.max_workers,
        )

        planner_output_format = build_plan_output_format(config.max_steps)
        planner_result = await self._query_once(
            agent_name="quick-qa",
            prompt=replan_prompt,
            student_id=student_id,
            cleaned_context=cleaned_context,
            role=role,
            tenant_context=tenant_context,
            agent=planner_agent,
            mode=planner_mode,
            output_format=planner_output_format,
            output_format_used="webagent_plan_v1_replan",
            persist_summary=False,
        )

        plan = parse_webagent_plan(
            structured_output=planner_result.get("structured_output"),
            text_output=str(planner_result.get("response") or ""),
        )
        if not plan:
            return None

        explicit_mode = str((runtime or {}).get("mode") or "").strip().lower()
        selected_mode = (
            explicit_mode
            if explicit_mode in _ALLOWED_MODES
            else pick_execution_mode(plan, config.executor_mode, _ALLOWED_MODES)
        )

        planner_meta = {
            "engine": planner_agent.engine,
            "model": self._model_label(planner_agent),
            "mode": planner_mode,
        }

        return {
            "plan": plan,
            "selected_mode": selected_mode,
            "meta": {
                "protocol": PROTOCOL_VERSION,
                "profile": config.profile,
                "strategy": str(plan.get("strategy") or "dag-replanned-execution"),
                "complexity": str(plan.get("complexity") or "medium"),
                "selected_mode": selected_mode,
                "max_workers": config.max_workers,
                "worker_timeout_s": config.worker_timeout_s,
                "worker_max_retries": config.worker_max_retries,
                "worker_retry_backoff_ms": config.worker_retry_backoff_ms,
                "max_budget_usd": config.max_budget_usd,
                "critique_enabled": config.critique_enabled,
                "critique_mode": config.critique_mode,
                "dynamic_replan_enabled": config.dynamic_replan_enabled,
                "max_replans": config.max_replans,
                "planner": planner_meta,
                "steps": summarize_plan_steps(plan, max_steps=config.max_steps),
                "tenant": compact_tenant_context(tenant_context),
            },
        }

    async def _plan_orchestration(
        self,
        agent_name: str,
        base_agent: AgentDef,
        prompt: str,
        student_id: str | None,
        cleaned_context: dict[str, Any] | None,
        role: str,
        runtime: dict[str, Any] | None,
        config: OrchestratorConfig,
        tenant_context: TenantContext | None,
    ) -> dict[str, Any] | None:
        """Build DAG plan with planner model and return orchestration metadata."""
        planner_base = AGENT_REGISTRY.get("quick-qa", base_agent)
        planner_base = replace(planner_base, tools=[])

        planner_runtime: dict[str, Any] = {
            "mode": config.planner_mode,
            "engine": "openai",
        }
        planner_agent, planner_mode = self._resolve_runtime_agent(planner_base, planner_runtime)

        planner_prompt = self._build_orchestration_planner_prompt(
            agent_name=agent_name,
            prompt=prompt,
            available_tools=base_agent.tools,
            cleaned_context=cleaned_context,
            max_steps=config.max_steps,
            max_workers=config.max_workers,
        )

        planner_output_format = build_plan_output_format(config.max_steps)
        planner_result = await self._query_once(
            agent_name="quick-qa",
            prompt=planner_prompt,
            student_id=student_id,
            cleaned_context=cleaned_context,
            role=role,
            tenant_context=tenant_context,
            agent=planner_agent,
            mode=planner_mode,
            output_format=planner_output_format,
            output_format_used="webagent_plan_v1",
            persist_summary=False,
        )

        plan = parse_webagent_plan(
            structured_output=planner_result.get("structured_output"),
            text_output=str(planner_result.get("response") or ""),
        )
        if not plan:
            return None

        explicit_mode = str((runtime or {}).get("mode") or "").strip().lower()
        selected_mode = (
            explicit_mode
            if explicit_mode in _ALLOWED_MODES
            else pick_execution_mode(plan, config.executor_mode, _ALLOWED_MODES)
        )

        planner_meta = {
            "engine": planner_agent.engine,
            "model": self._model_label(planner_agent),
            "mode": planner_mode,
        }

        return {
            "plan": plan,
            "selected_mode": selected_mode,
            "meta": {
                "protocol": PROTOCOL_VERSION,
                "profile": config.profile,
                "strategy": str(plan.get("strategy") or "dag-orchestrated-execution"),
                "complexity": str(plan.get("complexity") or "medium"),
                "selected_mode": selected_mode,
                "max_workers": config.max_workers,
                "worker_timeout_s": config.worker_timeout_s,
                "worker_max_retries": config.worker_max_retries,
                "worker_retry_backoff_ms": config.worker_retry_backoff_ms,
                "max_budget_usd": config.max_budget_usd,
                "critique_enabled": config.critique_enabled,
                "critique_mode": config.critique_mode,
                "dynamic_replan_enabled": config.dynamic_replan_enabled,
                "max_replans": config.max_replans,
                "planner": planner_meta,
                "steps": summarize_plan_steps(plan, max_steps=config.max_steps),
                "tenant": compact_tenant_context(tenant_context),
            },
        }

    async def _execute_orchestration_dag(
        self,
        agent_name: str,
        base_agent: AgentDef,
        prompt: str,
        student_id: str | None,
        cleaned_context: dict[str, Any] | None,
        role: str,
        runtime: dict[str, Any] | None,
        plan: WebAgentPlan,
        config: OrchestratorConfig,
        tenant_context: TenantContext | None,
        event_sink: Callable[[dict[str, Any]], Awaitable[None]] | None,
    ) -> list[dict[str, Any]]:
        """Execute planned DAG using multi-worker layered concurrency."""
        layers = build_dag_layers(plan, max_nodes=config.max_steps)
        if not layers:
            return []

        semaphore = asyncio.Semaphore(config.max_workers)
        artifacts: dict[str, dict[str, Any]] = {}
        trace: list[dict[str, Any]] = []
        budget_cap = config.max_budget_usd if config.max_budget_usd > 0 else None
        spent_budget = 0.0

        for layer_index, layer_nodes in enumerate(layers, start=1):
            if budget_cap is not None and spent_budget >= budget_cap:
                if event_sink:
                    await event_sink(
                        {
                            "type": "orchestrator",
                            "stage": "budget_exhausted",
                            "layer_index": layer_index,
                            "spent_budget_usd": round(spent_budget, 6),
                            "max_budget_usd": budget_cap,
                            "tenant": compact_tenant_context(tenant_context),
                        }
                    )
                break

            if event_sink:
                await event_sink(
                    {
                        "type": "orchestrator",
                        "stage": "layer_start",
                        "layer_index": layer_index,
                        "node_count": len(layer_nodes),
                        "tenant": compact_tenant_context(tenant_context),
                    }
                )

            async def _run(node: WebAgentPlanNode) -> dict[str, Any]:
                async with semaphore:
                    return await self._run_worker_node(
                        agent_name=agent_name,
                        base_agent=base_agent,
                        node=node,
                        original_prompt=prompt,
                        student_id=student_id,
                        cleaned_context=cleaned_context,
                        role=role,
                        runtime=runtime,
                        config=config,
                        tenant_context=tenant_context,
                        artifacts=artifacts,
                        event_sink=event_sink,
                    )

            raw_results = await asyncio.gather(*[_run(node) for node in layer_nodes], return_exceptions=True)

            for node, item in zip(layer_nodes, raw_results, strict=False):
                node_id = str(node.get("id") or "")
                if isinstance(item, Exception):
                    logger.exception("Worker node failed: %s", node_id)
                    artifact: WorkerArtifact = {
                        "id": node_id,
                        "title": str(node.get("title") or node_id),
                        "kind": str(node.get("kind") or "gather"),
                        "mode": str(node.get("mode") or "balanced"),
                        "status": "error",
                        "summary": f"worker failed: {item}",
                        "depends_on": [
                            str(dep)
                            for dep in (node.get("depends_on") or [])
                            if isinstance(dep, str)
                        ],
                        "tools_allowed": [
                            str(tool_name)
                            for tool_name in (node.get("tools") or [])
                            if isinstance(tool_name, str)
                        ],
                        "attempts": 1,
                        "failure_reason": "worker exception",
                        "cost_usd": 0.0,
                        "artifact": infer_artifact_contract(
                            response_text=f"worker failed: {item}",
                            structured_output=None,
                        ),
                    }
                else:
                    artifact = item

                if node_id:
                    artifacts[node_id] = artifact
                trace.append(artifact)
                spent_budget += float(artifact.get("cost_usd") or 0.0)

            if event_sink:
                await event_sink(
                    {
                        "type": "orchestrator",
                        "stage": "layer_done",
                        "layer_index": layer_index,
                        "node_count": len(layer_nodes),
                        "spent_budget_usd": round(spent_budget, 6),
                        "tenant": compact_tenant_context(tenant_context),
                    }
                )

        return trace

    async def _run_worker_node(
        self,
        agent_name: str,
        base_agent: AgentDef,
        node: WebAgentPlanNode,
        original_prompt: str,
        student_id: str | None,
        cleaned_context: dict[str, Any] | None,
        role: str,
        runtime: dict[str, Any] | None,
        config: OrchestratorConfig,
        tenant_context: TenantContext | None,
        artifacts: dict[str, dict[str, Any]],
        event_sink: Callable[[dict[str, Any]], Awaitable[None]] | None,
    ) -> dict[str, Any]:
        """Run one DAG worker node and return artifact."""
        node_id = str(node.get("id") or "")
        title = str(node.get("title") or node_id or "worker")
        kind = str(node.get("kind") or "gather")
        depends_on = [
            str(dep)
            for dep in (node.get("depends_on") or [])
            if isinstance(dep, str)
        ]
        requested_mode = str(node.get("mode") or "")
        worker_mode = self._resolve_worker_mode(requested_mode, kind)

        worker_runtime = self._derive_worker_runtime(runtime, worker_mode)
        worker_agent, resolved_mode = self._resolve_runtime_agent(base_agent, worker_runtime)

        requested_tools = [
            str(tool_name).strip()
            for tool_name in (node.get("tools") or [])
            if isinstance(tool_name, str) and str(tool_name).strip()
        ]
        allowed_tools = self._resolve_worker_tools(base_agent.tools, requested_tools)
        worker_agent = replace(worker_agent, tools=allowed_tools)

        if event_sink:
            await event_sink(
                {
                    "type": "orchestrator",
                    "stage": "worker_start",
                    "node_id": node_id,
                    "title": title,
                    "kind": kind,
                    "mode": resolved_mode,
                    "depends_on": depends_on,
                    "tools": allowed_tools,
                    "tenant": compact_tenant_context(tenant_context),
                }
            )

        worker_prompt = self._build_worker_prompt(
            original_prompt=original_prompt,
            node=node,
            dependencies=depends_on,
            artifacts=artifacts,
        )

        attempts = 0
        failure_reason = ""
        result: dict[str, Any] = self._build_worker_error_result(
            agent_name=agent_name,
            agent=worker_agent,
            mode=resolved_mode,
            output_format_used=None,
        )

        max_attempts = config.worker_max_retries + 1

        for attempt in range(1, max_attempts + 1):
            attempts = attempt
            try:
                candidate = await asyncio.wait_for(
                    self._query_once(
                        agent_name=agent_name,
                        prompt=worker_prompt,
                        student_id=student_id,
                        cleaned_context=cleaned_context,
                        role=role,
                        tenant_context=tenant_context,
                        agent=worker_agent,
                        mode=resolved_mode,
                        output_format=None,
                        output_format_used=None,
                        persist_summary=False,
                    ),
                    timeout=config.worker_timeout_s,
                )
                candidate_response = str(candidate.get("response") or "")
                if candidate_response and "AI 服务出现错误" not in candidate_response:
                    result = candidate
                    failure_reason = ""
                    break
                result = candidate
                failure_reason = "engine returned fallback response"
            except asyncio.TimeoutError:
                failure_reason = f"timeout after {config.worker_timeout_s}s"
                result = self._build_worker_error_result(
                    agent_name=agent_name,
                    agent=worker_agent,
                    mode=resolved_mode,
                    output_format_used=None,
                )
            except Exception as exc:
                logger.exception("Worker node runtime error: %s", node_id)
                failure_reason = f"worker exception: {exc}"
                result = self._build_worker_error_result(
                    agent_name=agent_name,
                    agent=worker_agent,
                    mode=resolved_mode,
                    output_format_used=None,
                )

            if attempt < max_attempts:
                backoff_ms = min(
                    config.worker_retry_backoff_ms * (2 ** (attempt - 1)),
                    10_000,
                )
                if event_sink:
                    await event_sink(
                        {
                            "type": "orchestrator",
                            "stage": "worker_retry",
                            "node_id": node_id,
                            "title": title,
                            "attempt": attempt,
                            "max_attempts": max_attempts,
                            "reason": failure_reason,
                            "next_backoff_ms": backoff_ms,
                            "tenant": compact_tenant_context(tenant_context),
                        }
                    )
                await asyncio.sleep(backoff_ms / 1000.0)

        response_text = str(result.get("response") or "")
        status = "done" if response_text and "AI 服务出现错误" not in response_text else "error"
        summary = _extract_summary(response_text)
        if not summary and result.get("structured_output") is not None:
            summary = _extract_summary(json.dumps(result.get("structured_output"), ensure_ascii=False))
        if status == "error" and not summary:
            summary = failure_reason[:120] if failure_reason else "worker failed"

        artifact: WorkerArtifact = {
            "id": node_id,
            "title": title,
            "kind": kind,
            "mode": resolved_mode,
            "depends_on": depends_on,
            "tools_allowed": allowed_tools,
            "attempts": attempts,
            "status": status,
            "failure_reason": failure_reason if status == "error" else "",
            "objective": str(node.get("objective") or ""),
            "deliverable": str(node.get("deliverable") or ""),
            "summary": summary,
            "response_preview": response_text[:400],
            "engine_used": result.get("engine_used"),
            "model_used": result.get("model_used"),
            "cost_usd": float(result.get("cost_usd") or 0.0),
            "input_tokens": int(result.get("input_tokens") or 0),
            "output_tokens": int(result.get("output_tokens") or 0),
            "artifact": infer_artifact_contract(
                response_text=response_text,
                structured_output=result.get("structured_output"),
            ),
        }

        if event_sink:
            await event_sink(
                {
                    "type": "orchestrator",
                    "stage": "worker_done",
                    "node_id": node_id,
                    "title": title,
                    "kind": kind,
                    "mode": resolved_mode,
                    "status": status,
                    "attempts": attempts,
                    "engine": result.get("engine_used"),
                    "model": result.get("model_used"),
                    "cost": float(result.get("cost_usd") or 0.0),
                    "failure_reason": failure_reason if status == "error" else "",
                    "artifact_type": str((artifact.get("artifact") or {}).get("kind") or ""),
                    "artifact_uri": str((artifact.get("artifact") or {}).get("uri") or ""),
                    "tenant": compact_tenant_context(tenant_context),
                }
            )

        return artifact

    def _compact_worker_trace(
        self,
        worker_trace: list[dict[str, Any]],
        limit: int = 12,
    ) -> list[dict[str, Any]]:
        """Compact worker trace payload for API/SSE response."""
        return core_compact_worker_trace(worker_trace, limit=limit)

    def _calc_worker_trace_cost(self, worker_trace: list[dict[str, Any]]) -> float:
        """Calculate total worker cost for orchestrator telemetry."""
        return core_calc_worker_trace_cost(worker_trace)

    def _resolve_worker_tools(self, base_tools: list[str], requested_tools: list[str]) -> list[str]:
        """Resolve worker tool whitelist from node.tools declaration."""
        return core_resolve_worker_tools(base_tools, requested_tools)

    def _build_worker_error_result(
        self,
        agent_name: str,
        agent: AgentDef,
        mode: str,
        output_format_used: str | None,
    ) -> dict[str, Any]:
        """Build normalized worker error payload."""
        return {
            "response": "AI 服务出现错误，请稍后再试。",
            "structured_output": None,
            "agent_used": agent_name,
            "engine_used": agent.engine,
            "model_used": self._model_label(agent),
            "mode_used": mode,
            "output_format_used": output_format_used,
            "cost_usd": 0.0,
            "input_tokens": 0,
            "output_tokens": 0,
        }

    def _resolve_worker_mode(self, requested_mode: str, kind: str) -> str:
        """Resolve worker mode with defaults by worker kind."""
        mode = str(requested_mode or "").strip().lower()
        if mode in _ALLOWED_MODES:
            return mode

        default_mode = _WORKER_MODE_DEFAULT.get(str(kind).lower(), "balanced")
        if default_mode in _ALLOWED_MODES:
            return default_mode
        return "balanced"

    def _derive_worker_runtime(self, runtime: dict[str, Any] | None, mode: str) -> dict[str, Any]:
        """Build worker runtime while preserving explicit engine overrides."""
        worker_runtime: dict[str, Any] = {"mode": mode}
        if isinstance(runtime, dict):
            for key in ("engine", "engine_model", "model_tier"):
                value = runtime.get(key)
                if value is not None:
                    worker_runtime[key] = value
        return worker_runtime

    def _build_worker_prompt(
        self,
        original_prompt: str,
        node: WebAgentPlanNode,
        dependencies: list[str],
        artifacts: dict[str, dict[str, Any]],
    ) -> str:
        """Build one worker prompt from DAG node and dependency artifacts."""
        node_id = str(node.get("id") or "")
        title = str(node.get("title") or node_id)
        kind = str(node.get("kind") or "gather")
        objective = str(node.get("objective") or "")
        deliverable = str(node.get("deliverable") or "")
        tools = [
            str(tool_name)
            for tool_name in (node.get("tools") or [])
            if isinstance(tool_name, str)
        ]

        dependency_lines: list[str] = []
        for dep in dependencies:
            dep_artifact = artifacts.get(dep)
            if not dep_artifact:
                dependency_lines.append(f"- {dep}: (无输出)")
                continue
            dep_summary = str(dep_artifact.get("summary") or "")
            dependency_lines.append(f"- {dep}: {dep_summary}")
        dependency_text = "\n".join(dependency_lines) if dependency_lines else "- 无依赖"

        tool_text = ", ".join(tools) if tools else "(不限，按需选择)"

        kind_guidance = {
            "reason": "以分析和决策为主，明确下一步行动标准。",
            "gather": "优先收集证据与事实，尽量使用只读/可复现工具。",
            "act": "执行任务并产出可落地结果，必要时调用写入类工具。",
            "synthesize": "融合上游结果，形成结构化结论与下一步计划。",
        }.get(kind, "完成本节点目标并产出清晰结果。")

        return (
            "[WebAgent Worker Node]\n"
            f"protocol: {PROTOCOL_VERSION}\n"
            f"node_id: {node_id}\n"
            f"node_title: {title}\n"
            f"worker_kind: {kind}\n"
            f"objective: {objective}\n"
            f"deliverable: {deliverable}\n"
            f"recommended_tools: {tool_text}\n"
            "dependencies:\n"
            f"{dependency_text}\n\n"
            "执行原则：\n"
            f"- {kind_guidance}\n"
            "- 输出要简洁、可验证、可直接给后续节点复用。\n"
            "- 如果使用了工具，给出关键证据摘要。\n\n"
            "用户原始请求：\n"
            f"{original_prompt}"
        )

    def _build_orchestration_critique_prompt(
        self,
        original_prompt: str,
        plan: WebAgentPlan,
        worker_trace: list[dict[str, Any]],
    ) -> str:
        """Build critique prompt for quality gate before final synthesis."""
        plan_steps = compact_plan_for_prompt(plan)
        worker_lines: list[str] = []
        for item in worker_trace:
            worker_lines.append(
                f"- {item.get('id', '')} [{item.get('status', '')}] "
                f"({item.get('kind', '')}/{item.get('mode', '')}) {item.get('summary', '')}"
            )
        worker_text = "\n".join(worker_lines) if worker_lines else "- 无 worker 产物"

        return (
            "你是 WebAgent Critique Worker，负责判断当前 DAG 执行结果是否足以回答用户问题。\n"
            "你必须输出结构化 JSON：pass/score/issues/recommendations/summary。\n"
            "pass=true 表示可直接进入最终汇总；pass=false 表示需要 replan。\n"
            "score 取值范围 0~1。\n"
            "issues 应聚焦缺失证据、逻辑断点、工具调用不足。\n\n"
            "原始用户请求:\n"
            f"{original_prompt}\n\n"
            "当前计划节点:\n"
            f"{plan_steps}\n\n"
            "当前 worker 结果:\n"
            f"{worker_text}"
        )

    def _build_orchestration_replan_prompt(
        self,
        agent_name: str,
        prompt: str,
        previous_plan: WebAgentPlan,
        worker_trace: list[dict[str, Any]],
        critique_result: dict[str, Any],
        available_tools: list[str],
        cleaned_context: dict[str, Any] | None,
        max_steps: int,
        max_workers: int,
    ) -> str:
        """Build planner prompt for dynamic replan."""
        tool_list = ", ".join(available_tools[:40]) if available_tools else "(none)"
        context_text = json.dumps(cleaned_context, ensure_ascii=False) if cleaned_context else "{}"
        prev_steps = compact_plan_for_prompt(previous_plan)

        worker_lines: list[str] = []
        for item in worker_trace:
            worker_lines.append(
                f"- {item.get('id', '')} [{item.get('status', '')}] "
                f"({item.get('kind', '')}/{item.get('mode', '')}) {item.get('summary', '')}"
            )
        worker_text = "\n".join(worker_lines) if worker_lines else "- 无 worker 产物"

        issues = critique_result.get("issues") or []
        issue_text = "\n".join(f"- {str(it)}" for it in issues) if issues else "- 无"
        recs = critique_result.get("recommendations") or []
        rec_text = "\n".join(f"- {str(it)}" for it in recs) if recs else "- 无"

        return (
            "你是 PathMind WebAgent Replan Planner。\n"
            "请基于 critique 结论与现有 worker 产物，重构一个更可执行的 DAG 计划。\n"
            f"protocol 必须是 {PROTOCOL_VERSION}。\n"
            f"最多 {max_steps} 个节点，最少 2 个节点。\n"
            f"执行并发上限参考：{max_workers}。\n"
            "mode 只能是 fast/balanced/deep。\n"
            "kind 只能是 reason/gather/act/synthesize。\n"
            "输出必须是标准 JSON，且每节点包含 depends_on。\n"
            "优先复用已有产物，不要重复无效步骤。\n"
            "你此轮只做规划，禁止调用工具。\n"
            f"\n目标 agent: {agent_name}"
            f"\n可用工具: {tool_list}"
            f"\n附加上下文: {context_text}"
            f"\n\n用户请求:\n{prompt}"
            f"\n\n上轮计划:\n{prev_steps}"
            f"\n\n上轮 worker 产物:\n{worker_text}"
            f"\n\nCritique 问题:\n{issue_text}"
            f"\n\nCritique 建议:\n{rec_text}"
        )

    def _build_orchestration_planner_prompt(
        self,
        agent_name: str,
        prompt: str,
        available_tools: list[str],
        cleaned_context: dict[str, Any] | None,
        max_steps: int,
        max_workers: int,
    ) -> str:
        """Build standardized planner prompt for WebAgent DAG orchestration."""
        tool_list = ", ".join(available_tools[:40]) if available_tools else "(none)"
        context_text = (
            json.dumps(cleaned_context, ensure_ascii=False)
            if cleaned_context
            else "{}"
        )

        return (
            "你是 PathMind WebAgent DAG 编排器。"
            "请把复杂任务拆成可执行 DAG 节点，生成标准化计划 JSON。\n"
            f"protocol 必须是 {PROTOCOL_VERSION}。\n"
            f"最多 {max_steps} 个节点，最少 2 个节点。\n"
            f"执行并发上限参考：{max_workers}。\n"
            "mode 只能是 fast/balanced/deep。\n"
            "kind 只能是 reason/gather/act/synthesize。\n"
            "每个节点必须包含 depends_on（可空数组），体现依赖关系。\n"
            "请尽可能并行化：互不依赖的节点放在不同分支。\n"
            "你此轮只做规划，禁止调用任何工具、禁止发起页面动作或副作用操作。\n"
            "如果需要外部检索/网站抓取/笔记操作，优先在 nodes.tools 中声明。\n"
            f"\n目标 agent: {agent_name}"
            f"\n可用工具: {tool_list}"
            f"\n附加上下文: {context_text}"
            f"\n\n用户请求:\n{prompt}"
        )

    def _build_orchestration_execution_prompt(
        self,
        original_prompt: str,
        plan: WebAgentPlan,
        worker_trace: list[dict[str, Any]],
    ) -> str:
        """Build executor prompt with DAG plan + worker artifacts."""
        plan_steps = compact_plan_for_prompt(plan)
        assumptions = plan.get("assumptions") or []
        assumptions_text = "\n".join(f"- {item}" for item in assumptions) if assumptions else "- 无"

        strategy = str(plan.get("strategy") or "dag-orchestrated-execution")
        complexity = str(plan.get("complexity") or "medium")
        expected_output = str(plan.get("expected_output") or "")

        worker_lines: list[str] = []
        for item in worker_trace:
            worker_lines.append(
                f"- {item.get('id', '')} [{item.get('status', '')}] "
                f"({item.get('kind', '')}/{item.get('mode', '')}) {item.get('summary', '')}"
            )
        worker_text = "\n".join(worker_lines) if worker_lines else "- 无 worker 产物"

        return (
            "[WebAgent Orchestration DAG]\n"
            f"protocol: {PROTOCOL_VERSION}\n"
            f"strategy: {strategy}\n"
            f"complexity: {complexity}\n"
            "nodes:\n"
            f"{plan_steps}\n"
            "assumptions:\n"
            f"{assumptions_text}\n"
            "worker_artifacts:\n"
            f"{worker_text}\n"
            f"expected_output: {expected_output}\n\n"
            "执行要求：\n"
            "1) 基于 worker 结果给出可执行结论，不重复空泛分析。\n"
            "2) 明确写出证据依据与不确定性。\n"
            "3) 输出包含：结论、行动步骤、可复用产物。\n\n"
            "用户原始请求:\n"
            f"{original_prompt}"
        )

    def _build_system_prompt(
        self,
        agent: AgentDef,
        student_id: str | None,
        context: dict | None,
        shared_ctx: str = "",
        tenant_context: TenantContext | None = None,
    ) -> str:
        """Build system prompt with agent definition and student context."""
        parts = [agent.system_prompt]

        if student_id:
            parts.append(f"\n当前学生 ID: {student_id}")

        if context:
            parts.append(f"\n附加上下文: {json.dumps(context, ensure_ascii=False)}")

        if tenant_context:
            parts.append(
                f"\n租户上下文: tenant={tenant_context.tenant_id}, role={tenant_context.role}, user={tenant_context.user_id or '-'}"
            )

        if shared_ctx:
            parts.append(shared_ctx)

        scratchpad = snapshot_for_prompt()
        if scratchpad:
            parts.append(f"\n共享运行记忆:\n{scratchpad}")

        return "\n".join(parts)

    def _merge_shared_contexts(self, *parts: str) -> str:
        """Merge multiple shared-context snippets into one prompt segment."""
        normalized = [part.strip() for part in parts if isinstance(part, str) and part.strip()]
        return "\n".join(normalized)

    def _split_context_and_runtime(
        self,
        context: dict[str, Any] | None,
        *,
        student_id: str | None,
        role: str,
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None, TenantContext]:
        """Split runtime controls from user context to avoid prompt pollution."""
        if not isinstance(context, dict):
            return None, None, parse_tenant_context(None, student_id=student_id, role=role)

        cleaned = dict(context)
        runtime = cleaned.pop(_RUNTIME_KEY, None)
        if not isinstance(runtime, dict):
            runtime = None

        tenant_payload = cleaned.pop(_TENANT_KEY, None)
        if not isinstance(tenant_payload, dict):
            tenant_payload = cleaned.pop("tenant", None)
            if not isinstance(tenant_payload, dict):
                tenant_payload = None

        tenant_context = parse_tenant_context(
            tenant_payload,
            student_id=student_id,
            role=role,
        )

        return cleaned or None, runtime, tenant_context

    def _resolve_runtime_agent(
        self,
        base_agent: AgentDef,
        runtime: dict[str, Any] | None,
    ) -> tuple[AgentDef, str]:
        """Resolve runtime routing for dual engine chain.

        Supported runtime payload (via context._runtime):
        - mode: fast | balanced | deep
        - engine: claude | openai
        - engine_model: specific OpenAI-compatible model id
        - model_tier: haiku | sonnet | opus (Claude tier)
        - output_format: preset id (e.g. advisor_card_v1) or json_schema object
        """
        if not runtime:
            return base_agent, "balanced"

        agent = replace(base_agent)
        mode = str(runtime.get("mode", "balanced")).strip().lower()
        if mode not in _ALLOWED_MODES:
            mode = "balanced"

        if mode == "fast":
            agent.engine = "openai"
            agent.engine_model = agent.engine_model or settings.openai_default_model
        elif mode == "deep":
            agent.engine = "claude"
            if agent.model == "haiku":
                agent.model = "sonnet"

        engine = runtime.get("engine")
        if isinstance(engine, str):
            engine = engine.strip().lower()
            if engine in _ALLOWED_ENGINES:
                agent.engine = engine

        model_tier = runtime.get("model_tier")
        if isinstance(model_tier, str):
            model_tier = model_tier.strip().lower()
            if model_tier in _ALLOWED_CLAUDE_TIERS:
                agent.model = model_tier

        engine_model = runtime.get("engine_model")
        if isinstance(engine_model, str) and engine_model.strip():
            agent.engine_model = engine_model.strip()

        raw_allowlist = runtime.get("tool_allowlist")
        allowlist: list[str] | None = None
        if isinstance(raw_allowlist, list):
            allowlist = [
                str(item).strip()
                for item in raw_allowlist
                if isinstance(item, str) and str(item).strip()
            ]
            allowset = set(allowlist)
            agent.tools = [name for name in agent.tools if name in allowset]

        raw_blocklist = runtime.get("tool_blocklist")
        if isinstance(raw_blocklist, list):
            blockset = {
                str(item).strip()
                for item in raw_blocklist
                if isinstance(item, str) and str(item).strip()
            }
            if blockset:
                agent.tools = [name for name in agent.tools if name not in blockset]

        if allowlist is not None and not allowlist:
            agent.tools = []

        if agent.engine == "openai" and not agent.engine_model:
            agent.engine_model = settings.openai_default_model

        return agent, mode

    def _resolve_output_format(
        self,
        runtime: dict[str, Any] | None,
    ) -> tuple[dict[str, Any] | None, str | None]:
        """Resolve output format from runtime controls."""
        if not runtime:
            return None, None

        raw = runtime.get("output_format")
        if isinstance(raw, str):
            key = raw.strip()
            preset = _OUTPUT_FORMAT_PRESETS.get(key)
            if preset:
                return json.loads(json.dumps(preset)), key
            return None, None

        if isinstance(raw, dict):
            preset_name = raw.get("preset")
            if isinstance(preset_name, str):
                key = preset_name.strip()
                preset = _OUTPUT_FORMAT_PRESETS.get(key)
                if preset:
                    return json.loads(json.dumps(preset)), key

            if raw.get("type") == "json_schema" and isinstance(raw.get("schema"), dict):
                return raw, "custom_json_schema"

        return None, None

    def _model_label(self, agent: AgentDef) -> str:
        """Human-readable model label for telemetry."""
        if agent.engine == "openai":
            return agent.engine_model or settings.openai_default_model
        return agent.model
