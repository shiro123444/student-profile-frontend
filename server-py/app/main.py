"""PathMind Agent Service - FastAPI entry point."""

import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.config import settings

logger = logging.getLogger("pathmind")


async def detect_models():
    """Query API /v1/models and update model config."""
    base = settings.anthropic_base_url.rstrip("/")
    if base.endswith("/v1/messages"):
        base = base[: -len("/messages")]
    if base.endswith("/v1"):
        url = f"{base}/models"
    else:
        url = f"{base}/v1/models"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                url, headers={"Authorization": f"Bearer {settings.anthropic_api_key}"}
            )
            resp.raise_for_status()
            data = resp.json()

        available = {m["id"] for m in data.get("data", [])}
        if not available:
            logger.warning("Model detection: no models returned from %s", url)
            return

        logger.info("Available models (%d): %s", len(available), ", ".join(sorted(available)))

        def pick_latest(keyword: str) -> str | None:
            candidates = [
                m for m in available if keyword in m and "thinking" not in m and "agentic" not in m
            ]
            return sorted(candidates)[-1] if candidates else None

        # Respect explicit configuration whenever the configured id is available.
        # Only auto-pick when configured model is missing/unavailable.
        if settings.haiku_model not in available:
            latest_haiku = pick_latest("haiku")
            if latest_haiku:
                settings.haiku_model = latest_haiku

        if settings.default_model not in available:
            latest_sonnet = pick_latest("sonnet")
            if latest_sonnet:
                settings.default_model = latest_sonnet

        if settings.opus_model not in available:
            latest_opus = pick_latest("opus")
            if latest_opus:
                settings.opus_model = latest_opus

        logger.info(
            "Model config: haiku=%s, sonnet=%s, opus=%s",
            settings.haiku_model,
            settings.default_model,
            settings.opus_model,
        )

    except Exception as e:
        logger.warning("Model auto-detection failed (%s), using defaults", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    from app.db.postgres import init_pg_pool
    from app.db.redis import init_redis
    from app.tools.registry import get_registry

    await init_pg_pool()
    await init_redis()
    await detect_models()

    # Warm-up unified tool registry (builtin/custom/external)
    registry = get_registry()
    logger.info(
        "Tool registry warmed: packages=%d tools=%d",
        len(registry.get_packages()),
        len(registry.get_all_tools()),
    )

    # Pre-warm TLS connection to NVIDIA API (avoids 5.7s cold TLS on first request)
    from app.engines.openai_engine import _get_shared_client

    try:
        client = _get_shared_client()
        warmup = await client.get(
            f"{settings.openai_base_url.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
        )
        logger.info("NVIDIA API pre-warm: %d", warmup.status_code)
    except Exception as e:
        logger.warning("NVIDIA API pre-warm failed: %s", e)

    yield

    from app.db.postgres import close_pg_pool
    from app.db.redis import close_redis

    # Close shared httpx client
    from app.engines.openai_engine import _shared_client

    if _shared_client and not _shared_client.is_closed:
        await _shared_client.aclose()

    await close_pg_pool()
    await close_redis()


app = FastAPI(
    title="PathMind Agent Service",
    version="0.1.0",
    description="Claude Agent SDK + MCP Tools + RAG Pipeline",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health():
    """Health check."""
    from app.agents.registry import AGENT_REGISTRY
    from app.db.postgres import get_pool
    from app.services.cache_service import get_cache_service
    from app.tools.registry import get_registry

    registry = get_registry()
    cache_stats = await get_cache_service().get_stats()
    pg_pool = await get_pool()

    return {
        "status": "ok",
        "service": "pathmind-agent",
        "agents": list(AGENT_REGISTRY.keys()),
        "tools": {
            "packages": len(registry.get_packages()),
            "total": len(registry.get_all_tools()),
        },
        "models": {
            "haiku": settings.haiku_model,
            "sonnet": settings.default_model,
            "opus": settings.opus_model,
        },
        "rag": {
            "pgvector_ready": pg_pool is not None,
        },
        "cache": cache_stats,
    }


if __name__ == "__main__":
    import uvicorn

    requested_workers = max(1, int(settings.uvicorn_workers))
    workers = 1 if settings.debug else requested_workers

    if settings.debug and requested_workers > 1:
        logger.warning(
            "PATHMIND_UVICORN_WORKERS=%s ignored when PATHMIND_DEBUG=true; forcing workers=1",
            requested_workers,
        )

    uvicorn_kwargs = {
        "app": "app.main:app",
        "host": settings.host,
        "port": settings.port,
        "reload": settings.debug,
        "workers": workers,
        "timeout_keep_alive": max(5, int(settings.uvicorn_timeout_keep_alive_s)),
        "timeout_graceful_shutdown": max(
            5,
            int(settings.uvicorn_timeout_graceful_shutdown_s),
        ),
        "backlog": max(128, int(settings.uvicorn_backlog)),
        "log_level": settings.uvicorn_log_level,
    }

    limit_concurrency = int(settings.uvicorn_limit_concurrency)
    if limit_concurrency > 0:
        uvicorn_kwargs["limit_concurrency"] = limit_concurrency

    uvicorn.run(**uvicorn_kwargs)
