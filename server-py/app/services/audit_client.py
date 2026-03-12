"""Async audit client for high-risk agent actions."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from app.config import settings
from app.services.agent_request_context import get_agent_request_context

logger = logging.getLogger(__name__)


async def log_tool_action(
    *,
    request_id: str,
    tool: str,
    risk: str,
    approved: bool,
    status: str,
    args: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    duration_ms: int | None = None,
    student_id: str | None = None,
    session_id: str | None = None,
    agent_name: str | None = None,
    engine: str | None = None,
    mode: str | None = None,
) -> None:
    """Fire-and-forget style audit logging to Go internal endpoint."""
    if not settings.coding_audit_enabled:
        return

    ctx = get_agent_request_context()
    payload: dict[str, Any] = {
        "request_id": request_id,
        "session_id": session_id if session_id is not None else ctx.session_id,
        "student_id": student_id if student_id is not None else ctx.student_id,
        "agent": agent_name if agent_name is not None else ctx.agent_name,
        "engine": engine if engine is not None else ctx.engine,
        "mode": mode if mode is not None else ctx.mode,
        "tool": tool,
        "risk": risk,
        "approved": approved,
        "status": status,
        "args": args or {},
        "result": result,
        "error": error,
        "duration_ms": duration_ms if duration_ms is not None else 0,
        "ts": int(time.time()),
    }

    endpoint = settings.go_backend_url.rstrip("/") + "/internal/agent/audit"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(2.5)) as client:
            await client.post(endpoint, json=payload)
    except Exception:
        logger.debug("audit log post failed", exc_info=True)
