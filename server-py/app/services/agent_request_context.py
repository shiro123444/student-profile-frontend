"""Per-request context shared across engines/tools for audit and approval."""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass


@dataclass(slots=True)
class AgentRequestContext:
    agent_name: str = ""
    student_id: str = ""
    role: str = "student"
    session_id: str = ""
    engine: str = ""
    mode: str = "balanced"


_default_ctx = AgentRequestContext()
_ctx_var: ContextVar[AgentRequestContext] = ContextVar("agent_request_context", default=_default_ctx)


def set_agent_request_context(ctx: AgentRequestContext) -> Token[AgentRequestContext]:
    return _ctx_var.set(ctx)


def reset_agent_request_context(token: Token[AgentRequestContext]) -> None:
    _ctx_var.reset(token)


def get_agent_request_context() -> AgentRequestContext:
    return _ctx_var.get()
