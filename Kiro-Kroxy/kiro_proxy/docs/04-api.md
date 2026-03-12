# API 参考

## 代理端点

### OpenAI 协议

#### POST /v1/chat/completions

Chat Completions API，兼容 OpenAI 格式。

**请求示例：**

```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "stream": true
}
```

**模型映射：**

| 请求模型 | 实际使用 |
|----------|----------|
| gpt-4o, gpt-4 | claude-sonnet-4 |
| gpt-4o-mini, gpt-3.5-turbo | claude-haiku-4.5 |
| o1, o1-preview | claude-opus-4.5 |

#### GET /v1/models

获取可用模型列表。

---

### Anthropic 协议

#### POST /v1/messages

Messages API，兼容 Anthropic 格式。

**请求示例：**

```json
{
  "model": "claude-sonnet-4",
  "max_tokens": 4096,
  "messages": [
    {"role": "user", "content": "Hello!"}
  ]
}
```

#### POST /v1/messages/count_tokens

计算消息的 Token 数量。

---

### Gemini 协议

#### POST /v1/models/{model}:generateContent

Generate Content API，兼容 Gemini 格式。

---

## 管理 API

### 状态与统计

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 服务状态 |
| `/api/stats` | GET | 基础统计 |
| `/api/stats/detailed` | GET | 详细统计 |
| `/api/quota` | GET | 配额状态 |
| `/api/logs` | GET | 请求日志 |

### 账号管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/accounts` | GET | 账号列表 |
| `/api/accounts` | POST | 添加账号 |
| `/api/accounts/{id}` | GET | 账号详情 |
| `/api/accounts/{id}` | DELETE | 删除账号 |
| `/api/accounts/{id}/toggle` | POST | 启用/禁用 |
| `/api/accounts/{id}/refresh` | POST | 刷新 Token |
| `/api/accounts/{id}/restore` | POST | 恢复账号 |
| `/api/accounts/{id}/usage` | GET | 用量查询 |
| `/api/accounts/refresh-all` | POST | 刷新所有 |

### Token 操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/token/scan` | GET | 扫描本地 Token |
| `/api/token/add-from-scan` | POST | 从扫描添加 |
| `/api/token/refresh-check` | POST | 检查 Token 状态 |

### 登录

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/kiro/login/start` | POST | 启动 AWS 登录 |
| `/api/kiro/login/poll` | GET | 轮询登录状态 |
| `/api/kiro/login/cancel` | POST | 取消登录 |
| `/api/kiro/social/start` | POST | 启动 Social 登录 |
| `/api/kiro/social/exchange` | POST | 交换 Token |

### Flow 监控

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/flows` | GET | 查询 Flows |
| `/api/flows/stats` | GET | Flow 统计 |
| `/api/flows/{id}` | GET | Flow 详情 |
| `/api/flows/{id}/bookmark` | POST | 收藏 Flow |
| `/api/flows/export` | POST | 导出 Flows |

---

## 配置

### 配置文件位置

- 账号配置：`~/.kiro-proxy/config.json`
- Token 缓存：`~/.aws/sso/cache/`

### 配置导入导出

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config/export` | GET | 导出配置 |
| `/api/config/import` | POST | 导入配置 |
