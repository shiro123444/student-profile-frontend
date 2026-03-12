"""MCP server helpers — internal SDK server + optional external MCP configs."""

from __future__ import annotations

import logging
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server

from app.tools.registry import ToolRegistry, get_registry

logger = logging.getLogger(__name__)


def _is_internal_tool(registry: ToolRegistry, tool_name: str) -> bool:
    mcp_ref = registry.get_mcp_tool_ref(tool_name) or ""
    return mcp_ref.startswith("mcp__pathmind__")


def build_mcp_server(name: str = "pathmind", version: str = "1.0.0"):
    """Build internal in-process MCP server with builtin/custom tools."""
    registry = get_registry()
    internal_tools = [
        tool for tool in registry.get_all_tools() if _is_internal_tool(registry, tool.name)
    ]

    logger.info("Building MCP server '%s' with %d internal tools", name, len(internal_tools))

    return create_sdk_mcp_server(
        name=name,
        version=version,
        tools=internal_tools,
    )


def build_mcp_server_for_role(role: str, name: str = "pathmind", version: str = "1.0.0"):
    """Build internal MCP server limited by role."""
    registry = get_registry()
    tools = [
        tool for tool in registry.get_tools_for_role(role) if _is_internal_tool(registry, tool.name)
    ]

    logger.info("Building MCP server '%s' for role '%s' with %d tools", name, role, len(tools))

    return create_sdk_mcp_server(
        name=name,
        version=version,
        tools=tools,
    )


_server = None


def get_mcp_server():
    """Get or create default internal MCP server singleton."""
    global _server
    if _server is None:
        _server = build_mcp_server()
    return _server


def get_claude_mcp_servers() -> dict[str, Any]:
    """Get merged MCP server map for ClaudeAgentOptions.

    Includes:
    - internal `pathmind` SDK server
    - external MCP servers loaded from `mcp_servers.yaml` (if enabled)
    """
    servers: dict[str, Any] = {"pathmind": get_mcp_server()}

    try:
        from app.tools.external import get_external_mcp_manager

        external_servers = get_external_mcp_manager().get_claude_mcp_servers()
        for server_name, cfg in external_servers.items():
            if server_name == "pathmind":
                logger.warning(
                    "External MCP server id 'pathmind' conflicts with internal server, skipping"
                )
                continue
            servers[server_name] = cfg
    except Exception:
        logger.exception("Failed to merge external MCP servers")

    return servers
