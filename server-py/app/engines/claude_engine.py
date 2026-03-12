"""ClaudeEngine — wraps Claude Agent SDK (existing logic from AgentService)."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from app.config import settings
from app.engines.base import BaseEngine, ToolDef, _json, build_frontend_events

logger = logging.getLogger(__name__)

_SENTINEL = object()
_FIRST_BYTE_TIMEOUT_SEC = 8    # no-response triggers model cascade
_STREAM_IDLE_TIMEOUT_SEC = 25  # mid-stream idle triggers terminal timeout


async def _prompt_as_stream(text: str) -> AsyncIterator[dict[str, Any]]:
    """Wrap a string prompt into an AsyncIterable for streaming mode."""
    yield {
        "type": "user",
        "session_id": "",
        "message": {"role": "user", "content": text},
        "parent_tool_use_id": None,
    }


class ClaudeEngine(BaseEngine):
    """Claude Agent SDK engine with MCP tool support."""

    def __init__(self, model_tier: str = "sonnet"):
        model_map = {
            "haiku": settings.haiku_model,
            "sonnet": settings.default_model,
            "opus": settings.opus_model,
        }
        self.model = model_map.get(model_tier, settings.default_model)
        # Build fallback chain for cascade on first-byte timeout
        if model_tier in {"sonnet", "opus"}:
            self._fallback_models: list[str] = [
                self.model,
                settings.sonnet_fallback_model,
                settings.haiku_model,
            ]
        else:
            self._fallback_models = [self.model]

    def _build_can_use_tool(
        self,
        role: str,
        event_sink: Any | None = None,
    ):
        from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

        from app.services.approval_broker import get_approval_broker
        from app.services.audit_client import log_tool_action
        from app.services.coding_policy import (
            approvals_enabled_for_runtime,
            build_args_preview,
            get_approval_timeout_sec,
            is_high_risk_tool,
            normalize_tool_name,
            risk_level_for_tool,
        )
        from app.services.coding_runtime import get_coding_runtime_context
        from app.services.run_scratchpad import append_reasoning
        from app.tools.permissions import get_permission_manager

        perm_manager = get_permission_manager()
        base_callback = perm_manager.make_callback(role) if role != "guest" else None

        async def can_use_tool(
            tool_name: str,
            input_data: dict[str, Any],
            context: Any,
        ) -> PermissionResultAllow | PermissionResultDeny:
            current_input = input_data
            base_result: PermissionResultAllow | PermissionResultDeny | None = None

            if base_callback is not None:
                base_result = await base_callback(tool_name, input_data, context)
                if isinstance(base_result, PermissionResultDeny):
                    return base_result
                if isinstance(base_result, PermissionResultAllow) and base_result.updated_input is not None:
                    current_input = base_result.updated_input

            runtime_ctx = get_coding_runtime_context()
            local_name = normalize_tool_name(tool_name)
            if not runtime_ctx.enabled or not approvals_enabled_for_runtime():
                return base_result if base_result is not None else PermissionResultAllow()

            if not is_high_risk_tool(local_name):
                return base_result if base_result is not None else PermissionResultAllow()

            risk = risk_level_for_tool(local_name)
            args_preview = build_args_preview(current_input)
            if event_sink is None:
                await log_tool_action(
                    request_id=f"precheck:{local_name}",
                    tool=local_name,
                    risk=risk,
                    approved=False,
                    status="rejected",
                    args=args_preview,
                    error="approval unavailable (non-stream mode)",
                )
                append_reasoning(
                    f"approval_unavailable: {local_name}",
                    source="approval",
                )
                return PermissionResultDeny(message="高风险操作仅支持流式审批")

            approved, reason, request_id = await get_approval_broker().request_approval(
                tool=local_name,
                risk=risk,
                args_preview=args_preview,
                timeout_sec=get_approval_timeout_sec(),
                event_sink=event_sink,
            )

            await log_tool_action(
                request_id=request_id,
                tool=local_name,
                risk=risk,
                approved=approved,
                status="approved" if approved else "rejected",
                args=args_preview,
                error=None if approved else reason,
            )
            append_reasoning(
                f"approval_{'ok' if approved else 'deny'}: {local_name}",
                source="approval",
            )

            if not approved:
                return PermissionResultDeny(message=f"用户拒绝执行 {local_name}: {reason}")

            return base_result if base_result is not None else PermissionResultAllow()

        return can_use_tool

    def _build_options(
        self,
        system: str,
        tools: list[ToolDef],
        role: str = "student",
        session_id: str | None = None,
        output_format: dict[str, Any] | None = None,
        hooks: dict[str, Any] | None = None,
        event_sink: Any | None = None,
        model_override: str | None = None,
    ):
        from claude_agent_sdk import ClaudeAgentOptions

        from app.tools.registry import get_registry
        from app.tools.server import get_claude_mcp_servers

        registry = get_registry()
        allowed_tools: list[str] = []
        for t in tools:
            ref = registry.get_mcp_tool_ref(t.name) or f"mcp__pathmind__{t.name}"
            if ref not in allowed_tools:
                allowed_tools.append(ref)

        return ClaudeAgentOptions(
            model=model_override or self.model,
            system_prompt=system,
            max_turns=settings.agent_max_turns,
            max_budget_usd=settings.agent_max_budget_usd,
            mcp_servers=get_claude_mcp_servers(),
            allowed_tools=allowed_tools,
            can_use_tool=self._build_can_use_tool(role, event_sink=event_sink),
            include_partial_messages=True,
            output_format=output_format,
            hooks=hooks,
            resume=session_id if session_id else None,
            env={
                "ANTHROPIC_API_KEY": settings.anthropic_api_key,
                "ANTHROPIC_BASE_URL": settings.anthropic_base_url,
            },
        )

    async def query(
        self,
        prompt: str,
        system: str,
        tools: list[ToolDef],
        role: str = "student",
        student_id: str | None = None,
        agent_name: str | None = None,
        output_format: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock
        from claude_agent_sdk import query as sdk_query

        from app.services.run_scratchpad import append_reasoning

        options = self._build_options(system, tools, role=role, output_format=output_format)

        response_text = ""
        cost = 0.0
        input_tokens = 0
        output_tokens = 0
        structured_output: Any = None

        prompt_input = _prompt_as_stream(prompt)
        async for message in sdk_query(prompt=prompt_input, options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if hasattr(block, "name") and hasattr(block, "input"):
                        tool_name = getattr(block, "name", "")
                        short_name = tool_name.split("__")[-1] if "__" in tool_name else tool_name
                        append_reasoning(f"claude_tool: {short_name}", source="claude")
                    if isinstance(block, TextBlock):
                        response_text += block.text
            elif isinstance(message, ResultMessage):
                cost = message.total_cost_usd or 0.0
                usage = message.usage or {}
                input_tokens = usage.get("input_tokens", 0)
                output_tokens = usage.get("output_tokens", 0)
                structured_output = getattr(message, "structured_output", None)
                if not response_text and getattr(message, "result", None):
                    response_text = getattr(message, "result", "") or ""

        if structured_output is not None and not response_text:
            response_text = json.dumps(structured_output, ensure_ascii=False)

        if response_text:
            append_reasoning(response_text, source="claude")

        return {
            "response": response_text,
            "structured_output": structured_output,
            "cost_usd": cost,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    async def stream(
        self,
        prompt: str,
        system: str,
        tools: list[ToolDef],
        role: str = "student",
        session_id: str | None = None,
        student_id: str | None = None,
        agent_name: str | None = None,
        output_format: dict[str, Any] | None = None,
        inline_mode: bool = False,
    ) -> AsyncIterator[str]:
        """Streaming query using Claude Agent SDK.

        Uses asyncio.Queue to bridge SDK's anyio task group with FastAPI's
        StreamingResponse (different asyncio Tasks).
        """
        from claude_agent_sdk import HookMatcher
        from claude_agent_sdk import query as sdk_query

        from app.services.run_scratchpad import append_reasoning

        queue: asyncio.Queue[object] = asyncio.Queue()

        async def emit_hook_event(event_name: str, payload: dict[str, Any]) -> None:
            lower = (event_name or "").strip().lower()
            base = {
                "type": "hook_event",
                "event": event_name,
                "timestamp": int(time.time()),
            }

            if lower == "permissionrequest":
                await queue.put(_json({
                    **base,
                    "category": "permission",
                    "tool": payload.get("tool_name", ""),
                    "tool_input": payload.get("tool_input", {}),
                    "permission_suggestions": payload.get("permission_suggestions"),
                }))
                return

            if lower in {"subagentstart", "subagentstop"}:
                await queue.put(_json({
                    **base,
                    "category": "subtask",
                    "stage": "start" if lower == "subagentstart" else "stop",
                    "agent_id": payload.get("agent_id"),
                    "agent_type": payload.get("agent_type"),
                    "agent_name": payload.get("agent_name"),
                    "agent_transcript_path": payload.get("agent_transcript_path"),
                    "stop_hook_active": payload.get("stop_hook_active"),
                }))
                return

            if lower == "notification":
                await queue.put(_json({
                    **base,
                    "category": "notification",
                    "level": payload.get("notification_type", "info"),
                    "title": payload.get("title"),
                    "message": payload.get("message", ""),
                }))
                return

            await queue.put(_json({
                **base,
                "category": "other",
                "payload": payload,
            }))

        async def hook_callback(
            input_data: dict[str, Any],
            tool_use_id: str | None,
            context: dict[str, Any],
        ) -> dict[str, Any]:
            try:
                event_name = str(input_data.get("hook_event_name", ""))
                await emit_hook_event(event_name, input_data)
            except Exception:
                logger.debug("Claude hook callback parse failed", exc_info=True)
            return {}

        hook_config = {
            "Notification": [HookMatcher(matcher=None, hooks=[hook_callback])],
            "PermissionRequest": [HookMatcher(matcher=None, hooks=[hook_callback])],
            "SubagentStart": [HookMatcher(matcher=None, hooks=[hook_callback])],
            "SubagentStop": [HookMatcher(matcher=None, hooks=[hook_callback])],
        }

        async def emit_runtime_event(payload: dict[str, Any]) -> None:
            await queue.put(_json(payload))

        async def _consume(opts: Any, q: asyncio.Queue[object]) -> None:
            stream_text_output = ""
            last_text_snapshot = ""
            try:
                from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

                prompt_input = _prompt_as_stream(prompt)
                async for message in sdk_query(prompt=prompt_input, options=opts):

                    if isinstance(message, AssistantMessage):
                        current_text_snapshot = ""
                        for block in message.content:
                            if hasattr(block, "name") and hasattr(block, "input"):
                                tool_name = getattr(block, "name", "")
                                tool_input = getattr(block, "input", {}) or {}
                                short_name = tool_name.split("__")[-1] if "__" in tool_name else tool_name

                                await q.put(
                                    _json({"type": "tool_call", "tool": short_name, "status": "calling"})
                                )

                                for evt in build_frontend_events(tool_name, tool_input):
                                    await q.put(evt)

                                append_reasoning(
                                    f"claude_tool: {short_name}",
                                    source="claude_stream",
                                )

                            if isinstance(block, TextBlock):
                                current_text_snapshot += block.text

                            if hasattr(block, "text"):
                                try:
                                    parsed = json.loads(block.text)
                                    if isinstance(parsed, dict):
                                        if parsed.get("ui_command"):
                                            await q.put(_json({"type": "ui_command", **parsed}))
                                        elif parsed.get("action") == "navigate":
                                            await q.put(_json({"type": "navigate", "to": parsed.get("to", "/")}))
                                        elif parsed.get("toast"):
                                            await q.put(_json({
                                                "type": "toast",
                                                "message": parsed.get("message", ""),
                                                "level": parsed.get("level", "info"),
                                            }))
                                        elif parsed.get("scroll_to"):
                                            await q.put(_json({
                                                "type": "scroll_to",
                                                "target": parsed.get("target", ""),
                                            }))
                                        elif parsed.get("set_theme"):
                                            await q.put(_json({
                                                "type": "set_theme",
                                                "theme": parsed.get("theme", "dark"),
                                            }))
                                        elif parsed.get("graph_command"):
                                            await q.put(_json({
                                                "type": "graph_command",
                                                "graph_command": True,
                                                "command": parsed.get("command", ""),
                                                "target": parsed.get("target", ""),
                                                "params": parsed.get("params", {}),
                                            }))
                                        elif parsed.get("graph_batch"):
                                            await q.put(_json({
                                                "type": "graph_batch",
                                                "graph_batch": True,
                                                "batch_id": parsed.get("batch_id", ""),
                                                "mode": parsed.get("mode", "best_effort"),
                                                "steps": parsed.get("steps", []),
                                            }))
                                except (json.JSONDecodeError, TypeError):
                                    pass

                        if current_text_snapshot:
                            if current_text_snapshot.startswith(last_text_snapshot):
                                delta_text = current_text_snapshot[len(last_text_snapshot):]
                            else:
                                delta_text = current_text_snapshot
                            if delta_text:
                                stream_text_output += delta_text
                                await q.put(_json({"type": "text", "content": delta_text}))
                            last_text_snapshot = current_text_snapshot

                    elif isinstance(message, ResultMessage):
                        sid = getattr(message, "session_id", None)
                        usage = message.usage or {}
                        stop_reason = getattr(message, "stop_reason", None)
                        structured_output = getattr(message, "structured_output", None)
                        if structured_output is not None:
                            await q.put(_json({
                                "type": "structured_output",
                                "data": structured_output,
                            }))
                        if stream_text_output:
                            append_reasoning(stream_text_output, source="claude_stream")
                        await q.put(_json({
                            "type": "done",
                            "session_id": sid,
                            "cost": message.total_cost_usd or 0.0,
                            "input_tokens": usage.get("input_tokens", 0),
                            "output_tokens": usage.get("output_tokens", 0),
                            "stop_reason": stop_reason,
                        }))

            except Exception:
                logger.exception("Claude engine stream error")
                await q.put(_json({"type": "text", "content": "AI 服务出现错误，请稍后再试。"}))
            finally:
                await q.put(_SENTINEL)

        # ── Model cascade: try each fallback in order ──────────────────────────
        # _FIRST_BYTE_TIMEOUT_SEC triggers cascade to next model on no-response.
        # _STREAM_IDLE_TIMEOUT_SEC handles mid-stream stalls on the active model.
        fallback_models = list(self._fallback_models)
        for attempt_idx, attempt_model in enumerate(fallback_models):
            queue = asyncio.Queue()  # fresh queue per attempt; closures see updated 'queue'
            opts = self._build_options(
                system,
                tools,
                role=role,
                session_id=session_id,
                output_format=output_format,
                hooks=hook_config,
                event_sink=emit_runtime_event,
                model_override=attempt_model,
            )
            task = asyncio.create_task(_consume(opts, queue))
            got_first_byte = False
            should_cascade = False
            try:
                while True:
                    timeout = (
                        _FIRST_BYTE_TIMEOUT_SEC if not got_first_byte
                        else _STREAM_IDLE_TIMEOUT_SEC
                    )
                    try:
                        item = await asyncio.wait_for(queue.get(), timeout=timeout)
                    except asyncio.TimeoutError:
                        is_last = (attempt_idx == len(fallback_models) - 1)
                        if not got_first_byte and not is_last:
                            next_model = fallback_models[attempt_idx + 1]
                            logger.warning(
                                "Claude first-byte timeout (%ss) model=%s → %s agent=%s",
                                _FIRST_BYTE_TIMEOUT_SEC, attempt_model, next_model, agent_name,
                            )
                            yield _json({
                                "type": "model_fallback",
                                "from_model": attempt_model,
                                "to_model": next_model,
                                "reason": "first_byte_timeout",
                            })
                            should_cascade = True
                        else:
                            label = "idle" if got_first_byte else "first_byte"
                            logger.warning(
                                "Claude stream %s timeout (%ss) model=%s agent=%s — all models exhausted",
                                label, timeout, attempt_model, agent_name,
                            )
                            yield _json({
                                "type": "text",
                                "content": "AI 流式响应超时，已结束本次会话。",
                            })
                            yield _json({
                                "type": "done",
                                "session_id": session_id,
                                "cost": 0.0,
                                "input_tokens": 0,
                                "output_tokens": 0,
                                "stop_reason": "idle_timeout",
                            })
                        break
                    if item is _SENTINEL:
                        break
                    got_first_byte = True
                    yield item  # type: ignore[misc]
            finally:
                if not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            if not should_cascade:
                break
