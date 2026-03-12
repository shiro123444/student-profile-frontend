# Agent 流式消息稳定化 — Release Checklist

## 回归测试矩阵 | Regression Test Matrix

### 1. `/debug/sse` 端点验证 | Debug SSE Endpoint Validation
```bash
curl -N http://localhost:9090/agent/debug/sse
```
预期 | Expected: 3 条 `text` + 1 条 `done` (stop_reason=end_turn) + `[DONE]`

### 2. 端到端流式测试 | End-to-End Streaming Test
```bash
curl -N -X POST http://localhost:9090/agent/stream \
  -H 'Content-Type: application/json' \
  -d '{"agent_name":"quick-qa","prompt":"你好","student_id":"test"}'
```
预期 | Expected: `meta` → `text`(s) → `done`（必须有 done，stop_reason 不为空 | must have done event with non-empty stop_reason）

### 3. 工具调用场景 | Tool Invocation Scenario
使用 `career-advisor` agent + 带 student_id 的请求触发 MCP 工具调用。
使用 | Use `career-advisor` agent + request with student_id to trigger MCP tool invocation.
预期 | Expected: `meta` → `tool_call(calling)` → `tool_call(done)` → `text` → `done`

### 4. 超时降级测试 | Timeout Fallback Test
设置一个不可达的 `anthropic_base_url`，验证 `model_fallback` 事件和最终 `done`。
Set an unreachable `anthropic_base_url`, verify `model_fallback` event and final `done`.

### 5. 并发测试 | Concurrency Test
10 个并发请求 → 验证所有请求都有 `done` 事件。
10 concurrent requests → verify all requests have `done` event.

## 告警阈值 | Alert Thresholds

| 指标 | Metric | 正常范围 | Normal Range | 告警阈值 | Alert Threshold | 来源 | Source |
|------|--------|---------|---------|---------|---------|------|--------|
| `stop_reason=idle_timeout` 占比 | Percentage | < 1% | < 1% | > 5% | > 5% | `[sse_metrics]` 日志 | log |
| `stop_reason=error` 占比 | Percentage | < 2% | < 2% | > 10% | > 10% | `[sse_metrics]` 日志 | log |
| `stop_reason=stream_closed` 占比 | Percentage | 0% | 0% | > 0% | > 0% | `[sse_metrics]` 日志 | log |
| `fallback=True` 占比 | Percentage | < 5% | < 5% | > 20% | > 20% | `[sse_metrics]` 日志 | log |
| `input_tokens=0` 且非 error | and non-error | 0% | 0% | > 0% | > 0% | 异常：引擎未正确报告 token 用量 | Anomaly: engine not reporting tokens correctly |
| 首包延迟 (first byte) | First byte latency | < 3s | < 3s | > 12s (触发 cascade) | > 12s (cascade trigger) | httpx timeout | httpx timeout |
| 工具循环次数 | Tool loop count | < 5 | < 5 | > 10 | > 10 | `tool_call_count` | `tool_call_count` |

## Done 事件必须字段检查 | Done Event Required Fields Check

每个流式响应结束时，`done` 事件必须包含：
Each streamed response must end with a `done` event containing:

- `stop_reason`: 非空字符串 | non-empty string
- `request_id`: req_ 前缀的唯一标识 | unique identifier with req_ prefix
- `effective_model`: 实际使用的模型名 | actual model name used
- `input_tokens` / `output_tokens`: 整数（可为 0 仅限 error/timeout） | integers (can be 0 only for error/timeout)
- `fallback_applied`: boolean
- `tool_call_count`: 整数 | integer

## 改动文件清单 | Changed Files Checklist

| 文件 | File | 组 | Group | 改动类型 | Change Type |
|---|---|---|---|---|---|
| `docs/anthropic_event_mapping.md` | `docs/anthropic_event_mapping.md` | A | A | 新建（纯文档） | New (documentation only) |
| `server-py/pyproject.toml` | `server-py/pyproject.toml` | B | B | 添加 `anthropic` 显式依赖 | Add explicit `anthropic` dependency |
| `server-py/app/engines/httpx_sse.py` | `server-py/app/engines/httpx_sse.py` | B | B | 修复 buf 残留、添加 request_id | Fix buf remnant, add request_id |
| `server-py/app/engines/anthropic_engine.py` | `server-py/app/engines/anthropic_engine.py` | B | B | 强化 done 字段、tool_call_count | Strengthen done fields, tool_call_count |
| `server-py/app/config.py` | `server-py/app/config.py` | B | B | 添加 `anthropic_first_byte_timeout_sec` | Add `anthropic_first_byte_timeout_sec` |
| `server-py/app/api/agent_routes.py` | `server-py/app/api/agent_routes.py` | C+D | C+D | SSE headers、`/debug/sse`、指标日志 | SSE headers, `/debug/sse`, metrics logging |
| `server-py/app/services/__init__.py` | `server-py/app/services/__init__.py` | C | C | DB 操作异步化 | Async database operations |
| `docs/release_checklist.md` | `docs/release_checklist.md` | D | D | 新建（回归矩阵+告警阈值） | New (regression matrix + alert thresholds) |
