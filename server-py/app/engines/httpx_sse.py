"""Isolated httpx SSE streaming — NO anthropic SDK imports.

This module MUST NOT import `anthropic` (directly or transitively).
On Python 3.14, `import anthropic` poisons httpx async streaming
(aiter_bytes hangs inside asyncio event loops). Keeping httpx streaming
in a module that never touches the anthropic SDK avoids the conflict.

The anthropic SDK is only used in anthropic_engine.py for non-streaming
tool-continuation turns (client.messages.create), which work correctly.
"""

import json
import logging
from collections.abc import AsyncIterator

import httpx

logger = logging.getLogger(__name__)


def _messages_url(base_url: str) -> str:
    """Build canonical Anthropic Messages endpoint URL.

    Avoid double-prefixing when caller already provides a `/v1` suffixed base URL.
    """
    normalized = base_url.rstrip("/")
    if normalized.endswith("/v1/messages"):
        return normalized
    if normalized.endswith("/v1"):
        return normalized + "/messages"
    return normalized + "/v1/messages"


class StreamResult:
    """Accumulated result of a streaming first turn."""

    __slots__ = (
        "text",
        "tool_uses",
        "input_tokens",
        "output_tokens",
        "stop_reason",
        "model",
        "request_id",
        "_pending_tool",
        "_tool_input_parts",
    )

    def __init__(self) -> None:
        self.text: str = ""
        self.tool_uses: list[dict] = []
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.stop_reason: str = "end_turn"
        self.model: str = ""
        self.request_id: str = ""
        self._pending_tool: dict | None = None
        self._tool_input_parts: list[str] = []

    def content_for_messages(self) -> list[dict]:
        blocks: list[dict] = []
        if self.text:
            blocks.append({"type": "text", "text": self.text})
        for tu in self.tool_uses:
            blocks.append(
                {
                    "type": "tool_use",
                    "id": tu["id"],
                    "name": tu["name"],
                    "input": tu["input"],
                }
            )
        return blocks


def _try_parse_ui_event(text: str) -> dict | None:
    """Parse JSON-embedded UI commands from model text."""
    try:
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            return None
        if parsed.get("ui_command"):
            return {"type": "ui_command", **parsed}
        if parsed.get("action") == "navigate":
            return {"type": "navigate", "to": parsed.get("to", "/")}
        if parsed.get("toast"):
            return {
                "type": "toast",
                "message": parsed.get("message", ""),
                "level": parsed.get("level", "info"),
            }
        if parsed.get("scroll_to"):
            return {"type": "scroll_to", "target": parsed.get("target", "")}
        if parsed.get("set_theme"):
            return {"type": "set_theme", "theme": parsed.get("theme", "dark")}
        if parsed.get("graph_command"):
            return {
                "type": "graph_command",
                "graph_command": True,
                "command": parsed.get("command", ""),
                "target": parsed.get("target", ""),
                "params": parsed.get("params", {}),
            }
        if parsed.get("graph_batch"):
            return {
                "type": "graph_batch",
                "graph_batch": True,
                "batch_id": parsed.get("batch_id", ""),
                "mode": parsed.get("mode", "best_effort"),
                "steps": parsed.get("steps", []),
            }
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _process_sse_event(
    evt: dict,
    result: StreamResult,
) -> list[tuple[str, object]]:
    """Process a single SSE event dict against a StreamResult.

    Returns a list of (event_type, data) tuples to yield upstream.
    An empty list means no events to yield.
    A tuple of ("_error", msg) signals a fatal API error.
    A tuple of ("_stop", None) signals message_stop.
    """
    events: list[tuple[str, object]] = []
    etype = evt.get("type", "")

    if etype == "error":
        err = evt.get("error", {})
        err_msg = err.get("message", "Unknown API error")
        logger.error("httpx_sse: API error type=%s msg=%s", err.get("type"), err_msg)
        events.append(("_error", err_msg))
        return events

    if etype == "message_start":
        msg = evt.get("message", {})
        result.model = msg.get("model", "")
        usage = msg.get("usage", {})
        result.input_tokens = usage.get("input_tokens", 0)

    elif etype == "content_block_start":
        block = evt.get("content_block", {})
        if block.get("type") == "tool_use":
            result._pending_tool = {
                "id": block.get("id", ""),
                "name": block.get("name", ""),
                "input": {},
            }
            result._tool_input_parts = []
            events.append(("tool_call_start", block))

    elif etype == "content_block_delta":
        delta = evt.get("delta", {})
        dtype = delta.get("type", "")
        if dtype == "text_delta":
            text = delta.get("text", "")
            if text:
                result.text += text
                events.append(("text", text))
                ui_evt = _try_parse_ui_event(result.text)
                if ui_evt:
                    events.append(("ui_event", ui_evt))
        elif dtype == "input_json_delta":
            result._tool_input_parts.append(delta.get("partial_json", ""))

    elif etype == "content_block_stop":
        if result._pending_tool is not None:
            raw_input = "".join(result._tool_input_parts)
            try:
                result._pending_tool["input"] = json.loads(raw_input) if raw_input else {}
            except json.JSONDecodeError:
                result._pending_tool["input"] = {"_raw": raw_input}
            result.tool_uses.append(result._pending_tool)
            events.append(("tool_use", result._pending_tool))
            result._pending_tool = None
            result._tool_input_parts = []

    elif etype == "message_delta":
        delta = evt.get("delta", {})
        result.stop_reason = delta.get("stop_reason", result.stop_reason) or result.stop_reason
        usage = evt.get("usage", {})
        result.output_tokens = usage.get("output_tokens", result.output_tokens)

    elif etype == "message_stop":
        events.append(("_stop", None))

    return events


async def httpx_stream_first_turn(
    base_url: str,
    api_key: str,
    payload: dict,
    read_timeout_s: float = 20.0,
) -> AsyncIterator[tuple[str, object]]:
    """Stream /v1/messages via raw httpx, yield (event_type, data) tuples.

    Yields:
        ("text", str)             — text chunk
        ("tool_call_start", dict) — tool use starting
        ("tool_use", dict)        — completed tool use block
        ("ui_event", dict)        — parsed UI command
        ("result", StreamResult)  — final accumulated result
        ("error", str)            — API error message

    Uses default httpx transport + aiter_bytes + manual newline split.
    Do NOT add `transport=AsyncHTTPTransport()` — it conflicts with the
    anthropic SDK being loaded in the same process on Python 3.14.
    """
    result = StreamResult()
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "accept": "text/event-stream",
    }
    url = _messages_url(base_url)

    print(f"[httpx_sse] opening stream to {url} model={payload.get('model')}", flush=True)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=5.0, read=max(5.0, float(read_timeout_s)), write=30.0, pool=5.0
        ),
    ) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            print(f"[httpx_sse] resp status={resp.status_code}", flush=True)
            if resp.status_code != 200:
                body = await resp.aread()
                error_text = body.decode(errors="replace")[:300]
                logger.error(
                    "httpx_stream HTTP %s model=%s body=%s",
                    resp.status_code,
                    payload.get("model"),
                    error_text,
                )
                yield ("error", f"API错误 ({resp.status_code})，请稍后重试。")
                return

            result.request_id = resp.headers.get("request-id", "")

            buf = b""
            stop = False
            chunk_count = 0
            async for chunk in resp.aiter_bytes():
                chunk_count += 1
                if chunk_count <= 3:
                    print(
                        f"[httpx_sse] chunk#{chunk_count} len={len(chunk)} content={chunk[:200]}",
                        flush=True,
                    )
                buf += chunk
                while b"\n" in buf:
                    raw_line, buf = buf.split(b"\n", 1)
                    line = raw_line.decode("utf-8", errors="replace")
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:].strip()
                    if not raw or raw == "[DONE]":
                        continue

                    try:
                        evt = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    for ev_type, ev_data in _process_sse_event(evt, result):
                        if ev_type == "_error":
                            yield ("error", ev_data)
                            return
                        if ev_type == "_stop":
                            stop = True
                            continue
                        yield (ev_type, ev_data)

                if stop:
                    break

            # ── Process any remaining data in buf after stream ends ──
            if buf and not stop:
                for raw_line in buf.split(b"\n"):
                    line = raw_line.decode("utf-8", errors="replace")
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        evt = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    for ev_type, ev_data in _process_sse_event(evt, result):
                        if ev_type == "_error":
                            yield ("error", ev_data)
                            return
                        if ev_type == "_stop":
                            stop = True
                            continue
                        yield (ev_type, ev_data)

            print(
                f"[httpx_sse] done chunks={chunk_count} text_len={len(result.text)} "
                f"tools={len(result.tool_uses)} in={result.input_tokens} out={result.output_tokens} "
                f"stop={result.stop_reason}",
                flush=True,
            )

    yield ("result", result)
