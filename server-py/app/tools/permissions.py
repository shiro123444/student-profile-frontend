"""Tool permission manager — role-based access control via SDK callback.

Uses manifest.yaml permissions from unified ToolRegistry (builtin/custom/external).
"""

from __future__ import annotations

import logging
from typing import Any

from claude_agent_sdk import (
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
)

from app.tools.registry import ToolRegistry, get_registry

logger = logging.getLogger(__name__)


class ToolPermissionManager:
    """Builds can_use_tool callbacks based on user role and manifests."""

    def __init__(self, registry: ToolRegistry | None = None):
        self._registry = registry or get_registry()
        self._role_cache: dict[str, set[str]] = {}
        self._build_cache()

    def _build_cache(self):
        """Pre-compute role → allowed local tool names."""
        self._role_cache.clear()

        for pkg in self._registry.get_packages().values():
            perms = pkg.manifest.get("permissions", {})
            default_roles = set(perms.get("roles", ["student", "teacher", "admin"]))
            tool_overrides = perms.get("tool_overrides", {})

            for tool_obj in pkg.tools:
                tool_name = tool_obj.name
                override = tool_overrides.get(tool_name, {})
                allowed_roles = set(override.get("roles", [])) or default_roles

                for role in allowed_roles:
                    self._role_cache.setdefault(role, set()).add(tool_name)

        for role, tools in self._role_cache.items():
            logger.info("Permission cache [%s]: %d tools", role, len(tools))

    def get_allowed_tools(self, role: str) -> set[str]:
        return self._role_cache.get(role, set())

    def _resolve_local_name(self, tool_name: str) -> str | None:
        """Resolve MCP-qualified tool names to local registry name."""
        resolved = self._registry.resolve_tool_name(tool_name)
        if resolved:
            return resolved

        if tool_name.startswith("mcp__"):
            parts = tool_name.split("__", 2)
            if len(parts) == 3:
                return parts[2]

        return tool_name

    def make_callback(self, role: str):
        """Create can_use_tool callback for SDK."""
        allowed = self.get_allowed_tools(role)

        async def can_use_tool(
            tool_name: str,
            input_data: dict[str, Any],
            context: ToolPermissionContext,
        ) -> PermissionResultAllow | PermissionResultDeny:
            bare_name = self._resolve_local_name(tool_name) or tool_name

            if bare_name in allowed:
                return PermissionResultAllow()

            logger.warning("Permission denied: role=%s tool=%s", role, bare_name)
            return PermissionResultDeny(
                message=f"权限不足: {role} 角色无法使用工具 {bare_name}"
            )

        return can_use_tool


_manager: ToolPermissionManager | None = None


def get_permission_manager() -> ToolPermissionManager:
    """Get or create global ToolPermissionManager singleton."""
    global _manager
    if _manager is None:
        _manager = ToolPermissionManager()
    return _manager
