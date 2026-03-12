"""Document search (RAG-powered) tools."""

from __future__ import annotations

import json
from typing import Any

from claude_agent_sdk import ToolAnnotations, tool


@tool(
    "search_documents",
    "使用语义相似度搜索教学材料和文档，返回相关文档片段及页码。",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "自然语言搜索查询"},
            "course_id": {"type": "string", "description": "课程 ID（可选，用于过滤）"},
            "limit": {"type": "integer", "description": "最大返回数量", "default": 5},
        },
        "required": ["query"],
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def search_documents(args: dict[str, Any]) -> dict[str, Any]:
    query = args["query"]
    course_id = args.get("course_id")
    limit = args.get("limit", 5)
    try:
        from app.services.rag_service import RAGService

        service = RAGService()
        results = await service.query(query=query, course_id=course_id, limit=limit)
        result = {
            "query": query,
            "results": [
                {
                    "content": r.content,
                    "document_title": r.document_title,
                    "page_number": r.page_number,
                    "score": r.score,
                }
                for r in results
            ],
            "count": len(results),
        }
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"搜索文档失败: {e}"}], "is_error": True}


@tool(
    "get_document_summary",
    "获取指定文档的摘要，通过 RAG 检索文档前几个片段拼接生成。",
    {"document_id": str},
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def get_document_summary(args: dict[str, Any]) -> dict[str, Any]:
    document_id = args["document_id"]
    try:
        from app.db.postgres import get_pool

        pool = await get_pool()
        if not pool:
            return {"content": [{"type": "text", "text": json.dumps({
                "document_id": document_id,
                "summary": "数据库不可用",
                "status": "db_unavailable",
            }, ensure_ascii=False)}]}

        rows = await pool.fetch(
            """SELECT content FROM document_chunks
               WHERE document_id = $1::uuid
               ORDER BY chunk_index LIMIT 5""",
            document_id,
        )
        if not rows:
            return {"content": [{"type": "text", "text": json.dumps({
                "document_id": document_id,
                "summary": "该文档尚未索引或无内容。",
                "status": "no_chunks",
            }, ensure_ascii=False)}]}

        summary_text = "\n\n".join(row["content"] for row in rows)
        result = {
            "document_id": document_id,
            "summary": summary_text[:2000],
            "chunks_used": len(rows),
            "status": "ok",
        }
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取文档摘要失败: {e}"}], "is_error": True}
