"""Database schema migrations for pgvector."""

from __future__ import annotations

import asyncpg


async def ensure_pgvector_schema(pool: asyncpg.Pool) -> None:
    """Create pgvector extension and document_chunks table idempotently."""
    async with pool.acquire() as conn:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS document_chunks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                document_id UUID NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding vector(1024),
                page_number INTEGER,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_dc_doc ON document_chunks(document_id)"
        )
        try:
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_dc_embed "
                "ON document_chunks USING hnsw (embedding vector_cosine_ops)"
            )
        except asyncpg.UndefinedObjectError:
            pass

        # Phase H.2: vision extraction metadata columns
        for stmt in (
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chunk_type TEXT DEFAULT 'text'",
            "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS heading TEXT",
        ):
            await conn.execute(stmt)

        # Phase H.3: code semantic search table (nv-embedcode-7b, 4096 dims)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS code_chunks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                experiment_id UUID NOT NULL,
                student_id UUID,
                language TEXT NOT NULL DEFAULT 'python',
                content TEXT NOT NULL,
                embedding vector(4096),
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cc_exp ON code_chunks(experiment_id)"
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cc_student ON code_chunks(student_id)"
        )
        try:
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_cc_embed "
                "ON code_chunks USING hnsw (embedding vector_cosine_ops)"
            )
        except (asyncpg.UndefinedObjectError, asyncpg.ProgramLimitExceededError):
            # pgvector < 0.9 limits HNSW to 2000 dims; fall back to IVFFlat
            try:
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_cc_embed "
                    "ON code_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
                )
            except Exception:
                pass

        # Phase I: note semantic search table (nv-embedqa-e5-v5, 1024 dims)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS note_chunks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                note_id UUID NOT NULL,
                student_id UUID NOT NULL,
                chunk_index INTEGER NOT NULL DEFAULT 0,
                content TEXT NOT NULL,
                embedding vector(1024),
                title TEXT,
                tags TEXT[],
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_nc_note ON note_chunks(note_id)"
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_nc_student ON note_chunks(student_id)"
        )
        try:
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_nc_embed "
                "ON note_chunks USING hnsw (embedding vector_cosine_ops)"
            )
        except asyncpg.UndefinedObjectError:
            pass
