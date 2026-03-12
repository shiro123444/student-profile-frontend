"""In-memory metrics collector for AI dispatcher."""

from __future__ import annotations

import asyncio
import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any


def _now_ts() -> float:
    return time.time()


def _bucket_key(task_type: str, engine: str) -> str:
    task = (task_type or "unknown").strip().lower() or "unknown"
    eng = (engine or "unknown").strip().lower() or "unknown"
    return f"{task}|{eng}"


def _p95(samples: deque[float]) -> float:
    if not samples:
        return 0.0
    ordered = sorted(samples)
    idx = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * 0.95) - 1))
    return float(ordered[idx])


@dataclass
class _BucketMetrics:
    requests_total: int = 0
    success_total: int = 0
    error_total: int = 0
    ttft_ms_samples: deque[float] = field(default_factory=lambda: deque(maxlen=512))
    duration_ms_samples: deque[float] = field(default_factory=lambda: deque(maxlen=512))


class DispatchMetricsCollector:
    """Low-overhead in-memory collector."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._started_at = int(_now_ts())
        self._requests_total = 0
        self._cache_hit_total = 0
        self._fallback_total = 0
        self._buckets: dict[str, _BucketMetrics] = defaultdict(_BucketMetrics)
        self._request_ts_window: deque[float] = deque(maxlen=4096)
        self._fallback_window: deque[float] = deque(maxlen=1024)

    @staticmethod
    def _trim_window(window: deque[float], now_ts: float, sec: float) -> None:
        while window and (now_ts - window[0]) > sec:
            window.popleft()

    async def record_route(self, *, task_type: str, engine: str) -> None:
        now_ts = _now_ts()
        key = _bucket_key(task_type, engine)
        async with self._lock:
            self._requests_total += 1
            self._request_ts_window.append(now_ts)
            self._buckets[key].requests_total += 1

    async def record_cache_hit(self) -> None:
        async with self._lock:
            self._cache_hit_total += 1

    async def record_fallback(self) -> None:
        now_ts = _now_ts()
        async with self._lock:
            self._fallback_total += 1
            self._fallback_window.append(now_ts)

    async def record_ttft(self, *, task_type: str, engine: str, ttft_ms: float) -> None:
        key = _bucket_key(task_type, engine)
        safe = max(0.0, float(ttft_ms))
        async with self._lock:
            self._buckets[key].ttft_ms_samples.append(safe)

    async def record_result(
        self,
        *,
        task_type: str,
        engine: str,
        success: bool,
        duration_ms: float,
    ) -> None:
        key = _bucket_key(task_type, engine)
        safe_duration = max(0.0, float(duration_ms))
        async with self._lock:
            bucket = self._buckets[key]
            if success:
                bucket.success_total += 1
            else:
                bucket.error_total += 1
            bucket.duration_ms_samples.append(safe_duration)

    async def snapshot(self) -> dict[str, Any]:
        now_ts = _now_ts()
        async with self._lock:
            self._trim_window(self._request_ts_window, now_ts, 60.0)
            self._trim_window(self._fallback_window, now_ts, 60.0)
            qps_60s = (len(self._request_ts_window) / 60.0) if self._request_ts_window else 0.0
            fallback_rate_60s = (
                (len(self._fallback_window) / len(self._request_ts_window))
                if self._request_ts_window
                else 0.0
            )

            buckets = {}
            for key, bucket in self._buckets.items():
                success_rate = (
                    bucket.success_total / bucket.requests_total
                    if bucket.requests_total > 0
                    else 0.0
                )
                buckets[key] = {
                    "requests_total": bucket.requests_total,
                    "success_total": bucket.success_total,
                    "error_total": bucket.error_total,
                    "success_rate": round(success_rate, 4),
                    "ttft_p95_ms": round(_p95(bucket.ttft_ms_samples), 2),
                    "duration_p95_ms": round(_p95(bucket.duration_ms_samples), 2),
                }

            cache_hit_rate = (
                self._cache_hit_total / self._requests_total
                if self._requests_total > 0
                else 0.0
            )
            fallback_rate = (
                self._fallback_total / self._requests_total
                if self._requests_total > 0
                else 0.0
            )

            return {
                "started_at": self._started_at,
                "generated_at": int(now_ts),
                "requests_total": self._requests_total,
                "cache_hit_total": self._cache_hit_total,
                "cache_hit_rate": round(cache_hit_rate, 4),
                "fallback_total": self._fallback_total,
                "fallback_rate": round(fallback_rate, 4),
                "qps_60s": round(qps_60s, 4),
                "fallback_rate_60s": round(fallback_rate_60s, 4),
                "buckets": buckets,
            }

    async def runtime_hints(self) -> dict[str, float]:
        """Return lightweight signals for adaptive routing/context scaling."""
        now_ts = _now_ts()
        async with self._lock:
            self._trim_window(self._request_ts_window, now_ts, 60.0)
            self._trim_window(self._fallback_window, now_ts, 60.0)
            qps_60s = (len(self._request_ts_window) / 60.0) if self._request_ts_window else 0.0
            fallback_rate_60s = (
                (len(self._fallback_window) / len(self._request_ts_window))
                if self._request_ts_window
                else 0.0
            )
            openai_bucket = self._buckets.get("summary|openai")
            openai_ttft_p95_ms = (
                _p95(openai_bucket.ttft_ms_samples)
                if openai_bucket is not None
                else 0.0
            )
            return {
                "qps_60s": float(qps_60s),
                "fallback_rate_60s": float(fallback_rate_60s),
                "openai_summary_ttft_p95_ms": float(openai_ttft_p95_ms),
            }


_collector = DispatchMetricsCollector()


def get_dispatch_metrics_collector() -> DispatchMetricsCollector:
    return _collector
