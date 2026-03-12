# WebAgent Coding Security Runbook v1

> 面向运维/开发联调：处理 Coding Agent 在审批、沙箱、审计、external MCP 回退链路中的常见问题。

## 1. 安全基线（必须）

- `PATHMIND_CODING_ENABLED=true` 才允许 Coding 工具执行。
- 默认禁网：`PATHMIND_CODING_NETWORK_ENABLED=false`。
- 高风险逐次审批：`PATHMIND_CODING_APPROVALS_ENABLED=true`。
- 审计默认开启：`PATHMIND_CODING_AUDIT_ENABLED=true`。
- Shell 受命令白名单限制：`PATHMIND_CODING_ALLOWED_COMMANDS`。
- 路径必须在 `PATHMIND_CODING_WORKSPACE_ROOTS` 内，且不在 `PATHMIND_CODING_BLOCKED_PATHS`。
- 策略模板支持热更新：`PATHMIND_CODING_POLICY_PROFILES_PATH`（修改文件后下次请求自动生效）。

---

## 2. 风险分级与审批策略

### 内建高风险工具（默认必审）

- `code_write_file`
- `code_edit_file`
- `code_git_add`
- `code_git_commit`
- `code_git_branch`
- `code_shell_exec`

### external MCP 风险策略

优先级：

1. manifest 覆写（`tool_overrides.risk`）
2. 注解推断（`destructiveHint/readOnlyHint/openWorldHint`）
3. 环境变量默认（`PATHMIND_CODING_EXTERNAL_*`）

若 `PATHMIND_CODING_MEDIUM_RISK_REQUIRES_APPROVAL=true`，则 `medium` 也进入审批。

---

## 3. 运行态巡检清单

### 3.1 审批状态

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/agent/approvals/metrics
```

重点字段：

- `pending`：当前挂起审批数
- `timed_out`：超时拒绝累计
- `avg_wait_ms`：审批平均等待

### 3.2 审计落库覆盖

```sql
SELECT
  tool,
  risk,
  approved,
  status,
  COUNT(*) AS total
FROM agent_action_audit
GROUP BY tool, risk, approved, status
ORDER BY total DESC;
```

### 3.3 external MCP 健康

- 检查 `PATHMIND_EXTERNAL_MCP_ENABLED` 是否开启。
- 检查 `mcp_servers.yaml` 各 server `enabled/type/command|url`。
- 检查 UI 时间线是否出现 `tool_fallback`（external→builtin）。

---

## 4. 常见故障与处理

### 故障 A：高风险操作一直“超时拒绝”

现象：`approval_result.approved=false` 且原因为超时。

排查：

1. 前端是否接入 `approval_request` 事件。
2. 是否调用 `/api/agent/approvals/{id}/approve|reject`。
3. `PATHMIND_CODING_APPROVAL_TIMEOUT_SEC` 是否过低（默认 60s）。

处理：

- 优先修复前端审批弹窗回调。
- 临时提升超时到 90~120s（仅联调环境）。

### 故障 B：文件访问被拒绝

现象：`路径超出允许范围` 或 `路径被策略禁止`。

排查：

1. `workspace_id` 映射目录是否存在。
2. `PATHMIND_CODING_WORKSPACE_ROOTS` 是否覆盖目标目录。
3. 是否命中 blocked path 前缀。

处理：

- 调整 workspace root，不要放宽 blocked path 到系统目录。

### 故障 C：Shell 命令被拒绝

现象：`命令不在白名单` / `命中危险命令策略` / `禁用网络命令`。

排查：

1. 命令二进制是否在 `PATHMIND_CODING_ALLOWED_COMMANDS`。
2. 是否包含复合语法：`&& || | ; > <`。
3. 是否使用网络命令但 `allow_network=false`。

处理：

- 拆分为单命令执行。
- 仅对必要工具追加白名单。
- 网络场景必须显式 runtime `allow_network=true`，且评估风险。

### 故障 D：external MCP 调用失败

现象：工具结果报错，或时间线出现 fallback。

排查：

1. transport 配置（stdio/http/sse）是否正确。
2. server 可执行文件/URL/headers 是否有效。
3. `PATHMIND_EXTERNAL_MCP_FALLBACK_TO_INTERNAL` 是否开启。

处理：

- 保持 `PATHMIND_EXTERNAL_MCP_BUILTIN_PRIORITY=true`。
- 保持 `PATHMIND_EXTERNAL_MCP_FALLBACK_TO_INTERNAL=true`。
- 对高不稳定 server 调高风险等级（`risk: high`）并强制审批。

### 故障 E：审计记录缺失

现象：高风险操作执行后，`agent_action_audit` 无记录。

排查：

1. `PATHMIND_CODING_AUDIT_ENABLED` 是否关闭。
2. Go 内部接口 `/api/internal/agent/audit` 是否可达。
3. Python `PATHMIND_GO_BACKEND_URL` 是否正确。

处理：

- 先恢复 internal audit 通路。
- 注意：审计上报是异步降级设计，失败不阻断主流程。

### 故障 F：策略模板未生效

现象：已修改 `coding_policy_profiles.json`，但审批/回退行为未变化。

排查：

1. `PATHMIND_CODING_POLICY_PROFILES_ENABLED` 是否为 `true`。
2. `PATHMIND_CODING_POLICY_PROFILES_PATH` 指向文件是否正确。
3. 运行时 `policy_profile` 是否拼写错误（会回退到默认模板）。
4. 调用 `GET /api/agent/coding/policies` 检查 `errors` 与 `default_profile`。

处理：

- 修复 JSON 语法和 profile key；保存后无需重启即可热更新。
- 如需紧急稳定，临时回退到 `strict_v1`。

---

## 5. 回滚策略

### 快速回滚（最小影响）

1. 关闭 coding 总开关：`PATHMIND_CODING_ENABLED=false`
2. 保留普通学习 Agent 能力不受影响。

### 局部回滚

- 仅关闭审批：`PATHMIND_CODING_APPROVALS_ENABLED=false`
- 仅关闭审计：`PATHMIND_CODING_AUDIT_ENABLED=false`
- 仅关闭 external MCP：`PATHMIND_EXTERNAL_MCP_ENABLED=false`

---

## 6. 生产建议

- 高风险并发保持 `1`（`PATHMIND_CODING_HIGH_RISK_MAX_CONCURRENCY=1`）。
- medium 风险建议默认走审批。
- external MCP 先小流量灰度，再逐步放量。
- 每周回顾 `timed_out / rejected / fallback` 指标，反推提示词与策略模板优化。

