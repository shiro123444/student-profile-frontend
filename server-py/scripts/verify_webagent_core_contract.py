"""Verify public export contract of webagent_core and compatibility shim.

This script is intentionally static (AST-based) to avoid importing runtime
modules that may require full service dependencies.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

REQUIRED_CORE_EXPORTS = {
    "PROTOCOL_VERSION",
    "DEFAULT_PROFILE",
    "WebAgentPlanNode",
    "WebAgentPlan",
    "OrchestratorConfig",
    "TenantContext",
    "ArtifactContract",
    "WorkerArtifact",
    "parse_tenant_context",
    "compact_tenant_context",
    "infer_artifact_contract",
    "DataAdapter",
    "HttpDataAdapter",
    "get_data_adapter",
    "set_data_adapter",
    "parse_orchestrator_config",
    "parse_runtime_orchestrator",
    "build_plan_output_format",
    "parse_webagent_plan",
    "build_dag_layers",
    "pick_execution_mode",
    "compact_plan_for_prompt",
    "summarize_plan_steps",
    "calc_worker_trace_cost",
    "compact_worker_trace",
    "resolve_worker_tools",
}

REQUIRED_SHIM_EXPORTS = {
    "TenantContext",
    "ArtifactContract",
    "DataAdapter",
    "HttpDataAdapter",
    "get_data_adapter",
    "set_data_adapter",
    "parse_tenant_context",
    "compact_tenant_context",
    "infer_artifact_contract",
}


def extract_all_symbols(module_path: Path) -> set[str]:
    tree = ast.parse(module_path.read_text(encoding="utf-8"), filename=str(module_path))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "__all__":
                    value = node.value
                    if not isinstance(value, (ast.List, ast.Tuple)):
                        raise ValueError(f"__all__ in {module_path} is not list/tuple")
                    symbols: set[str] = set()
                    for item in value.elts:
                        if isinstance(item, ast.Constant) and isinstance(item.value, str):
                            symbols.add(item.value)
                    return symbols
    raise ValueError(f"__all__ not found in {module_path}")


def check_contract(symbols: set[str], required: set[str], name: str) -> int:
    missing = sorted(required - symbols)
    extra = sorted(symbols - required)

    print(f"[{name}] required={len(required)} actual={len(symbols)}")
    if missing:
        print(f"  missing({len(missing)}): {', '.join(missing)}")
    else:
        print("  missing(0): -")

    # extra exports are allowed in MINOR releases, so only report
    if extra:
        print(f"  extra({len(extra)}): {', '.join(extra[:12])}{' ...' if len(extra) > 12 else ''}")
    else:
        print("  extra(0): -")

    return 1 if missing else 0


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    core_init = repo_root / "server-py" / "app" / "services" / "webagent_core" / "__init__.py"
    shim_init = repo_root / "server-py" / "app" / "services" / "webagent_protocol.py"

    core_symbols = extract_all_symbols(core_init)
    shim_symbols = extract_all_symbols(shim_init)

    code = 0
    code |= check_contract(core_symbols, REQUIRED_CORE_EXPORTS, "webagent_core")
    code |= check_contract(shim_symbols, REQUIRED_SHIM_EXPORTS, "webagent_protocol(shim)")

    if code == 0:
        print("contract-check: PASS")
    else:
        print("contract-check: FAIL")
    return code


if __name__ == "__main__":
    sys.exit(main())
