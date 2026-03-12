"""RAG (Retrieval-Augmented Generation) service."""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class RAGResult:
    """A single RAG search result."""

    content: str
    document_id: str
    document_title: str
    page_number: int | None
    score: float


class RAGService:
    """Document ingestion and semantic search via pgvector + NVIDIA embeddings."""

    async def ingest(
        self,
        document_id: str,
        file_path: str,
        metadata: dict | None = None,
    ) -> dict:
        """Ingest a document: extract → chunk → embed → store in pgvector."""
        from app.db.postgres import get_pool
        from app.rag.embedding import EmbeddingClient

        pool = await get_pool()
        if not pool:
            return {"document_id": document_id, "chunks_created": 0, "status": "db_unavailable"}

        api_key = settings.nvidia_api_key or settings.openai_api_key
        if not api_key:
            return {"document_id": document_id, "chunks_created": 0, "status": "no_nvidia_key"}

        extraction_method = "text"
        chunks_data: list[tuple[str, int, str, str | None]] = []  # (content, page, type, heading)

        if file_path.lower().endswith(".pdf"):
            text_chunks = self._extract_with_text(file_path)
            if settings.rag_prefer_text_extraction and self._is_text_extraction_usable(text_chunks):
                chunks_data, extraction_method = text_chunks, "text"
            else:
                chunks_data, extraction_method = await self._extract_with_vision(file_path)
                if not chunks_data and text_chunks:
                    chunks_data, extraction_method = text_chunks, "text"
        else:
            chunks_data, extraction_method = self._extract_with_text(file_path), "text"

        if not chunks_data:
            return {"document_id": document_id, "chunks_created": 0, "status": "no_chunks"}

        # Embed chunks
        embedder = EmbeddingClient()
        texts = [c[0] for c in chunks_data]
        embeddings = await embedder.embed_texts(texts)

        # Store in pgvector
        meta_dict = metadata or {}
        meta_dict["extraction_method"] = extraction_method
        meta = json.dumps(meta_dict)

        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM document_chunks WHERE document_id = $1::uuid", document_id
            )
            await conn.executemany(
                """INSERT INTO document_chunks
                   (document_id, chunk_index, content, embedding, page_number,
                    metadata, chunk_type, heading)
                   VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8)""",
                [
                    (
                        document_id,
                        i,
                        content,
                        json.dumps(emb),
                        page_num,
                        meta,
                        chunk_type,
                        heading,
                    )
                    for i, ((content, page_num, chunk_type, heading), emb) in enumerate(
                        zip(chunks_data, embeddings)
                    )
                ],
            )

        logger.info(
            "Ingested %d chunks (%s) for document %s",
            len(chunks_data), extraction_method, document_id,
        )
        return {
            "document_id": document_id,
            "chunks_created": len(chunks_data),
            "extraction_method": extraction_method,
            "status": "completed",
        }

    async def _extract_with_vision(
        self, file_path: str
    ) -> tuple[list[tuple[str, int, str, str | None]], str]:
        """Try vision-based extraction. Returns (chunks_data, method)."""
        try:
            from app.rag.smart_chunker import smart_chunk
            from app.rag.vision_extractor import VisionExtractor

            vision_model = (
                settings.nvidia_parse_model
                if settings.rag_use_structured_parser
                else settings.nvidia_vision_model
            )
            extractor = VisionExtractor(model=vision_model)
            elements = await extractor.extract(file_path)
            if not elements:
                return [], "text"

            chunks = smart_chunk(elements)
            if not chunks:
                return [], "text"

            return [
                (c.content, c.page_number, c.chunk_type, c.heading)
                for c in chunks
            ], "vision"
        except Exception:
            logger.exception("Vision extraction failed, falling back to text")
            return [], "text"

    @staticmethod
    def _is_text_extraction_usable(chunks_data: list[tuple[str, int, str, str | None]]) -> bool:
        """Quality gate for pypdf extraction results."""
        if not chunks_data:
            return False
        total_chars = sum(len((content or "").strip()) for content, *_ in chunks_data)
        return total_chars >= max(80, int(settings.rag_text_min_chars))

    @staticmethod
    def _extract_with_text(file_path: str) -> list[tuple[str, int, str, str | None]]:
        """Fallback: pypdf text extraction + fixed chunking."""
        from app.rag.chunker import chunk_pages
        from app.rag.extractor import extract_pdf

        pages = extract_pdf(file_path)
        if not pages:
            return []
        chunks = chunk_pages(pages)
        return [(c.content, c.page_number, "text", None) for c in chunks]

    @staticmethod
    def _cosine_similarity(left: list[float], right: list[float]) -> float:
        if not left or not right:
            return 0.0
        size = min(len(left), len(right))
        dot = sum(left[i] * right[i] for i in range(size))
        left_norm = math.sqrt(sum(left[i] * left[i] for i in range(size)))
        right_norm = math.sqrt(sum(right[i] * right[i] for i in range(size)))
        if left_norm <= 0 or right_norm <= 0:
            return 0.0
        return float(dot / (left_norm * right_norm))

    async def _rerank_rows(
        self,
        *,
        query: str,
        rows: list,
        limit: int,
    ) -> list[dict]:
        """Second-pass rerank on retrieved candidates using a dedicated embedding model."""
        from app.rag.embedding import EmbeddingClient

        if not rows:
            return []

        rerank_model = settings.nvidia_rerank_model
        if not settings.rag_rerank_enabled or not rerank_model:
            return [dict(row) for row in rows[:limit]]

        try:
            reranker = EmbeddingClient(
                model=rerank_model,
                max_chars=settings.rag_rerank_max_chars,
            )
            query_vec = await reranker.embed_query(query)
            docs = [dict(row) for row in rows]
            passages = [str(item.get("content", "")) for item in docs]
            passage_vecs = await reranker.embed_texts(passages)
            scored: list[dict] = []
            for item, passage_vec in zip(docs, passage_vecs):
                item["score"] = self._cosine_similarity(query_vec, passage_vec)
                scored.append(item)
            scored.sort(key=lambda item: float(item.get("score", 0.0)), reverse=True)
            return scored[:limit]
        except Exception:
            logger.exception("RAG rerank failed; using retrieval order")
            return [dict(row) for row in rows[:limit]]

    @staticmethod
    def _keyword_fragments(query: str) -> list[str]:
        raw = (query or "").strip()
        if not raw:
            return []

        fragments: list[str] = []
        fragments.append(raw)

        compact = " ".join(raw.split())
        if compact and compact not in fragments:
            fragments.append(compact)

        if len(raw) >= 12:
            fragments.append(raw[:12])
        if len(raw) >= 6:
            fragments.append(raw[:6])

        # 去重并限制数量，避免 SQL 参数过大
        unique: list[str] = []
        for item in fragments:
            text = item.strip()
            if not text:
                continue
            if text not in unique:
                unique.append(text)
            if len(unique) >= 4:
                break
        return unique

    async def _keyword_fallback_query(
        self,
        *,
        pool: Any,
        query: str,
        course_id: str | None,
        limit: int,
        uploaded_by: str | None,
    ) -> list[RAGResult]:
        patterns = [f"%{frag}%" for frag in self._keyword_fragments(query)]
        if not patterns:
            return []

        if course_id and uploaded_by:
            rows = await pool.fetch(
                """SELECT dc.content, dc.document_id::text, dc.page_number,
                          CASE WHEN COALESCE(d.title, '') ILIKE ANY($1::text[]) THEN 0.72 ELSE 0.58 END AS score,
                          COALESCE(d.title, '') AS document_title
                   FROM document_chunks dc
                   JOIN documents d ON d.id = dc.document_id
                   WHERE d.is_active = true
                     AND d.course_id::text = $2
                     AND d.uploaded_by::text = $3
                     AND (dc.content ILIKE ANY($1::text[]) OR COALESCE(d.title, '') ILIKE ANY($1::text[]))
                   ORDER BY score DESC, dc.chunk_index ASC
                   LIMIT $4""",
                patterns,
                course_id,
                uploaded_by,
                limit,
            )
        elif course_id:
            rows = await pool.fetch(
                """SELECT dc.content, dc.document_id::text, dc.page_number,
                          CASE WHEN COALESCE(d.title, '') ILIKE ANY($1::text[]) THEN 0.72 ELSE 0.58 END AS score,
                          COALESCE(d.title, '') AS document_title
                   FROM document_chunks dc
                   JOIN documents d ON d.id = dc.document_id
                   WHERE d.is_active = true
                     AND d.course_id::text = $2
                     AND (dc.content ILIKE ANY($1::text[]) OR COALESCE(d.title, '') ILIKE ANY($1::text[]))
                   ORDER BY score DESC, dc.chunk_index ASC
                   LIMIT $3""",
                patterns,
                course_id,
                limit,
            )
        elif uploaded_by:
            rows = await pool.fetch(
                """SELECT dc.content, dc.document_id::text, dc.page_number,
                          CASE WHEN COALESCE(d.title, '') ILIKE ANY($1::text[]) THEN 0.72 ELSE 0.58 END AS score,
                          COALESCE(d.title, '') AS document_title
                   FROM document_chunks dc
                   JOIN documents d ON d.id = dc.document_id
                   WHERE d.is_active = true
                     AND d.uploaded_by::text = $2
                     AND (dc.content ILIKE ANY($1::text[]) OR COALESCE(d.title, '') ILIKE ANY($1::text[]))
                   ORDER BY score DESC, dc.chunk_index ASC
                   LIMIT $3""",
                patterns,
                uploaded_by,
                limit,
            )
        else:
            rows = await pool.fetch(
                """SELECT dc.content, dc.document_id::text, dc.page_number,
                          CASE WHEN COALESCE(d.title, '') ILIKE ANY($1::text[]) THEN 0.72 ELSE 0.58 END AS score,
                          COALESCE(d.title, '') AS document_title
                   FROM document_chunks dc
                   LEFT JOIN documents d ON d.id = dc.document_id
                   WHERE d.is_active = true
                     AND (dc.content ILIKE ANY($1::text[]) OR COALESCE(d.title, '') ILIKE ANY($1::text[]))
                   ORDER BY score DESC, dc.chunk_index ASC
                   LIMIT $2""",
                patterns,
                limit,
            )

        return [
            RAGResult(
                content=row["content"],
                document_id=row["document_id"],
                document_title=row["document_title"],
                page_number=row["page_number"],
                score=float(row["score"]),
            )
            for row in rows
        ]

    async def query(
        self,
        query: str,
        course_id: str | None = None,
        limit: int = 5,
        uploaded_by: str | None = None,
    ) -> list[RAGResult]:
        """Semantic search over document chunks via pgvector cosine similarity."""
        from app.db.postgres import get_pool
        from app.rag.embedding import EmbeddingClient
        from app.services.cache_service import get_cache_service

        pool = await get_pool()
        if not pool:
            return []

        has_embed_key = bool(settings.nvidia_api_key or settings.openai_api_key)
        if not has_embed_key:
            logger.warning("RAG query fallback to keyword search: embedding API key not configured")
            return await self._keyword_fallback_query(
                pool=pool,
                query=query,
                course_id=course_id,
                limit=limit,
                uploaded_by=uploaded_by,
            )

        use_cache = uploaded_by is None
        cache = get_cache_service()
        query_model = settings.nvidia_embed_model
        rerank_model = settings.nvidia_rerank_model if settings.rag_rerank_enabled else None
        if use_cache:
            cached = await cache.get_rag_query(
                query=query,
                course_id=course_id,
                limit=limit,
                query_model=query_model,
                rerank_model=rerank_model,
            )
            if cached is not None:
                return [
                    RAGResult(
                        content=item.get("content", ""),
                        document_id=item.get("document_id", ""),
                        document_title=item.get("document_title", ""),
                        page_number=item.get("page_number"),
                        score=float(item.get("score", 0.0)),
                    )
                    for item in cached
                ]

        try:
            embedder = EmbeddingClient()
            query_embedding = await embedder.embed_query(query)
        except Exception:
            logger.exception("RAG embedding query failed; fallback to keyword search")
            return await self._keyword_fallback_query(
                pool=pool,
                query=query,
                course_id=course_id,
                limit=limit,
                uploaded_by=uploaded_by,
            )
        embedding_str = json.dumps(query_embedding)

        candidate_limit = limit
        if settings.rag_rerank_enabled:
            candidate_limit = max(
                limit,
                min(int(settings.rag_rerank_max_candidates), max(limit * 4, limit)),
            )

        if course_id and uploaded_by:
            rows = await pool.fetch(
                """SELECT dc.content, dc.document_id::text, dc.page_number,
                          1 - (dc.embedding <=> $1::vector) AS score,
                          d.title AS document_title
                   FROM document_chunks dc
                   JOIN documents d ON d.id = dc.document_id
                   WHERE d.course_id::text = $2
                     AND d.uploaded_by::text = $3
                     AND d.is_active = true
                   ORDER BY dc.embedding <=> $1::vector
                   LIMIT $4""",
                embedding_str,
                course_id,
                uploaded_by,
                candidate_limit,
            )
        elif course_id:
            rows = await pool.fetch(
                """SELECT dc.content, dc.document_id::text, dc.page_number,
                          1 - (dc.embedding <=> $1::vector) AS score,
                          d.title AS document_title
                   FROM document_chunks dc
                   JOIN documents d ON d.id = dc.document_id
                   WHERE d.course_id::text = $2 AND d.is_active = true
                   ORDER BY dc.embedding <=> $1::vector
                   LIMIT $3""",
                embedding_str,
                course_id,
                candidate_limit,
            )
        elif uploaded_by:
            rows = await pool.fetch(
                """SELECT dc.content, dc.document_id::text, dc.page_number,
                          1 - (dc.embedding <=> $1::vector) AS score,
                          COALESCE(d.title, '') AS document_title
                   FROM document_chunks dc
                   JOIN documents d ON d.id = dc.document_id
                   WHERE d.uploaded_by::text = $2 AND d.is_active = true
                   ORDER BY dc.embedding <=> $1::vector
                   LIMIT $3""",
                embedding_str,
                uploaded_by,
                candidate_limit,
            )
        else:
            rows = await pool.fetch(
                """SELECT dc.content, dc.document_id::text, dc.page_number,
                          1 - (dc.embedding <=> $1::vector) AS score,
                          COALESCE(d.title, '') AS document_title
                   FROM document_chunks dc
                   LEFT JOIN documents d ON d.id = dc.document_id
                   ORDER BY dc.embedding <=> $1::vector
                   LIMIT $2""",
                embedding_str,
                candidate_limit,
            )

        if not rows:
            fallback_results = await self._keyword_fallback_query(
                pool=pool,
                query=query,
                course_id=course_id,
                limit=limit,
                uploaded_by=uploaded_by,
            )
            if fallback_results:
                return fallback_results

        reranked_rows = await self._rerank_rows(query=query, rows=list(rows), limit=limit)

        results = [
            RAGResult(
                content=row["content"],
                document_id=row["document_id"],
                document_title=row["document_title"],
                page_number=row["page_number"],
                score=float(row["score"]),
            )
            for row in reranked_rows
        ]

        if use_cache:
            await cache.set_rag_query(
                query=query,
                course_id=course_id,
                limit=limit,
                query_model=query_model,
                rerank_model=rerank_model,
                results=[
                    {
                        "content": item.content,
                        "document_id": item.document_id,
                        "document_title": item.document_title,
                        "page_number": item.page_number,
                        "score": item.score,
                    }
                    for item in results
                ],
            )

        return results
