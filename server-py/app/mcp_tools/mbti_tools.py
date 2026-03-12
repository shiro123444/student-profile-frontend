"""MCP Tools: MBTI data and PsyCOT scoring."""

from __future__ import annotations

import json
from typing import Any

import httpx
from claude_agent_sdk import tool

from app.config import settings

GO_API = settings.go_backend_url


@tool(
    "get_mbti_type_info",
    "获取 MBTI 人格类型的详细信息，包括描述、优势、劣势和推荐职业。",
    {"mbti_code": str},
)
async def get_mbti_type_info(args: dict[str, Any]) -> dict[str, Any]:
    mbti_code = args["mbti_code"]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GO_API}/mbti/types/{mbti_code}", timeout=10)
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取 MBTI 类型信息失败: {e}"}], "is_error": True}


@tool(
    "get_psycot_questions",
    "获取指定 MBTI 维度的 PsyCOT 问卷题目，返回中文题目及选项，用于多轮心理评估。",
    {"dimension": str},
)
async def get_psycot_questions(args: dict[str, Any]) -> dict[str, Any]:
    dimension = args["dimension"]
    try:
        from app.mbti.question_bank import get_questions_for_dimension

        questions = get_questions_for_dimension(dimension)
        result = {"dimension": dimension, "questions": questions, "count": len(questions)}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取 PsyCOT 题目失败: {e}"}], "is_error": True}


@tool(
    "score_mbti_dimension",
    "根据学生的 PsyCOT 问卷答案计算 MBTI 维度的软标签分数 (0.0-1.0)、硬标签和置信度。",
    {
        "type": "object",
        "properties": {
            "dimension": {"type": "string", "description": "MBTI 维度: EI, SN, TF, JP"},
            "answers": {
                "type": "array",
                "description": "答案列表",
                "items": {
                    "type": "object",
                    "properties": {
                        "question_id": {"type": "integer"},
                        "choice": {"type": "string", "description": "选项: A, B, C, 或 D"},
                    },
                    "required": ["question_id", "choice"],
                },
            },
        },
        "required": ["dimension", "answers"],
    },
)
async def score_mbti_dimension(args: dict[str, Any]) -> dict[str, Any]:
    dimension = args["dimension"]
    answers = args["answers"]
    try:
        from app.mbti.dimension_calculator import DimensionCalculator

        calc = DimensionCalculator()
        soft = calc.calculate_soft_label(dimension, answers)
        conf = calc.calculate_confidence(dimension, answers)
        hard = calc.calculate_hard_label(dimension, answers)

        result = {
            "dimension": dimension,
            "soft_label": round(soft, 3),
            "hard_label": hard,
            "confidence": round(conf, 3),
            "answers_counted": len([a for a in answers if a.get("choice") in ("A", "B")]),
            "total_answers": len(answers),
        }
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"MBTI 维度评分失败: {e}"}], "is_error": True}
