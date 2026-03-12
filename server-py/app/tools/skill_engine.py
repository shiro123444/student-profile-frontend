"""Skill engine — executes YAML-defined workflows that chain tools and agent calls.

A skill is a reusable workflow defined in YAML:

    name: career-exploration
    description: 探索职业方向并生成学习路径
    steps:
      - id: profile
        action: tool
        tool: get_student_profile
        input: { student_id: "{{student_id}}" }

      - id: mbti
        action: tool
        tool: get_mbti_type_info
        input: { mbti_code: "{{profile.mbti_type}}" }

      - id: careers
        action: tool
        tool: search_careers
        input: { mbti_code: "{{profile.mbti_type}}", limit: 5 }

      - id: summary
        action: agent
        agent: quick-qa
        prompt: |
          根据以下信息为学生推荐职业方向:
          MBTI: {{mbti.result}}
          推荐职业: {{careers.result}}
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

# Template variable pattern: {{variable}} or {{step_id.field}}
_VAR_PATTERN = re.compile(r"\{\{(.+?)\}\}")


class SkillStep:
    """A single step in a skill workflow."""

    def __init__(self, step_def: dict[str, Any]):
        self.id: str = step_def["id"]
        self.action: str = step_def["action"]  # "tool" or "agent"
        self.tool: str | None = step_def.get("tool")
        self.agent: str | None = step_def.get("agent")
        self.input: dict[str, Any] = step_def.get("input", {})
        self.prompt: str | None = step_def.get("prompt")
        self.condition: str | None = step_def.get("condition")  # optional skip condition


class SkillDefinition:
    """Parsed skill definition from YAML."""

    def __init__(self, data: dict[str, Any], source: str = "builtin"):
        self.name: str = data["name"]
        self.description: str = data.get("description", "")
        self.category: str = data.get("category", "general")
        self.steps: list[SkillStep] = [SkillStep(s) for s in data.get("steps", [])]
        self.input_schema: dict = data.get("input_schema", {})
        self.source = source

    @classmethod
    def from_yaml(cls, path: Path, source: str = "builtin") -> SkillDefinition:
        with open(path, encoding="utf-8") as f:
            return cls(yaml.safe_load(f), source=source)

    @classmethod
    def from_string(cls, yaml_str: str, source: str = "custom") -> SkillDefinition:
        return cls(yaml.safe_load(yaml_str), source=source)


def _resolve_template(template: str, context: dict[str, Any]) -> str:
    """Replace {{var}} placeholders with values from context."""

    def replacer(match: re.Match) -> str:
        key = match.group(1).strip()
        parts = key.split(".")
        value = context
        for part in parts:
            if isinstance(value, dict):
                value = value.get(part, f"{{{{MISSING:{key}}}}}")
            else:
                return f"{{{{MISSING:{key}}}}}"
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)

    return _VAR_PATTERN.sub(replacer, template)


def _resolve_input(input_def: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Resolve all template variables in a step's input dict."""
    resolved = {}
    for k, v in input_def.items():
        if isinstance(v, str):
            resolved[k] = _resolve_template(v, context)
        elif isinstance(v, dict):
            resolved[k] = _resolve_input(v, context)
        else:
            resolved[k] = v
    return resolved


class SkillEngine:
    """Executes skill workflows step by step."""

    def __init__(self):
        from app.tools.registry import get_registry

        self._registry = get_registry()

    async def execute(
        self,
        skill: SkillDefinition,
        params: dict[str, Any],
        role: str = "student",
    ) -> dict[str, Any]:
        """Execute a skill workflow and return all step results.

        Returns:
            {
                "skill": skill.name,
                "steps": { step_id: result, ... },
                "final": last_step_result,
            }
        """
        # Context holds input params + step results
        context = {**params}
        step_results: dict[str, Any] = {}

        for step in skill.steps:
            # Check optional condition
            if step.condition:
                cond_resolved = _resolve_template(step.condition, context)
                if cond_resolved.lower() in ("false", "none", "", "0"):
                    logger.info("Skipping step '%s' — condition not met", step.id)
                    step_results[step.id] = None
                    continue

            try:
                if step.action == "tool":
                    result = await self._execute_tool_step(step, context, role)
                elif step.action == "agent":
                    result = await self._execute_agent_step(step, context, role)
                else:
                    logger.warning("Unknown action '%s' in step '%s'", step.action, step.id)
                    result = {"error": f"unknown action: {step.action}"}

                step_results[step.id] = result
                context[step.id] = result

            except Exception as e:
                logger.exception("Step '%s' failed", step.id)
                step_results[step.id] = {"error": str(e)}
                context[step.id] = {"error": str(e)}

        # Final result is the last step
        final = step_results.get(skill.steps[-1].id) if skill.steps else None

        return {
            "skill": skill.name,
            "steps": step_results,
            "final": final,
        }

    async def _execute_tool_step(
        self, step: SkillStep, context: dict[str, Any], role: str
    ) -> Any:
        """Execute a tool call step."""
        tool_name = step.tool
        if not tool_name:
            raise ValueError(f"Step '{step.id}' missing 'tool' field")

        tool_map = self._registry.get_tool_map()
        tool_obj = tool_map.get(tool_name)
        if tool_obj is None:
            raise ValueError(f"Tool '{tool_name}' not found in registry")

        # Check permission
        from app.tools.permissions import get_permission_manager

        pm = get_permission_manager()
        allowed = pm.get_allowed_tools(role)
        if tool_name not in allowed:
            raise PermissionError(f"Role '{role}' cannot use tool '{tool_name}'")

        # Resolve input
        resolved_input = _resolve_input(step.input, context)

        # Call the tool handler
        result = await tool_obj.handler(resolved_input)

        # Extract text content if MCP format
        if isinstance(result, dict) and "content" in result:
            contents = result["content"]
            if isinstance(contents, list) and len(contents) == 1:
                return contents[0].get("text", contents[0])
            return contents

        return result

    async def _execute_agent_step(
        self, step: SkillStep, context: dict[str, Any], role: str
    ) -> str:
        """Execute an agent query step."""
        agent_name = step.agent or "quick-qa"
        prompt = step.prompt or ""
        resolved_prompt = _resolve_template(prompt, context)

        from app.services import AgentService

        service = AgentService()
        result = await service.query(
            agent_name=agent_name,
            prompt=resolved_prompt,
            role=role,
        )
        return result.get("response", "")


# ── Skill Registry ──────────────────────────────────────

_BUILTIN_DIR = Path(__file__).parent / "skills"


class SkillRegistry:
    """Discovers and manages skill definitions."""

    def __init__(self):
        self._skills: dict[str, SkillDefinition] = {}

    def scan(self):
        """Scan builtin skills directory."""
        if _BUILTIN_DIR.is_dir():
            for path in sorted(_BUILTIN_DIR.glob("*.yaml")):
                try:
                    skill = SkillDefinition.from_yaml(path, source="builtin")
                    self._skills[skill.name] = skill
                    logger.info("Loaded builtin skill: %s", skill.name)
                except Exception:
                    logger.exception("Failed to load skill: %s", path.name)

        logger.info("Skill registry: %d skills loaded", len(self._skills))

    def register(self, skill: SkillDefinition):
        """Register a skill (e.g., from database)."""
        self._skills[skill.name] = skill

    def get(self, name: str) -> SkillDefinition | None:
        return self._skills.get(name)

    def list_all(self) -> dict[str, SkillDefinition]:
        return dict(self._skills)

    def list_info(self) -> list[dict[str, str]]:
        return [
            {
                "name": s.name,
                "description": s.description,
                "category": s.category,
                "steps": len(s.steps),
                "source": s.source,
            }
            for s in self._skills.values()
        ]


_skill_registry: SkillRegistry | None = None


def get_skill_registry() -> SkillRegistry:
    global _skill_registry
    if _skill_registry is None:
        _skill_registry = SkillRegistry()
        _skill_registry.scan()
    return _skill_registry
