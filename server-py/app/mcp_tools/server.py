"""Backward-compatible shim — delegates to new app.tools system.

Existing code that imports `from app.mcp_tools.server import pathmind_mcp_server`
will continue to work. New code should use `app.tools.server` directly.
"""

from __future__ import annotations


def __getattr__(name: str):
    if name == "pathmind_mcp_server":
        from app.tools.server import get_mcp_server

        return get_mcp_server()
    if name == "ALL_TOOLS":
        from app.tools.registry import get_registry

        return get_registry().get_all_tools()
    if name == "TOOL_MAP":
        from app.tools.registry import get_registry

        return get_registry().get_tool_map()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
