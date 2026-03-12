"""OpenAIEngine — httpx-based engine for OpenAI-compatible models.

Supports streaming, function calling with local tool execution,
and transparent escalation to Claude for complex tasks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any, Awaitable, Callable

import httpx

from app.config import settings
from app.engines.base import (
    BaseEngine,
    ToolDef,
    _json,
    build_frontend_events,
    build_frontend_events_from_result,
)
from app.engines.tool_converter import ESCALATE_TOOL, to_openai_function

logger = logging.getLogger(__name__)

_SENTINEL = object()

# ── Shared connection pool for NVIDIA/OpenAI API ──
# Keeps TLS sessions alive across requests (5.7s TLS handshake → 0ms on reuse)
_shared_client: httpx.AsyncClient | None = None


def _get_shared_client() -> httpx.AsyncClient:
    """Return a long-lived httpx client with connection pooling."""
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=10.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _shared_client


class OpenAIEngine(BaseEngine):
    """OpenAI-compatible engine (Qwen, GPT-4o-mini, DeepSeek, etc.)."""

    def __init__(self, model: str | None = None):
        self.model = model or settings.openai_default_model
        self.api_key = settings.openai_api_key
        self.base_url = settings.openai_base_url.rstrip("/")
        self.max_turns = settings.openai_max_turns

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
        from app.services.run_scratchpad import append_reasoning
        from app.services.shared_memory import load_messages, save_messages

        normalized_output_format = self._normalize_output_format(output_format)
        system_prompt = self._augment_system_for_output_format(system, normalized_output_format)

        history = await load_messages(agent_name or "", student_id or "")
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            *history,
            {"role": "user", "content": prompt},
        ]
        openai_tools = self._build_openai_tools(tools)
        tool_map = {t.name: t for t in tools}

        total_input = 0
        total_output = 0
        final_content = ""

        for _ in range(self.max_turns):
            data = await self._chat_completion(messages, openai_tools, stream=False)
            usage = data.get("usage", {})
            total_input += usage.get("prompt_tokens", 0)
            total_output += usage.get("completion_tokens", 0)

            choice = data["choices"][0]
            msg = choice["message"]
            finish = choice.get("finish_reason", "stop")

            if finish != "tool_calls" and not msg.get("tool_calls"):
                final_content = msg.get("content") or msg.get("reasoning_content") or ""
                if final_content:
                    append_reasoning(final_content, source="openai")
                messages.append({"role": "assistant", "content": final_content})
                await save_messages(agent_name or "", student_id or "", messages)

                structured_output = self._extract_structured_output(final_content, normalized_output_format)
                if structured_output is not None and not final_content.strip():
                    final_content = json.dumps(structured_output, ensure_ascii=False)

                return {
                    "response": final_content,
                    "structured_output": structured_output,
                    "cost_usd": 0.0,
                    "input_tokens": total_input,
                    "output_tokens": total_output,
                }

            messages.append(msg)
            for tc in msg.get("tool_calls", []):
                fn = tc["function"]
                name = fn["name"]
                args = json.loads(fn.get("arguments", "{}"))

                if name == "escalate_to_claude":
                    return await self._escalate_query(
                        prompt,
                        system,
                        tools,
                        role,
                        student_id,
                        agent_name,
                        normalized_output_format,
                    )

                result = await self._execute_tool_call(
                    name=name,
                    args=args,
                    tool_map=tool_map,
                    event_sink=None,
                )

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result, ensure_ascii=False),
                })

        await save_messages(agent_name or "", student_id or "", messages)
        fallback_response = messages[-1].get("content", "")
        if fallback_response:
            append_reasoning(fallback_response, source="openai")
        return {
            "response": fallback_response,
            "structured_output": self._extract_structured_output(fallback_response, normalized_output_format),
            "cost_usd": 0.0,
            "input_tokens": total_input,
            "output_tokens": total_output,
        }

    # ── Inline FIM: /v1/completions for base models (StarCoder2) ──

    _FIM_STOP = [
        "<|endoftext|>", "<fim_prefix>", "<fim_suffix>",
        "<fim_middle>", "<file_sep>", "\n\n\n",
    ]

    async def _inline_fim_stream(self, prompt: str) -> AsyncIterator[str]:
        """Lightweight /v1/completions path for FIM-capable base models.

        Uses non-streaming POST for connection reuse (TLS keep-alive).
        Streaming breaks httpx connection pool — NVIDIA closes the conn.
        With warm pool: ~600ms vs ~6.5s cold TLS per request.
        """
        t0 = time.monotonic()
        try:
            client = _get_shared_client()
            resp = await client.post(
                f"{self.base_url}/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "max_tokens": 40,
                    "temperature": 0.1,
                    "stream": False,
                },
            )
            if resp.status_code != 200:
                logger.warning("[fim] API error %d: %s", resp.status_code, resp.text[:300])
                yield _json({"type": "text", "content": "AI 补全暂时不可用。"})
                yield _json({"type": "done", "cost": 0.0})
                return

            data = resp.json()
            text = data.get("choices", [{}])[0].get("text", "")
            # Clean FIM stop tokens from output
            for st in self._FIM_STOP:
                idx = text.find(st)
                if idx >= 0:
                    text = text[:idx]
            text = text.rstrip()

            dt = time.monotonic() - t0
            logger.info("[fim] model=%s len=%d time=%.2fs", self.model, len(text), dt)

            if text:
                yield _json({"type": "text", "content": text})

        except httpx.ReadTimeout:
            logger.warning("[fim] timeout")
        except Exception as exc:
            logger.warning("[fim] error: %s", exc)
        yield _json({"type": "done", "cost": 0.0})

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
        from app.services.run_scratchpad import append_reasoning
        from app.services.shared_memory import load_messages, save_messages

        normalized_output_format = self._normalize_output_format(output_format)
        system_prompt = self._augment_system_for_output_format(system, normalized_output_format)

        # Skip history for inline completion — stateless, saves ~50-100ms I/O
        if inline_mode:
            history: list[dict[str, Any]] = []
        else:
            history = await load_messages(agent_name or "", student_id or "")

        # ── Inline FIM fast-path: /v1/completions with StarCoder2 ──
        if inline_mode and "starcoder" in self.model.lower():
            async for event in self._inline_fim_stream(prompt):
                yield event
            return

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            *history,
            {"role": "user", "content": prompt},
        ]
        openai_tools = self._build_openai_tools(tools)
        tool_map = {t.name: t for t in tools}

        queue: asyncio.Queue[object] = asyncio.Queue()

        async def emit(payload: dict[str, Any]) -> None:
            await queue.put(_json(payload))

        async def _consume() -> None:
            final_text_output = ""
            try:
                for _ in range(self.max_turns):
                    text_buf = ""
                    tool_calls_raw: dict[int, dict[str, Any]] = {}
                    tc_counter = 0

                    if inline_mode:
                        client = _get_shared_client()
                    else:
                        client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))
                    async with client.stream(
                        "POST",
                        f"{self.base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.model,
                            "messages": messages,
                            **({"tools": openai_tools} if openai_tools else {}),
                            "stream": True,
                            "temperature": 0.1 if inline_mode else 0.7,
                            "max_tokens": 40 if inline_mode else 4096,
                        },
                    ) as resp:
                        if resp.status_code != 200:
                            body = await resp.aread()
                            logger.error("[openai] API error %d: %s", resp.status_code, body[:500])
                            await emit({"type": "text", "content": "AI 服务暂时不可用，请稍后再试。"})
                            await emit({"type": "done", "cost": 0.0})
                            return
                        logger.debug("[openai] streaming started, model=%s", self.model)

                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                break

                            try:
                                chunk = json.loads(data_str)
                            except json.JSONDecodeError:
                                continue

                            choice = chunk["choices"][0]
                            delta = choice.get("delta", {})

                            text = delta.get("content") or ""
                            if not text and delta.get("reasoning_content"):
                                text = delta["reasoning_content"]
                            if text:
                                text_buf += text
                                await emit({"type": "text", "content": text})

                            if delta.get("tool_calls"):
                                for tc_delta in delta["tool_calls"]:
                                    idx = tc_delta.get("index", -1)
                                    if idx < 0:
                                        if tc_delta.get("id"):
                                            idx = tc_counter
                                            tc_counter += 1
                                        else:
                                            idx = max(tool_calls_raw.keys()) if tool_calls_raw else 0
                                    if idx not in tool_calls_raw:
                                        tool_calls_raw[idx] = {
                                            "id": tc_delta.get("id", ""),
                                            "name": "",
                                            "arguments": "",
                                        }
                                    entry = tool_calls_raw[idx]
                                    if tc_delta.get("id"):
                                        entry["id"] = tc_delta["id"]
                                    fn = tc_delta.get("function", {})
                                    if fn.get("name"):
                                        entry["name"] = fn["name"]
                                    if fn.get("arguments"):
                                        entry["arguments"] += fn["arguments"]

                    if text_buf:
                        final_text_output = text_buf
                        append_reasoning(text_buf, source="openai_stream")

                    if not tool_calls_raw:
                        break

                    assistant_msg: dict[str, Any] = {"role": "assistant"}
                    if text_buf:
                        assistant_msg["content"] = text_buf
                    assistant_msg["tool_calls"] = [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {"name": tc["name"], "arguments": tc["arguments"]},
                        }
                        for tc in tool_calls_raw.values()
                    ]
                    messages.append(assistant_msg)

                    for tc in tool_calls_raw.values():
                        name = tc["name"]
                        try:
                            args = json.loads(tc["arguments"])
                        except json.JSONDecodeError:
                            args = {}

                        if name == "escalate_to_claude":
                            reason = args.get("reason", "")
                            logger.info("Escalating to Claude: %s", reason)
                            append_reasoning(f"escalate_to_claude: {reason}", source="openai")
                            await emit({"type": "text", "content": "\n\n正在升级到 Claude 深度分析...\n\n"})
                            async for event in self._escalate_stream(
                                prompt,
                                system,
                                tools,
                                role,
                                student_id,
                                agent_name,
                                normalized_output_format,
                            ):
                                await queue.put(event)
                            return

                        await emit({"type": "tool_call", "tool": name, "status": "calling"})

                        result = await self._execute_tool_call(
                            name=name,
                            args=args,
                            tool_map=tool_map,
                            event_sink=emit,
                        )

                        for evt in build_frontend_events(name, args):
                            await queue.put(evt)
                        for evt in build_frontend_events_from_result(name, args, result):
                            await queue.put(evt)

                        await emit({"type": "tool_call", "tool": name, "status": "done"})

                        result_text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": result_text,
                        })

                # Skip history persistence for inline completion — stateless
                if not inline_mode:
                    await save_messages(agent_name or "", student_id or "", messages)

                structured_output = self._extract_structured_output(final_text_output, normalized_output_format)
                if structured_output is not None:
                    await emit({"type": "structured_output", "data": structured_output})

                synthetic_session_id = (
                    f"openai:{agent_name}:{student_id}"
                    if agent_name and student_id
                    else None
                )
                done_payload: dict[str, Any] = {"type": "done", "cost": 0.0}
                if synthetic_session_id:
                    done_payload["session_id"] = synthetic_session_id
                await emit(done_payload)
            except Exception:
                logger.exception("OpenAI engine stream error")
                await emit({"type": "text", "content": "AI 服务出现错误，请稍后再试。"})
                await emit({"type": "done", "cost": 0.0})
            finally:
                if not inline_mode and not client.is_closed:
                    await client.aclose()
                await queue.put(_SENTINEL)

        task = asyncio.create_task(_consume())

        try:
            while True:
                item = await queue.get()
                if item is _SENTINEL:
                    break
                yield item  # type: ignore[misc]
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    async def _execute_tool_call(
        self,
        name: str,
        args: dict[str, Any],
        tool_map: dict[str, ToolDef],
        event_sink: Callable[[dict[str, Any]], Awaitable[None]] | None,
    ) -> dict[str, Any] | str:
        """Execute tool call with approval/audit and low-risk retry policy."""
        from app.services.approval_broker import get_approval_broker
        from app.services.audit_client import log_tool_action
        from app.services.coding_policy import (
            acquire_high_risk_execution_slot,
            approvals_enabled_for_runtime,
            build_args_preview,
            external_builtin_priority_enabled,
            external_fallback_to_internal_enabled,
            get_approval_timeout_sec,
            get_low_risk_retry_policy,
            is_high_risk_tool,
            normalize_tool_name,
            risk_level_for_tool,
        )
        from app.services.coding_runtime import get_coding_runtime_context
        from app.services.run_scratchpad import append_reasoning, append_tool_result
        from app.tools.registry import get_registry

        local_name = normalize_tool_name(name)
        runtime_ctx = get_coding_runtime_context()
        high_risk = runtime_ctx.enabled and approvals_enabled_for_runtime() and is_high_risk_tool(local_name)
        risk = risk_level_for_tool(local_name)
        args_preview = build_args_preview(args)

        approval_request_id = str(uuid.uuid4())
        if high_risk:
            if event_sink is None:
                await log_tool_action(
                    request_id=approval_request_id,
                    tool=local_name,
                    risk=risk,
                    approved=False,
                    status="rejected",
                    args=args_preview,
                    error="approval unavailable (non-stream mode)",
                )
                return {"error": "高风险操作仅支持流式审批", "is_error": True}

            approved, reason, approval_request_id = await get_approval_broker().request_approval(
                tool=local_name,
                risk=risk,
                args_preview=args_preview,
                timeout_sec=get_approval_timeout_sec(),
                event_sink=event_sink,
            )
            await log_tool_action(
                request_id=approval_request_id,
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
                return {
                    "error": f"用户拒绝执行 {local_name}: {reason}",
                    "is_error": True,
                }

        started = time.time()
        retry_count, retry_backoff_ms = get_low_risk_retry_policy(local_name)
        max_attempts = 1 if high_risk else 1 + retry_count

        async def _call_once() -> tuple[dict[str, Any] | str, str, str | None]:
            registry = get_registry()
            mcp_server = registry.get_tool_mcp_server(name)

            result: dict[str, Any] | str
            error: str | None = None
            status = "executed"

            tool_def = tool_map.get(name, ToolDef(name, "", {}))
            handler = tool_def.handler

            builtin_handler = None
            if mcp_server == "pathmind" and handler is not None:
                builtin_handler = handler
            else:
                local_def = tool_map.get(local_name)
                if local_def and registry.get_tool_mcp_server(local_name) == "pathmind":
                    builtin_handler = local_def.handler

            async def _run_builtin(exec_handler: Any, tool_label: str) -> tuple[dict[str, Any] | str, str, str | None]:
                if exec_handler is None:
                    msg = f"Tool {tool_label} not found"
                    return {"error": msg, "is_error": True}, "failed", msg

                try:
                    out = await exec_handler(args)
                    if isinstance(out, dict) and out.get("is_error"):
                        msg = self._extract_tool_error_message(out) or f"Tool {tool_label} execution failed"
                        return out, "failed", msg
                    return out, "executed", None
                except Exception:
                    logger.exception("Tool execution error: %s", tool_label)
                    msg = f"Tool {tool_label} execution failed"
                    return {"error": msg, "is_error": True}, "failed", msg

            if mcp_server and mcp_server != "pathmind":
                builtin_attempted = False

                if external_builtin_priority_enabled() and builtin_handler is not None:
                    builtin_attempted = True
                    result, status, error = await _run_builtin(builtin_handler, local_name)
                    if status != "failed":
                        if event_sink is not None:
                            await event_sink(
                                {
                                    "type": "tool_fallback",
                                    "tool": local_name,
                                    "stage": "builtin_preferred",
                                }
                            )
                        return result, status, error

                try:
                    from app.tools.external import get_openai_external_adapter

                    result = await get_openai_external_adapter().call_tool(name, args)
                    if isinstance(result, dict) and result.get("is_error"):
                        status = "failed"
                        error = self._extract_tool_error_message(result) or (
                            f"External MCP tool {name} execution failed"
                        )
                    else:
                        status = "executed"
                        error = None
                except Exception:
                    logger.exception("External MCP adapter call failed: %s", name)
                    status = "failed"
                    error = f"External MCP tool {name} execution failed"
                    result = {"error": error, "is_error": True}

                if (
                    status == "failed"
                    and external_fallback_to_internal_enabled()
                    and builtin_handler is not None
                    and not builtin_attempted
                ):
                    result, status, error = await _run_builtin(builtin_handler, local_name)
                    if status != "failed" and event_sink is not None:
                        await event_sink(
                            {
                                "type": "tool_fallback",
                                "tool": local_name,
                                "stage": "external_failed_builtin_used",
                            }
                        )

                if status == "failed" and isinstance(error, str):
                    error = error + "；建议调用 escalate_to_claude 继续执行。"
                    result = {"error": error, "is_error": True}

                return result, status, error

            result, status, error = await _run_builtin(handler, name)
            return result, status, error

        attempt = 0
        result: dict[str, Any] | str = {"error": "tool execution failed", "is_error": True}
        status = "failed"
        error: str | None = None

        while attempt < max_attempts:
            attempt += 1

            if high_risk:
                async with acquire_high_risk_execution_slot(local_name):
                    result, status, error = await _call_once()
            else:
                result, status, error = await _call_once()

            if status != "failed":
                break

            deterministic_error = False
            if isinstance(error, str):
                lowered_error = error.lower()
                deterministic_keywords = (
                    "not found",
                    "invalid",
                    "无效",
                    "不存在",
                    "不能为空",
                    "被拒绝",
                )
                deterministic_error = any(keyword in lowered_error for keyword in deterministic_keywords)

            retryable_failure = (
                not high_risk
                and attempt < max_attempts
                and isinstance(error, str)
                and not deterministic_error
            )
            if not retryable_failure:
                break

            if event_sink is not None:
                await event_sink(
                    {
                        "type": "tool_retry",
                        "tool": local_name,
                        "attempt": attempt + 1,
                        "max_attempts": max_attempts,
                        "reason": error,
                    }
                )

            append_reasoning(
                f"tool_retry: {local_name} ({attempt + 1}/{max_attempts})",
                source="retry",
            )
            await asyncio.sleep((retry_backoff_ms * (2 ** (attempt - 1))) / 1000)

        duration_ms = int((time.time() - started) * 1000)
        if isinstance(result, dict):
            if result.get("error"):
                summary = str(result.get("error"))
            else:
                summary = json.dumps(result, ensure_ascii=False)
        else:
            summary = str(result)

        append_tool_result(
            tool=local_name,
            status=status,
            summary=summary,
            ref=f"attempts={attempt}",
        )

        if high_risk:
            result_preview: dict[str, Any] | None = None
            if isinstance(result, dict):
                result_preview = result
            else:
                result_preview = {"text": str(result)[:400]}

            await log_tool_action(
                request_id=approval_request_id,
                tool=local_name,
                risk=risk,
                approved=True,
                status=status,
                args=args_preview,
                result=result_preview,
                error=error,
                duration_ms=duration_ms,
            )

        return result

    def _extract_tool_error_message(self, result: Any) -> str | None:
        """Best-effort extract readable error text from tool result payload."""
        if not isinstance(result, dict):
            return None

        direct = result.get("error")
        if isinstance(direct, str) and direct.strip():
            return direct.strip()

        content = result.get("content")
        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    continue
                if str(item.get("type") or "") != "text":
                    continue
                text = str(item.get("text") or "").strip()
                if text:
                    return text

        return None

    def _build_openai_tools(self, tools: list[ToolDef]) -> list[dict[str, Any]]:
        """Convert ToolDefs to OpenAI format + add escalation tool.

        Returns empty list when *tools* is empty so callers can omit the
        ``tools`` key entirely (e.g. inline completion).
        """
        if not tools:
            return []
        result = [to_openai_function(t) for t in tools]
        result.append(ESCALATE_TOOL)
        return result

    async def _chat_completion(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        stream: bool = False,
    ) -> dict[str, Any]:
        """Non-streaming chat completion call."""
        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 4096,
        }
        if tools:
            body["tools"] = tools

        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
            return resp.json()

    async def _escalate_query(
        self,
        prompt: str,
        system: str,
        tools: list[ToolDef],
        role: str,
        student_id: str | None = None,
        agent_name: str | None = None,
        output_format: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Escalate to Claude for one-shot query."""
        from app.engines.claude_engine import ClaudeEngine
        from app.services.run_scratchpad import snapshot_for_prompt

        claude = ClaudeEngine(model_tier="sonnet")
        scratchpad = snapshot_for_prompt(max_chars=1200)
        escalated = system
        if scratchpad:
            escalated += f"\n\n[跨链路共享记忆]\n{scratchpad}"
        escalated += "\n\n[此请求由快速模型升级而来，请提供深度分析]"
        return await claude.query(
            prompt,
            escalated,
            tools,
            role,
            student_id=student_id,
            agent_name=agent_name,
            output_format=output_format,
        )

    async def _escalate_stream(
        self,
        prompt: str,
        system: str,
        tools: list[ToolDef],
        role: str,
        student_id: str | None = None,
        agent_name: str | None = None,
        output_format: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        """Escalate to Claude for streaming."""
        from app.engines.claude_engine import ClaudeEngine
        from app.services.run_scratchpad import snapshot_for_prompt

        claude = ClaudeEngine(model_tier="sonnet")
        scratchpad = snapshot_for_prompt(max_chars=1200)
        escalated = system
        if scratchpad:
            escalated += f"\n\n[跨链路共享记忆]\n{scratchpad}"
        escalated += "\n\n[此请求由快速模型升级而来，请提供深度分析]"
        async for event in claude.stream(
            prompt,
            escalated,
            tools,
            role,
            student_id=student_id,
            agent_name=agent_name,
            output_format=output_format,
        ):
            yield event

    def _normalize_output_format(self, output_format: dict[str, Any] | None) -> dict[str, Any] | None:
        """Validate json_schema output format from runtime."""
        if not isinstance(output_format, dict):
            return None
        if output_format.get("type") != "json_schema":
            return None
        schema = output_format.get("schema")
        if not isinstance(schema, dict):
            return None
        return output_format

    def _augment_system_for_output_format(
        self,
        system: str,
        output_format: dict[str, Any] | None,
    ) -> str:
        """Inject explicit JSON instruction for OpenAI-compatible models."""
        if not output_format:
            return system
        return (
            system
            + "\n\n请严格按 JSON 输出，不要输出解释文本。"
            + " 若无法满足 schema，请输出最接近 schema 的合法 JSON。"
        )

    def _extract_structured_output(
        self,
        text: str,
        output_format: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Best-effort parse JSON object from model text."""
        if not output_format or not text:
            return None

        candidate = text.strip()
        if not candidate:
            return None

        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        match = re.search(r"\{[\s\S]*\}", candidate)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None

        return None
