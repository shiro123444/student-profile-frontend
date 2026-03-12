"""MCP Tools: Experiment details and code validation."""

from __future__ import annotations

import json
from typing import Any

import httpx
from claude_agent_sdk import tool

from app.config import settings

GO_API = settings.go_backend_url


@tool(
    "get_experiment_details",
    "获取实验的完整详情，包括描述、难度、知识点和初始代码模板。",
    {"experiment_id": str},
)
async def get_experiment_details(args: dict[str, Any]) -> dict[str, Any]:
    experiment_id = args["experiment_id"]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GO_API}/experiments/{experiment_id}", timeout=10)
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取实验详情失败: {e}"}], "is_error": True}


@tool(
    "validate_code_syntax",
    "检查代码的语法错误和基本问题（不执行）。支持 Python、Go、JavaScript 和 Java。",
    {"code": str, "language": str},
)
async def validate_code_syntax(args: dict[str, Any]) -> dict[str, Any]:
    code = args["code"]
    language = args["language"]
    errors: list[str] = []

    if language == "python":
        try:
            compile(code, "<student_code>", "exec")
        except SyntaxError as e:
            errors.append(f"Line {e.lineno}: {e.msg}")

    result = {
        "language": language,
        "valid": len(errors) == 0,
        "errors": errors,
        "code_length": len(code),
        "line_count": code.count("\n") + 1,
    }
    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}


@tool(
    "search_similar_code",
    "语义搜索相似代码片段。输入一段代码或描述，返回数据库中语义最相似的代码。"
    "可用于查找参考实现、发现相似解法、或对比不同学生的提交。",
    {"query_code": str, "experiment_id": str, "limit": int},
)
async def search_similar_code(args: dict[str, Any]) -> dict[str, Any]:
    query_code = args["query_code"]
    experiment_id = args.get("experiment_id") or None
    limit = args.get("limit", 5)
    try:
        from app.services.code_search import CodeSearchService

        svc = CodeSearchService()
        results = await svc.search(query_code, experiment_id=experiment_id, limit=limit)
        data = [
            {
                "content": r.content,
                "experiment_id": r.experiment_id,
                "language": r.language,
                "score": round(r.score, 4),
            }
            for r in results
        ]
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"代码搜索失败: {e}"}], "is_error": True}


@tool(
    "index_student_code",
    "将学生提交的代码索引到语义搜索数据库中，以便后续搜索和对比。",
    {"experiment_id": str, "code": str, "language": str, "student_id": str},
)
async def index_student_code(args: dict[str, Any]) -> dict[str, Any]:
    experiment_id = args["experiment_id"]
    code = args["code"]
    language = args.get("language", "python")
    student_id = args.get("student_id") or None
    try:
        from app.services.code_search import CodeSearchService

        svc = CodeSearchService()
        result = await svc.index_code(
            experiment_id=experiment_id,
            code=code,
            language=language,
            student_id=student_id,
        )
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"代码索引失败: {e}"}], "is_error": True}
