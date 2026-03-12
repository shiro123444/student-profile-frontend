# P4-2C Cache Baseline Runbook

## 目标
对比 **冷缓存** 与 **预热缓存** 在以下场景下的性能基线：
- `rag_query`
- `note_search`
- `unified_builtin`
- `unified_mcp`

输出指标：`QPS`、`Avg`、`P95`、`P99`、错误率、缓存命中率。

## 前置条件
- Python Agent 服务依赖可访问（PostgreSQL / Redis / Embedding API）
- 已在 `server-py/.env` 配置：
  - `PATHMIND_CACHE_ENABLED=true`
  - `PATHMIND_EMBEDDING_CACHE_ENABLED=true`
  - `PATHMIND_RAG_QUERY_CACHE_ENABLED=true`
  - `PATHMIND_NOTE_SEARCH_CACHE_ENABLED=true`
  - `PATHMIND_UNIFIED_SEARCH_CACHE_ENABLED=true`

## 执行命令

### 1) 快速预演（不执行真实请求）
```bash
python3 server-py/scripts/benchmark_cache_baseline.py --dry-run
```

### 2) 标准基线测试
```bash
python3 server-py/scripts/benchmark_cache_baseline.py \
  --iterations 3 \
  --cases rag_query note_search unified_builtin unified_mcp \
  --student-id 00000000-0000-0000-0000-000000000001
```

### 3) 指定查询集
```bash
python3 server-py/scripts/benchmark_cache_baseline.py \
  --queries-file docs/perf-baselines/queries-sample.txt \
  --iterations 5
```

## 输出文件
脚本会在 `docs/perf-baselines/` 自动生成：
- `p4-2c-cache-baseline-<timestamp>.json`
- `p4-2c-cache-baseline-<timestamp>.md`

## 判读建议
- `warm_cache` 相对 `cold_cache`：
  - `P95` 降低 >= 30%（目标）
  - `QPS` 提升 >= 20%（目标）
- `cache_stats`：
  - `embedding.hit_ratio`、`rag_query.hit_ratio`、`note_search.hit_ratio`、`unified_search.hit_ratio`
  - 目标：稳定场景 > 0.6

## 常见问题
- `errors > 0`：优先检查 Redis/DB/Embedding API 可达性。
- `hit_ratio 很低`：检查查询是否重复、TTL 是否过短、缓存是否被重置。
- `warm 无明显提升`：检查是否命中同一 `query/course_id/student_id/variant` 组合。
