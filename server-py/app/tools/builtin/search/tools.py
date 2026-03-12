"""Unified search tools — cross-document and note search."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
from claude_agent_sdk import ToolAnnotations, tool

from app.config import settings
from app.services.cache_service import get_cache_service

GO_API = settings.go_backend_url


@tool(
    "unified_search",
    "统一搜索：同时搜索教学文档（RAG 语义搜索）和个人笔记（全文搜索），返回综合结果。",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "搜索查询"},
            "student_id": {"type": "string", "description": "学生 UUID（用于搜索个人笔记）"},
            "course_id": {"type": "string", "description": "课程 ID（可选，过滤文档）"},
        },
        "required": ["query", "student_id"],
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def unified_search(args: dict[str, Any]) -> dict[str, Any]:
    query = args["query"]
    student_id = args["student_id"]
    course_id = args.get("course_id")

    cache = get_cache_service()
    cached = await cache.get_unified_search(
        query=query,
        student_id=student_id,
        course_id=course_id,
        variant="builtin",
    )
    if cached is not None:
        return {"content": [{"type": "text", "text": json.dumps(cached, ensure_ascii=False)}]}

    async def search_docs():
        try:
            from app.services.rag_service import RAGService

            service = RAGService()
            results = await service.query(query=query, course_id=course_id, limit=5)
            return [
                {
                    "type": "document",
                    "content": r.content,
                    "title": r.document_title,
                    "page_number": r.page_number,
                    "score": r.score,
                }
                for r in results
            ]
        except Exception:
            return []

    async def search_student_notes():
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{GO_API}/notes",
                    params={"search": query},
                    headers={"X-Student-ID": student_id},
                    timeout=10,
                )
                resp.raise_for_status()
                data = resp.json()
            notes = data.get("notes", [])
            return [
                {
                    "type": "note",
                    "title": n.get("title", ""),
                    "content": n.get("content", "")[:300],
                    "folder": n.get("folder", "/"),
                    "tags": n.get("tags", []),
                    "note_id": n.get("id", ""),
                }
                for n in notes[:5]
            ]
        except Exception:
            return []

    doc_results, note_results = await asyncio.gather(search_docs(), search_student_notes())

    result = {
        "query": query,
        "documents": doc_results,
        "notes": note_results,
        "total_documents": len(doc_results),
        "total_notes": len(note_results),
    }

    await cache.set_unified_search(
        query=query,
        student_id=student_id,
        course_id=course_id,
        variant="builtin",
        result=result,
    )

    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
