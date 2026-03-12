"""MCP Tools: Career search and learning paths."""

from __future__ import annotations

import json
from typing import Any

import httpx
from claude_agent_sdk import tool

from app.config import settings

GO_API = settings.go_backend_url


@tool(
    "search_careers",
    "根据 MBTI 类型搜索匹配的职业，返回职业列表（含薪资、增长前景、所需技能）。",
    {
        "type": "object",
        "properties": {
            "mbti_code": {"type": "string", "description": "4 字母 MBTI 代码，如 INTJ"},
            "limit": {"type": "integer", "description": "最大返回数量", "default": 10},
        },
        "required": ["mbti_code"],
    },
)
async def search_careers(args: dict[str, Any]) -> dict[str, Any]:
    mbti_code = args["mbti_code"]
    limit = args.get("limit", 10)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GO_API}/mbti/types/{mbti_code}/careers", timeout=10)
            resp.raise_for_status()
            careers = resp.json()
            if isinstance(careers, list):
                careers = careers[:limit]
        result = {"careers": careers or [], "mbti_code": mbti_code}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"搜索职业失败: {e}"}], "is_error": True}


@tool(
    "get_learning_path",
    "获取特定职业的结构化学习路径，包括课程、预计时长和先修技能。",
    {"career_id": str},
)
async def get_learning_path(args: dict[str, Any]) -> dict[str, Any]:
    career_id = args["career_id"]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GO_API}/careers/{career_id}/learning-paths", timeout=10)
            resp.raise_for_status()
            data = resp.json()
        result = {"career_id": career_id, "learning_paths": data or []}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取学习路径失败: {e}"}], "is_error": True}
