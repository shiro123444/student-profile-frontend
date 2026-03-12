"""Dynamic custom tool loader — fetches user-created tools from Go API and registers them.

Custom tools are stored in the database (Go backend) and loaded at runtime.
Each tool's Python code runs in a restricted sandbox with limited builtins.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from claude_agent_sdk import SdkMcpTool, tool

from app.config import settings

logger = logging.getLogger(__name__)

GO_API = settings.go_backend_url

# Restricted builtins for custom tool execution
_SAFE_BUILTINS = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "filter": filter,
    "float": float,
    "frozenset": frozenset,
    "int": int,
    "isinstance": isinstance,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "print": print,
    "range": range,
    "reversed": reversed,
    "round": round,
    "set": set,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "type": type,
    "zip": zip,
    "None": None,
    "True": True,
    "False": False,
}

# Allowed imports for custom tools
_SAFE_MODULES = {"json", "math", "re", "datetime", "collections", "itertools", "functools"}


def _make_safe_import(name: str, *args, **kwargs):
    """Restricted __import__ that only allows safe modules."""
    if name not in _SAFE_MODULES:
        raise ImportError(f"Import of '{name}' is not allowed in custom tools")
    return __builtins__.__import__(name, *args, **kwargs) if hasattr(__builtins__, '__import__') else __import__(name, *args, **kwargs)


def _build_sandbox_globals() -> dict[str, Any]:
    """Build a restricted globals dict for exec()."""
    safe = {"__builtins__": {**_SAFE_BUILTINS, "__import__": _make_safe_import}}
    return safe


def _compile_custom_tool(tool_def: dict[str, Any]) -> SdkMcpTool | None:
    """Compile a custom tool definition into an SdkMcpTool.

    The tool code must define an async function `handler(args: dict) -> dict`
    that returns MCP-compatible content.
    """
    name = tool_def["name"]
    description = tool_def["description"]
    code = tool_def["code"]
    input_schema = tool_def.get("input_schema", {})

    if isinstance(input_schema, str):
        try:
            input_schema = json.loads(input_schema)
        except json.JSONDecodeError:
            input_schema = {}

    try:
        # Compile and exec in sandbox
        sandbox = _build_sandbox_globals()
        compiled = compile(code, f"<custom_tool:{name}>", "exec")
        exec(compiled, sandbox)

        # Extract the handler function
        handler_fn = sandbox.get("handler")
        if handler_fn is None:
            logger.error("Custom tool '%s' missing handler() function", name)
            return None

        # Wrap into @tool-compatible async handler
        async def tool_handler(args: dict[str, Any], _fn=handler_fn, _name=name) -> dict[str, Any]:
            try:
                import asyncio
                if asyncio.iscoroutinefunction(_fn):
                    result = await _fn(args)
                else:
                    result = _fn(args)

                # Normalize output
                if isinstance(result, dict) and "content" in result:
                    return result
                return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}
            except Exception as e:
                logger.exception("Custom tool '%s' execution error", _name)
                return {"content": [{"type": "text", "text": f"自定义工具执行失败: {e}"}], "is_error": True}

        # Create SdkMcpTool via @tool decorator
        return tool(name, description, input_schema)(tool_handler)

    except Exception:
        logger.exception("Failed to compile custom tool: %s", name)
        return None


async def fetch_custom_tools() -> list[SdkMcpTool]:
    """Fetch active+approved custom tools from Go backend and compile them."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GO_API}/internal/tools/active", timeout=10)
            resp.raise_for_status()
            tool_defs = resp.json()
    except Exception:
        logger.warning("Failed to fetch custom tools from Go backend — using builtin only")
        return []

    compiled = []
    for td in tool_defs:
        t = _compile_custom_tool(td)
        if t is not None:
            compiled.append(t)

    logger.info("Loaded %d custom tools from database", len(compiled))
    return compiled


def compile_tool_from_code(name: str, description: str, code: str, input_schema: dict | str = "{}") -> SdkMcpTool | None:
    """Compile a single custom tool from code string (for validation/preview)."""
    return _compile_custom_tool({
        "name": name,
        "description": description,
        "code": code,
        "input_schema": input_schema,
    })
