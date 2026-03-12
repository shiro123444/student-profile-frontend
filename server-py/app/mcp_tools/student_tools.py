"""MCP Tools: Student data access via Go backend API."""

from __future__ import annotations

import json
from typing import Any

import httpx
from claude_agent_sdk import tool

from app.config import settings

GO_API = settings.go_backend_url


@tool(
    "get_student_profile",
    "获取学生的综合画像，包括 MBTI 类型、实验完成率、知识掌握度、学习活跃度和等级排名。",
    {"student_id": str},
)
async def get_student_profile(args: dict[str, Any]) -> dict[str, Any]:
    student_id = args["student_id"]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GO_API}/internal/students/{student_id}/profile", timeout=10)
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取学生画像失败: {e}"}], "is_error": True}


@tool(
    "get_learning_history",
    "获取学生近期的学习活动记录，包括实验完成数、课程浏览量、学习时长和知识点练习情况。",
    {
        "type": "object",
        "properties": {
            "student_id": {"type": "string", "description": "学生 UUID"},
            "days": {"type": "integer", "description": "回溯天数", "default": 30},
        },
        "required": ["student_id"],
    },
)
async def get_learning_history(args: dict[str, Any]) -> dict[str, Any]:
    student_id = args["student_id"]
    days = args.get("days", 30)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GO_API}/internal/students/{student_id}/learning-trend",
                params={"days": days},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取学习记录失败: {e}"}], "is_error": True}


@tool(
    "get_class_overview",
    "获取班级统计数据，包括平均完成率、掌握度、活跃度指标，以及需要关注的学生预警。",
    {"class_id": str},
)
async def get_class_overview(args: dict[str, Any]) -> dict[str, Any]:
    class_id = args["class_id"]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GO_API}/internal/classes/{class_id}/overview", timeout=10)
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取班级概览失败: {e}"}], "is_error": True}
