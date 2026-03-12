"""MCP Tools: Points and credits."""

from __future__ import annotations

import json
from typing import Any

import httpx
from claude_agent_sdk import tool

from app.config import settings

GO_API = settings.go_backend_url


@tool(
    "get_point_balance",
    "获取学生当前的积分余额和 AI 使用额度。",
    {"student_id": str},
)
async def get_point_balance(args: dict[str, Any]) -> dict[str, Any]:
    student_id = args["student_id"]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GO_API}/points/balance",
                headers={"X-Student-ID": student_id},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取积分余额失败: {e}"}], "is_error": True}


@tool(
    "check_ai_credits",
    "检查学生是否有足够的 AI 额度进行指定操作，返回剩余额度和预估费用。",
    {
        "type": "object",
        "properties": {
            "student_id": {"type": "string", "description": "学生 UUID"},
            "operation": {
                "type": "string",
                "description": "操作类型: query, stream, analyze, code_review",
                "default": "query",
            },
        },
        "required": ["student_id"],
    },
)
async def check_ai_credits(args: dict[str, Any]) -> dict[str, Any]:
    student_id = args["student_id"]
    operation = args.get("operation", "query")

    cost_estimates = {
        "query": 0.002,
        "stream": 0.005,
        "analyze": 0.01,
        "code_review": 0.008,
    }
    estimated_cost = cost_estimates.get(operation, 0.005)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GO_API}/points/balance",
                headers={"X-Student-ID": student_id},
                timeout=10,
            )
            resp.raise_for_status()
            balance_data = resp.json()
            credits = balance_data.get("credits", 0)
    except Exception:
        credits = 0

    result = {
        "student_id": student_id,
        "operation": operation,
        "estimated_cost": estimated_cost,
        "current_credits": credits,
        "sufficient": credits >= estimated_cost,
    }
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
