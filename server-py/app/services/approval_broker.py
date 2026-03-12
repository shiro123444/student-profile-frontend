"""In-memory approval broker for high-risk tool calls."""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.services.coding_policy import get_approval_timeout_sec


EventSink = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass(slots=True)
class ApprovalPending:
    request_id: str
    tool: str
    risk: str
    args_preview: dict[str, Any]
    created_at: float
    timeout_sec: int
    future: asyncio.Future[tuple[bool, str]]


@dataclass(slots=True)
class ApprovalMetrics:
    total_requests: int = 0
    approved: int = 0
    rejected: int = 0
    timed_out: int = 0
    total_wait_ms: int = 0


class ApprovalBroker:
    """Tracks pending approval requests and decisions."""

    def __init__(self):
        self._pending: dict[str, ApprovalPending] = {}
        self._metrics = ApprovalMetrics()
        self._lock = asyncio.Lock()

    async def request_approval(
        self,
        *,
        tool: str,
        risk: str,
        args_preview: dict[str, Any],
        timeout_sec: int | None = None,
        event_sink: EventSink | None = None,
    ) -> tuple[bool, str, str]:
        """Create an approval request and wait for decision."""
        safe_timeout = timeout_sec if isinstance(timeout_sec, int) else get_approval_timeout_sec()
        safe_timeout = max(5, min(int(safe_timeout), 300))

        request_id = str(uuid.uuid4())
        future: asyncio.Future[tuple[bool, str]] = asyncio.get_running_loop().create_future()

        pending = ApprovalPending(
            request_id=request_id,
            tool=tool,
            risk=risk,
            args_preview=args_preview,
            created_at=time.time(),
            timeout_sec=safe_timeout,
            future=future,
        )

        async with self._lock:
            self._pending[request_id] = pending

        if event_sink is not None:
            await event_sink(
                {
                    "type": "approval_request",
                    "id": request_id,
                    "tool": tool,
                    "risk": risk,
                    "args_preview": args_preview,
                    "timeout_sec": safe_timeout,
                }
            )

        approved = False
        reason = "timeout"
        timed_out = False
        try:
            approved, reason = await asyncio.wait_for(future, timeout=safe_timeout)
        except TimeoutError:
            approved = False
            reason = "审批超时，默认拒绝"
            timed_out = True
        finally:
            wait_ms = max(0, int((time.time() - pending.created_at) * 1000))
            await self._cleanup(request_id)
            await self._record_metrics(
                approved=bool(approved),
                timed_out=timed_out,
                wait_ms=wait_ms,
            )
            if event_sink is not None:
                await event_sink(
                    {
                        "type": "approval_result",
                        "id": request_id,
                        "tool": tool,
                        "risk": risk,
                        "approved": bool(approved),
                        "reason": reason,
                    }
                )

        return bool(approved), reason, request_id

    async def approve(self, request_id: str, reason: str = "approved") -> bool:
        """Approve a pending request."""
        pending = self._pending.get(request_id)
        if pending is None:
            return False
        if not pending.future.done():
            pending.future.set_result((True, reason))
        return True

    async def reject(self, request_id: str, reason: str = "rejected") -> bool:
        """Reject a pending request."""
        pending = self._pending.get(request_id)
        if pending is None:
            return False
        if not pending.future.done():
            pending.future.set_result((False, reason))
        return True

    async def metrics(self) -> dict[str, Any]:
        """Return aggregated approval metrics snapshot."""
        async with self._lock:
            total = self._metrics.total_requests
            avg_wait_ms = (self._metrics.total_wait_ms / total) if total > 0 else 0.0
            return {
                "pending": len(self._pending),
                "total_requests": total,
                "approved": self._metrics.approved,
                "rejected": self._metrics.rejected,
                "timed_out": self._metrics.timed_out,
                "avg_wait_ms": round(avg_wait_ms, 2),
            }

    async def _record_metrics(self, *, approved: bool, timed_out: bool, wait_ms: int) -> None:
        async with self._lock:
            self._metrics.total_requests += 1
            self._metrics.total_wait_ms += max(0, int(wait_ms))

            if approved:
                self._metrics.approved += 1
            else:
                self._metrics.rejected += 1
                if timed_out:
                    self._metrics.timed_out += 1

    async def _cleanup(self, request_id: str) -> None:
        async with self._lock:
            self._pending.pop(request_id, None)


_broker: ApprovalBroker | None = None


def get_approval_broker() -> ApprovalBroker:
    global _broker
    if _broker is None:
        _broker = ApprovalBroker()
    return _broker
