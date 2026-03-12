"""System registry and observability tools for command-center agent."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from claude_agent_sdk import ToolAnnotations, tool

from app.agents.registry import AGENT_REGISTRY
from app.services.ai_dispatch_metrics import get_dispatch_metrics_collector
from app.services.approval_broker import get_approval_broker
from app.services.shared_memory import list_sessions
from app.tools.registry import get_registry


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@tool(
    "list_registered_agents",
    "列出系统内已注册的全部 Agent（名称、引擎、模型层级、工具数）。",
    {
        "type": "object",
        "properties": {},
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def list_registered_agents(args: dict[str, Any]) -> dict[str, Any]:
    del args
    agents = []
    for name, agent in AGENT_REGISTRY.items():
        agents.append({
            "name": name,
            "description": agent.description,
            "engine": agent.engine,
            "model_tier": agent.model,
            "engine_model": agent.engine_model,
            "tool_count": len(agent.tools),
            "tools": agent.tools,
        })
    agents.sort(key=lambda item: item["name"])
    payload = {
        "generated_at": _now_iso(),
        "total": len(agents),
        "agents": agents,
    }
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}]}


@tool(
    "list_registered_tool_packages",
    "列出系统中已注册的工具包、工具数量、来源和权限角色。",
    {
        "type": "object",
        "properties": {},
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def list_registered_tool_packages(args: dict[str, Any]) -> dict[str, Any]:
    del args
    registry = get_registry()
    packages = registry.list_info()
    payload = {
        "generated_at": _now_iso(),
        "package_count": len(packages),
        "tool_count": len(registry.get_all_tools()),
        "packages": packages,
    }
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}]}


@tool(
    "get_runtime_observability",
    "获取运行态观测快照：dispatch 指标、审批指标、可选学生会话摘要。",
    {
        "type": "object",
        "properties": {
            "student_id": {"type": "string", "description": "可选：按学生查询最近会话"},
            "limit": {"type": "integer", "description": "会话条数（1-50）", "default": 10},
        },
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def get_runtime_observability(args: dict[str, Any]) -> dict[str, Any]:
    student_id = str(args.get("student_id") or "").strip()
    limit_raw = args.get("limit", 10)
    try:
        limit = int(limit_raw)
    except (TypeError, ValueError):
        limit = 10
    limit = max(1, min(limit, 50))

    dispatch_snapshot = await get_dispatch_metrics_collector().snapshot()
    approval_snapshot = await get_approval_broker().metrics()
    sessions = await list_sessions(student_id, limit) if student_id else []

    payload = {
        "generated_at": _now_iso(),
        "dispatch": dispatch_snapshot,
        "approvals": approval_snapshot,
        "student_id": student_id or None,
        "session_limit": limit,
        "sessions": sessions,
    }
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}]}
