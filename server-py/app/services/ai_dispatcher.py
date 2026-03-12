"""Central AI dispatch service for task-based routing."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any, AsyncGenerator

from app.engines.base import _json
from app.services import AgentService
from app.services.cache_service import get_cache_service
from app.services.ai_dispatch_metrics import get_dispatch_metrics_collector


@dataclass
class DispatchRuntime:
    """Resolved runtime route."""

    engine: str
    mode: str
    reason: str
    engine_model: str | None = None


class AIDispatcher:
    """Task-based dispatcher with cache and fallback semantics."""

    _SUMMARY_TASKS = {"summary", "preview_summary", "wikilink_summary"}
    _INLINE_TASKS = {"inline_complete", "inline_completion", "inline_copilot"}
    _OPENAI_TTFT_DEGRADE_MS = 2000.0
    _HIGH_LOAD_QPS = 1.8
    _HIGH_FALLBACK_RATE = 0.22

    @staticmethod
    def _looks_like_inline_error_text(text: str) -> bool:
        normalized = " ".join((text or "").strip().lower().split())
        if not normalized:
            return True
        patterns = (
            "ai 服务出现错误",
            "ai服务出现错误",
            "请稍后再试",
            "暂时不可用",
            "service unavailable",
            "internal server error",
            "fallback",
            "error",
            "failed",
        )
        return any(pattern in normalized for pattern in patterns)

    def _pick_runtime(self, task_type: str, priority: str | None) -> DispatchRuntime:
        normalized_task = (task_type or "").strip().lower()
        normalized_priority = (priority or "").strip().lower()

        if normalized_task in self._INLINE_TASKS:
            return DispatchRuntime(
                engine="openai",
                mode="fast",
                reason="inline completion routed to fast/openai-coder",
                engine_model="bigcode/starcoder2-7b",
            )

        if normalized_task in self._SUMMARY_TASKS or normalized_priority == "low":
            return DispatchRuntime(
                engine="openai",
                mode="fast",
                reason="summary task routed to fast/openai",
            )

        if normalized_priority in {"high", "critical"}:
            return DispatchRuntime(
                engine="claude",
                mode="deep",
                reason="high-priority task routed to deep/claude",
            )

        return DispatchRuntime(
            engine="claude",
            mode="balanced",
            reason="default route balanced/claude",
        )

    @staticmethod
    def _cap_referenced_summaries(
        context_snapshot: dict[str, Any] | None,
        *,
        max_refs: int,
    ) -> dict[str, Any] | None:
        if not context_snapshot:
            return context_snapshot
        next_snapshot = dict(context_snapshot)
        refs = next_snapshot.get("referenced_summaries")
        if isinstance(refs, list):
            next_snapshot["referenced_summaries"] = refs[: max(0, max_refs)]
        return next_snapshot

    @staticmethod
    def _merge_context(
        context: dict[str, Any] | None,
        runtime: DispatchRuntime,
        context_snapshot: dict[str, Any] | None,
    ) -> dict[str, Any]:
        merged: dict[str, Any] = dict(context or {})
        incoming_runtime = merged.get("_runtime")
        incoming_runtime_dict = incoming_runtime if isinstance(incoming_runtime, dict) else {}

        merged["_runtime"] = {
            **incoming_runtime_dict,
            "mode": runtime.mode,
            "engine": runtime.engine,
        }
        if runtime.engine_model:
            merged["_runtime"]["engine_model"] = runtime.engine_model

        if context_snapshot:
            merged["_context_snapshot"] = context_snapshot

        return merged

    async def stream_dispatch(
        self,
        *,
        agent_name: str,
        prompt: str,
        student_id: str | None,
        role: str,
        session_id: str | None,
        context: dict[str, Any] | None,
        task_type: str,
        priority: str | None = None,
        cache_key: str | None = None,
        context_snapshot: dict[str, Any] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream dispatch result as JSON event chunks."""
        started_at = time.perf_counter()
        runtime = self._pick_runtime(task_type=task_type, priority=priority)
        normalized_task = (task_type or "").strip().lower()
        summary_mode = normalized_task in self._SUMMARY_TASKS
        inline_mode = normalized_task in self._INLINE_TASKS
        summary_cache_key = (cache_key or "").strip()
        summary_target = summary_cache_key or normalized_task
        dispatch_metrics = get_dispatch_metrics_collector()
        # Skip metrics hints for inline — saves ~20-50ms Redis/DB I/O
        if inline_mode:
            hints: dict[str, Any] = {}
        else:
            hints = await dispatch_metrics.runtime_hints()
        openai_summary_ttft_p95_ms = float(hints.get("openai_summary_ttft_p95_ms", 0.0))
        high_load = (
            float(hints.get("qps_60s", 0.0)) >= self._HIGH_LOAD_QPS
            or float(hints.get("fallback_rate_60s", 0.0)) >= self._HIGH_FALLBACK_RATE
        )
        metrics_task_type = normalized_task or "unknown"
        selected_engine = runtime.engine
        first_text_recorded = False
        request_succeeded = False

        if summary_mode and runtime.engine == "openai" and openai_summary_ttft_p95_ms >= self._OPENAI_TTFT_DEGRADE_MS:
            runtime = DispatchRuntime(
                engine="claude",
                mode="balanced",
                reason="openai summary p95 ttft degraded; routed to claude",
            )
            selected_engine = runtime.engine

        asyncio.create_task(
            dispatch_metrics.record_route(
                task_type=metrics_task_type,
                engine=selected_engine,
            )
        )

        yield _json(
            {
                "type": "dispatch_meta",
                "task_type": normalized_task or "unknown",
                "priority": (priority or "normal"),
                "selected_engine": runtime.engine,
                "selected_mode": runtime.mode,
                "reason": runtime.reason,
            }
        )

        cache_service = get_cache_service()
        if summary_mode and summary_target:
            cached = await cache_service.get_ai_summary(
                scope=normalized_task or "summary",
                target=summary_target,
                student_id=student_id,
            )
            if cached:
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                asyncio.create_task(dispatch_metrics.record_cache_hit())
                asyncio.create_task(
                    dispatch_metrics.record_ttft(
                        task_type=metrics_task_type,
                        engine="cache",
                        ttft_ms=elapsed_ms,
                    )
                )
                asyncio.create_task(
                    dispatch_metrics.record_result(
                        task_type=metrics_task_type,
                        engine="cache",
                        success=True,
                        duration_ms=elapsed_ms,
                    )
                )
                yield _json({"type": "meta", "engine": "cache", "mode": runtime.mode})
                yield _json({"type": "text", "content": cached})
                yield _json(
                    {
                        "type": "done",
                        "session_id": session_id or "",
                        "cost": 0.0,
                        "input_tokens": 0,
                        "output_tokens": 0,
                    }
                )
                return

        max_refs = 6
        if high_load:
            max_refs = 2
        elif openai_summary_ttft_p95_ms >= 1200:
            max_refs = 3
        scaled_context_snapshot = self._cap_referenced_summaries(context_snapshot, max_refs=max_refs)
        merged_context = self._merge_context(
            context,
            runtime=runtime,
            context_snapshot=scaled_context_snapshot,
        )
        # Inject task_type so downstream (AgentService.stream) can see it
        merged_context["taskType"] = task_type
        service = AgentService()
        summary_accumulator: list[str] = []

        async def _run_once(run_runtime: DispatchRuntime) -> AsyncGenerator[str, None]:
            nonlocal first_text_recorded
            run_context = self._merge_context(
                merged_context,
                runtime=run_runtime,
                context_snapshot=scaled_context_snapshot,
            )
            async for chunk in service.stream(
                agent_name=agent_name,
                prompt=prompt,
                student_id=student_id,
                context=run_context,
                role=role,
                session_id=session_id,
            ):
                try:
                    payload = json.loads(chunk)
                except Exception:
                    payload = None
                if isinstance(payload, dict) and payload.get("type") == "text":
                    text_chunk = payload.get("content")
                    if inline_mode and isinstance(text_chunk, str) and self._looks_like_inline_error_text(text_chunk):
                        continue
                    if isinstance(text_chunk, str) and summary_mode:
                        summary_accumulator.append(text_chunk)
                    if not first_text_recorded and isinstance(text_chunk, str) and text_chunk:
                        first_text_recorded = True
                        ttft_ms = (time.perf_counter() - started_at) * 1000
                        asyncio.create_task(
                            dispatch_metrics.record_ttft(
                                task_type=metrics_task_type,
                                engine=run_runtime.engine,
                                ttft_ms=ttft_ms,
                            )
                        )
                yield chunk

        try:
            async for chunk in _run_once(runtime):
                yield chunk
            request_succeeded = True
        except Exception as primary_error:
            if not summary_mode or runtime.engine == "claude":
                duration_ms = (time.perf_counter() - started_at) * 1000
                asyncio.create_task(
                    dispatch_metrics.record_result(
                        task_type=metrics_task_type,
                        engine=selected_engine,
                        success=False,
                        duration_ms=duration_ms,
                    )
                )
                raise primary_error

            fallback_runtime = DispatchRuntime(
                engine="claude",
                mode="balanced",
                reason="summary fast path failed; fallback to claude",
            )
            selected_engine = fallback_runtime.engine
            asyncio.create_task(dispatch_metrics.record_fallback())
            asyncio.create_task(
                dispatch_metrics.record_route(
                    task_type=metrics_task_type,
                    engine=fallback_runtime.engine,
                )
            )
            yield _json(
                {
                    "type": "dispatch_meta",
                    "task_type": normalized_task or "unknown",
                    "priority": (priority or "normal"),
                    "selected_engine": fallback_runtime.engine,
                    "selected_mode": fallback_runtime.mode,
                    "reason": fallback_runtime.reason,
                }
            )
            async for chunk in _run_once(fallback_runtime):
                yield chunk
            request_succeeded = True

        duration_ms = (time.perf_counter() - started_at) * 1000
        asyncio.create_task(
            dispatch_metrics.record_result(
                task_type=metrics_task_type,
                engine=selected_engine,
                success=request_succeeded,
                duration_ms=duration_ms,
            )
        )

        if summary_mode and summary_target and summary_accumulator:
            await cache_service.set_ai_summary(
                scope=normalized_task or "summary",
                target=summary_target,
                student_id=student_id,
                summary="".join(summary_accumulator).strip(),
            )
