"""Reusable orchestrator helper functions.

These helpers are intentionally engine-agnostic so they can be shipped as part
of `webagent_core` without depending on product service code.
"""

from __future__ import annotations

from typing import Any


def calc_worker_trace_cost(worker_trace: list[dict[str, Any]]) -> float:
    """Calculate total worker cost from artifacts."""
    return round(
        sum(float(item.get("cost_usd") or 0.0) for item in worker_trace),
        6,
    )


def compact_worker_trace(worker_trace: list[dict[str, Any]], limit: int = 12) -> list[dict[str, Any]]:
    """Compact worker artifacts for API/SSE payloads."""
    compact: list[dict[str, Any]] = []
    for item in worker_trace[: max(1, limit)]:
        artifact = item.get("artifact") if isinstance(item.get("artifact"), dict) else {}
        compact.append(
            {
                "id": str(item.get("id") or ""),
                "title": str(item.get("title") or ""),
                "kind": str(item.get("kind") or ""),
                "mode": str(item.get("mode") or ""),
                "status": str(item.get("status") or ""),
                "depends_on": item.get("depends_on") or [],
                "tools_allowed": item.get("tools_allowed") or [],
                "attempts": int(item.get("attempts") or 1),
                "failure_reason": str(item.get("failure_reason") or "")[:120],
                "engine": item.get("engine_used"),
                "model": item.get("model_used"),
                "cost": float(item.get("cost_usd") or 0.0),
                "summary": str(item.get("summary") or "")[:120],
                "artifact_type": str(artifact.get("kind") or ""),
                "artifact_uri": str(artifact.get("uri") or ""),
            }
        )
    return compact


def resolve_worker_tools(base_tools: list[str], requested_tools: list[str]) -> list[str]:
    """Resolve worker tool whitelist from planner node declaration."""
    normalized_base = [
        str(tool_name)
        for tool_name in base_tools
        if isinstance(tool_name, str) and str(tool_name).strip()
    ]
    if not requested_tools:
        return normalized_base

    allowed: list[str] = []
    base_set = set(normalized_base)
    seen: set[str] = set()
    for tool_name in requested_tools:
        if tool_name in base_set and tool_name not in seen:
            allowed.append(tool_name)
            seen.add(tool_name)
    return allowed


__all__ = [
    "calc_worker_trace_cost",
    "compact_worker_trace",
    "resolve_worker_tools",
]
