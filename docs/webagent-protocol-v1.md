# WebAgent Protocol v1 (Draft)

## Purpose

`webagent.v1` 定义 PathMind 的 WebAgent 编排协议，目标是将“复杂任务规划 + DAG 多 worker 执行”能力标准化，便于后续独立打包为 SDK。

## Runtime Contract (`context._runtime.orchestrator`)

```json
{
  "enabled": true,
  "profile": "webagent_v1",
  "planner_mode": "fast",
  "executor_mode": "balanced",
  "max_steps": 5,
  "max_workers": 3,
  "worker_timeout_s": 90,
  "worker_max_retries": 1,
  "worker_retry_backoff_ms": 600,
  "max_budget_usd": 1.0,
  "critique_enabled": true,
  "critique_mode": "deep",
  "dynamic_replan_enabled": true,
  "max_replans": 1
}
```

- `enabled`: 是否启用编排器。
- `profile`: 编排策略版本。
- `planner_mode`: 规划阶段模型模式（`fast|balanced|deep`）。
- `executor_mode`: 执行阶段默认模式（`fast|balanced|deep`）。
- `max_steps`: 计划节点上限（2~12）。
- `max_workers`: DAG 并发 worker 上限（1~8）。
- `worker_timeout_s`: 单 worker 超时（15~600 秒）。
- `worker_max_retries`: 单 worker 最大重试次数（0~3）。
- `worker_retry_backoff_ms`: worker 重试退避基线（100~10000 毫秒，指数退避）。
- `max_budget_usd`: 编排阶段预算上限（<=0 表示不限制）。
- `critique_enabled`: 是否启用 Critique Worker 质量门。
- `critique_mode`: Critique Worker 推理模式（`fast|balanced|deep`）。
- `dynamic_replan_enabled`: Critique 未通过时是否触发动态重规划。
- `max_replans`: 最大重规划轮数（0~3）。

## Planner Output Contract

Planner 输出必须符合 JSON Schema，核心字段：

- `protocol`: `webagent.v1`
- `strategy`: 规划策略名
- `complexity`: `low|medium|high`
- `assumptions`: 前置假设
- `nodes[]`: 每个 DAG 节点包含
  - `id`
  - `title`
  - `kind` (`reason|gather|act|synthesize`)
  - `mode` (`fast|balanced|deep`)
  - `objective`
  - `tools` (optional)
  - `depends_on` (optional)
  - `deliverable`
- `expected_output`: 目标产出描述

## Query Response Extension

`POST /agent/query` 增加：

- `orchestrator.protocol`
- `orchestrator.profile`
- `orchestrator.strategy`
- `orchestrator.complexity`
- `orchestrator.selected_mode`
- `orchestrator.planner.{engine,model,mode}`
- `orchestrator.steps[]`（压缩版 DAG 节点摘要）
- `orchestrator.max_workers`
- `orchestrator.worker_timeout_s`
- `orchestrator.worker_max_retries`
- `orchestrator.worker_retry_backoff_ms`
- `orchestrator.max_budget_usd`
- `orchestrator.critique_enabled`
- `orchestrator.critique_mode`
- `orchestrator.dynamic_replan_enabled`
- `orchestrator.max_replans`
- `orchestrator.replan_count`
- `orchestrator.critique`（`pass/score/issues/recommendations/summary`）
- `orchestrator.worker_count`
- `orchestrator.worker_cost_usd`
- `orchestrator.workers[]`（worker 执行摘要，含 attempts/tools/failure_reason）

## Streaming Extension

SSE 增加 `type: "orchestrator"` 事件（`planned/layer_start/worker_start/worker_retry/worker_done/layer_done/budget_exhausted/critique_done/replan_start/replan_done`）：

```json
{
  "type": "orchestrator",
  "stage": "planned",
  "protocol": "webagent.v1",
  "profile": "webagent_v1",
  "strategy": "decompose-and-execute",
  "complexity": "medium",
  "selected_mode": "balanced",
  "planner": { "engine": "openai", "model": "gpt-4o-mini", "mode": "fast" },
  "max_workers": 3,
  "steps": [
    { "id": "node-1", "title": "任务拆解", "kind": "reason", "mode": "fast", "objective": "明确子任务", "depends_on": [] }
  ]
}
```

## Current Scope

- 当前为单 planner + 多 worker DAG + 单 executor 编排。
- worker 按 DAG 拓扑层执行，层内并发受 `max_workers` 控制。
- worker 受 timeout/retry/backoff 治理，预算耗尽会提前停止后续层。
- `node.tools` 在 worker 执行时会映射为工具白名单。
- 执行模式选择基于显式 runtime mode（优先）或计划复杂度（回退）。



## Core Package Boundary (P3-3B)

当前协议核心已抽离到 `server-py/app/services/webagent_core/`：

- `protocol.py`：计划 schema、DAG 构建、模式选择。
- `runtime.py`：`_runtime.orchestrator` 解析。
- `contracts.py`：`WebAgentPlan*` 与 `OrchestratorConfig` 契约。
- `orchestrator.py`：worker trace 压缩、成本统计、工具白名单解析。

兼容说明：`server-py/app/services/webagent_protocol.py` 仍保留为兼容导出层。

## Next SDK Milestones

1. ✅ 抽出 `webagent_core` 包（`protocol/runtime/contracts/orchestrator`）。
2. 定义 worker contract（reason/gather/act/synthesize）并支持多 worker。
3. 引入 artifact contract（`note_markdown`, `report_json`, `pdf_url`）。
4. 引入 provider adapter（Claude / OpenAI-compatible / future providers）。

## P3-4 Milestone (External MCP v1)

已完成第一阶段外部 MCP 标准化接入：

- 新增 `mcp_servers.yaml` 配置模型（stdio / sse / http）。
- ToolRegistry 升级为 unified 视图：`builtin + custom + external`。
- 新增工具 MCP 名称映射：`tool_name -> mcp__<server>__<tool>`。
- Claude runtime 改为 registry 驱动 `allowed_tools`，并自动合并 external `mcp_servers`。
- 新增 `/tools/health` 诊断接口（含 external server 状态）。

当前约束：

- external MCP 工具优先由 Claude 引擎直接执行。
- OpenAI 链路的 external MCP 直连执行器留在下一阶段补齐。

## P3-4.2 Milestone (OpenAI External MCP Adapter)

- 新增 OpenAI external adapter（`app/tools/external/openai_adapter.py`）。
- OpenAI 引擎 tool call 执行路径升级为：
  - internal tool → 本地 handler
  - external tool (`mcp__<server>__<tool>`) → adapter（stdio 首版）
- 前端 AIAdvisor 升级为动态 Agent Hub（agent list + capabilities + manual switch）。

当前约束：

- OpenAI external adapter 已支持 `stdio/http/sse` 三种外部 MCP 传输。
- `tool_routes` 的 `engine_support` 已对 external transport 做动态声明。


## P3-4.3 Completion (SSE/HTTP Adapter)

- OpenAI external MCP adapter 已补齐 `http` 与 `sse` 直连路径。
- SSE 路径支持 endpoint 事件发现 + message queue 回收响应。
- HTTP 路径支持 JSON 与 SSE 响应格式，并透传 `Mcp-Session-Id` 会话头。

## P4-3 Milestone (SDK Boundary v1)

已新增 `webagent_core` 的 SDK 契约层，覆盖三类核心接口：

1. `DataAdapter`（数据访问抽象）
   - 协议：`get_json` / `post_json`
   - 默认实现：`HttpDataAdapter`
   - 注入入口：`set_data_adapter()` / `get_data_adapter()`
2. `TenantContext`（多租户上下文）
   - 标准字段：`tenant_id` / `role` / `student_id` / `user_id` / `workspace_id` / `metadata`
   - 解析与压缩：`parse_tenant_context()` / `compact_tenant_context()`
3. `Artifact Contract`（worker 产物标准化）
   - 标准类型：`text` / `note_markdown` / `report_json` / `pdf_url`
   - 推断器：`infer_artifact_contract()`
   - 已接入 worker trace，`workers[]` 会附带 `artifact_type` / `artifact_uri`

### SDK 使用示例

- 示例文件：`server-py/examples/webagent_sdk_boundary_example.py`
- 可演示：
  - 自定义 `DataAdapter` 注入
  - 构建 `TenantContext`
  - 通过统一接口调用数据读取

## P4-3B Milestone (Tenant Context Propagation)

新增 `context._tenant` 约定，用于在 query/stream 中透传多租户作用域：

```json
{
  "context": {
    "_tenant": {
      "tenant_id": "school-a",
      "role": "teacher",
      "student_id": "stu-001",
      "user_id": "teacher-001",
      "workspace_id": "default",
      "metadata": {
        "project": "pathmind-demo"
      }
    }
  }
}
```

后端行为：
- `query` 响应增加 `tenant` 字段。
- stream `meta` / `orchestrator` 事件增加 `tenant` 字段。
- `tenant` 支持 `_tenant` 与 `tenant` 两种 key（兼容旧客户端）。

## P4-3C Milestone (SDK Docs Delivery)

新增 SDK 文档交付：

- `docs/webagent-sdk-reference-v1.md`（API Reference）
- `docs/webagent-sdk-quickstart.md`（Quickstart）

覆盖内容：

- 核心导出边界（protocol/runtime/contracts/orchestrator/data_adapter）
- `TenantContext` / `ArtifactContract` / `DataAdapter` 标准契约
- event 协议（`tenant`、`artifact_type`、`artifact_uri`）
- 最小接入示例路径与实践建议

## P4-4A/B Milestone (Release Contract + Packaging Checklist)

新增产品化交付资产：

- `docs/webagent-sdk-release-contract-v1.md`
- `docs/webagent-sdk-packaging-checklist-v1.md`
- `server-py/scripts/verify_webagent_core_contract.py`

覆盖目标：

- 语义版本与弃用策略（SemVer + deprecation window）
- 跨语言兼容矩阵（Python API / SSE / Go Proxy / Frontend）
- 发布门禁命令（contract check + build/test）
- 打包范围、文档范围、最小发布流程


## P4-4C Milestone (Unified Release Gate Command)

- 新增统一门禁脚本：`scripts/check_webagent_release.sh`
- 新增 npm 命令：
  - `npm run check:webagent`（quick）
  - `npm run check:webagent:full`（full）


## P5-P2-3 Milestone (Coding Docs Delivery)

新增 Coding 闭环文档交付：

- `docs/webagent-coding-quickstart-v1.md`
- `docs/webagent-coding-security-runbook-v1.md`
- `docs/webagent-coding-api-reference-v1.md`

覆盖内容：

- Coding runtime contract（`context._runtime.coding`）
- SSE 审批/重试/回退事件协议
- Go/Python 审批接口与 metrics 查询
- internal audit ingest contract 与审计表字段
- 沙箱策略、故障排查、回滚流程


## P6-1 Milestone (Policy Templates + Hot Reload)

新增策略治理契约：

- `context._runtime.coding.policy_profile`（按请求选择策略模板）
- `GET /agent/coding/policies`（策略快照与热更新状态）
- Go 代理透传：`GET /api/agent/coding/policies`

策略模板覆盖项（首版）：

- `approvals_enabled` / `approval_timeout_sec`
- `medium_risk_requires_approval`
- `low_risk_retry_count` / `low_risk_retry_backoff_ms`
- `high_risk_max_concurrency`
- `external_default_risk` / `external_readonly_risk` / `external_openworld_risk`
- `external_mcp_builtin_priority` / `external_mcp_fallback_to_internal`
