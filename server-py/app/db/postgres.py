"""PostgreSQL connection pool (asyncpg + pgvector)."""

from __future__ import annotations

import logging

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None
logger = logging.getLogger(__name__)


async def init_pg_pool():
    """Initialize the PostgreSQL connection pool and run migrations."""
    global _pool
    try:
        _pool = await asyncpg.create_pool(settings.database_url, min_size=2, max_size=10)
        # Run pgvector schema migration
        from app.db.migrations import ensure_pgvector_schema

        await ensure_pgvector_schema(_pool)
    except Exception:
        # DB may not be available yet; agent service can still run without pgvector
        logger.exception(
            "Failed to initialize PostgreSQL/pgvector pool; RAG vector features are unavailable"
        )
        _pool = None


async def close_pg_pool():
    """Close the PostgreSQL connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_pool() -> asyncpg.Pool | None:
    """Get the connection pool."""
    return _pool
