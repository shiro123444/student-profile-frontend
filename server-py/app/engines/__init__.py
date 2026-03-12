"""Engine factory — creates the right engine for each agent."""

from __future__ import annotations

from app.agents.registry import AgentDef
from app.engines.base import BaseEngine


class EngineFactory:
    """Select engine based on AgentDef.engine field."""

    @staticmethod
    def create(agent: AgentDef) -> BaseEngine:
        engine = getattr(agent, "engine", "claude")

        if engine == "openai":
            from app.engines.openai_engine import OpenAIEngine

            model = getattr(agent, "engine_model", None)
            return OpenAIEngine(model=model)

        if engine == "claude_legacy":
            # Explicit opt-in to old CLI-subprocess path
            from app.engines.claude_engine import ClaudeEngine

            return ClaudeEngine(model_tier=agent.model)

        # Default: anthropic direct HTTP (no CLI subprocess)
        from app.engines.anthropic_engine import AnthropicDirectEngine

        return AnthropicDirectEngine(model_tier=agent.model)
