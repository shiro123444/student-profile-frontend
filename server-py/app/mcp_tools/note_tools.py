"""MCP Tools: Obsidian-style note operations via Go backend API."""

from __future__ import annotations

import json
from typing import Any

import httpx
from claude_agent_sdk import tool

from app.config import settings

GO_API = settings.go_backend_url


@tool(
    "search_notes",
    "搜索学生的个人笔记，支持全文搜索和标签过滤。返回匹配的笔记列表。",
    {
        "type": "object",
        "properties": {
            "student_id": {"type": "string", "description": "学生 UUID"},
            "search": {"type": "string", "description": "搜索关键词"},
            "tags": {"type": "string", "description": "逗号分隔的标签过滤"},
            "folder": {"type": "string", "description": "文件夹路径过滤"},
        },
        "required": ["student_id"],
    },
)
async def search_notes(args: dict[str, Any]) -> dict[str, Any]:
    student_id = args["student_id"]
    params: dict[str, Any] = {}
    if args.get("search"):
        params["search"] = args["search"]
    if args.get("tags"):
        params["tags"] = args["tags"]
    if args.get("folder"):
        params["folder"] = args["folder"]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GO_API}/internal/notes",
                params=params,
                headers={"X-Student-ID": student_id},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"搜索笔记失败: {e}"}], "is_error": True}


@tool(
    "get_note_content",
    "获取指定笔记的完整 Markdown 内容和元数据。",
    {
        "type": "object",
        "properties": {
            "student_id": {"type": "string", "description": "学生 UUID"},
            "note_id": {"type": "string", "description": "笔记 UUID"},
        },
        "required": ["student_id", "note_id"],
    },
)
async def get_note_content(args: dict[str, Any]) -> dict[str, Any]:
    student_id = args["student_id"]
    note_id = args["note_id"]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GO_API}/internal/notes/{note_id}",
                headers={"X-Student-ID": student_id},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取笔记失败: {e}"}], "is_error": True}


@tool(
    "create_note",
    "将对话中的重要信息保存为学生的个人笔记。支持 Markdown 格式和 [[双向链接]]。",
    {
        "type": "object",
        "properties": {
            "student_id": {"type": "string", "description": "学生 UUID"},
            "title": {"type": "string", "description": "笔记标题"},
            "content": {"type": "string", "description": "Markdown 内容"},
            "folder": {"type": "string", "description": "文件夹路径，如 /学习笔记/算法/"},
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "标签列表",
            },
        },
        "required": ["student_id", "title", "content"],
    },
)
async def create_note(args: dict[str, Any]) -> dict[str, Any]:
    student_id = args["student_id"]
    payload = {
        "title": args["title"],
        "content": args["content"],
        "folder": args.get("folder", "/"),
        "tags": args.get("tags", []),
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{GO_API}/internal/notes",
                json=payload,
                headers={"X-Student-ID": student_id},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"创建笔记失败: {e}"}], "is_error": True}


@tool(
    "get_note_graph",
    "获取学生的笔记关系图谱，展示笔记间的 [[双向链接]] 关系。",
    {"student_id": str},
)
async def get_note_graph(args: dict[str, Any]) -> dict[str, Any]:
    student_id = args["student_id"]
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GO_API}/internal/notes/graph",
                headers={"X-Student-ID": student_id},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取笔记图谱失败: {e}"}], "is_error": True}


@tool(
    "semantic_search_notes",
    "语义搜索学生笔记。基于向量相似度查找与查询语义相关的笔记，比关键词搜索更智能。"
    "例如搜索'反向传播'能找到标题为'BP算法学习心得'的笔记。",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "自然语言搜索查询"},
            "student_id": {"type": "string", "description": "学生 UUID"},
            "limit": {"type": "integer", "description": "最大返回数量", "default": 5},
        },
        "required": ["query", "student_id"],
    },
)
async def semantic_search_notes(args: dict[str, Any]) -> dict[str, Any]:
    query = args["query"]
    student_id = args["student_id"]
    limit = args.get("limit", 5)
    try:
        from app.services.note_embedding import NoteEmbeddingService

        svc = NoteEmbeddingService()
        results = await svc.search_notes(query=query, student_id=student_id, limit=limit)
        data = {
            "query": query,
            "results": [
                {
                    "note_id": r.note_id,
                    "title": r.title,
                    "content_preview": r.content,
                    "tags": r.tags,
                    "score": round(r.score, 4),
                }
                for r in results
            ],
            "count": len(results),
        }
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"语义搜索笔记失败: {e}"}], "is_error": True}
