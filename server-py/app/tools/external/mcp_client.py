"""Lightweight MCP protocol client for external tool dispatch.

Supports three MCP transports:
  - stdio   : spawn a subprocess, communicate over stdin/stdout
  - sse     : connect via Server-Sent Events (older MCP HTTP+SSE transport)
  - http    : connect via streamable-HTTP (modern MCP transport)

Each call_* function opens a session per call and closes it afterward.
No persistent connection pooling — suitable for typical AI-agent workloads
where tool calls are infrequent relative to session lifetime.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT: float = 30.0


# ──────────────────────────────────────────────────────────────────
# Public call functions
# ──────────────────────────────────────────────────────────────────


async def call_mcp_tool_stdio(
    command: str,
    args: list[str],
    env: dict[str, str],
    tool_name: str,
    tool_args: dict[str, Any],
    timeout: float = _DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Call a tool on a stdio MCP server (subprocess transport)."""
    from mcp.client.stdio import stdio_client, StdioServerParameters
    from mcp import ClientSession

    # Merge provided env over the current process environment so the subprocess
    # inherits PATH etc. while getting server-specific vars.
    merged_env: dict[str, str] | None = {**os.environ, **env} if env else None

    params = StdioServerParameters(command=command, args=args or [], env=merged_env)
    try:
        async with asyncio.timeout(timeout):
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool(tool_name, tool_args or {})
    except TimeoutError:
        return {
            "error": f"MCP stdio tool '{tool_name}' timed out after {timeout}s",
            "is_error": True,
        }
    except Exception as exc:
        logger.warning(
            "MCP stdio call failed server_cmd=%s tool=%s: %s", command, tool_name, exc
        )
        return {"error": str(exc), "is_error": True}

    return _format_result(result, tool_name)


async def call_mcp_tool_sse(
    url: str,
    headers: dict[str, str],
    tool_name: str,
    tool_args: dict[str, Any],
    timeout: float = _DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Call a tool on an SSE MCP server (HTTP+SSE transport)."""
    from mcp.client.sse import sse_client
    from mcp import ClientSession

    try:
        async with asyncio.timeout(timeout):
            async with sse_client(
                url,
                headers=headers or None,
                timeout=min(timeout, 10),  # connect timeout; sse_read_timeout stays long
            ) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool(tool_name, tool_args or {})
    except TimeoutError:
        return {
            "error": f"MCP SSE tool '{tool_name}' timed out after {timeout}s",
            "is_error": True,
        }
    except Exception as exc:
        logger.warning(
            "MCP SSE call failed url=%s tool=%s: %s", url, tool_name, exc
        )
        return {"error": str(exc), "is_error": True}

    return _format_result(result, tool_name)


async def call_mcp_tool_http(
    url: str,
    headers: dict[str, str],
    tool_name: str,
    tool_args: dict[str, Any],
    timeout: float = _DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Call a tool on a streamable-HTTP MCP server (modern transport)."""
    from mcp.client.streamable_http import streamablehttp_client
    from mcp import ClientSession

    try:
        async with asyncio.timeout(timeout):
            async with streamablehttp_client(
                url,
                headers=headers or None,
                timeout=timeout,
            ) as (read, write, _get_session_id):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool(tool_name, tool_args or {})
    except TimeoutError:
        return {
            "error": f"MCP HTTP tool '{tool_name}' timed out after {timeout}s",
            "is_error": True,
        }
    except Exception as exc:
        logger.warning(
            "MCP HTTP call failed url=%s tool=%s: %s", url, tool_name, exc
        )
        return {"error": str(exc), "is_error": True}

    return _format_result(result, tool_name)


# ──────────────────────────────────────────────────────────────────
# Result formatting
# ──────────────────────────────────────────────────────────────────


def _format_result(result: Any, tool_name: str = "") -> dict[str, Any]:
    """Convert mcp.types.CallToolResult → plain dict.

    Prefers a flat ``{"result": text}`` shape for single-text responses so
    the model sees clean text rather than a list wrapper.
    """
    content = list(result.content) if result.content else []
    is_error = bool(getattr(result, "isError", False))

    text_parts = [block.text for block in content if hasattr(block, "text")]
    combined_text = "\n".join(text_parts) if text_parts else ""

    if is_error:
        return {
            "error": combined_text or f"MCP tool '{tool_name}' returned an error",
            "is_error": True,
        }

    # Single text block → flat result (most common case)
    if text_parts:
        return {"result": combined_text}

    # Non-text content (images, blobs, etc.)
    parts: list[dict[str, Any]] = []
    for block in content:
        if hasattr(block, "text"):
            parts.append({"type": "text", "text": block.text})
        elif hasattr(block, "data"):
            parts.append(
                {
                    "type": "image",
                    "data": block.data,
                    "mimeType": getattr(block, "mimeType", ""),
                }
            )
        elif hasattr(block, "blob"):
            parts.append(
                {
                    "type": "blob",
                    "blob": block.blob,
                    "mimeType": getattr(block, "mimeType", ""),
                }
            )
        else:
            parts.append({"type": type(block).__name__})

    return {"content": parts} if parts else {"result": ""}
