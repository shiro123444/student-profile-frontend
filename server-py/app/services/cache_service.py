"""Redis-backed cache service for embeddings and search results."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from app.config import settings
from app.db.redis import get_redis

logger = logging.getLogger(__name__)


class CacheService:
    """High-level cache helpers with hit/miss stats."""

    EMBEDDING_PREFIX = "cache:embedding"
    RAG_QUERY_PREFIX = "cache:rag_query"
    NOTE_SEARCH_PREFIX = "cache:note_search"
    UNIFIED_SEARCH_PREFIX = "cache:unified_search"
    AI_SUMMARY_PREFIX = "cache:ai_summary"
    STATS_PREFIX = "cache:stats"

    def _enabled(self) -> bool:
        return bool(settings.cache_enabled)

    @staticmethod
    def _build_key(prefix: str, payload: dict[str, Any]) -> str:
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        return f"{prefix}:{digest}"

    async def _record(self, scope: str, hit: bool) -> None:
        if not self._enabled():
            return

        redis = await get_redis()
        if not redis:
            return

        result = "hit" if hit else "miss"
        try:
            await redis.incr(f"{self.STATS_PREFIX}:{scope}:{result}")
        except Exception:
            logger.debug("cache stats incr failed", exc_info=True)

    async def _get_json(self, key: str) -> Any | None:
        if not self._enabled():
            return None

        redis = await get_redis()
        if not redis:
            return None

        try:
            raw = await redis.get(key)
            if raw is None:
                return None
            return json.loads(raw)
        except Exception:
            logger.debug("cache get failed", exc_info=True)
            return None

    async def _set_json(self, key: str, value: Any, ttl_sec: int) -> None:
        if not self._enabled():
            return

        redis = await get_redis()
        if not redis:
            return

        try:
            ttl = max(1, int(ttl_sec))
            await redis.setex(key, ttl, json.dumps(value, ensure_ascii=False))
        except Exception:
            logger.debug("cache set failed", exc_info=True)

    async def _get_scoped(
        self,
        *,
        prefix: str,
        payload: dict[str, Any],
        scope: str,
        enabled: bool,
    ) -> Any | None:
        if not (self._enabled() and enabled):
            return None

        key = self._build_key(prefix, payload)
        cached = await self._get_json(key)
        hit = cached is not None
        await self._record(scope, hit)
        return cached

    async def _set_scoped(
        self,
        *,
        prefix: str,
        payload: dict[str, Any],
        value: Any,
        ttl_sec: int,
        enabled: bool,
    ) -> None:
        if not (self._enabled() and enabled):
            return

        key = self._build_key(prefix, payload)
        await self._set_json(key, value, ttl_sec)

    async def get_embedding(
        self,
        *,
        model: str,
        input_type: str,
        text: str,
    ) -> list[float] | None:
        cached = await self._get_scoped(
            prefix=self.EMBEDDING_PREFIX,
            payload={"model": model, "input_type": input_type, "text": text},
            scope="embedding",
            enabled=settings.embedding_cache_enabled,
        )
        return cached if isinstance(cached, list) else None

    async def set_embedding(
        self,
        *,
        model: str,
        input_type: str,
        text: str,
        embedding: list[float],
    ) -> None:
        await self._set_scoped(
            prefix=self.EMBEDDING_PREFIX,
            payload={"model": model, "input_type": input_type, "text": text},
            value=embedding,
            ttl_sec=settings.embedding_cache_ttl_sec,
            enabled=settings.embedding_cache_enabled,
        )

    async def get_rag_query(
        self,
        *,
        query: str,
        course_id: str | None,
        limit: int,
        query_model: str | None = None,
        rerank_model: str | None = None,
    ) -> list[dict[str, Any]] | None:
        cached = await self._get_scoped(
            prefix=self.RAG_QUERY_PREFIX,
            payload={
                "query": query,
                "course_id": course_id,
                "limit": limit,
                "query_model": query_model,
                "rerank_model": rerank_model,
            },
            scope="rag_query",
            enabled=settings.rag_query_cache_enabled,
        )
        return cached if isinstance(cached, list) else None

    async def set_rag_query(
        self,
        *,
        query: str,
        course_id: str | None,
        limit: int,
        results: list[dict[str, Any]],
        query_model: str | None = None,
        rerank_model: str | None = None,
    ) -> None:
        await self._set_scoped(
            prefix=self.RAG_QUERY_PREFIX,
            payload={
                "query": query,
                "course_id": course_id,
                "limit": limit,
                "query_model": query_model,
                "rerank_model": rerank_model,
            },
            value=results,
            ttl_sec=settings.rag_query_cache_ttl_sec,
            enabled=settings.rag_query_cache_enabled,
        )

    async def get_note_search(
        self,
        *,
        query: str,
        student_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]] | None:
        cached = await self._get_scoped(
            prefix=self.NOTE_SEARCH_PREFIX,
            payload={"query": query, "student_id": student_id, "limit": limit},
            scope="note_search",
            enabled=settings.note_search_cache_enabled,
        )
        return cached if isinstance(cached, list) else None

    async def set_note_search(
        self,
        *,
        query: str,
        student_id: str | None,
        limit: int,
        results: list[dict[str, Any]],
    ) -> None:
        await self._set_scoped(
            prefix=self.NOTE_SEARCH_PREFIX,
            payload={"query": query, "student_id": student_id, "limit": limit},
            value=results,
            ttl_sec=settings.note_search_cache_ttl_sec,
            enabled=settings.note_search_cache_enabled,
        )

    async def get_unified_search(
        self,
        *,
        query: str,
        student_id: str,
        course_id: str | None,
        variant: str,
    ) -> dict[str, Any] | None:
        cached = await self._get_scoped(
            prefix=self.UNIFIED_SEARCH_PREFIX,
            payload={
                "query": query,
                "student_id": student_id,
                "course_id": course_id,
                "variant": variant,
            },
            scope="unified_search",
            enabled=settings.unified_search_cache_enabled,
        )
        return cached if isinstance(cached, dict) else None

    async def set_unified_search(
        self,
        *,
        query: str,
        student_id: str,
        course_id: str | None,
        variant: str,
        result: dict[str, Any],
    ) -> None:
        await self._set_scoped(
            prefix=self.UNIFIED_SEARCH_PREFIX,
            payload={
                "query": query,
                "student_id": student_id,
                "course_id": course_id,
                "variant": variant,
            },
            value=result,
            ttl_sec=settings.unified_search_cache_ttl_sec,
            enabled=settings.unified_search_cache_enabled,
        )

    async def get_ai_summary(
        self,
        *,
        scope: str,
        target: str,
        student_id: str | None,
    ) -> str | None:
        cached = await self._get_scoped(
            prefix=self.AI_SUMMARY_PREFIX,
            payload={
                "scope": scope,
                "target": target.strip().lower(),
                "student_id": student_id,
            },
            scope="ai_summary",
            enabled=True,
        )
        return cached if isinstance(cached, str) and cached.strip() else None

    async def set_ai_summary(
        self,
        *,
        scope: str,
        target: str,
        student_id: str | None,
        summary: str,
    ) -> None:
        cleaned = (summary or "").strip()
        if not cleaned:
            return
        await self._set_scoped(
            prefix=self.AI_SUMMARY_PREFIX,
            payload={
                "scope": scope,
                "target": target.strip().lower(),
                "student_id": student_id,
            },
            value=cleaned,
            ttl_sec=max(120, settings.rag_query_cache_ttl_sec),
            enabled=True,
        )

    async def get_stats(self) -> dict[str, Any]:
        redis = await get_redis()
        if not redis:
            return {
                "enabled": self._enabled(),
                "backend": "redis",
                "available": False,
            }

        scopes = ["embedding", "rag_query", "note_search", "unified_search"]
        keys: dict[str, str] = {}
        for scope in scopes:
            keys[f"{scope}_hit"] = f"{self.STATS_PREFIX}:{scope}:hit"
            keys[f"{scope}_miss"] = f"{self.STATS_PREFIX}:{scope}:miss"

        values: dict[str, int] = {}
        try:
            raw_vals = await redis.mget(*keys.values())
            for (name, _), raw in zip(keys.items(), raw_vals):
                values[name] = int(raw) if raw is not None else 0
        except Exception:
            logger.debug("cache stats read failed", exc_info=True)
            values = {name: 0 for name in keys}

        def ratio(hit: int, miss: int) -> float:
            total = hit + miss
            return float(hit / total) if total > 0 else 0.0

        def build_scope(scope: str, ttl_sec: int) -> dict[str, Any]:
            hit = values[f"{scope}_hit"]
            miss = values[f"{scope}_miss"]
            return {
                "hit": hit,
                "miss": miss,
                "hit_ratio": round(ratio(hit, miss), 4),
                "ttl_sec": ttl_sec,
            }

        return {
            "enabled": self._enabled(),
            "backend": "redis",
            "available": True,
            "embedding": build_scope("embedding", settings.embedding_cache_ttl_sec),
            "rag_query": build_scope("rag_query", settings.rag_query_cache_ttl_sec),
            "note_search": build_scope("note_search", settings.note_search_cache_ttl_sec),
            "unified_search": build_scope(
                "unified_search",
                settings.unified_search_cache_ttl_sec,
            ),
        }


_cache_service: CacheService | None = None


def get_cache_service() -> CacheService:
    global _cache_service
    if _cache_service is None:
        _cache_service = CacheService()
    return _cache_service
