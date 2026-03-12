"""Runtime parsing and mode-selection utilities for WebAgent core."""

from __future__ import annotations

from typing import Any

from app.services.webagent_core.protocol import (
    OrchestratorConfig,
    parse_orchestrator_config,
    pick_execution_mode,
)


def parse_runtime_orchestrator(
    runtime: dict[str, Any] | None,
    allowed_modes: set[str],
) -> OrchestratorConfig:
    """Parse `_runtime.orchestrator` payload with safe defaults."""
    return parse_orchestrator_config(runtime=runtime, allowed_modes=allowed_modes)


__all__ = [
    "OrchestratorConfig",
    "parse_orchestrator_config",
    "parse_runtime_orchestrator",
    "pick_execution_mode",
]
