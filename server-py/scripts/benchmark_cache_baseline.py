#!/usr/bin/env python3
"""P4-2C cache baseline benchmark (cold vs warm cache).

Runs service-level scenarios and outputs:
- JSON metrics report
- Markdown summary report

Scenarios:
- rag_query
- note_search
- unified_builtin
- unified_mcp
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Awaitable, Callable


# Make `app.*` imports available when invoked from repo root.
SCRIPT_PATH = Path(__file__).resolve()
SERVER_PY_ROOT = SCRIPT_PATH.parents[1]
REPO_ROOT = SCRIPT_PATH.parents[2]
if str(SERVER_PY_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_PY_ROOT))

DEFAULT_QUERIES = [
    "反向传播算法核心思想",
    "如何制定 Python 学习路径",
    "二叉树遍历的常见写法",
    "我的 MBTI 结果如何影响职业选择",
    "线性代数在机器学习里的应用",
]


@dataclass
class CaseMetrics:
    requests: int
    success: int
    errors: int
    avg_ms: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    min_ms: float
    qps: float
    duration_s: float


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    arr = sorted(values)
    pos = max(0.0, min(1.0, pct)) * (len(arr) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(arr) - 1)
    weight = pos - lo
    return arr[lo] * (1 - weight) + arr[hi] * weight


def summarize(latencies_ms: list[float], success: int, errors: int, duration_s: float) -> CaseMetrics:
    requests = success + errors
    avg_ms = sum(latencies_ms) / len(latencies_ms) if latencies_ms else 0.0
    return CaseMetrics(
        requests=requests,
        success=success,
        errors=errors,
        avg_ms=avg_ms,
        p50_ms=percentile(latencies_ms, 0.50),
        p95_ms=percentile(latencies_ms, 0.95),
        p99_ms=percentile(latencies_ms, 0.99),
        max_ms=max(latencies_ms) if latencies_ms else 0.0,
        min_ms=min(latencies_ms) if latencies_ms else 0.0,
        qps=(requests / duration_s) if duration_s > 0 else 0.0,
        duration_s=duration_s,
    )


async def reset_cache_state(get_redis_fn: Callable[[], Awaitable[Any]]) -> dict[str, int]:
    """Clear cache keys + stats keys for deterministic cold run."""
    redis = await get_redis_fn()
    if not redis:
        return {"deleted": 0, "matched": 0}

    patterns = [
        "cache:embedding:*",
        "cache:rag_query:*",
        "cache:note_search:*",
        "cache:unified_search:*",
        "cache:stats:*",
    ]

    to_delete: list[str] = []
    for pattern in patterns:
        async for key in redis.scan_iter(match=pattern, count=500):
            to_delete.append(key)

    if not to_delete:
        return {"deleted": 0, "matched": 0}

    deleted = await redis.delete(*to_delete)
    return {"deleted": int(deleted), "matched": len(to_delete)}


async def run_case(
    case_name: str,
    handler: Callable[[str], Awaitable[Any]],
    queries: list[str],
    iterations: int,
    verbose: bool,
) -> CaseMetrics:
    latencies_ms: list[float] = []
    success = 0
    errors = 0

    started = time.perf_counter()
    for _ in range(iterations):
        for query in queries:
            t0 = time.perf_counter()
            try:
                await handler(query)
                success += 1
            except Exception as exc:  # noqa: BLE001
                errors += 1
                if verbose:
                    print(f"[warn] case={case_name} query={query!r} error={exc}")
            finally:
                latencies_ms.append((time.perf_counter() - t0) * 1000.0)
    duration_s = max(0.000001, time.perf_counter() - started)

    return summarize(latencies_ms, success, errors, duration_s)


def md_table_for_phase(phase_name: str, case_rows: dict[str, dict[str, Any]]) -> str:
    lines = [
        f"### {phase_name}",
        "",
        "| Case | Requests | Success | Errors | Avg ms | P95 ms | P99 ms | QPS |",
        "|------|----------|---------|--------|--------|--------|--------|-----|",
    ]
    for case, m in case_rows.items():
        lines.append(
            "| {case} | {requests} | {success} | {errors} | {avg:.2f} | {p95:.2f} | {p99:.2f} | {qps:.2f} |".format(
                case=case,
                requests=m["requests"],
                success=m["success"],
                errors=m["errors"],
                avg=m["avg_ms"],
                p95=m["p95_ms"],
                p99=m["p99_ms"],
                qps=m["qps"],
            )
        )
    lines.append("")
    return "\n".join(lines)


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark cache baseline (P4-2C)")
    parser.add_argument(
        "--cases",
        nargs="+",
        default=["rag_query", "note_search", "unified_builtin", "unified_mcp"],
        choices=["rag_query", "note_search", "unified_builtin", "unified_mcp"],
        help="Scenarios to run",
    )
    parser.add_argument("--iterations", type=int, default=3, help="Iterations per query")
    parser.add_argument("--limit", type=int, default=5, help="Search result limit")
    parser.add_argument(
        "--queries-file",
        type=str,
        default="",
        help="Path to newline-separated queries (optional)",
    )
    parser.add_argument(
        "--student-id",
        type=str,
        default="00000000-0000-0000-0000-000000000001",
        help="Student UUID for note/unified scenarios",
    )
    parser.add_argument(
        "--course-id",
        type=str,
        default="",
        help="Optional course UUID for RAG filter",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(REPO_ROOT / "docs" / "perf-baselines"),
        help="Directory to write reports",
    )
    parser.add_argument(
        "--skip-reset",
        action="store_true",
        help="Skip clearing cache before cold phase",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print plan and exit",
    )
    parser.add_argument("--verbose", action="store_true", help="Print per-error warnings")
    return parser


async def main_async(args: argparse.Namespace) -> int:
    queries = DEFAULT_QUERIES
    if args.queries_file:
        qpath = Path(args.queries_file)
        if not qpath.is_absolute():
            qpath = REPO_ROOT / qpath
        if qpath.exists():
            queries = [line.strip() for line in qpath.read_text(encoding="utf-8").splitlines() if line.strip()]

    if args.dry_run:
        print("[dry-run] cases=", args.cases)
        print("[dry-run] queries=", len(queries))
        print("[dry-run] iterations=", args.iterations)
        print("[dry-run] output_dir=", args.output_dir)
        return 0

    from app.db.postgres import close_pg_pool, init_pg_pool
    from app.db.redis import close_redis, get_redis, init_redis
    from app.services.cache_service import get_cache_service
    from app.services.note_embedding import NoteEmbeddingService
    from app.services.rag_service import RAGService
    from app.tools.builtin.search.tools import unified_search as builtin_unified_search
    from app.mcp_tools.search_tools import unified_search as mcp_unified_search

    await init_pg_pool()
    await init_redis()

    rag_service = RAGService()
    note_service = NoteEmbeddingService()
    cache_service = get_cache_service()

    course_id = args.course_id or None

    async def rag_case(query: str) -> Any:
        return await rag_service.query(query=query, course_id=course_id, limit=args.limit)

    async def note_case(query: str) -> Any:
        return await note_service.search_notes(query=query, student_id=args.student_id, limit=args.limit)

    async def unified_builtin_case(query: str) -> Any:
        return await builtin_unified_search(
            {"query": query, "student_id": args.student_id, "course_id": course_id}
        )

    async def unified_mcp_case(query: str) -> Any:
        return await mcp_unified_search(
            {"query": query, "student_id": args.student_id, "course_id": course_id}
        )

    handlers: dict[str, Callable[[str], Awaitable[Any]]] = {
        "rag_query": rag_case,
        "note_search": note_case,
        "unified_builtin": unified_builtin_case,
        "unified_mcp": unified_mcp_case,
    }

    report: dict[str, Any] = {
        "meta": {
            "generated_at": datetime.now(UTC).isoformat(),
            "cases": args.cases,
            "queries": queries,
            "iterations": args.iterations,
            "limit": args.limit,
            "student_id": args.student_id,
            "course_id": course_id,
        },
        "phases": {},
    }

    phases = [
        ("cold_cache", not args.skip_reset),
        ("warm_cache", False),
    ]

    for phase_name, need_reset in phases:
        if need_reset:
            report["phases"].setdefault(phase_name, {})["reset"] = await reset_cache_state(get_redis)

        case_rows: dict[str, dict[str, Any]] = {}
        for case_name in args.cases:
            metrics = await run_case(
                case_name=case_name,
                handler=handlers[case_name],
                queries=queries,
                iterations=args.iterations,
                verbose=args.verbose,
            )
            case_rows[case_name] = {
                "requests": metrics.requests,
                "success": metrics.success,
                "errors": metrics.errors,
                "avg_ms": round(metrics.avg_ms, 3),
                "p50_ms": round(metrics.p50_ms, 3),
                "p95_ms": round(metrics.p95_ms, 3),
                "p99_ms": round(metrics.p99_ms, 3),
                "max_ms": round(metrics.max_ms, 3),
                "min_ms": round(metrics.min_ms, 3),
                "qps": round(metrics.qps, 3),
                "duration_s": round(metrics.duration_s, 3),
            }

        report["phases"].setdefault(phase_name, {})["cases"] = case_rows
        report["phases"][phase_name]["cache_stats"] = await cache_service.get_stats()

    out_dir = Path(args.output_dir)
    if not out_dir.is_absolute():
        out_dir = REPO_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    json_path = out_dir / f"p4-2c-cache-baseline-{stamp}.json"
    md_path = out_dir / f"p4-2c-cache-baseline-{stamp}.md"

    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    md_lines = [
        "# P4-2C Cache Baseline Report",
        "",
        f"- Generated At (UTC): `{report['meta']['generated_at']}`",
        f"- Cases: `{', '.join(args.cases)}`",
        f"- Queries: `{len(queries)}`",
        f"- Iterations: `{args.iterations}`",
        "",
    ]

    for phase_name in ["cold_cache", "warm_cache"]:
        phase = report["phases"][phase_name]
        md_lines.append(md_table_for_phase(phase_name, phase["cases"]))
        md_lines.append("**Cache Stats Snapshot**")
        md_lines.append("")
        md_lines.append("```json")
        md_lines.append(json.dumps(phase["cache_stats"], ensure_ascii=False, indent=2))
        md_lines.append("```")
        md_lines.append("")

    md_path.write_text("\n".join(md_lines), encoding="utf-8")

    print(f"[ok] json report: {json_path}")
    print(f"[ok] markdown report: {md_path}")

    await close_pg_pool()
    await close_redis()
    return 0


def main() -> int:
    parser = make_parser()
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
