"""Per-request coding runtime context.

The context is carried through a ContextVar so built-in coding tools can read
runtime controls from `context._runtime.coding` without polluting tool args.
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class CodingRuntimeContext:
    """Runtime controls for coding workflow."""

    enabled: bool = False
    workspace_id: str = "default"
    approval_mode: str = "per_call"
    allow_network: bool = False
    policy_profile: str | None = None


_default_ctx = CodingRuntimeContext()
_ctx_var: ContextVar[CodingRuntimeContext] = ContextVar("coding_runtime_context", default=_default_ctx)


def parse_coding_runtime(runtime: dict[str, Any] | None) -> CodingRuntimeContext:
    """Parse `context._runtime.coding` into a stable context object."""
    if not isinstance(runtime, dict):
        return CodingRuntimeContext()

    raw = runtime.get("coding")
    if not isinstance(raw, dict):
        return CodingRuntimeContext()

    workspace_id = str(raw.get("workspace_id") or "default").strip() or "default"
    approval_mode = str(raw.get("approval_mode") or "per_call").strip() or "per_call"
    policy_profile = str(raw.get("policy_profile") or "").strip() or None

    return CodingRuntimeContext(
        enabled=bool(raw.get("enabled", False)),
        workspace_id=workspace_id,
        approval_mode=approval_mode,
        allow_network=bool(raw.get("allow_network", False)),
        policy_profile=policy_profile,
    )


def set_coding_runtime_context(ctx: CodingRuntimeContext) -> Token[CodingRuntimeContext]:
    """Set coding runtime context for current task."""
    return _ctx_var.set(ctx)


def reset_coding_runtime_context(token: Token[CodingRuntimeContext]) -> None:
    """Reset coding runtime context to the previous value."""
    _ctx_var.reset(token)


def get_coding_runtime_context() -> CodingRuntimeContext:
    """Get coding runtime context for current request/task."""
    return _ctx_var.get()
