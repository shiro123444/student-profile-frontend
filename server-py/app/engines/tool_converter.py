"""Tool format conversion: ToolRegistry ↔ ToolDef ↔ OpenAI function calling."""

from __future__ import annotations

from typing import Any

from app.engines.base import ToolDef


def _schema_includes_key(schema: Any, key: str) -> bool:
    if not isinstance(schema, dict):
        return False

    if key in schema:
        return True

    properties = schema.get("properties")
    if isinstance(properties, dict) and key in properties:
        return True

    required = schema.get("required")
    if isinstance(required, list) and key in required:
        return True

    return False


def _inject_runtime_defaults(args: Any, schema: Any) -> dict[str, Any]:
    """Inject request-scoped defaults (e.g. student_id) into tool args.

    Many internal tools require ``student_id``. Models occasionally omit it
    despite prompt hints, which previously caused tool loops and degraded UX.
    """
    from app.services.agent_request_context import get_agent_request_context

    payload: dict[str, Any]
    if isinstance(args, dict):
        payload = dict(args)
    else:
        payload = {}

    request_ctx = get_agent_request_context()
    student_id = (request_ctx.student_id or "").strip()
    if student_id and _schema_includes_key(schema, "student_id"):
        current = payload.get("student_id")
        if not isinstance(current, str) or not current.strip():
            payload["student_id"] = student_id

    return payload


def _wrap_tool_handler(handler: Any, schema: Any):
    if handler is None:
        return None

    async def _wrapped(args: dict[str, Any]) -> dict[str, Any]:
        normalized_args = _inject_runtime_defaults(args, schema)
        return await handler(normalized_args)

    return _wrapped


def build_tool_defs(agent_tools: list[str]) -> list[ToolDef]:
    """Convert agent's tool name list → ToolDef list (with handler refs)."""
    from app.tools.registry import get_registry

    registry = get_registry()
    tool_map = registry.get_tool_map()

    defs: list[ToolDef] = []
    for name in agent_tools:
        sdk_tool = tool_map.get(name)
        if sdk_tool is None:
            continue
        input_schema = getattr(sdk_tool, "input_schema", {})
        wrapped_handler = _wrap_tool_handler(getattr(sdk_tool, "handler", None), input_schema)
        defs.append(
            ToolDef(
                name=sdk_tool.name,
                description=getattr(sdk_tool, "description", ""),
                input_schema=input_schema,
                handler=wrapped_handler,
            )
        )
    return defs


def _normalize_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Normalize shorthand tool schemas to valid JSON Schema.

    Claude SDK accepts shorthand like {"mbti_code": str}, but OpenAI
    function calling needs proper JSON Schema with "type": "string" etc.
    """
    if not schema:
        return {"type": "object", "properties": {}}

    # Already a proper JSON Schema (has "type" or "properties" key)
    if "type" in schema or "properties" in schema:
        return schema

    # Shorthand: {"key": str, "key2": int} or {"key": {"type": "string"}} → JSON Schema
    type_map = {str: "string", int: "integer", float: "number", bool: "boolean"}
    properties = {}
    for key, val in schema.items():
        if isinstance(val, dict):
            properties[key] = val
        elif val in type_map:
            properties[key] = {"type": type_map[val]}
        else:
            properties[key] = {"type": "string"}

    return {
        "type": "object",
        "properties": properties,
        "required": list(properties.keys()),
    }


def to_openai_function(tool: ToolDef) -> dict[str, Any]:
    """ToolDef → OpenAI function calling format."""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": _normalize_schema(tool.input_schema or {}),
        },
    }


# ── Escalation tool (injected into OpenAI engine) ──

ESCALATE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "escalate_to_claude",
        "description": (
            "当前问题需要更深度的推理、多步分析或复杂工具编排时，升级到 Claude 大模型处理。"
            "适用场景：复杂职业规划、深度 MBTI 分析、多工具协作任务。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "升级原因",
                },
            },
            "required": ["reason"],
        },
    },
}
