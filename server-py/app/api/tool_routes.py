"""Tool & skill registry routes — list packages/tools/skills and execute workflows."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.tools.registry import get_registry
from app.tools.skill_engine import SkillEngine, get_skill_registry

router = APIRouter()


# ── Tool routes ──


def _normalize_annotations(annotations: Any) -> dict[str, Any] | None:
    """Convert ToolAnnotations object to plain dict for JSON response."""
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


def _risk_level(annotations: dict[str, Any] | None) -> str:
    """Derive a simple risk level from MCP tool annotations."""
    if not annotations:
        return "unknown"
    if annotations.get("destructiveHint"):
        return "destructive"
    if annotations.get("readOnlyHint"):
        return "read_only"
    if annotations.get("openWorldHint"):
        return "open_world"
    if annotations.get("idempotentHint"):
        return "idempotent"
    return "unknown"


@router.get("/packages")
async def list_packages():
    """List all tool packages with metadata."""
    return get_registry().list_info()


@router.get("/list")
async def list_tools():
    """Flat list of all available tools grouped by package.

    Includes `tool_details` with description, annotations, risk and MCP metadata,
    while preserving legacy `tools` string list for backward compatibility.
    """
    registry = get_registry()
    tool_map = registry.get_tool_map()

    result: dict[str, Any] = {}
    for name, pkg in registry.get_packages().items():
        external_meta = pkg.manifest.get("external") or {}
        transport = str(external_meta.get("transport") or "").lower()
        external_openai_supported = transport in {"stdio", "sse", "http"}
        package_engine_support = ["claude", "openai"] if (
            pkg.source != "external" or external_openai_supported
        ) else ["claude"]

        details: list[dict[str, Any]] = []
        for tool_name in pkg.tool_names:
            tool_obj = tool_map.get(tool_name)
            annotations = _normalize_annotations(getattr(tool_obj, "annotations", None))
            details.append(
                {
                    "name": tool_name,
                    "description": getattr(tool_obj, "description", ""),
                    "annotations": annotations,
                    "risk_level": _risk_level(annotations),
                    "mcp_name": registry.get_mcp_tool_ref(tool_name),
                    "mcp_server": registry.get_tool_mcp_server(tool_name),
                    "engine_support": package_engine_support,
                }
            )

        result[name] = {
            "tools": pkg.tool_names,
            "tool_details": details,
            "category": pkg.manifest.get("category", ""),
            "source": pkg.source,
            "external": pkg.manifest.get("external"),
            "engine_support": package_engine_support,
        }
    return result


@router.get("/by-role/{role}")
async def tools_by_role(role: str):
    """List tool names accessible by a given role."""
    registry = get_registry()
    names = registry.get_tool_names_for_role(role)
    return {
        "role": role,
        "tools": names,
        "count": len(names),
    }


@router.get("/health")
async def tools_health():
    """Registry + external MCP health diagnostics."""
    return get_registry().health()


# ── Skill routes ──


class SkillExecuteRequest(BaseModel):
    skill_name: str
    params: dict = {}
    role: str = "student"


@router.get("/skills")
async def list_skills():
    """List all available skills."""
    return get_skill_registry().list_info()


@router.get("/skills/{name}")
async def get_skill(name: str):
    """Get skill definition details."""
    skill = get_skill_registry().get(name)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill not found: {name}")
    return {
        "name": skill.name,
        "description": skill.description,
        "category": skill.category,
        "source": skill.source,
        "input_schema": skill.input_schema,
        "steps": [
            {"id": s.id, "action": s.action, "tool": s.tool, "agent": s.agent}
            for s in skill.steps
        ],
    }


@router.post("/skills/execute")
async def execute_skill(request: SkillExecuteRequest):
    """Execute a skill workflow."""
    skill = get_skill_registry().get(request.skill_name)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill not found: {request.skill_name}")

    engine = SkillEngine()
    result = await engine.execute(skill, request.params, role=request.role)
    return result
