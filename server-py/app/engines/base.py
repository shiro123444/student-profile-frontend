"""Base engine abstraction for multi-model agent support."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable


@dataclass
class ToolDef:
    """Unified tool definition with handler reference."""

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None


@dataclass
class ToolCall:
    """Parsed tool call from model response."""

    id: str
    name: str
    input: dict[str, Any]
    handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None


def _json(obj: dict[str, Any]) -> str:
    return json.dumps(obj, ensure_ascii=False)


# ── Frontend control event detection (shared by all engines) ──

_FRONTEND_TOOL_MAP = {
    "navigate_page": lambda inp: {"type": "navigate", "to": inp["to"]} if inp.get("to") else None,
    "emit_ui_command": lambda inp: {
        "type": "ui_command",
        "ui_command": True,
        "command": inp["command"],
        "target": inp.get("target", ""),
        "params": inp.get("params", {}),
    } if inp.get("command") else None,
    "show_toast": lambda inp: {
        "type": "toast",
        "message": inp["message"],
        "level": inp.get("level", "info"),
    } if inp.get("message") else None,
    "scroll_to_section": lambda inp: {
        "type": "scroll_to",
        "target": inp["target"],
    } if inp.get("target") else None,
    "set_theme": lambda inp: {
        "type": "set_theme",
        "theme": inp["theme"],
    } if inp.get("theme") else None,
    "emit_graph_command": lambda inp: {
        "type": "graph_command",
        "graph_command": True,
        "command": inp["command"],
        "target": inp.get("target", ""),
        "params": inp.get("params", {}),
    } if inp.get("command") else None,
    "emit_graph_batch": lambda inp: {
        "type": "graph_batch",
        "graph_batch": True,
        "batch_id": inp.get("batch_id", ""),
        "mode": inp.get("mode", "best_effort"),
        "steps": inp.get("steps", []),
    } if inp.get("steps") else None,
    "delegate_to_agent": lambda inp: {
        "type": "agent_handoff",
        "stage": "start",
        "target_agent": inp.get("target_agent", ""),
        "task_preview": str(inp.get("task", ""))[:180],
    } if inp.get("target_agent") else None,
    "delegate_batch_agents": lambda inp: {
        "type": "agent_handoff_batch",
        "stage": "start",
        "mode": inp.get("mode", "best_effort"),
        "request_count": len(inp.get("requests") or []),
    } if isinstance(inp.get("requests"), list) else None,
}


def build_frontend_events(tool_name: str, tool_input: dict[str, Any]) -> list[str]:
    """Return JSON-encoded SSE events for frontend-control tools."""
    events: list[str] = []
    # Strip any prefix (mcp__pathmind__)
    short = tool_name.split("__")[-1] if "__" in tool_name else tool_name
    builder = _FRONTEND_TOOL_MAP.get(short)
    if builder:
        evt = builder(tool_input)
        if evt:
            events.append(_json(evt))
    return events


def _extract_tool_payload(tool_result: Any) -> dict[str, Any]:
    """Best-effort extract JSON payload from MCP tool result."""
    if isinstance(tool_result, dict):
        content = tool_result.get("content")
        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    continue
                if str(item.get("type") or "") != "text":
                    continue
                text = str(item.get("text") or "").strip()
                if not text:
                    continue
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict):
                        merged = dict(parsed)
                        if tool_result.get("is_error"):
                            merged.setdefault("is_error", True)
                        return merged
                except json.JSONDecodeError:
                    payload = {"text": text}
                    if tool_result.get("is_error"):
                        payload["is_error"] = True
                    return payload
        return tool_result

    if isinstance(tool_result, str):
        text = tool_result.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {"text": text}

    return {}


def build_frontend_events_from_result(
    tool_name: str,
    tool_input: dict[str, Any],
    tool_result: Any,
) -> list[str]:
    """Return JSON-encoded SSE events derived from tool execution result."""
    short = tool_name.split("__")[-1] if "__" in tool_name else tool_name
    payload = _extract_tool_payload(tool_result)
    events: list[str] = []

    if short == "delegate_to_agent":
        target_agent = (
            str(payload.get("target_agent") or "").strip()
            if isinstance(payload, dict)
            else ""
        ) or str(tool_input.get("target_agent") or "").strip()
        if target_agent:
            delegated = bool(payload.get("delegated")) if isinstance(payload, dict) else False
            is_error = bool(payload.get("is_error")) if isinstance(payload, dict) else False
            stage = "done" if delegated and not is_error else "failed"

            event_payload: dict[str, Any] = {
                "type": "agent_handoff",
                "stage": stage,
                "target_agent": target_agent,
            }
            if isinstance(payload, dict):
                if isinstance(payload.get("chain"), list):
                    event_payload["chain"] = payload.get("chain")
                if isinstance(payload.get("engine_used"), str):
                    event_payload["engine"] = payload.get("engine_used")
                if isinstance(payload.get("model_used"), str):
                    event_payload["model"] = payload.get("model_used")
                if isinstance(payload.get("mode_used"), str):
                    event_payload["mode"] = payload.get("mode_used")
                if isinstance(payload.get("cost_usd"), (int, float)):
                    event_payload["cost_usd"] = float(payload.get("cost_usd") or 0.0)
                if isinstance(payload.get("response"), str):
                    event_payload["summary"] = payload.get("response")[:220]
                if stage == "failed":
                    event_payload["error"] = str(payload.get("error") or payload.get("text") or "").strip()

            events.append(_json(event_payload))
        return events

    if short == "delegate_batch_agents":
        summary = payload.get("summary") if isinstance(payload, dict) else None
        if isinstance(summary, dict):
            events.append(
                _json(
                    {
                        "type": "agent_handoff_batch",
                        "stage": "done",
                        "mode": payload.get("mode", tool_input.get("mode", "best_effort")),
                        "batch_id": payload.get("batch_id", ""),
                        "success_count": int(summary.get("success") or 0),
                        "failed_count": int(summary.get("failed") or 0),
                        "skipped_count": int(summary.get("skipped") or 0),
                        "total": int(summary.get("total") or 0),
                        "committed": bool((payload.get("transaction") or {}).get("committed", False)),
                    }
                )
            )
        return events

    return events


class BaseEngine(ABC):
    """Abstract base for LLM engines."""

    @abstractmethod
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
        """Yield JSON-encoded SSE events."""
        ...

    @abstractmethod
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
        """One-shot query → {response, cost_usd, input_tokens, output_tokens}."""
        ...
