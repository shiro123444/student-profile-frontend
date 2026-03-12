"""Code semantic search service using nv-embedcode-7b."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class CodeSearchResult:
    """A single code search result."""

    content: str
    experiment_id: str
    student_id: str | None
    language: str
    score: float


class CodeSearchService:
    """Index and search code snippets via pgvector + nv-embedcode-7b."""

    async def index_code(
        self,
        experiment_id: str,
        code: str,
        language: str = "python",
        student_id: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """Embed and store a code snippet."""
        from app.db.postgres import get_pool
        from app.rag.embedding import EmbeddingClient

        pool = await get_pool()
        if not pool:
            return {"status": "db_unavailable"}

        api_key = settings.nvidia_api_key or settings.openai_api_key
        if not api_key:
            return {"status": "no_api_key"}

        embedder = EmbeddingClient(model=settings.nvidia_code_embed_model)
        embedding = await embedder.embed_query(code)

        meta = json.dumps(metadata or {})
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO code_chunks
                   (experiment_id, student_id, language, content, embedding, metadata)
                   VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)""",
                experiment_id,
                student_id,
                language,
                code,
                json.dumps(embedding),
                meta,
            )

        logger.info("Indexed code for experiment %s", experiment_id)
        return {"status": "indexed", "experiment_id": experiment_id, "language": language}

    async def search(
        self,
        query_code: str,
        experiment_id: str | None = None,
        limit: int = 5,
    ) -> list[CodeSearchResult]:
        """Semantic search over code snippets."""
        from app.db.postgres import get_pool
        from app.rag.embedding import EmbeddingClient

        pool = await get_pool()
        if not pool:
            return []

        api_key = settings.nvidia_api_key or settings.openai_api_key
        if not api_key:
            return []

        embedder = EmbeddingClient(model=settings.nvidia_code_embed_model)
        query_embedding = await embedder.embed_query(query_code)
        embedding_str = json.dumps(query_embedding)

        if experiment_id:
            rows = await pool.fetch(
                """SELECT content, experiment_id::text, student_id::text,
                          language, 1 - (embedding <=> $1::vector) AS score
                   FROM code_chunks
                   WHERE experiment_id = $2::uuid
                   ORDER BY embedding <=> $1::vector
                   LIMIT $3""",
                embedding_str,
                experiment_id,
                limit,
            )
        else:
            rows = await pool.fetch(
                """SELECT content, experiment_id::text, student_id::text,
                          language, 1 - (embedding <=> $1::vector) AS score
                   FROM code_chunks
                   ORDER BY embedding <=> $1::vector
                   LIMIT $2""",
                embedding_str,
                limit,
            )

        return [
            CodeSearchResult(
                content=row["content"],
                experiment_id=row["experiment_id"],
                student_id=row["student_id"],
                language=row["language"],
                score=float(row["score"]),
            )
            for row in rows
        ]
