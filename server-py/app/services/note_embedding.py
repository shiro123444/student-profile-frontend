"""Note semantic embedding service using nv-embedqa-e5-v5."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GO_API = settings.go_backend_url


@dataclass
class NoteSearchResult:
    """A single note semantic search result."""

    note_id: str
    student_id: str
    title: str | None
    content: str
    tags: list[str]
    score: float


class NoteEmbeddingService:
    """Embed and search student notes via pgvector + nv-embedqa-e5-v5 (1024d)."""

    MAX_CHUNK_CHARS = 400  # NVIDIA nv-embedqa-e5-v5 has 512 token limit

    async def embed_note(
        self,
        note_id: str,
        student_id: str,
        title: str,
        content: str,
        tags: list[str] | None = None,
    ) -> dict:
        """Embed a single note. Short notes → 1 chunk, long notes → split by paragraphs."""
        from app.db.postgres import get_pool
        from app.rag.embedding import EmbeddingClient

        pool = await get_pool()
        if not pool:
            return {"note_id": note_id, "chunks_created": 0, "status": "db_unavailable"}

        if not (settings.nvidia_api_key or settings.openai_api_key):
            return {"note_id": note_id, "chunks_created": 0, "status": "no_api_key"}

        # Chunk the note
        chunks = self._chunk_note(title, content)
        if not chunks:
            return {"note_id": note_id, "chunks_created": 0, "status": "empty_content"}

        # Embed
        embedder = EmbeddingClient()
        embeddings = await embedder.embed_texts(chunks)

        tags_list = tags or []

        # Replace old embeddings → insert new
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM note_chunks WHERE note_id = $1::uuid", note_id)
            await conn.executemany(
                """INSERT INTO note_chunks
                   (note_id, student_id, chunk_index, content, embedding, title, tags, metadata)
                   VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, '{}'::jsonb)""",
                [
                    (note_id, student_id, i, chunk, json.dumps(emb), title, tags_list)
                    for i, (chunk, emb) in enumerate(zip(chunks, embeddings))
                ],
            )

        logger.info("Embedded note %s: %d chunks", note_id, len(chunks))
        return {"note_id": note_id, "chunks_created": len(chunks), "status": "ok"}

    async def delete_note_embedding(self, note_id: str) -> dict:
        """Delete embeddings for a note."""
        from app.db.postgres import get_pool

        pool = await get_pool()
        if not pool:
            return {"note_id": note_id, "status": "db_unavailable"}

        async with pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM note_chunks WHERE note_id = $1::uuid", note_id
            )

        deleted = int(result.split()[-1]) if result else 0
        logger.info("Deleted %d chunks for note %s", deleted, note_id)
        return {"note_id": note_id, "deleted": deleted, "status": "ok"}

    async def reindex_student_notes(self, student_id: str) -> dict:
        """Reindex all notes for a student by fetching from Go backend."""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{GO_API}/notes",
                    headers={"X-Student-ID": student_id},
                    timeout=30,
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            logger.error("Failed to fetch notes for student %s: %s", student_id, e)
            return {"student_id": student_id, "indexed": 0, "status": f"fetch_error: {e}"}

        notes = data.get("notes", [])
        if not notes:
            return {"student_id": student_id, "indexed": 0, "status": "no_notes"}

        indexed = 0
        for note in notes:
            try:
                result = await self.embed_note(
                    note_id=note["id"],
                    student_id=student_id,
                    title=note.get("title", ""),
                    content=note.get("content", ""),
                    tags=note.get("tags", []),
                )
                if result["status"] == "ok":
                    indexed += 1
            except Exception:
                logger.exception("Failed to embed note %s", note.get("id"))

        logger.info("Reindexed %d/%d notes for student %s", indexed, len(notes), student_id)
        return {"student_id": student_id, "indexed": indexed, "total": len(notes), "status": "ok"}

    async def search_notes(
        self,
        query: str,
        student_id: str | None = None,
        limit: int = 5,
    ) -> list[NoteSearchResult]:
        """Semantic search over note chunks via pgvector cosine similarity."""
        from app.db.postgres import get_pool
        from app.rag.embedding import EmbeddingClient
        from app.services.cache_service import get_cache_service

        pool = await get_pool()
        if not pool or not (settings.nvidia_api_key or settings.openai_api_key):
            return []

        cache = get_cache_service()
        cached = await cache.get_note_search(query=query, student_id=student_id, limit=limit)
        if cached is not None:
            return [
                NoteSearchResult(
                    note_id=item.get("note_id", ""),
                    student_id=item.get("student_id", ""),
                    title=item.get("title"),
                    content=item.get("content", ""),
                    tags=item.get("tags", []),
                    score=float(item.get("score", 0.0)),
                )
                for item in cached
            ]

        embedder = EmbeddingClient()
        query_embedding = await embedder.embed_query(query)
        embedding_str = json.dumps(query_embedding)

        if student_id:
            rows = await pool.fetch(
                """SELECT DISTINCT ON (note_id)
                          note_id::text, student_id::text, title, content,
                          tags, 1 - (embedding <=> $1::vector) AS score
                   FROM note_chunks
                   WHERE student_id = $2::uuid
                   ORDER BY note_id, embedding <=> $1::vector
                   LIMIT $3""",
                embedding_str,
                student_id,
                limit,
            )
        else:
            rows = await pool.fetch(
                """SELECT DISTINCT ON (note_id)
                          note_id::text, student_id::text, title, content,
                          tags, 1 - (embedding <=> $1::vector) AS score
                   FROM note_chunks
                   ORDER BY note_id, embedding <=> $1::vector
                   LIMIT $2""",
                embedding_str,
                limit,
            )

        # Re-sort by score (DISTINCT ON breaks ORDER BY score)
        results = [
            NoteSearchResult(
                note_id=row["note_id"],
                student_id=row["student_id"],
                title=row["title"],
                content=row["content"][:300],
                tags=row["tags"] or [],
                score=float(row["score"]),
            )
            for row in rows
        ]
        results.sort(key=lambda r: r.score, reverse=True)

        await cache.set_note_search(
            query=query,
            student_id=student_id,
            limit=limit,
            results=[
                {
                    "note_id": item.note_id,
                    "student_id": item.student_id,
                    "title": item.title,
                    "content": item.content,
                    "tags": item.tags,
                    "score": item.score,
                }
                for item in results
            ],
        )

        return results

    def _chunk_note(self, title: str, content: str) -> list[str]:
        """Split note into chunks. Prefix each with title for retrieval context."""
        content = (content or "").strip()
        if not content:
            return []

        prefix = f"# {title}\n" if title else ""

        # Short note → single chunk
        if len(prefix) + len(content) <= self.MAX_CHUNK_CHARS:
            return [prefix + content]

        # Long note → split by paragraphs
        paragraphs = content.split("\n\n")
        chunks: list[str] = []
        current = prefix

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            if len(current) + len(para) + 2 > self.MAX_CHUNK_CHARS and current != prefix:
                chunks.append(current.strip())
                current = prefix
            current += para + "\n\n"

        if current.strip() and current.strip() != prefix.strip():
            chunks.append(current.strip())

        return chunks or [prefix + content[:self.MAX_CHUNK_CHARS]]
