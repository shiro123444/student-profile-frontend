"""Compatibility shim for legacy imports.

New code should import from `app.services.webagent_core`.
This module re-exports the same symbols to avoid breaking existing callers.
"""

from __future__ import annotations

from app.services.webagent_core import (
    ArtifactContract,
    DataAdapter,
    DataAdapterError,
    DEFAULT_PROFILE,
    HttpDataAdapter,
    PROTOCOL_VERSION,
    OrchestratorConfig,
    TenantContext,
    WebAgentPlan,
    WebAgentPlanNode,
    WorkerArtifact,
    build_dag_layers,
    build_plan_output_format,
    compact_plan_for_prompt,
    compact_tenant_context,
    get_data_adapter,
    infer_artifact_contract,
    list_plan_nodes,
    parse_orchestrator_config,
    parse_tenant_context,
    parse_webagent_plan,
    pick_execution_mode,
    set_data_adapter,
    summarize_plan_steps,
)

__all__ = [
    "PROTOCOL_VERSION",
    "DEFAULT_PROFILE",
    "WebAgentPlanNode",
    "WebAgentPlan",
    "OrchestratorConfig",
    "TenantContext",
    "ArtifactContract",
    "WorkerArtifact",
    "DataAdapter",
    "DataAdapterError",
    "HttpDataAdapter",
    "get_data_adapter",
    "set_data_adapter",
    "parse_tenant_context",
    "compact_tenant_context",
    "infer_artifact_contract",
    "parse_orchestrator_config",
    "build_plan_output_format",
    "parse_webagent_plan",
    "build_dag_layers",
    "list_plan_nodes",
    "pick_execution_mode",
    "compact_plan_for_prompt",
    "summarize_plan_steps",
]
