"""Runtime guards for cross-agent delegation."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass

from app.config import settings

_DEFAULT_WHITELIST: dict[str, set[str]] = {
    "quick-qa": {"document-reader", "career-advisor", "learning-coach", "mbti-analyst", "note-assistant"},
    "mbti-analyst": {"career-advisor", "learning-coach", "quick-qa"},
    "career-advisor": {"learning-coach", "document-reader", "graph-analyst", "quick-qa"},
    "learning-coach": {"document-reader", "note-assistant", "career-advisor", "quick-qa"},
    "note-assistant": {"document-reader", "learning-coach", "quick-qa"},
    "graph-analyst": {"document-reader", "career-advisor", "learning-coach"},
    "document-reader": {"quick-qa", "learning-coach", "note-assistant"},
    "command-center": {
        "note-assistant",
        "document-reader",
        "learning-coach",
        "career-advisor",
        "graph-analyst",
        "mbti-analyst",
        "quick-qa",
    },
}


@dataclass(slots=True)
class DelegationState:
    """Per-request delegation stack."""

    chain: list[str]


_ctx_var: ContextVar[DelegationState | None] = ContextVar(
    "agent_delegation_state",
    default=None,
)


def delegation_enabled() -> bool:
    """Whether cross-agent delegation is enabled globally."""
    return bool(settings.agent_delegation_enabled)


def max_delegation_depth() -> int:
    """Configured max delegation depth."""
    return max(1, min(int(settings.agent_delegation_max_depth), 5))


def allowed_targets_for(agent_name: str) -> set[str]:
    """Return delegation targets allowed for one source agent."""
    return set(_DEFAULT_WHITELIST.get(str(agent_name or "").strip(), set()))


def get_chain() -> list[str]:
    """Get current delegation chain."""
    state = _ctx_var.get()
    if state is None:
        return []
    return list(state.chain)


def format_chain(chain: list[str] | None = None) -> str:
    """Render delegation chain string."""
    items = chain if isinstance(chain, list) else get_chain()
    return " -> ".join(item for item in items if isinstance(item, str) and item.strip())


def _normalized_chain_for_source(source_agent: str) -> list[str]:
    source = str(source_agent or "").strip()
    if not source:
        return []

    chain = get_chain()
    if not chain:
        return [source]

    if chain[-1] == source:
        return chain

    if source in chain:
        idx = chain.index(source)
        return chain[: idx + 1]

    return [*chain, source]


def validate_delegation(
    *,
    source_agent: str,
    target_agent: str,
) -> tuple[bool, str, list[str]]:
    """Validate one delegation request and return normalized chain."""
    source = str(source_agent or "").strip()
    target = str(target_agent or "").strip()
    chain = _normalized_chain_for_source(source)

    if not delegation_enabled():
        return False, "delegation disabled", chain

    if not source:
        return False, "missing source agent", chain
    if not target:
        return False, "missing target agent", chain
    if source == target:
        return False, "self delegation is not allowed", chain

    depth = max(0, len(chain) - 1)
    if depth >= max_delegation_depth():
        return (
            False,
            f"max delegation depth reached ({depth}/{max_delegation_depth()})",
            chain,
        )

    if target in chain:
        cycle_chain = [*chain, target]
        return False, f"delegation cycle detected: {format_chain(cycle_chain)}", chain

    allowed = allowed_targets_for(source)
    if target not in allowed:
        allowed_text = ", ".join(sorted(allowed)) if allowed else "(none)"
        return (
            False,
            f"target '{target}' not allowed for '{source}', allowed: {allowed_text}",
            chain,
        )

    return True, "", chain


@contextmanager
def delegation_scope(source_agent: str, target_agent: str):
    """Push one delegation edge into context and reset afterwards."""
    source = str(source_agent or "").strip()
    target = str(target_agent or "").strip()
    base_chain = _normalized_chain_for_source(source)
    next_chain = [*base_chain, target]

    token: Token[DelegationState | None] = _ctx_var.set(DelegationState(chain=next_chain))
    try:
        yield next_chain
    finally:
        _ctx_var.reset(token)
