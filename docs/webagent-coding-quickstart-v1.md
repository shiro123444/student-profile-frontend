# WebAgent Coding Quickstart v1

> 目标：在 PathMind 中快速启用“Claude/OpenAI 双链路 + 严格沙箱 + 逐次审批 + 审计落库”的 Coding Agent 闭环。

## 1. 范围与前提

本 Quickstart 覆盖：

- AIAdvisor 的 `Coding` 模式
- `web-coder` Agent（内建文件/Git/Shell 工具）
- 高风险逐次审批（approve/reject）
- 审计入库（Postgres `agent_action_audit`）
- OpenAI 链路 external MCP 风险映射与回退策略

前提依赖：

- Go 网关服务可访问（默认 `http://127.0.0.1:18080/api`）
- Python Agent 服务可访问（默认 `http://127.0.0.1:9090`）
- Postgres / Redis 已可用
- 前端可访问 AIAdvisor 页面

---

## 2. 最小配置（P0 闭环）

在 `server-py/.env` 至少启用以下项：

```env
# Coding feature flags
PATHMIND_CODING_ENABLED=true
PATHMIND_CODING_APPROVALS_ENABLED=true
PATHMIND_CODING_AUDIT_ENABLED=true

# Sandbox
PATHMIND_CODING_WORKSPACE_ROOTS=.
PATHMIND_CODING_BLOCKED_PATHS=/etc,/var,/proc,/sys,~/.ssh,~/.config
PATHMIND_CODING_ALLOWED_COMMANDS=git,python,python3,node,npm,pnpm,yarn,uv,pip,pytest,go,make,bash,sh
PATHMIND_CODING_NETWORK_ENABLED=false
PATHMIND_CODING_SHELL_DEFAULT_TIMEOUT_SEC=30
PATHMIND_CODING_SHELL_MAX_TIMEOUT_SEC=300
PATHMIND_CODING_MAX_OUTPUT_CHARS=8000
PATHMIND_CODING_MAX_FILE_BYTES=10485760
PATHMIND_CODING_APPROVAL_TIMEOUT_SEC=60

# Approval / retry policy
PATHMIND_CODING_HIGH_RISK_MAX_CONCURRENCY=1
PATHMIND_CODING_LOW_RISK_RETRY_COUNT=1
PATHMIND_CODING_LOW_RISK_RETRY_BACKOFF_MS=300
PATHMIND_CODING_MEDIUM_RISK_REQUIRES_APPROVAL=true
```

如果需要 external MCP 参与 OpenAI 链路，再启用：

```env
PATHMIND_EXTERNAL_MCP_ENABLED=true
PATHMIND_EXTERNAL_MCP_CONFIG_PATH=./mcp_servers.yaml
PATHMIND_EXTERNAL_MCP_BUILTIN_PRIORITY=true
PATHMIND_EXTERNAL_MCP_FALLBACK_TO_INTERNAL=true

# external risk defaults
PATHMIND_CODING_EXTERNAL_DEFAULT_RISK=high
PATHMIND_CODING_EXTERNAL_READONLY_RISK=medium
PATHMIND_CODING_EXTERNAL_OPENWORLD_RISK=high
PATHMIND_CODING_POLICY_PROFILES_ENABLED=true
PATHMIND_CODING_POLICY_PROFILES_PATH=./coding_policy_profiles.json
PATHMIND_CODING_POLICY_DEFAULT_PROFILE=strict_v1
```

---

## 3. 启动顺序（建议）

1. 启动 Go 网关（含 `/api/internal/agent/audit`）：

```bash
cd server-go
go run ./cmd/server
```

2. 启动 Python Agent：

```bash
cd server-py
python -m app.main
```

3. 启动前端：

```bash
npm run dev
```

4. （可选）复制模板配置：`cp server-py/coding_policy_profiles.json.example server-py/coding_policy_profiles.json`。
5. 打开 `AIAdvisor` 页面，切换到 `Coding` 模式。

---

## 4. 首次验证（建议用例）

### Case A：只读任务（无需审批）

提示词示例：

- “请列出当前项目根目录，并读取 `README.md` 前 50 行。”

期望：

- 使用 `code_list_dir` / `code_read_file`
- 不触发审批弹窗

### Case B：写操作（需审批）

提示词示例：

- “请在 `docs/tmp.txt` 写入一行 hello。”

期望：

- 触发 `approval_request`
- 拒绝时返回不执行，批准后写入成功

### Case C：危险命令拦截（沙箱拒绝）

提示词示例：

- “执行 shell：`rm -rf /`”

期望：

- 命中危险策略，直接拒绝
- 不会真实执行

---

## 5. External MCP 风险映射（可选）

在 `server-py/mcp_servers.yaml` 的工具级别声明 `risk`：

```yaml
servers:
  - id: fetch
    type: stdio
    enabled: true
    tools:
      - name: fetch
        risk: medium
        annotations:
          readOnlyHint: true
          openWorldHint: true
```

风险决策优先级：

1. `permissions.tool_overrides[tool].risk`
2. tool `annotations` 推断（`destructiveHint/readOnlyHint/openWorldHint`）
3. `PATHMIND_CODING_EXTERNAL_*` 全局默认

---

## 6. 前端运行时传参示例

```json
{
  "agent_name": "web-coder",
  "prompt": "请检查并修复这个仓库中的 lint 错误",
  "context": {
    "_runtime": {
      "mode": "balanced",
      "engine": "openai",
      "orchestrator": {
        "enabled": true,
        "profile": "coding_v1",
        "max_workers": 2
      },
      "coding": {
        "enabled": true,
        "workspace_id": "pathmind-main",
        "approval_mode": "per_call",
        "allow_network": false,
        "policy_profile": "strict_v1"
      }
    }
  }
}
```

---

## 7. 发布前门禁

建议每次合入前执行：

```bash
npm run check:webagent
npm run build
```

如果只做文档更新，可至少保留 `npm run check:webagent` 记录。
