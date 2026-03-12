# WebAgent Coding API Reference v1

> 本文档聚焦 P5 Coding 闭环：运行时参数、SSE 事件、审批接口、审计接口、工具清单。

## 1. Runtime Contract

Coding 运行时通过 `context._runtime.coding` 透传。

```json
{
  "context": {
    "_runtime": {
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

字段说明：

- `enabled: bool`：是否启用 coding 工具策略。
- `workspace_id: string`：工作区标识，映射到 sandbox 根目录下子路径。
- `approval_mode: "per_call"`：高风险逐次审批（当前仅支持该模式）。
- `allow_network: bool`：当前请求是否允许网络命令（仍受全局策略约束）。
- `policy_profile: string`：策略模板名（例如 `strict_v1` / `balanced_v1`）。

---

## 2. SSE Events（Coding相关）

### 2.1 `approval_request`

```json
{
  "type": "approval_request",
  "id": "uuid",
  "tool": "code_write_file",
  "risk": "high",
  "args_preview": {"path": "docs/a.md"},
  "timeout_sec": 60
}
```

### 2.2 `approval_result`

```json
{
  "type": "approval_result",
  "id": "uuid",
  "tool": "code_write_file",
  "risk": "high",
  "approved": true,
  "reason": "approved by user"
}
```

### 2.3 `tool_retry`（OpenAI低风险重试）

```json
{
  "type": "tool_retry",
  "tool": "search_notes",
  "attempt": 2,
  "max_attempts": 3,
  "reason": "temporary error"
}
```

### 2.4 `tool_fallback`（external ↔ builtin）

```json
{
  "type": "tool_fallback",
  "tool": "web_search",
  "stage": "external_failed_builtin_used"
}
```

`stage` 枚举：

- `builtin_preferred`：命中“内建优先”策略。
- `external_failed_builtin_used`：external 失败后回退内建工具。

---

## 3. HTTP API（Go Gateway 对外）

> 以下接口走 Go 网关，对前端开放路径带 `/api` 前缀。

### 3.1 Agent Query / Stream

- `POST /api/agent/query`
- `POST /api/agent/stream`

请求体（节选）：

```json
{
  "agent_name": "web-coder",
  "prompt": "请修复这个报错",
  "student_id": "stu-001",
  "context": {
    "_runtime": {
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

### 3.2 Approval Decision

- `POST /api/agent/approvals/{id}/approve`
- `POST /api/agent/approvals/{id}/reject`

请求体：

```json
{
  "reason": "optional reason"
}
```

响应体：

```json
{
  "ok": true,
  "request_id": "uuid",
  "approved": true,
  "reason": "approved by user"
}
```

### 3.3 Approval Metrics

- `GET /api/agent/approvals/metrics`

响应体：

```json
{
  "pending": 0,
  "total_requests": 10,
  "approved": 7,
  "rejected": 3,
  "timed_out": 1,
  "avg_wait_ms": 1420.5
}
```

### 3.4 Coding Policy Profiles

- `GET /api/agent/coding/policies`

响应体（节选）：

```json
{
  "enabled": true,
  "config_path": "/path/to/coding_policy_profiles.json",
  "default_profile": "strict_v1",
  "source_version": "1.0",
  "profiles": {
    "strict_v1": {
      "approvals_enabled": true,
      "approval_timeout_sec": 60,
      "external_mcp_builtin_priority": true
    }
  },
  "errors": []
}
```

---

## 4. HTTP API（Python Agent Service 内部）

> 以下为 Python 内部接口（通常由 Go 网关转发）。

- `POST /agent/approvals/{request_id}/approve`
- `POST /agent/approvals/{request_id}/reject`
- `GET /agent/approvals/metrics`

请求/响应结构与 Go 侧保持一致。

---

## 5. Internal Audit API（Python -> Go）

- `POST /api/internal/agent/audit`

请求体字段：

- `request_id`
- `session_id`
- `student_id`
- `agent`
- `engine`
- `mode`
- `tool`
- `risk`
- `approved`
- `status`
- `args`（JSON）
- `result`（JSON）
- `error`
- `duration_ms`

审计表：`agent_action_audit`

核心字段：

- `request_id/session_id/student_id`
- `agent/engine/mode/tool/risk`
- `approved/status/error/duration_ms/created_at`

---

## 6. Built-in Coding Tools

### 6.1 文件系统

- `code_list_dir`（只读）
- `code_read_file`（只读）
- `code_write_file`（高风险）
- `code_edit_file`（高风险）
- `code_search_files`（只读）
- `code_grep_content`（只读）

### 6.2 Git

- `code_git_status`（只读）
- `code_git_diff`（只读）
- `code_git_add`（高风险）
- `code_git_commit`（高风险）
- `code_git_branch`（高风险）
- `code_git_log`（只读）

### 6.3 Shell

- `code_shell_exec`（高风险）

---

## 7. 风险策略参数

关键配置（`server-py/app/config.py`）：

- `coding_medium_risk_requires_approval`
- `coding_external_default_risk`
- `coding_external_readonly_risk`
- `coding_external_openworld_risk`
- `external_mcp_builtin_priority`
- `external_mcp_fallback_to_internal`

行为说明：

- high 风险总是审批。
- medium 风险是否审批由 `coding_medium_risk_requires_approval` 控制。
- external 工具优先尝试内建或外部由 `external_mcp_builtin_priority` 控制。
- external 失败时是否回退内建由 `external_mcp_fallback_to_internal` 控制。

