"""MCP Tools: Knowledge graph queries."""

from __future__ import annotations

import json
from typing import Any

import httpx
from claude_agent_sdk import tool

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
