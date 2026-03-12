"""Knowledge graph query tools."""

from __future__ import annotations

import json
from typing import Any

import httpx
from claude_agent_sdk import ToolAnnotations, tool

from app.config import settings

GO_API = settings.go_backend_url


@tool(
    "query_knowledge_graph",
    "查询 Neo4j 知识图谱，获取学生、MBTI 类型、职业、技能和课程之间的关系。",
    {
        "type": "object",
        "properties": {
            "query_type": {
                "type": "string",
                "description": "查询类型: full（全图）、student（学生子图）、career（职业子图）",
                "default": "full",
            },
            "entity_id": {
                "type": "string",
                "description": "学生或职业 ID（student/career 类型必填）",
            },
        },
        "required": [],
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def query_knowledge_graph(args: dict[str, Any]) -> dict[str, Any]:
    query_type = args.get("query_type", "full")
    entity_id = args.get("entity_id")
    try:
        async with httpx.AsyncClient() as client:
            if query_type == "student" and entity_id:
                url = f"{GO_API}/graph/student/{entity_id}"
            elif query_type == "career" and entity_id:
                url = f"{GO_API}/graph/career/{entity_id}"
            else:
                url = f"{GO_API}/graph/full"

            resp = await client.get(url, timeout=15)
            resp.raise_for_status()
            data = resp.json()

        result = {
            "query_type": query_type,
            "nodes": data.get("nodes", []),
            "edges": data.get("edges", []),
            "node_count": len(data.get("nodes", [])),
            "edge_count": len(data.get("edges", [])),
        }
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"查询知识图谱失败: {e}"}], "is_error": True}


@tool(
    "emit_graph_command",
    "发送图谱可视化控制指令给前端。用于聚焦节点、过滤节点类型、路径高亮、视图缩放等交互控制。",
    {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "enum": [
                    "focus_node",
                    "filter_type",
                    "clear_filters",
                    "fit_view",
                    "highlight_path",
                    "expand_node",
                    "open_panel",
                ],
                "description": "图谱控制命令类型",
            },
            "target": {
                "type": "string",
                "description": "命令目标（如 node_id、节点名称、类型）",
            },
            "params": {
                "type": "object",
                "description": "额外参数，如 {types: ['career','skill']} 或 {source,target}",
            },
        },
        "required": ["command"],
    },
    annotations=ToolAnnotations(idempotentHint=True),
)
async def emit_graph_command(args: dict[str, Any]) -> dict[str, Any]:
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "graph_command": True,
                        "command": args["command"],
                        "target": args.get("target", ""),
                        "params": args.get("params", {}),
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


@tool(
    "emit_graph_batch",
    "发送图谱批次执行指令。可一次下发多条图谱命令并指定执行模式（best_effort / all_or_nothing）。",
    {
        "type": "object",
        "properties": {
            "batch_id": {
                "type": "string",
                "description": "批次 ID，用于前端与回执跟踪",
            },
            "mode": {
                "type": "string",
                "enum": ["best_effort", "all_or_nothing"],
                "default": "best_effort",
                "description": "执行模式：best_effort 尽量执行；all_or_nothing 遇错即停",
            },
            "steps": {
                "type": "array",
                "description": "按顺序执行的图谱命令列表",
                "items": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "enum": [
                                "focus_node",
                                "filter_type",
                                "clear_filters",
                                "fit_view",
                                "highlight_path",
                                "expand_node",
                                "open_panel",
                            ],
                        },
                        "target": {"type": "string"},
                        "params": {"type": "object"},
                    },
                    "required": ["command"],
                },
                "minItems": 1,
                "maxItems": 12,
            },
        },
        "required": ["steps"],
    },
    annotations=ToolAnnotations(idempotentHint=True),
)
async def emit_graph_batch(args: dict[str, Any]) -> dict[str, Any]:
    steps = args.get("steps") or []
    if not isinstance(steps, list):
        steps = []
    normalized_steps: list[dict[str, Any]] = []
    for item in steps[:12]:
        if not isinstance(item, dict):
            continue
        command = str(item.get("command") or "").strip()
        if not command:
            continue
        normalized_steps.append(
            {
                "command": command,
                "target": str(item.get("target") or ""),
                "params": item.get("params") if isinstance(item.get("params"), dict) else {},
            }
        )

    payload = {
        "graph_batch": True,
        "batch_id": str(args.get("batch_id") or ""),
        "mode": str(args.get("mode") or "best_effort"),
        "steps": normalized_steps,
    }
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(payload, ensure_ascii=False),
            }
        ]
    }
