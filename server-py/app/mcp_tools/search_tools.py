"""MCP Tools: Unified search across documents and notes."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
from claude_agent_sdk import tool

from app.config import settings
from app.services.cache_service import get_cache_service

GO_API = settings.go_backend_url


@tool(
    "unified_search",
    "统一语义搜索：同时搜索教学文档和个人笔记（均基于向量语义搜索），返回按相关度排序的综合结果。",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "搜索查询"},
            "student_id": {"type": "string", "description": "学生 UUID（用于搜索个人笔记）"},
            "course_id": {"type": "string", "description": "课程 ID（可选，过滤文档）"},
        },
        "required": ["query", "student_id"],
    },
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
        variant="mcp",
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
                    "source": "document",
                    "content": r.content,
                    "title": r.document_title,
                    "page_number": r.page_number,
                    "score": round(r.score, 4),
                }
                for r in results
            ]
        except Exception:
            return []

    async def search_notes_semantic():
        try:
            from app.services.note_embedding import NoteEmbeddingService

            svc = NoteEmbeddingService()
            results = await svc.search_notes(query=query, student_id=student_id, limit=5)
            return [
                {
                    "source": "note",
                    "content": r.content,
                    "title": r.title,
                    "note_id": r.note_id,
                    "tags": r.tags,
                    "score": round(r.score, 4),
                }
                for r in results
            ]
        except Exception:
            return []

    async def search_notes_keyword():
        """Keyword fallback — catches notes not yet embedded."""
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
                    "source": "note_keyword",
                    "content": n.get("content", "")[:300],
                    "title": n.get("title", ""),
                    "note_id": n.get("id", ""),
                    "tags": n.get("tags", []),
                    "score": 0.0,
                }
                for n in notes[:3]
            ]
        except Exception:
            return []

    doc_results, note_sem, note_kw = await asyncio.gather(
        search_docs(), search_notes_semantic(), search_notes_keyword()
    )

    # Deduplicate keyword notes already found by semantic search
    sem_note_ids = {r["note_id"] for r in note_sem if r.get("note_id")}
    note_kw_deduped = [r for r in note_kw if r.get("note_id") not in sem_note_ids]

    # Merge all results, sort by score descending
    all_results = doc_results + note_sem + note_kw_deduped
    all_results.sort(key=lambda r: r.get("score", 0), reverse=True)

    result = {
        "query": query,
        "results": all_results[:10],
        "total": len(all_results),
        "sources": {
            "documents": len(doc_results),
            "notes_semantic": len(note_sem),
            "notes_keyword": len(note_kw_deduped),
        },
    }

    await cache.set_unified_search(
        query=query,
        student_id=student_id,
        course_id=course_id,
        variant="mcp",
        result=result,
    )

    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
