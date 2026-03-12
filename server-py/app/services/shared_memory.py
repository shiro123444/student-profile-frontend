"""SharedMemory — Redis-backed cross-agent context pool.

Each student has a lightweight summary pool shared across all agents.
When agent A finishes a conversation, a short summary is appended.
When agent B starts, it reads the pool and injects it into the system prompt.

Redis keys:
  pathmind:ctx:{student_id}   — JSON list of {agent, summary, ts}, TTL 24h
  pathmind:msgs:{agent}:{sid} — JSON list of OpenAI messages, TTL 2h
  pathmind:sessions:{sid}     — ZSET of session_id scored by updated_at, TTL 7d
  pathmind:session:{sid}:{id} — JSON session metadata, TTL 7d
  pathmind:graph_feedback:{sid} — JSON list of graph command ACK rows, TTL 4h
  pathmind:graph_batch_feedback:{sid} — JSON list of graph batch receipts, TTL 12h
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from app.db.redis import get_redis

logger = logging.getLogger(__name__)

_CTX_KEY = "pathmind:ctx:{sid}"
_MSGS_KEY = "pathmind:msgs:{agent}:{sid}"
_SESSION_INDEX_KEY = "pathmind:sessions:{sid}"
_SESSION_META_KEY = "pathmind:session:{sid}:{session_id}"
_GRAPH_FEEDBACK_KEY = "pathmind:graph_feedback:{sid}"
_GRAPH_BATCH_FEEDBACK_KEY = "pathmind:graph_batch_feedback:{sid}"

_CTX_TTL = 86400   # 24h
_MSGS_TTL = 7200   # 2h
_SESSION_TTL = 604800  # 7d
_GRAPH_FEEDBACK_TTL = 14400  # 4h
_GRAPH_BATCH_FEEDBACK_TTL = 43200  # 12h

_MAX_ENTRIES = 8   # max summary entries per student
_MAX_INJECT_CHARS = 400  # max chars injected into system prompt
_MAX_MESSAGES = 12  # max OpenAI messages stored per agent session
_MAX_SESSION_KEEP = 40  # max indexed sessions per student
_MAX_GRAPH_FEEDBACK_ENTRIES = 24
_MAX_GRAPH_FEEDBACK_INJECT_CHARS = 600
_MAX_GRAPH_BATCH_FEEDBACK_ENTRIES = 80


# ── Shared Context (cross-agent summaries) ──────────────────────────────────

async def get_context(student_id: str) -> str:
    """Return formatted shared context string to inject into system prompt."""
    r = await get_redis()
    if not r or not student_id:
        return ""
    try:
        raw = await r.get(_CTX_KEY.format(sid=student_id))
        if not raw:
            return ""
        entries: list[dict] = json.loads(raw)
        if not entries:
            return ""
        lines = [f"[{e['agent']}]: {e['summary']}" for e in entries[-_MAX_ENTRIES:]]
        text = "\n".join(lines)
        if len(text) > _MAX_INJECT_CHARS:
            text = text[-_MAX_INJECT_CHARS:]
        return f"\n\n--- 跨页面对话记忆 ---\n{text}\n---"
    except Exception:
        logger.debug("SharedMemory.get_context failed", exc_info=True)
        return ""


async def append_summary(student_id: str, agent_name: str, summary: str) -> None:
    """Append a short summary of the last exchange to the shared pool."""
    r = await get_redis()
    if not r or not student_id or not summary.strip():
        return
    try:
        key = _CTX_KEY.format(sid=student_id)
        raw = await r.get(key)
        entries: list[dict] = json.loads(raw) if raw else []
        entries.append({
            "agent": agent_name,
            "summary": summary[:120].strip(),
            "ts": int(time.time()),
        })
        entries = entries[-_MAX_ENTRIES:]
        await r.set(key, json.dumps(entries, ensure_ascii=False), ex=_CTX_TTL)
    except Exception:
        logger.debug("SharedMemory.append_summary failed", exc_info=True)


async def clear_context(student_id: str) -> None:
    """Clear the shared context pool for a student."""
    r = await get_redis()
    if not r or not student_id:
        return
    try:
        await r.delete(_CTX_KEY.format(sid=student_id))
    except Exception:
        logger.debug("SharedMemory.clear_context failed", exc_info=True)


# ── OpenAI Message History (per-agent session) ───────────────────────────────

async def load_messages(agent_name: str, student_id: str) -> list[dict[str, Any]]:
    """Load previous OpenAI messages for this agent+student session."""
    r = await get_redis()
    if not r or not student_id:
        return []
    try:
        key = _MSGS_KEY.format(agent=agent_name, sid=student_id)
        raw = await r.get(key)
        if not raw:
            return []
        return json.loads(raw)
    except Exception:
        logger.debug("SharedMemory.load_messages failed", exc_info=True)
        return []


async def save_messages(
    agent_name: str, student_id: str, messages: list[dict[str, Any]]
) -> None:
    """Save OpenAI messages for this agent+student session (excludes system msg)."""
    r = await get_redis()
    if not r or not student_id:
        return
    try:
        non_system = [m for m in messages if m.get("role") != "system"]
        non_system = non_system[-_MAX_MESSAGES:]
        key = _MSGS_KEY.format(agent=agent_name, sid=student_id)
        await r.set(key, json.dumps(non_system, ensure_ascii=False), ex=_MSGS_TTL)
    except Exception:
        logger.debug("SharedMemory.save_messages failed", exc_info=True)


async def clear_messages(agent_name: str, student_id: str) -> None:
    """Clear OpenAI message history for this agent+student."""
    r = await get_redis()
    if not r or not student_id:
        return
    try:
        await r.delete(_MSGS_KEY.format(agent=agent_name, sid=student_id))
    except Exception:
        logger.debug("SharedMemory.clear_messages failed", exc_info=True)


# ── Session Index (cross-engine) ─────────────────────────────────────────────

async def upsert_session(
    student_id: str,
    session_id: str,
    agent_name: str,
    engine: str,
    model: str,
    mode: str,
    prompt: str = "",
    summary: str = "",
    cost_usd: float = 0.0,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> None:
    """Create/update a session metadata record for list/restore/clear UI."""
    r = await get_redis()
    if not r or not student_id or not session_id:
        return

    now_ts = int(time.time())
    payload = {
        "session_id": session_id,
        "agent_name": agent_name,
        "engine": engine,
        "model": model,
        "mode": mode,
        "last_prompt": (prompt or "").strip()[:160],
        "last_summary": (summary or "").strip()[:200],
        "total_cost_usd": float(cost_usd or 0.0),
        "total_input_tokens": int(input_tokens or 0),
        "total_output_tokens": int(output_tokens or 0),
        "updated_at": now_ts,
    }

    index_key = _SESSION_INDEX_KEY.format(sid=student_id)
    meta_key = _SESSION_META_KEY.format(sid=student_id, session_id=session_id)

    try:
        await r.set(meta_key, json.dumps(payload, ensure_ascii=False), ex=_SESSION_TTL)
        await r.zadd(index_key, {session_id: now_ts})
        await r.expire(index_key, _SESSION_TTL)

        total = await r.zcard(index_key)
        if total > _MAX_SESSION_KEEP:
            trim_count = total - _MAX_SESSION_KEEP
            stale_ids = await r.zrange(index_key, 0, trim_count - 1)
            if stale_ids:
                stale_meta_keys = [
                    _SESSION_META_KEY.format(sid=student_id, session_id=sid)
                    for sid in stale_ids
                ]
                await r.delete(*stale_meta_keys)
                await r.zrem(index_key, *stale_ids)
    except Exception:
        logger.debug("SharedMemory.upsert_session failed", exc_info=True)


async def list_sessions(student_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """List most-recent sessions for the student."""
    r = await get_redis()
    if not r or not student_id:
        return []

    safe_limit = max(1, min(limit, 100))
    index_key = _SESSION_INDEX_KEY.format(sid=student_id)

    try:
        session_ids = await r.zrevrange(index_key, 0, safe_limit - 1)
        if not session_ids:
            return []

        meta_keys = [
            _SESSION_META_KEY.format(sid=student_id, session_id=sid)
            for sid in session_ids
        ]
        raw_values = await r.mget(meta_keys)

        sessions: list[dict[str, Any]] = []
        stale_ids: list[str] = []

        for sid, raw in zip(session_ids, raw_values, strict=False):
            if not raw:
                stale_ids.append(sid)
                continue
            try:
                item = json.loads(raw)
                if isinstance(item, dict):
                    sessions.append(item)
            except Exception:
                stale_ids.append(sid)

        if stale_ids:
            await r.zrem(index_key, *stale_ids)

        sessions.sort(key=lambda x: int(x.get("updated_at", 0)), reverse=True)
        return sessions
    except Exception:
        logger.debug("SharedMemory.list_sessions failed", exc_info=True)
        return []


async def clear_sessions(student_id: str, session_id: str | None = None) -> int:
    """Clear one session or all sessions for the student. Returns clear count."""
    r = await get_redis()
    if not r or not student_id:
        return 0

    index_key = _SESSION_INDEX_KEY.format(sid=student_id)

    try:
        if session_id:
            meta_key = _SESSION_META_KEY.format(sid=student_id, session_id=session_id)
            await r.delete(meta_key)
            await r.zrem(index_key, session_id)
            return 1

        all_ids = await r.zrange(index_key, 0, -1)
        if all_ids:
            meta_keys = [
                _SESSION_META_KEY.format(sid=student_id, session_id=sid)
                for sid in all_ids
            ]
            await r.delete(*meta_keys)
        await r.delete(index_key)
        return len(all_ids)
    except Exception:
        logger.debug("SharedMemory.clear_sessions failed", exc_info=True)
        return 0


# ── Graph Command Feedback (frontend execution ACK) ─────────────────────────

def _normalize_graph_feedback_entry(
    *,
    agent_name: str,
    session_id: str | None,
    source: str | None,
    item: dict[str, Any],
) -> dict[str, Any]:
    command = str(item.get("command") or "").strip()[:64]
    target = str(item.get("target") or "").strip()[:120]
    status = str(item.get("status") or "ignored").strip().lower()
    if status not in {"success", "ignored", "error"}:
        status = "ignored"
    success = bool(item.get("success"))
    message = str(item.get("message") or "").strip()[:220]
    issued_at = item.get("issued_at") or item.get("issuedAt")
    executed_at = item.get("executed_at") or item.get("executedAt")
    params = item.get("params")
    if not isinstance(params, dict):
        params = {}

    return {
        "agent": (agent_name or "graph-analyst").strip()[:48],
        "session_id": str(session_id or "").strip()[:128],
        "source": str(source or "graph_ui").strip()[:48],
        "command": command,
        "target": target,
        "status": status,
        "success": success,
        "message": message,
        "issued_at": int(issued_at) if isinstance(issued_at, (int, float)) else 0,
        "executed_at": int(executed_at) if isinstance(executed_at, (int, float)) else 0,
        "params": params,
        "ts": int(time.time()),
    }


async def append_graph_feedback(
    student_id: str,
    *,
    agent_name: str,
    session_id: str | None,
    source: str | None,
    items: list[dict[str, Any]],
) -> int:
    """Append frontend graph command execution feedback for later prompt injection."""
    r = await get_redis()
    if not r or not student_id or not items:
        return 0

    key = _GRAPH_FEEDBACK_KEY.format(sid=student_id)
    try:
        raw = await r.get(key)
        entries: list[dict[str, Any]] = json.loads(raw) if raw else []
        accepted = 0

        for item in items[:_MAX_GRAPH_FEEDBACK_ENTRIES]:
            if not isinstance(item, dict):
                continue
            normalized = _normalize_graph_feedback_entry(
                agent_name=agent_name,
                session_id=session_id,
                source=source,
                item=item,
            )
            if not normalized.get("command"):
                continue
            entries.append(normalized)
            accepted += 1

        if accepted == 0:
            return 0

        entries = entries[-_MAX_GRAPH_FEEDBACK_ENTRIES:]
        await r.set(key, json.dumps(entries, ensure_ascii=False), ex=_GRAPH_FEEDBACK_TTL)
        return accepted
    except Exception:
        logger.debug("SharedMemory.append_graph_feedback failed", exc_info=True)
        return 0


async def get_graph_feedback_context(
    student_id: str,
    *,
    agent_name: str | None = None,
    session_id: str | None = None,
) -> str:
    """Return compact graph command feedback context for model prompt."""
    r = await get_redis()
    if not r or not student_id:
        return ""

    key = _GRAPH_FEEDBACK_KEY.format(sid=student_id)
    try:
        raw = await r.get(key)
        if not raw:
            return ""
        entries: list[dict[str, Any]] = json.loads(raw)
        if not entries:
            return ""

        filtered = [e for e in entries if isinstance(e, dict)]
        if agent_name:
            target_agent = agent_name.strip()
            filtered = [e for e in filtered if str(e.get("agent") or "") == target_agent]
        if session_id:
            target_session = session_id.strip()
            session_hits = [e for e in filtered if str(e.get("session_id") or "") == target_session]
            if session_hits:
                filtered = session_hits

        if not filtered:
            return ""

        recent = filtered[-8:]
        lines: list[str] = []
        for item in recent:
            status = str(item.get("status") or "ignored")
            command = str(item.get("command") or "graph_command")
            target = str(item.get("target") or "").strip()
            message = str(item.get("message") or "").strip()
            line = f"[{status}] {command}"
            if target:
                line += f"({target})"
            if message:
                line += f": {message}"
            lines.append(line)

        text = "\n".join(lines)
        if len(text) > _MAX_GRAPH_FEEDBACK_INJECT_CHARS:
            text = text[-_MAX_GRAPH_FEEDBACK_INJECT_CHARS:]
        return f"\n\n--- 图谱命令执行回执 ---\n{text}\n---"
    except Exception:
        logger.debug("SharedMemory.get_graph_feedback_context failed", exc_info=True)
        return ""


async def list_graph_feedback(
    student_id: str,
    *,
    agent_name: str | None = None,
    session_id: str | None = None,
    status: str | None = None,
    command: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List graph command feedback entries for diagnostics/timeline UI."""
    r = await get_redis()
    if not r or not student_id:
        return []

    safe_limit = max(1, min(int(limit or 50), 200))
    key = _GRAPH_FEEDBACK_KEY.format(sid=student_id)

    try:
        raw = await r.get(key)
        if not raw:
            return []
        entries: list[dict[str, Any]] = json.loads(raw)
        if not entries:
            return []

        filtered = [e for e in entries if isinstance(e, dict)]
        if agent_name:
            target_agent = agent_name.strip()
            filtered = [e for e in filtered if str(e.get("agent") or "") == target_agent]
        if session_id:
            target_session = session_id.strip()
            filtered = [e for e in filtered if str(e.get("session_id") or "") == target_session]
        if status:
            target_status = status.strip().lower()
            filtered = [e for e in filtered if str(e.get("status") or "").strip().lower() == target_status]
        if command:
            target_command = command.strip().lower()
            filtered = [
                e for e in filtered
                if target_command in str(e.get("command") or "").strip().lower()
            ]

        filtered.sort(
            key=lambda item: int(item.get("executed_at") or item.get("issued_at") or item.get("ts") or 0),
            reverse=True,
        )
        return filtered[:safe_limit]
    except Exception:
        logger.debug("SharedMemory.list_graph_feedback failed", exc_info=True)
        return []


# ── Graph Batch Feedback (batch-level audit receipts) ───────────────────────

def _normalize_graph_batch_feedback_entry(
    *,
    agent_name: str,
    session_id: str | None,
    source: str | None,
    item: dict[str, Any],
) -> dict[str, Any]:
    batch_id = str(item.get("batch_id") or item.get("batchId") or "").strip()[:96]
    mode = str(item.get("mode") or "best_effort").strip().lower()
    if mode not in {"best_effort", "all_or_nothing"}:
        mode = "best_effort"
    status = str(item.get("status") or "failed").strip().lower()
    if status not in {"running", "success", "partial", "failed"}:
        status = "failed"
    completed = item.get("completed")
    total = item.get("total")
    started_at = item.get("started_at") or item.get("startedAt")
    finished_at = item.get("finished_at") or item.get("finishedAt")
    rolled_back = item.get("rolled_back") or item.get("rolledBack")
    rollback_failed = item.get("rollback_failed") or item.get("rollbackFailed")
    message = str(item.get("message") or "").strip()[:280]

    return {
        "agent": (agent_name or "graph-analyst").strip()[:48],
        "session_id": str(session_id or "").strip()[:128],
        "source": str(source or "graph_ui").strip()[:48],
        "batch_id": batch_id,
        "mode": mode,
        "status": status,
        "completed": int(completed) if isinstance(completed, (int, float)) else 0,
        "total": int(total) if isinstance(total, (int, float)) else 0,
        "rolled_back": int(rolled_back) if isinstance(rolled_back, (int, float)) else 0,
        "rollback_failed": int(rollback_failed) if isinstance(rollback_failed, (int, float)) else 0,
        "started_at": int(started_at) if isinstance(started_at, (int, float)) else 0,
        "finished_at": int(finished_at) if isinstance(finished_at, (int, float)) else 0,
        "message": message,
        "ts": int(time.time()),
    }


async def append_graph_batch_feedback(
    student_id: str,
    *,
    agent_name: str,
    session_id: str | None,
    source: str | None,
    item: dict[str, Any],
) -> int:
    """Append frontend graph batch execution receipt for timeline/audit."""
    r = await get_redis()
    if not r or not student_id or not isinstance(item, dict):
        return 0

    key = _GRAPH_BATCH_FEEDBACK_KEY.format(sid=student_id)
    try:
        raw = await r.get(key)
        entries: list[dict[str, Any]] = json.loads(raw) if raw else []

        normalized = _normalize_graph_batch_feedback_entry(
            agent_name=agent_name,
            session_id=session_id,
            source=source,
            item=item,
        )
        if not normalized.get("batch_id"):
            return 0

        entries.append(normalized)
        entries = entries[-_MAX_GRAPH_BATCH_FEEDBACK_ENTRIES:]
        await r.set(key, json.dumps(entries, ensure_ascii=False), ex=_GRAPH_BATCH_FEEDBACK_TTL)
        return 1
    except Exception:
        logger.debug("SharedMemory.append_graph_batch_feedback failed", exc_info=True)
        return 0


async def list_graph_batch_feedback(
    student_id: str,
    *,
    agent_name: str | None = None,
    session_id: str | None = None,
    status: str | None = None,
    before_ts: int | None = None,
    limit: int = 50,
) -> tuple[list[dict[str, Any]], int | None]:
    """List graph batch feedback entries for diagnostics/audit UI."""
    r = await get_redis()
    if not r or not student_id:
        return [], None

    safe_limit = max(1, min(int(limit or 50), 200))
    key = _GRAPH_BATCH_FEEDBACK_KEY.format(sid=student_id)

    try:
        raw = await r.get(key)
        if not raw:
            return [], None
        entries: list[dict[str, Any]] = json.loads(raw)
        if not entries:
            return [], None

        filtered = [e for e in entries if isinstance(e, dict)]
        if agent_name:
            target_agent = agent_name.strip()
            filtered = [e for e in filtered if str(e.get("agent") or "") == target_agent]
        if session_id:
            target_session = session_id.strip()
            filtered = [e for e in filtered if str(e.get("session_id") or "") == target_session]
        if status:
            target_status = status.strip().lower()
            filtered = [e for e in filtered if str(e.get("status") or "").strip().lower() == target_status]
        if isinstance(before_ts, (int, float)) and int(before_ts) > 0:
            cursor = int(before_ts)
            filtered = [
                e for e in filtered
                if int(e.get("finished_at") or e.get("started_at") or e.get("ts") or 0) < cursor
            ]

        filtered.sort(
            key=lambda item: int(item.get("finished_at") or item.get("started_at") or item.get("ts") or 0),
            reverse=True,
        )
        has_more = len(filtered) > safe_limit
        sliced = filtered[:safe_limit]
        next_before_ts: int | None = None
        if has_more and sliced:
            tail = sliced[-1]
            next_before_ts = int(tail.get("finished_at") or tail.get("started_at") or tail.get("ts") or 0) or None
        return sliced, next_before_ts
    except Exception:
        logger.debug("SharedMemory.list_graph_batch_feedback failed", exc_info=True)
        return [], None
