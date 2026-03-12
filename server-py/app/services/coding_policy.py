"""Risk policy helpers for coding workflow tools."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from app.config import settings
from app.services.coding_policy_profiles import get_effective_coding_policy_profile


_HIGH_RISK_TOOLS = {
    "code_write_file",
    "code_edit_file",
    "code_git_add",
    "code_git_commit",
    "code_git_branch",
    "code_shell_exec",
}
_ALLOWED_RISK_LEVELS = {"low", "medium", "high"}

_high_risk_semaphores: dict[int, asyncio.Semaphore] = {}
_high_risk_init_lock: asyncio.Lock | None = None


async def _get_init_lock() -> asyncio.Lock:
    global _high_risk_init_lock
    if _high_risk_init_lock is None:
        _high_risk_init_lock = asyncio.Lock()
    return _high_risk_init_lock


def _safe_risk(value: Any, default: str) -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in _ALLOWED_RISK_LEVELS else default


def approvals_enabled_for_runtime() -> bool:
    """Whether approval workflow is enabled for current runtime/profile."""
    profile = get_effective_coding_policy_profile()
    return bool(settings.coding_approvals_enabled and profile.approvals_enabled)


def get_approval_timeout_sec() -> int:
    """Approval timeout for current runtime/profile."""
    profile = get_effective_coding_policy_profile()
    return max(5, min(int(profile.approval_timeout_sec), 300))


def external_builtin_priority_enabled() -> bool:
    """Whether builtin tool handler should be preferred before external MCP call."""
    profile = get_effective_coding_policy_profile()
    return bool(profile.external_mcp_builtin_priority)


def external_fallback_to_internal_enabled() -> bool:
    """Whether external MCP failure should fallback to internal builtin handler."""
    profile = get_effective_coding_policy_profile()
    return bool(profile.external_mcp_fallback_to_internal)


def _normalize_annotations(annotations: Any) -> dict[str, Any] | None:
    if annotations is None:
        return None

    data: Any
    if hasattr(annotations, "model_dump"):
        data = annotations.model_dump(exclude_none=True)
    elif hasattr(annotations, "dict"):
        data = annotations.dict(exclude_none=True)
    elif isinstance(annotations, dict):
        data = annotations
    else:
        return None

    if not isinstance(data, dict):
        return None

    normalized = {k: v for k, v in data.items() if v is not None}
    return normalized or None


def normalize_tool_name(tool_name: str) -> str:
    """Normalize MCP-qualified tool name to local registry tool name."""
    if not tool_name:
        return ""

    try:
        from app.tools.registry import get_registry

        resolved = get_registry().resolve_tool_name(tool_name)
        if isinstance(resolved, str) and resolved.strip():
            return resolved.strip()
    except Exception:
        pass

    if tool_name.startswith("mcp__"):
        parts = tool_name.split("__", 2)
        if len(parts) == 3:
            return parts[2]

    if "__" in tool_name:
        return tool_name.split("__")[-1]

    return tool_name


def _lookup_tool_risk_override(tool_name: str) -> str | None:
    """Lookup per-tool risk override from package manifest tool_overrides."""
    normalized = normalize_tool_name(tool_name)
    if not normalized:
        return None

    try:
        from app.tools.registry import get_registry

        registry = get_registry()
        package_name = registry.get_tool_package_name(normalized)
        if not package_name:
            return None

        pkg = registry.get_package(package_name)
        if pkg is None:
            return None

        perms = pkg.manifest.get("permissions") if isinstance(pkg.manifest, dict) else None
        if not isinstance(perms, dict):
            return None

        tool_overrides = perms.get("tool_overrides")
        if not isinstance(tool_overrides, dict):
            return None

        override = tool_overrides.get(normalized)
        if not isinstance(override, dict):
            return None

        return _safe_risk(override.get("risk"), default="") or None
    except Exception:
        return None


def is_external_tool(tool_name: str) -> bool:
    """Whether tool belongs to external MCP server (non-pathmind)."""
    normalized = normalize_tool_name(tool_name)
    if not normalized:
        return False

    try:
        from app.tools.registry import get_registry

        server = get_registry().get_tool_mcp_server(normalized)
        return bool(server and server != "pathmind")
    except Exception:
        return False


def _external_risk_level(tool_name: str) -> str | None:
    """Resolve risk level for external MCP tools from annotations + defaults."""
    normalized = normalize_tool_name(tool_name)
    if not normalized:
        return None

    profile = get_effective_coding_policy_profile()

    try:
        from app.tools.registry import get_registry

        registry = get_registry()
        server = registry.get_tool_mcp_server(normalized)
        if not server or server == "pathmind":
            return None

        tool_obj = registry.get_tool(normalized)
        annotations = _normalize_annotations(getattr(tool_obj, "annotations", None))

        if not annotations:
            return _safe_risk(profile.external_default_risk, "high")

        if bool(annotations.get("destructiveHint")):
            return "high"

        if bool(annotations.get("readOnlyHint")):
            if bool(annotations.get("openWorldHint")):
                return _safe_risk(profile.external_openworld_risk, "high")
            return _safe_risk(profile.external_readonly_risk, "medium")

        if bool(annotations.get("openWorldHint")):
            return _safe_risk(profile.external_openworld_risk, "high")

        return _safe_risk(profile.external_default_risk, "high")
    except Exception:
        return _safe_risk(profile.external_default_risk, "high")


def risk_level_for_tool(tool_name: str) -> str:
    """Resolve risk level label for SSE/audit."""
    normalized = normalize_tool_name(tool_name)

    if normalized in _HIGH_RISK_TOOLS:
        return "high"

    override = _lookup_tool_risk_override(normalized)
    if override:
        return override

    external_risk = _external_risk_level(normalized)
    if external_risk:
        return external_risk

    return "low"


def is_high_risk_tool(tool_name: str) -> bool:
    """Whether the tool requires per-call approval in coding mode."""
    risk = risk_level_for_tool(tool_name)
    if risk == "high":
        return True
    if risk == "medium":
        profile = get_effective_coding_policy_profile()
        return bool(profile.medium_risk_requires_approval)
    return False


def get_low_risk_retry_policy(tool_name: str) -> tuple[int, int]:
    """Return `(retry_count, backoff_ms)` for low-risk tools only."""
    if is_high_risk_tool(tool_name):
        return 0, 0

    profile = get_effective_coding_policy_profile()
    retry_count = max(0, min(int(profile.low_risk_retry_count), 3))
    backoff_ms = max(50, min(int(profile.low_risk_retry_backoff_ms), 10_000))
    return retry_count, backoff_ms


def get_high_risk_concurrency() -> int:
    """Concurrency slot size for high-risk operations under active profile."""
    profile = get_effective_coding_policy_profile()
    return max(1, min(int(profile.high_risk_max_concurrency), 8))


async def _get_high_risk_semaphore(concurrency: int) -> asyncio.Semaphore:
    existing = _high_risk_semaphores.get(concurrency)
    if existing is not None:
        return existing

    init_lock = await _get_init_lock()
    async with init_lock:
        again = _high_risk_semaphores.get(concurrency)
        if again is not None:
            return again

        created = asyncio.Semaphore(concurrency)
        _high_risk_semaphores[concurrency] = created
        return created


@asynccontextmanager
async def acquire_high_risk_execution_slot(tool_name: str) -> AsyncIterator[None]:
    """Serialize high-risk tool execution under configurable concurrency."""
    if not is_high_risk_tool(tool_name):
        yield
        return

    concurrency = get_high_risk_concurrency()
    semaphore = await _get_high_risk_semaphore(concurrency)
    await semaphore.acquire()
    try:
        yield
    finally:
        semaphore.release()


def build_args_preview(args: dict[str, Any], max_str_len: int = 240) -> dict[str, Any]:
    """Build safe/truncated args preview for approval dialog."""
    preview: dict[str, Any] = {}
    for key, value in (args or {}).items():
        if isinstance(value, str):
            preview[key] = value[:max_str_len]
            continue
        if isinstance(value, list):
            sanitized: list[Any] = []
            for item in value[:20]:
                if isinstance(item, str):
                    sanitized.append(item[:max_str_len])
                else:
                    sanitized.append(item)
            preview[key] = sanitized
            continue
        if isinstance(value, dict):
            preview[key] = {k: str(v)[:max_str_len] for k, v in list(value.items())[:20]}
            continue
        preview[key] = value
    return preview
