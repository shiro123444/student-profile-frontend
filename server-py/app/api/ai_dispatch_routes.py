"""Task-based AI dispatch routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.registry import AGENT_REGISTRY
from app.services.ai_dispatcher import AIDispatcher
from app.services.ai_dispatch_metrics import get_dispatch_metrics_collector

router = APIRouter()


class AIDispatchStreamRequest(BaseModel):
    """Unified dispatch payload for stream route."""

    task_type: str = Field(default="summary")
    priority: str | None = Field(default=None)
    cache_key: str | None = Field(default=None)
    agent_name: str | None = Field(default=None)
    prompt: str
    student_id: str | None = Field(default=None)
    context: dict[str, Any] | None = Field(default=None)
    role: str = Field(default="student")
    session_id: str | None = Field(default=None)
    context_snapshot: dict[str, Any] | None = Field(default=None)


@router.post("/stream")
async def stream_dispatch(request: AIDispatchStreamRequest):
    """Dispatch one AI request to task-specific runtime and stream SSE events."""
    agent_name = request.agent_name or "note-assistant"
    if agent_name not in AGENT_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown agent: {agent_name}")

    dispatcher = AIDispatcher()

    async def event_generator():
        async for chunk in dispatcher.stream_dispatch(
            agent_name=agent_name,
            prompt=request.prompt,
            student_id=request.student_id,
            role=request.role,
            session_id=request.session_id,
            context=request.context,
            task_type=request.task_type,
            priority=request.priority,
            cache_key=request.cache_key,
            context_snapshot=request.context_snapshot,
        ):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/metrics")
async def get_dispatch_metrics():
    """Return in-memory metrics snapshot for AI dispatch traffic."""
    return await get_dispatch_metrics_collector().snapshot()
