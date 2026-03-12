"""Redis connection for session caching."""

from __future__ import annotations

import redis.asyncio as aioredis

from app.config import settings

_redis: aioredis.Redis | None = None


async def init_redis():
    """Initialize Redis connection."""
    global _redis
    try:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        await _redis.ping()
    except Exception:
        _redis = None


async def close_redis():
    """Close Redis connection."""
    global _redis
    if _redis:
        await _redis.close()
        _redis = None


async def get_redis() -> aioredis.Redis | None:
    """Get the Redis client."""
    return _redis
