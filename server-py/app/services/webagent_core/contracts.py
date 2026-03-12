"""Core contracts for WebAgent SDK boundary.

This module centralizes durable type contracts that can be reused when
`webagent_core` is extracted as an independent package.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, TypedDict, runtime_checkable

from app.services.webagent_core.protocol import (
    DEFAULT_PROFILE,
    PROTOCOL_VERSION,
    OrchestratorConfig,
    WebAgentPlan,
    WebAgentPlanNode,
)

_DEFAULT_TENANT_ID = "public"


@dataclass(slots=True)
class TenantContext:
    """Normalized tenant scope carried across orchestration/runtime."""

    tenant_id: str = _DEFAULT_TENANT_ID
    role: str = "student"
    student_id: str | None = None
    user_id: str | None = None
    workspace_id: str | None = None
    locale: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class ArtifactContract(TypedDict, total=False):
    """Standardized worker artifact payload.

    kind values are intentionally constrained to a compact v1 set so SDK
    consumers can render artifacts consistently:
    - text: plain text conclusion/notes
    - note_markdown: markdown suitable for note workspace
    - report_json: structured JSON report payload
    - pdf_url: generated PDF URL (or relative path)
    """

    kind: str
    mime_type: str
    value: Any
    uri: str
    title: str
    metadata: dict[str, Any]


class WorkerArtifact(TypedDict, total=False):
    """Standardized artifact emitted by one orchestrator worker node."""

    id: str
    title: str
    kind: str
    mode: str
    depends_on: list[str]
    tools_allowed: list[str]
    attempts: int
    status: str
    failure_reason: str
    objective: str
    deliverable: str
    summary: str
    response_preview: str
    engine_used: str | None
    model_used: str | None
    cost_usd: float
    input_tokens: int
    output_tokens: int
    artifact: ArtifactContract


class ApprovalDecision(TypedDict, total=False):
    """Standardized approval result for risky operations."""

    approved: bool
    reason: str
    request_id: str


@runtime_checkable
class ApprovalProvider(Protocol):
    """Pluggable approval provider contract for SDK consumers."""

    async def request_approval(
        self,
        tool: str,
        risk: str,
        args_preview: dict[str, Any],
    ) -> ApprovalDecision:
        ...


@runtime_checkable
class SandboxPolicy(Protocol):
    """Pluggable sandbox policy contract for SDK consumers."""

    def check_tool_call(self, tool: str, args: dict[str, Any]) -> None:
        ...


@runtime_checkable
class AuditSink(Protocol):
    """Pluggable audit sink contract for SDK consumers."""

    async def log_action(self, payload: dict[str, Any]) -> None:
        ...


def parse_tenant_context(
    payload: Mapping[str, Any] | None,
    *,
    student_id: str | None = None,
    role: str = "student",
) -> TenantContext:
    """Normalize external tenant payload to stable v1 contract."""
    source = dict(payload or {})
    tenant_id = str(
        source.get("tenant_id")
        or source.get("tenantId")
        or source.get("org_id")
        or _DEFAULT_TENANT_ID
    ).strip() or _DEFAULT_TENANT_ID

    resolved_role = str(source.get("role") or role or "student").strip() or "student"
    resolved_student_id = str(source.get("student_id") or student_id or "").strip() or None
    user_id = str(source.get("user_id") or source.get("userId") or "").strip() or None
    workspace_id = str(source.get("workspace_id") or source.get("workspaceId") or "").strip() or None
    locale = str(source.get("locale") or "").strip() or None

    metadata: dict[str, Any] = {}
    raw_metadata = source.get("metadata")
    if isinstance(raw_metadata, Mapping):
        metadata.update(dict(raw_metadata))

    for key in ("project", "labels", "feature_flags"):
        if key in source and key not in metadata:
            metadata[key] = source[key]

    return TenantContext(
        tenant_id=tenant_id,
        role=resolved_role,
        student_id=resolved_student_id,
        user_id=user_id,
        workspace_id=workspace_id,
        locale=locale,
        metadata=metadata,
    )


def compact_tenant_context(ctx: TenantContext | None) -> dict[str, Any] | None:
    """Return compact dict representation for API/SSE metadata payloads."""
    if ctx is None:
        return None

    payload: dict[str, Any] = {
        "tenant_id": ctx.tenant_id,
        "role": ctx.role,
    }
    if ctx.student_id:
        payload["student_id"] = ctx.student_id
    if ctx.user_id:
        payload["user_id"] = ctx.user_id
    if ctx.workspace_id:
        payload["workspace_id"] = ctx.workspace_id
    if ctx.locale:
        payload["locale"] = ctx.locale
    if ctx.metadata:
        payload["metadata"] = ctx.metadata
    return payload


def infer_artifact_contract(
    response_text: str,
    structured_output: Any,
) -> ArtifactContract:
    """Infer artifact contract from worker output.

    Heuristics keep backward compatibility while giving downstream SDK consumers
    a stable `artifact.kind` to branch rendering/storage logic.
    """
    if isinstance(structured_output, dict):
        pdf_url = structured_output.get("pdf_url")
        if isinstance(pdf_url, str) and pdf_url.strip():
            return {
                "kind": "pdf_url",
                "mime_type": "application/pdf",
                "uri": pdf_url.strip(),
                "metadata": {"source": "structured_output"},
            }
        return {
            "kind": "report_json",
            "mime_type": "application/json",
            "value": structured_output,
            "metadata": {"source": "structured_output"},
        }

    if isinstance(structured_output, list):
        return {
            "kind": "report_json",
            "mime_type": "application/json",
            "value": structured_output,
            "metadata": {"source": "structured_output"},
        }

    text = str(response_text or "")
    if "#" in text or "```" in text:
        return {
            "kind": "note_markdown",
            "mime_type": "text/markdown",
            "value": text,
        }

    return {
        "kind": "text",
        "mime_type": "text/plain",
        "value": text,
    }


__all__ = [
    "PROTOCOL_VERSION",
    "DEFAULT_PROFILE",
    "WebAgentPlanNode",
    "WebAgentPlan",
    "OrchestratorConfig",
    "TenantContext",
    "ArtifactContract",
    "WorkerArtifact",
    "ApprovalDecision",
    "ApprovalProvider",
    "SandboxPolicy",
    "AuditSink",
    "parse_tenant_context",
    "compact_tenant_context",
    "infer_artifact_contract",
]
