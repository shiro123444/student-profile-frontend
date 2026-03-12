"""AnthropicDirectEngine — wraps official anthropic Python SDK.

Drop-in replacement for ClaudeEngine:
  * Same query() / stream() signatures and SSE event shapes.
  * Directly calls /v1/messages via httpx (no Claude CLI subprocess).
  * Full tool-use loop: tool_use → dispatch handler → tool_result → continue.
  * First-turn streaming uses raw httpx SSE in an isolated module
    (avoids anthropic SDK poisoning aiter_bytes on Python 3.14).
  * Subsequent tool turns use non-streaming SDK calls (which work correctly).
  * Model cascade: sonnet → sonnet-fallback → haiku on first-byte timeout.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Any

import anthropic
import httpx

from app.config import settings
from app.engines.base import (
    BaseEngine,
    ToolDef,
    _json,
    build_frontend_events,
    build_frontend_events_from_result,
)
from app.engines.httpx_sse import StreamResult, httpx_stream_first_turn

logger = logging.getLogger(__name__)

_MAX_TOOL_TURNS = 20  # safety cap on tool loops
_GREETING_ONLY = re.compile(
    r"^(hi|hello|hey|你好|您好|在吗|在不在|早上好|中午好|下午好|晚上好|嗨)$",
    re.IGNORECASE,
)


def _prefer_direct_answer(prompt: str, tools: list[ToolDef], inline_mode: bool, agent_name: str | None) -> bool:
    if inline_mode or not tools:
        return False
    if (agent_name or "").strip() == "command-center":
        return False
    normalized = (prompt or "").strip()
    if not normalized:
        return False
    if len(normalized) > 8:
        return False
    if not _GREETING_ONLY.search(normalized):
        return False
    return True


def _make_client() -> anthropic.AsyncAnthropic:
    read_timeout = max(5.0, float(getattr(settings, "anthropic_stream_read_timeout_sec", 20)))
    return anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        base_url=settings.anthropic_base_url,
        max_retries=1,
        timeout=anthropic.Timeout(connect=5.0, read=read_timeout, write=30.0, pool=5.0),
    )


def _tools_for_api(tools: list[ToolDef]) -> list[dict[str, Any]]:
    from app.engines.tool_converter import _normalize_schema

    return [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": _normalize_schema(_sanitize_schema(t.input_schema)),
        }
        for t in tools
    ]


_PY_TYPE_TO_JSON: dict[type, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object",
    type(None): "null",
}


def _sanitize_schema(schema: Any) -> Any:
    """Recursively replace Python type objects with JSON Schema type strings."""
    if isinstance(schema, type):
        return {"type": _PY_TYPE_TO_JSON.get(schema, "string")}
    if isinstance(schema, dict):
        return {k: _sanitize_schema(v) for k, v in schema.items()}
    if isinstance(schema, list):
        return [_sanitize_schema(item) for item in schema]
    return schema


def _handler_map(tools: list[ToolDef]) -> dict[str, Any]:
    return {t.name: t.handler for t in tools if t.handler is not None}


def _tool_result_is_error(result: Any) -> bool:
    if isinstance(result, dict):
        if bool(result.get("is_error")):
            return True
        err_val = result.get("error")
        if isinstance(err_val, str) and err_val.strip():
            return True
    return False


def _tool_result_content(result: Any) -> str | list[dict[str, Any]]:
    if isinstance(result, dict):
        content = result.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return content
        return json.dumps(result, ensure_ascii=False)

    if isinstance(result, list):
        return result

    if isinstance(result, str):
        return result

    return json.dumps(result, ensure_ascii=False)


def _build_tool_result_block(tool_use_id: str, result: Any) -> dict[str, Any]:
    block: dict[str, Any] = {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": _tool_result_content(result),
    }
    if _tool_result_is_error(result):
        block["is_error"] = True
    return block


class AnthropicDirectEngine(BaseEngine):
    """anthropic Python SDK engine — direct HTTP, no CLI subprocess."""

    def __init__(self, model_tier: str = "sonnet"):
        model_map = {
            "haiku": settings.haiku_model,
            "sonnet": settings.default_model,
            "opus": settings.opus_model,
        }
        self.model = model_map.get(model_tier, settings.default_model)
        if model_tier in {"sonnet", "opus"}:
            self._fallback_models: list[str] = [
                self.model,
                settings.sonnet_fallback_model,
                settings.haiku_model,
            ]
        else:
            self._fallback_models = [self.model]

    # ── non-streaming query (sync-style, single-turn + tool loop) ────────────

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

        client = _make_client()
        api_tools = _tools_for_api(tools)
        handlers = _handler_map(tools)

        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
        response_text = ""
        cost = 0.0
        input_tokens = 0
        output_tokens = 0

        for _turn in range(_MAX_TOOL_TURNS):
            kwargs: dict[str, Any] = dict(
                model=self._fallback_models[0],
                max_tokens=settings.agent_max_tokens if hasattr(settings, "agent_max_tokens") else 8096,
                system=system,
                messages=messages,
            )
            if api_tools:
                kwargs["tools"] = api_tools

            response = await client.messages.create(**kwargs)
            input_tokens += response.usage.input_tokens
            output_tokens += response.usage.output_tokens

            tool_uses = []
            for block in response.content:
                if block.type == "text":
                    response_text += block.text
                elif block.type == "tool_use":
                    short = block.name.split("__")[-1] if "__" in block.name else block.name
                    append_reasoning(f"anthropic_tool: {short}", source="anthropic")
                    tool_uses.append(block)

            if response.stop_reason != "tool_use" or not tool_uses:
                break

            # Append assistant turn + execute tools
            messages.append({"role": "assistant", "content": response.content})
            tool_results: list[dict[str, Any]] = []
            for tu in tool_uses:
                handler = handlers.get(tu.name)
                if handler:
                    try:
                        result = await handler(tu.input)
                    except Exception as exc:
                        result = {"error": str(exc)}
                else:
                    result = {"error": f"no handler for {tu.name}"}
                tool_results.append(_build_tool_result_block(tu.id, result))
            messages.append({"role": "user", "content": tool_results})

        if response_text:
            append_reasoning(response_text, source="anthropic")

        return {
            "response": response_text,
            "structured_output": None,
            "cost_usd": cost,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    # ── streaming query: raw httpx SSE first turn + SDK tool loops ──────────

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
        """Stream using raw httpx SSE for first turn (SDK stream hangs on py3.14+anyio).

        Tool-continuation turns use the non-streaming SDK path (client.messages.create)
        which works correctly on all Python versions.
        """
        from app.services.run_scratchpad import append_reasoning

        effective_tools = tools
        if _prefer_direct_answer(prompt, tools, inline_mode, agent_name):
            logger.info("AnthropicDirectEngine: use direct-answer path (tools disabled) agent=%s", agent_name)
            effective_tools = []
            yield _json({
                "type": "orchestrator",
                "stage": "lite_direct",
                "reason": "short_prompt_skip_tools",
            })

        api_tools = _tools_for_api(effective_tools)
        handlers = _handler_map(effective_tools)
        fallback_models = list(self._fallback_models)
        max_tokens = settings.agent_max_tokens if hasattr(settings, "agent_max_tokens") else 8096
        base_url = settings.anthropic_base_url
        api_key = settings.anthropic_api_key
        first_byte_timeout = max(1, int(getattr(settings, "anthropic_first_byte_timeout_sec", 12)))
        stream_read_timeout = max(5.0, float(getattr(settings, "anthropic_stream_read_timeout_sec", 20)))

        for attempt_idx, attempt_model in enumerate(fallback_models):
            print(f"[engine.stream] attempt#{attempt_idx} model={attempt_model} base_url={base_url[:50]}", flush=True)
            # Build first-turn payload
            first_payload: dict[str, Any] = {
                "model": attempt_model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
            }
            if system:
                first_payload["system"] = system
            if api_tools:
                first_payload["tools"] = api_tools

            stream_result: StreamResult | None = None
            got_first_byte = False
            should_cascade = False
            got_error = False

            async def _handle_stream_event(event_type: str, event_data: object) -> AsyncIterator[str]:
                """Handle one streamed event and yield frontend payload events."""
                nonlocal got_first_byte, got_error, stream_result
                got_first_byte = True

                if event_type == "error":
                    yield _json({"type": "text", "content": event_data})
                    got_error = True
                    return

                if event_type == "text":
                    yield _json({"type": "text", "content": event_data})
                    return

                if event_type == "ui_event":
                    yield _json(event_data)
                    return

                if event_type == "tool_call_start":
                    block = event_data
                    short = block["name"].split("__")[-1] if "__" in block["name"] else block["name"]
                    yield _json({"type": "tool_call", "tool": short, "status": "calling"})
                    block_input = block.get("input") if isinstance(block, dict) else {}
                    for fe in build_frontend_events(block["name"], block_input if isinstance(block_input, dict) else {}):
                        yield fe
                    return

                if event_type == "result":
                    stream_result = event_data

                # tool_use and unknown events are consumed by stream_result reconstruction.
                return

            try:
                stream_iter = httpx_stream_first_turn(
                    base_url,
                    api_key,
                    first_payload,
                    read_timeout_s=stream_read_timeout,
                )
                stream_aiter = stream_iter.__aiter__()

                # Apply a strict first-byte timeout to avoid hanging streams.
                try:
                    first_event = await asyncio.wait_for(
                        stream_aiter.__anext__(),
                        timeout=float(first_byte_timeout),
                    )
                except StopAsyncIteration:
                    first_event = None
                except asyncio.TimeoutError as exc:
                    raise httpx.TimeoutException("first_byte_timeout") from exc

                if first_event is not None:
                    async for payload_event in _handle_stream_event(first_event[0], first_event[1]):
                        yield payload_event
                    if not got_error:
                        async for event_type, event_data in stream_aiter:
                            async for payload_event in _handle_stream_event(event_type, event_data):
                                yield payload_event
                            if got_error:
                                break

            except httpx.TimeoutException:
                is_last = attempt_idx == len(fallback_models) - 1
                if not got_first_byte and not is_last:
                    next_model = fallback_models[attempt_idx + 1]
                    logger.warning(
                        "Anthropic first-byte timeout model=%s → %s agent=%s",
                        attempt_model, next_model, agent_name,
                    )
                    yield _json({"type": "model_fallback", "from_model": attempt_model,
                                 "to_model": next_model, "reason": "first_byte_timeout",
                                 "attempt_index": attempt_idx})
                    should_cascade = True
                else:
                    label = "idle" if got_first_byte else "first_byte"
                    logger.warning(
                        "Anthropic stream %s timeout model=%s agent=%s",
                        label, attempt_model, agent_name,
                    )
                    yield _json({"type": "text", "content": "AI 流式响应超时，已结束本次会话。"})
                    yield _json({"type": "done", "session_id": session_id, "cost": 0.0,
                                 "input_tokens": 0, "output_tokens": 0, "stop_reason": "idle_timeout"})
                break

            except Exception:
                logger.exception("AnthropicDirectEngine.stream error model=%s agent=%s", attempt_model, agent_name)
                yield _json({"type": "text", "content": "AI 响应出错，请稍后重试。"})
                yield _json({"type": "done", "session_id": session_id, "cost": 0.0,
                             "input_tokens": 0, "output_tokens": 0, "stop_reason": "error"})
                break

            if should_cascade:
                continue

            if got_error or stream_result is None:
                yield _json({"type": "done", "session_id": session_id, "cost": 0.0,
                             "input_tokens": 0, "output_tokens": 0, "stop_reason": "error"})
                break

            # ── Tool continuation loops (non-streaming SDK) ──────────────
            sr = stream_result
            input_tokens_total = sr.input_tokens
            output_tokens_total = sr.output_tokens
            stop_reason = sr.stop_reason
            tool_uses_raw = list(sr.tool_uses)
            tool_call_count = len(tool_uses_raw)

            if stop_reason == "tool_use" and not tool_uses_raw:
                logger.warning(
                    "Anthropic stop=tool_use but no parsable tool blocks model=%s agent=%s",
                    attempt_model, agent_name,
                )
                yield _json({
                    "type": "done",
                    "session_id": session_id,
                    "cost": 0.0,
                    "input_tokens": input_tokens_total,
                    "output_tokens": output_tokens_total,
                    "stop_reason": "tool_use_pending",
                    "request_id": sr.request_id,
                    "tool_call_count": 0,
                })
                break

            if sr.text:
                append_reasoning(sr.text, source="anthropic_stream")

            if stop_reason == "tool_use" and tool_uses_raw:
                if all(tu["name"] not in handlers for tu in tool_uses_raw):
                    logger.warning(
                        "Anthropic tool_use has no local handlers model=%s agent=%s tools=%s",
                        attempt_model,
                        agent_name,
                        [tu["name"] for tu in tool_uses_raw],
                    )
                    yield _json({
                        "type": "done",
                        "session_id": session_id,
                        "cost": 0.0,
                        "input_tokens": input_tokens_total,
                        "output_tokens": output_tokens_total,
                        "stop_reason": "tool_use_pending",
                        "request_id": sr.request_id,
                        "tool_call_count": tool_call_count,
                    })
                    break

                client = _make_client()
                messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]

                # Reconstruct assistant turn content
                asst_content: list[dict[str, Any]] = []
                if sr.text:
                    asst_content.append({"type": "text", "text": sr.text})
                for tu in tool_uses_raw:
                    asst_content.append({
                        "type": "tool_use",
                        "id": tu["id"],
                        "name": tu["name"],
                        "input": tu["input"],
                    })
                messages.append({"role": "assistant", "content": asst_content})

                for _turn in range(_MAX_TOOL_TURNS):
                    # Execute tools
                    tool_results: list[dict[str, Any]] = []
                    for tu in tool_uses_raw:
                        short = tu["name"].split("__")[-1] if "__" in tu["name"] else tu["name"]
                        append_reasoning(f"anthropic_tool: {short}", source="anthropic_stream")
                        handler = handlers.get(tu["name"])
                        if handler:
                            try:
                                result = await handler(tu["input"])
                            except Exception as exc:
                                result = {"error": str(exc)}
                        else:
                            result = {"error": f"no handler for {tu['name']}"}
                        is_error = _tool_result_is_error(result)
                        status = "error" if is_error else "done"
                        payload: dict[str, Any] = {
                            "type": "tool_call",
                            "tool": short,
                            "status": status,
                            "result_preview": str(result)[:120],
                        }
                        if is_error:
                            payload["reason"] = str(result)[:220]
                        yield _json(payload)
                        for fe in build_frontend_events_from_result(tu["name"], tu["input"], result):
                            yield fe
                        tool_results.append(_build_tool_result_block(tu["id"], result))
                    messages.append({"role": "user", "content": tool_results})

                    # Non-streaming follow-up
                    kwargs: dict[str, Any] = dict(
                        model=attempt_model,
                        max_tokens=max_tokens,
                        system=system,
                        messages=messages,
                    )
                    if api_tools:
                        kwargs["tools"] = api_tools
                    try:
                        follow_msg = await client.messages.create(**kwargs)
                    except Exception as exc:
                        logger.exception("Tool continuation failed model=%s: %s", attempt_model, exc)
                        yield _json({"type": "text", "content": "工具调用后续处理出错，已结束本次会话。"})
                        stop_reason = "error"
                        break

                    input_tokens_total += follow_msg.usage.input_tokens
                    output_tokens_total += follow_msg.usage.output_tokens

                    follow_text = ""
                    tool_uses_raw = []
                    for block in follow_msg.content:
                        if block.type == "text":
                            follow_text += block.text
                            yield _json({"type": "text", "content": block.text})
                        elif block.type == "tool_use":
                            short = block.name.split("__")[-1] if "__" in block.name else block.name
                            yield _json({"type": "tool_call", "tool": short, "status": "calling"})
                            for fe in build_frontend_events(block.name, block.input):
                                yield fe
                            tool_uses_raw.append({
                                "id": block.id,
                                "name": block.name,
                                "input": block.input,
                            })
                            tool_call_count += 1

                    if follow_text:
                        append_reasoning(follow_text, source="anthropic_stream_tool")

                    stop_reason = follow_msg.stop_reason or "end_turn"
                    if stop_reason != "tool_use" or not tool_uses_raw:
                        break

                    # Next tool turn
                    asst_content = []
                    if follow_text:
                        asst_content.append({"type": "text", "text": follow_text})
                    for tu in tool_uses_raw:
                        asst_content.append({
                            "type": "tool_use",
                            "id": tu["id"],
                            "name": tu["name"],
                            "input": tu["input"],
                        })
                    messages.append({"role": "assistant", "content": asst_content})

            yield _json({
                "type": "done",
                "session_id": session_id,
                "cost": 0.0,
                "input_tokens": input_tokens_total,
                "output_tokens": output_tokens_total,
                "stop_reason": stop_reason,
                "request_id": sr.request_id,
                "tool_call_count": tool_call_count,
            })
            break
