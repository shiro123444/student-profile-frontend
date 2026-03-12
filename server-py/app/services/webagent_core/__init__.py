"""WebAgent core boundary package.

This package provides a stable import surface for protocol/runtime/orchestrator
logic so the core can be extracted as standalone SDK later.
"""

from __future__ import annotations

from app.services.webagent_core.contracts import (
    ArtifactContract,
    ApprovalDecision,
    ApprovalProvider,
    AuditSink,
    DEFAULT_PROFILE,
    PROTOCOL_VERSION,
    OrchestratorConfig,
    SandboxPolicy,
    TenantContext,
    WebAgentPlan,
    WebAgentPlanNode,
    WorkerArtifact,
    compact_tenant_context,
    infer_artifact_contract,
    parse_tenant_context,
)
from app.services.webagent_core.data_adapter import (
    DataAdapter,
    DataAdapterError,
    HttpDataAdapter,
    get_data_adapter,
    set_data_adapter,
)
from app.services.webagent_core.orchestrator import (
    calc_worker_trace_cost,
    compact_worker_trace,
    resolve_worker_tools,
)
from app.services.webagent_core.protocol import (
    build_dag_layers,
    build_plan_output_format,
    compact_plan_for_prompt,
    list_plan_nodes,
    parse_orchestrator_config,
    parse_webagent_plan,
    pick_execution_mode,
    summarize_plan_steps,
)
from app.services.webagent_core.runtime import parse_runtime_orchestrator

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
    "DataAdapter",
    "DataAdapterError",
    "HttpDataAdapter",
    "get_data_adapter",
    "set_data_adapter",
    "parse_orchestrator_config",
    "parse_runtime_orchestrator",
    "build_plan_output_format",
    "parse_webagent_plan",
    "build_dag_layers",
    "list_plan_nodes",
    "pick_execution_mode",
    "compact_plan_for_prompt",
    "summarize_plan_steps",
    "calc_worker_trace_cost",
    "compact_worker_trace",
    "resolve_worker_tools",
]
