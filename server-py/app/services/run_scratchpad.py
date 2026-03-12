"""Run-level scratchpad shared across engine chains.

This module provides a lightweight in-memory context (ContextVar scoped) so
Claude/OpenAI chain switches can share interim reasoning and tool outcomes
within the same request/run.
"""

from __future__ import annotations

import time
import uuid
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class RunScratchpad:
    """Transient run memory for one agent request."""

    run_id: str
    created_at: float
    notes: list[str] = field(default_factory=list)
    tool_results: list[dict[str, Any]] = field(default_factory=list)


_ctx_var: ContextVar[RunScratchpad | None] = ContextVar("run_scratchpad_context", default=None)


def start_run_scratchpad(
    *,
    run_id: str | None = None,
    prompt: str | None = None,
) -> Token[RunScratchpad | None]:
    """Initialize and set run scratchpad for current request/task."""
    effective_run_id = run_id or str(uuid.uuid4())
    scratchpad = RunScratchpad(run_id=effective_run_id, created_at=time.time())
    token = _ctx_var.set(scratchpad)

    if prompt:
        append_reasoning(f"user_prompt: {prompt}", source="user")

    return token


def reset_run_scratchpad(token: Token[RunScratchpad | None]) -> None:
    """Reset scratchpad context to previous value."""
    _ctx_var.reset(token)


def get_run_scratchpad() -> RunScratchpad | None:
    """Get current run scratchpad context."""
    return _ctx_var.get()


def append_reasoning(note: str, *, source: str = "engine", max_chars: int = 400) -> None:
    """Append concise reasoning/note into run scratchpad."""
    scratchpad = get_run_scratchpad()
    if scratchpad is None:
        return

    text = (note or "").strip().replace("\n", " ")
    if not text:
        return

    if len(text) > max_chars:
        text = text[:max_chars]

    scratchpad.notes.append(f"[{source}] {text}")
    if len(scratchpad.notes) > 50:
        scratchpad.notes = scratchpad.notes[-50:]


def append_tool_result(
    *,
    tool: str,
    summary: str,
    status: str = "ok",
    ref: str | None = None,
    max_chars: int = 280,
) -> None:
    """Append one tool result record for cross-engine continuity."""
    scratchpad = get_run_scratchpad()
    if scratchpad is None:
        return

    text = (summary or "").strip().replace("\n", " ")
    if len(text) > max_chars:
        text = text[:max_chars]

    item: dict[str, Any] = {
        "tool": tool,
        "status": status,
        "summary": text,
    }
    if ref:
        item["ref"] = ref

    scratchpad.tool_results.append(item)
    if len(scratchpad.tool_results) > 40:
        scratchpad.tool_results = scratchpad.tool_results[-40:]


def snapshot_for_prompt(
    *,
    max_chars: int = 1800,
    max_notes: int = 8,
    max_tools: int = 8,
) -> str:
    """Render compact scratchpad snapshot suitable for system prompt."""
    scratchpad = get_run_scratchpad()
    if scratchpad is None:
        return ""

    lines: list[str] = ["[Run Scratchpad]"]

    if scratchpad.notes:
        lines.append("- recent_reasoning:")
        for note in scratchpad.notes[-max_notes:]:
            lines.append(f"  - {note}")

    if scratchpad.tool_results:
        lines.append("- recent_tool_results:")
        for item in scratchpad.tool_results[-max_tools:]:
            tool = str(item.get("tool") or "")
            status = str(item.get("status") or "")
            summary = str(item.get("summary") or "")
            lines.append(f"  - {tool} [{status}]: {summary}")

    snapshot = "\n".join(lines).strip()
    if len(snapshot) > max_chars:
        snapshot = snapshot[-max_chars:]
    return snapshot
