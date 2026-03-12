"""Agent query routes - called by Go backend."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agents.registry import AGENT_REGISTRY, AgentDef
from app.services import AgentService
from app.services.approval_broker import get_approval_broker
from app.services.audit_client import log_tool_action
from app.services.coding_policy_profiles import get_coding_policy_profile_manager
from app.services.task_templates import (
    create_task_run_id,
    get_task_template,
    list_task_templates,
    now_ts,
)
from app.services.shared_memory import (
    append_graph_batch_feedback,
    append_graph_feedback,
    list_graph_batch_feedback,
    list_graph_feedback,
)

router = APIRouter()

_RUNTIME_MODES = ["fast", "balanced", "deep"]


class AgentQueryRequest(BaseModel):
    """Request to query an agent.

    Runtime routing may be passed via context._runtime, e.g.:
    {
      "_runtime": {
        "mode": "fast",
        "engine": "openai",
        "engine_model": "gpt-4o-mini",
        "model_tier": "sonnet",
        "output_format": "advisor_card_v1",
        "coding": {
          "enabled": true,
          "workspace_id": "pathmind-main",
          "approval_mode": "per_call",
          "allow_network": false
        },
        "orchestrator": {
          "enabled": true,
          "profile": "webagent_v1",
          "planner_mode": "fast",
          "executor_mode": "balanced",
          "max_steps": 5,
          "max_workers": 3,
          "worker_timeout_s": 90,
          "worker_max_retries": 1,
          "worker_retry_backoff_ms": 600,
          "max_budget_usd": 1.0
        }
      },
      "_tenant": {
        "tenant_id": "school-a",
        "user_id": "teacher-001",
        "workspace_id": "default"
      }
    }

    `output_format` also supports direct schema objects:
    {
      "type": "json_schema",
      "schema": { ... }
    }
    """

    agent_name: str | None = None
    prompt: str
    student_id: str | None = None
    context: dict | None = None
    role: str = "student"
    session_id: str | None = None


class AgentQueryResponse(BaseModel):
    """Response from an agent query."""

    response: str
    structured_output: Any | None = None
    agent_used: str
    engine_used: str | None = None
    model_used: str | None = None
    mode_used: str | None = None
    output_format_used: str | None = None
    orchestrator: Any | None = None
    tenant: Any | None = None
    cost_usd: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0


class AgentSessionItem(BaseModel):
    """Session item for list/restore UI."""

    session_id: str
    agent_name: str | None = None
    engine: str | None = None
    model: str | None = None
    mode: str | None = None
    last_prompt: str | None = None
    last_summary: str | None = None
    total_cost_usd: float | None = None
    total_input_tokens: int | None = None
    total_output_tokens: int | None = None
    updated_at: int | None = None


class ClearSessionsResponse(BaseModel):
    """Response for session clear operation."""

    ok: bool
    cleared: int
    session_id: str | None = None


class AgentCatalogItem(BaseModel):
    """Lightweight catalog item for agent selection UI."""

    name: str
    description: str
    model: str
    engine: str
    engine_model: str | None = None
    tool_count: int


class AgentCapabilitiesResponse(BaseModel):
    """Detailed per-agent capabilities for routing/UI decisions."""

    name: str
    description: str
    model: str
    engine: str
    engine_model: str | None = None
    tool_count: int
    tools: list[str]
    runtime_modes: list[str]
    supports_orchestrator: bool
    supports_streaming: bool


class ApprovalDecisionRequest(BaseModel):
    """Approval decision request payload."""

    reason: str | None = None


class ApprovalDecisionResponse(BaseModel):
    """Approval decision response payload."""

    ok: bool
    request_id: str
    approved: bool
    reason: str | None = None


class ApprovalMetricsResponse(BaseModel):
    """Aggregated approval metrics snapshot."""

    pending: int
    total_requests: int
    approved: int
    rejected: int
    timed_out: int
    avg_wait_ms: float


class TaskTemplateStep(BaseModel):
    """One step in a task template contract."""

    id: str
    label: str
    module: str
    action: str | None = None
    risk: str | None = None


class TaskTemplateReceiptSchema(BaseModel):
    """Receipt schema metadata for one task template."""

    version: str | None = None
    fields: list[str] = []


class TaskTemplateItem(BaseModel):
    """Task template contract item."""

    task_type: str
    label: str
    description: str | None = None
    target_agent: str | None = None
    default_prompt: str | None = None
    risk_level: str = "medium"
    tags: list[str] = []
    steps: list[TaskTemplateStep] = []
    receipt_schema: TaskTemplateReceiptSchema | None = None


class TaskTemplateListResponse(BaseModel):
    """Task template catalog response."""

    templates: list[TaskTemplateItem]
    source: str = "builtin"


class TaskTemplateStartRequest(BaseModel):
    """Task template start request payload."""

    task_type: str
    label: str | None = None
    prompt: str | None = None
    student_id: str | None = None
    workspace_id: str | None = None
    metadata: dict[str, Any] | None = None


class TaskTemplateStartResponse(BaseModel):
    """Task template start response payload."""

    ok: bool = True
    run_id: str
    task_type: str
    label: str | None = None
    started_at: int
    source: str = "api"


class GraphCommandFeedbackItem(BaseModel):
    """One graph command execution feedback item from frontend."""

    command: str
    target: str | None = None
    status: str = "ignored"
    success: bool | None = None
    message: str | None = None
    issued_at: int | None = None
    executed_at: int | None = None
    params: dict[str, Any] | None = None


class GraphCommandFeedbackRequest(BaseModel):
    """Batch graph command execution feedback payload."""

    student_id: str | None = None
    agent_name: str | None = "graph-analyst"
    session_id: str | None = None
    source: str | None = "graph_page"
    items: list[GraphCommandFeedbackItem] = []


class GraphCommandFeedbackResponse(BaseModel):
    """Graph feedback ingest response."""

    ok: bool
    accepted: int
    student_id: str | None = None
    agent_name: str | None = None
    session_id: str | None = None


class GraphCommandFeedbackListResponse(BaseModel):
    """Graph feedback query response."""

    ok: bool
    total: int
    student_id: str
    agent_name: str | None = None
    session_id: str | None = None
    status: str | None = None
    command: str | None = None
    items: list[GraphCommandFeedbackItem]


class GraphBatchFeedbackItem(BaseModel):
    """One graph batch execution receipt item from frontend."""

    batch_id: str
    mode: str = "best_effort"
    status: str = "failed"
    completed: int = 0
    total: int = 0
    rolled_back: int | None = None
    rollback_failed: int | None = None
    message: str | None = None
    started_at: int | None = None
    finished_at: int | None = None


class GraphBatchFeedbackRequest(BaseModel):
    """Graph batch execution feedback payload."""

    student_id: str | None = None
    agent_name: str | None = "graph-analyst"
    session_id: str | None = None
    source: str | None = "graph_page"
    item: GraphBatchFeedbackItem


class GraphBatchFeedbackResponse(BaseModel):
    """Graph batch feedback ingest response."""

    ok: bool
    accepted: int
    student_id: str | None = None
    agent_name: str | None = None
    session_id: str | None = None
    batch_id: str | None = None


class GraphBatchFeedbackListResponse(BaseModel):
    """Graph batch feedback query response."""

    ok: bool
    total: int
    student_id: str
    agent_name: str | None = None
    session_id: str | None = None
    status: str | None = None
    source: str | None = None
    next_before_ts: int | None = None
    items: list[GraphBatchFeedbackItem]


def _build_agent_catalog_item(name: str, agent: AgentDef) -> AgentCatalogItem:
    return AgentCatalogItem(
        name=name,
        description=agent.description,
        model=agent.model or "default",
        engine=getattr(agent, "engine", "claude"),
        engine_model=getattr(agent, "engine_model", None),
        tool_count=len(agent.tools),
    )


def _build_agent_capabilities(name: str, agent: AgentDef) -> AgentCapabilitiesResponse:
    return AgentCapabilitiesResponse(
        name=name,
        description=agent.description,
        model=agent.model or "default",
        engine=getattr(agent, "engine", "claude"),
        engine_model=getattr(agent, "engine_model", None),
        tool_count=len(agent.tools),
        tools=list(agent.tools),
        runtime_modes=list(_RUNTIME_MODES),
        supports_orchestrator=True,
        supports_streaming=True,
    )


@router.get("/debug/sse")
async def debug_sse():
    """Minimal SSE health check: 3 text chunks + 1 done event."""

    async def gen():
        for i in range(3):
            yield f'data: {{"type":"text","content":"debug chunk {i}"}}\n\n'
            await asyncio.sleep(0.1)
        yield (
            f'data: {{"type":"done","stop_reason":"end_turn",'
            f'"input_tokens":0,"output_tokens":0}}\n\n'
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/query", response_model=AgentQueryResponse)
async def query_agent(request: AgentQueryRequest):
    """Synchronous one-shot agent query."""
    agent_name = request.agent_name or "quick-qa"
    if agent_name not in AGENT_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown agent: {agent_name}")

    service = AgentService()
    result = await service.query(
        agent_name=agent_name,
        prompt=request.prompt,
        student_id=request.student_id,
        context=request.context,
        role=request.role,
    )
    return result


@router.post("/stream")
async def stream_agent(request: AgentQueryRequest):
    """Streaming agent query via SSE."""
    agent_name = request.agent_name or "quick-qa"
    if agent_name not in AGENT_REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown agent: {agent_name}")

    service = AgentService()

    async def event_generator():
        stop_reason = "unknown"
        input_tokens = 0
        output_tokens = 0
        tool_call_count = 0
        fallback_applied = False
        _request_id = ""
        async for chunk in service.stream(
            agent_name=agent_name,
            prompt=request.prompt,
            student_id=request.student_id,
            context=request.context,
            role=request.role,
            session_id=request.session_id,
        ):
            print(f"[sse_out] {chunk[:120]}", flush=True)
            # Extract metrics from done event
            try:
                _parsed = json.loads(chunk)
                if _parsed.get("type") == "done":
                    stop_reason = str(_parsed.get("stop_reason") or "unknown")
                    input_tokens = int(_parsed.get("input_tokens") or 0)
                    output_tokens = int(_parsed.get("output_tokens") or 0)
                    tool_call_count = int(_parsed.get("tool_call_count") or 0)
                    fallback_applied = bool(_parsed.get("fallback_applied"))
                    _request_id = str(_parsed.get("request_id") or "")
            except Exception:
                pass
            yield f"data: {chunk}\n\n"
        print(
            f"[sse_metrics] agent={agent_name} stop_reason={stop_reason} "
            f"tokens_in={input_tokens} tokens_out={output_tokens} "
            f"tool_calls={tool_call_count} fallback={fallback_applied} "
            f"request_id={_request_id}",
            flush=True,
        )
        print("[sse_out] [DONE]", flush=True)
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions", response_model=list[AgentSessionItem])
async def list_agent_sessions(
    student_id: str = Query(..., description="Student ID"),
    limit: int = Query(20, ge=1, le=100, description="Max sessions"),
):
    """List available sessions for restore UI."""
    service = AgentService()
    return await service.list_sessions(student_id=student_id, limit=limit)


@router.delete("/sessions", response_model=ClearSessionsResponse)
async def clear_agent_sessions(
    student_id: str = Query(..., description="Student ID"),
    session_id: str | None = Query(None, description="Specific session id to clear"),
):
    """Clear one session or all sessions for a student."""
    service = AgentService()
    return await service.clear_sessions(student_id=student_id, session_id=session_id)


@router.post("/approvals/{request_id}/approve", response_model=ApprovalDecisionResponse)
async def approve_tool_request(request_id: str, payload: ApprovalDecisionRequest):
    """Approve one pending high-risk tool request."""
    reason = payload.reason or "approved by user"
    ok = await get_approval_broker().approve(request_id, reason=reason)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Approval request not found: {request_id}")
    return ApprovalDecisionResponse(
        ok=True,
        request_id=request_id,
        approved=True,
        reason=reason,
    )


@router.post("/approvals/{request_id}/reject", response_model=ApprovalDecisionResponse)
async def reject_tool_request(request_id: str, payload: ApprovalDecisionRequest):
    """Reject one pending high-risk tool request."""
    reason = payload.reason or "rejected by user"
    ok = await get_approval_broker().reject(request_id, reason=reason)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Approval request not found: {request_id}")
    return ApprovalDecisionResponse(
        ok=True,
        request_id=request_id,
        approved=False,
        reason=reason,
    )


@router.get("/approvals/metrics", response_model=ApprovalMetricsResponse)
async def approval_metrics():
    """Return approval request metrics for coding observability."""
    return await get_approval_broker().metrics()


@router.get("/coding/policies")
async def coding_policy_profiles():
    """Return active coding policy profiles (with hot-reload snapshot)."""
    return get_coding_policy_profile_manager().snapshot()


@router.get("/task-templates", response_model=TaskTemplateListResponse)
async def task_templates_catalog():
    """Return cross-module task template catalog."""
    templates = [
        TaskTemplateItem(**item)
        for item in list_task_templates()
    ]
    return TaskTemplateListResponse(
        templates=templates,
        source="builtin",
    )


@router.post("/task-templates/start", response_model=TaskTemplateStartResponse)
async def start_task_template(payload: TaskTemplateStartRequest):
    """Start a task template run and return run metadata."""
    template = get_task_template(payload.task_type)
    if template is None:
        raise HTTPException(status_code=400, detail=f"Unknown task template: {payload.task_type}")

    run_id = create_task_run_id(payload.task_type)
    started_at = now_ts()
    label = payload.label or str(template.get("label") or payload.task_type)
    student_id = (payload.student_id or "").strip() or None

    await log_tool_action(
        request_id=f"task_template_start:{run_id}",
        tool="task_template_start",
        risk=str(template.get("risk_level") or "medium"),
        approved=True,
        status="queued",
        args={
            "task_type": payload.task_type,
            "label": label,
            "workspace_id": payload.workspace_id,
            "prompt_overridden": bool((payload.prompt or "").strip()),
            "metadata": payload.metadata or {},
            "steps": template.get("steps") or [],
        },
        result={
            "run_id": run_id,
            "started_at": started_at,
        },
        student_id=student_id,
        agent_name=str(template.get("target_agent") or "quick-qa"),
        engine="task_template",
        mode="queued",
    )

    return TaskTemplateStartResponse(
        ok=True,
        run_id=run_id,
        task_type=payload.task_type,
        label=label,
        started_at=started_at,
        source="api",
    )


@router.post("/graph/feedback", response_model=GraphCommandFeedbackResponse)
async def ingest_graph_feedback(payload: GraphCommandFeedbackRequest):
    """Ingest graph command execution feedback for next-turn reasoning context."""
    student_id = (payload.student_id or "").strip()
    if not student_id:
        raise HTTPException(status_code=400, detail="student_id required")
    items = [item.model_dump(exclude_none=True) for item in (payload.items or [])]
    if not items:
        raise HTTPException(status_code=400, detail="items required")

    accepted = await append_graph_feedback(
        student_id,
        agent_name=(payload.agent_name or "graph-analyst"),
        session_id=payload.session_id,
        source=payload.source,
        items=items,
    )

    return GraphCommandFeedbackResponse(
        ok=True,
        accepted=accepted,
        student_id=student_id,
        agent_name=payload.agent_name or "graph-analyst",
        session_id=payload.session_id,
    )


@router.get("/graph/feedback", response_model=GraphCommandFeedbackListResponse)
async def list_graph_feedback_entries(
    student_id: str = Query(..., description="Student ID"),
    agent_name: str | None = Query("graph-analyst", description="Agent name filter"),
    session_id: str | None = Query(None, description="Session ID filter"),
    status: str | None = Query(None, description="Status filter: success|ignored|error"),
    command: str | None = Query(None, description="Command contains filter"),
    limit: int = Query(50, ge=1, le=200, description="Max entries"),
):
    """List graph command execution feedback for timeline and diagnostics."""
    items = await list_graph_feedback(
        student_id,
        agent_name=agent_name,
        session_id=session_id,
        status=status,
        command=command,
        limit=limit,
    )
    parsed_items = [
        GraphCommandFeedbackItem(
            command=str(item.get("command") or ""),
            target=str(item.get("target") or "") or None,
            status=str(item.get("status") or "ignored"),
            success=bool(item.get("success")) if item.get("success") is not None else None,
            message=str(item.get("message") or "") or None,
            issued_at=int(item.get("issued_at")) if isinstance(item.get("issued_at"), (int, float)) else None,
            executed_at=int(item.get("executed_at")) if isinstance(item.get("executed_at"), (int, float)) else None,
            params=item.get("params") if isinstance(item.get("params"), dict) else None,
        )
        for item in items
        if str(item.get("command") or "").strip()
    ]
    return GraphCommandFeedbackListResponse(
        ok=True,
        total=len(parsed_items),
        student_id=student_id,
        agent_name=agent_name,
        session_id=session_id,
        status=status,
        command=command,
        items=parsed_items,
    )


@router.post("/graph/batch-feedback", response_model=GraphBatchFeedbackResponse)
async def ingest_graph_batch_feedback(payload: GraphBatchFeedbackRequest):
    """Ingest graph batch execution feedback for timeline/audit."""
    student_id = (payload.student_id or "").strip()
    if not student_id:
        raise HTTPException(status_code=400, detail="student_id required")

    item = payload.item.model_dump(exclude_none=True)
    accepted = await append_graph_batch_feedback(
        student_id,
        agent_name=(payload.agent_name or "graph-analyst"),
        session_id=payload.session_id,
        source=payload.source,
        item=item,
    )

    batch_id = str(item.get("batch_id") or "")
    request_id = f"graph_batch:{batch_id}:{int(item.get('finished_at') or item.get('started_at') or 0)}"
    await log_tool_action(
        request_id=request_id,
        tool="graph_batch",
        risk="idempotent",
        approved=True,
        status=str(item.get("status") or "failed"),
        args={
            "batch_id": batch_id,
            "mode": str(item.get("mode") or "best_effort"),
            "total": int(item.get("total") or 0),
            "source": payload.source or "graph_page",
            "rolled_back": int(item.get("rolled_back") or 0),
            "rollback_failed": int(item.get("rollback_failed") or 0),
        },
        result={
            "completed": int(item.get("completed") or 0),
            "message": str(item.get("message") or ""),
            "started_at": int(item.get("started_at") or 0),
            "finished_at": int(item.get("finished_at") or 0),
        },
        student_id=student_id,
        session_id=payload.session_id,
        agent_name=payload.agent_name or "graph-analyst",
        engine="graph_ui",
        mode="batch",
    )

    return GraphBatchFeedbackResponse(
        ok=True,
        accepted=accepted,
        student_id=student_id,
        agent_name=payload.agent_name or "graph-analyst",
        session_id=payload.session_id,
        batch_id=str(item.get("batch_id") or ""),
    )


@router.get("/graph/batch-feedback", response_model=GraphBatchFeedbackListResponse)
async def list_graph_batch_feedback_entries(
    student_id: str = Query(..., description="Student ID"),
    agent_name: str | None = Query("graph-analyst", description="Agent name filter"),
    session_id: str | None = Query(None, description="Session ID filter"),
    status: str | None = Query(None, description="Status filter: running|success|partial|failed"),
    before_ts: int | None = Query(None, ge=0, description="Pagination cursor (ms)"),
    limit: int = Query(50, ge=1, le=200, description="Max entries"),
):
    """List graph batch feedback for timeline and diagnostics."""
    items, next_before_ts = await list_graph_batch_feedback(
        student_id,
        agent_name=agent_name,
        session_id=session_id,
        status=status,
        before_ts=before_ts,
        limit=limit,
    )
    parsed_items = [
        GraphBatchFeedbackItem(
            batch_id=str(item.get("batch_id") or ""),
            mode=str(item.get("mode") or "best_effort"),
            status=str(item.get("status") or "failed"),
            completed=int(item.get("completed")) if isinstance(item.get("completed"), (int, float)) else 0,
            total=int(item.get("total")) if isinstance(item.get("total"), (int, float)) else 0,
            rolled_back=int(item.get("rolled_back")) if isinstance(item.get("rolled_back"), (int, float)) else None,
            rollback_failed=int(item.get("rollback_failed")) if isinstance(item.get("rollback_failed"), (int, float)) else None,
            message=str(item.get("message") or "") or None,
            started_at=int(item.get("started_at")) if isinstance(item.get("started_at"), (int, float)) else None,
            finished_at=int(item.get("finished_at")) if isinstance(item.get("finished_at"), (int, float)) else None,
        )
        for item in items
        if str(item.get("batch_id") or "").strip()
    ]
    return GraphBatchFeedbackListResponse(
        ok=True,
        total=len(parsed_items),
        student_id=student_id,
        agent_name=agent_name,
        session_id=session_id,
        status=status,
        source="redis",
        next_before_ts=next_before_ts,
        items=parsed_items,
    )


@router.get("/list", response_model=list[AgentCatalogItem])
async def list_agents_catalog():
    """List available agents with concise metadata."""
    return [
        _build_agent_catalog_item(name, agent)
        for name, agent in AGENT_REGISTRY.items()
    ]


@router.get("/agents", response_model=list[AgentCatalogItem])
async def list_agents():
    """Backward-compatible alias for agent catalog list."""
    return await list_agents_catalog()


@router.get("/{agent_name}/capabilities", response_model=AgentCapabilitiesResponse)
async def get_agent_capabilities(agent_name: str):
    """Return detailed capabilities of a specific agent."""
    agent = AGENT_REGISTRY.get(agent_name)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_name}")
    return _build_agent_capabilities(agent_name, agent)
