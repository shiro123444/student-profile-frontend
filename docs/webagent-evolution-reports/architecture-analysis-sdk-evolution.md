# PathMind AI 架构分析与 SDK 化演进方案

**分析日期**: 2026-02-20
**分析师**: Architecture Analyst
**版本**: v1.0

---

## 执行摘要

PathMind AI 是一个基于 Claude Agent SDK 的三层智能教育平台，当前架构智能化程度评分 **7.5/10**。系统已具备完整的 Agent 编排能力、多引擎路由、工具注册机制和 WebAgent 协议支持，但存在业务逻辑与智能层耦合、会话管理不完善、前端集成不足等问题。

本报告提出 **4 阶段 SDK 化演进路径**，将 PathMind 从业务系统转型为通用 WebAgent 平台，核心目标：
1. 解耦业务逻辑与 Agent 能力（Phase 1-2）
2. 抽象 Agent 调度层为独立服务（Phase 3）
3. SDK 化封装与开放平台建设（Phase 4）

---

## 1. 当前架构智能化程度评估

### 1.1 三层架构职责分析

```
┌─────────────────────────────────────────────────────────────┐
│  React Frontend (Port 5173)                                 │
│  - UI 渲染 + 用户交互                                        │
│  - SSE 流式消费 (useAgentStream hook)                       │
│  - 智能决策: 无 (纯展示层)                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP/SSE
┌─────────────────────────────────────────────────────────────┐
│  Go Backend (Port 8080)                                     │
│  - JWT 认证 + CRUD 业务逻辑                                  │
│  - SSE 代理 (bufio.Scanner 逐行转发)                        │
│  - 智能决策: 无 (纯代理层)                                   │
│  - 问题: 与业务数据库强耦合 (GORM + PostgreSQL)             │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP Proxy
┌─────────────────────────────────────────────────────────────┐
│  Python Agent Service (Port 9090)                           │
│  - 8 Agents + 24 MCP Tools                                  │
│  - 双引擎路由 (Claude Sonnet/Haiku + NVIDIA OpenAI)         │
│  - WebAgent 协议 (DAG 编排 + 多 worker 并发)                │
│  - 智能决策: 高 (Agent 编排 + 工具调用 + 会话管理)          │
│  - 问题: 与业务数据库耦合 (MCP tools 直接查询 PostgreSQL)   │
└─────────────────────────────────────────────────────────────┘
```

**职责划分评分**: 6/10
- ✅ 前端纯展示，Go 纯代理，Python 纯智能 — 理论上清晰
- ❌ Python 层 MCP tools 直接访问业务数据库 (student_tools, mbti_tools 等)
- ❌ Go 层包含笔记 CRUD 后触发 Python 嵌入的 webhook 逻辑
- ❌ 缺少统一的业务数据访问抽象层

### 1.2 双路智能架构评估

**引擎路由机制** (AgentService._resolve_runtime_agent):
```python
mode = "fast" | "balanced" | "deep"
engine = "claude" | "openai"
model_tier = "haiku" | "sonnet" | "opus"  # Claude only
engine_model = "deepseek-v3.2" | "qwen3-next-80b" | ...  # OpenAI-compatible
```

**智能共享机制** (SharedMemoryService):
- Redis 存储: `agent_context:{student_id}` (跨 agent 共享上下文)
- Redis 存储: `agent_sessions:{student_id}` (会话恢复)
- PostgreSQL: `note_chunks` (笔记语义搜索，跨 agent 共享)

**评分**: 8/10
- ✅ 分层模型策略 (Haiku 快速任务, Sonnet 复杂任务)
- ✅ 运行时引擎切换 (context._runtime)
- ✅ 跨 agent 共享记忆 (Redis + pgvector)
- ❌ 缺少智能路由 (前端硬编码 agent_name)
- ❌ 缺少负载均衡和故障转移

### 1.3 WebAgent 协议编排能力

**协议版本**: `webagent-v1` (app/services/webagent_protocol.py)

**核心能力**:
1. **Planner**: 使用 quick-qa (OpenAI) 生成 DAG 计划
2. **DAG 执行**: 分层并发 (asyncio.Semaphore 控制 max_workers)
3. **Worker 类型**: reason, gather, act, synthesize
4. **依赖管理**: depends_on 字段 + artifacts 传递

**示例流程**:
```
用户请求 → Planner (生成 DAG) → 分层执行 (Layer 1: gather, Layer 2: reason, Layer 3: synthesize)
→ 最终 Agent 综合 worker 产物 → 返回结果
```

**评分**: 9/10
- ✅ 完整的 DAG 编排实现
- ✅ 多 worker 并发 + 依赖管理
- ✅ 流式事件推送 (orchestrator SSE events)
- ❌ Planner 固定使用 quick-qa，缺少 planner 选择策略
- ❌ 缺少 DAG 可视化和调试工具

### 1.4 架构瓶颈识别

| 瓶颈类型 | 描述 | 影响 | 优先级 |
|---------|------|------|--------|
| **单点故障** | Python 服务单实例，无高可用 | 服务中断影响全部 Agent 功能 | P0 |
| **业务耦合** | MCP tools 直接查询业务数据库 | 无法独立部署为通用平台 | P0 |
| **会话管理** | Redis 会话无持久化，重启丢失 | 用户体验差 | P1 |
| **前端集成** | 6/7 agents 无前端调用 | 智能能力未充分利用 | P1 |
| **扩展性** | 无水平扩展机制 | 并发能力受限 | P2 |
| **多租户** | 无租户隔离和配额管理 | 无法商业化 | P2 |

---

## 2. 抽象层设计分析

### 2.1 当前 Go 代理层分析

**文件**: `server-go/internal/handler/agent_handler.go`

**功能**:
1. JWT 认证 (middleware)
2. HTTP → Python 转发 (AgentProxyService)
3. SSE 流式代理 (bufio.Scanner)
4. 公开端点 (PublicStreamQuery, 仅允许 quick-qa/homepage-guide)

**问题**:
- ❌ 无 Agent 路由逻辑 (agent_name 由前端传入)
- ❌ 无会话管理 (session_id 透传给 Python)
- ❌ 无权限控制 (仅区分 public/authenticated)
- ❌ 无负载均衡 (单 Python 实例)

**改进方向**:
```go
// 理想的 Go 代理层应包含:
type AgentGateway struct {
    router      AgentRouter       // 智能路由 (根据 prompt 选择 agent)
    loadBalancer LoadBalancer     // 多 Python 实例负载均衡
    sessionMgr  SessionManager    // 会话管理 (Redis + PostgreSQL)
    authz       AuthzService      // 细粒度权限控制
    rateLimit   RateLimiter       // 租户配额管理
}
```

### 2.2 Agent 调度机制分析

**当前实现**: 前端硬编码 agent_name
```typescript
// src/pages/AIAdvisor.tsx
agentApi.stream({ agentName: 'quick-qa', prompt: '...' })

// src/components/notes/NoteAIPanel.tsx
agentApi.stream({ agentName: 'note-assistant', prompt: '...' })
```

**问题**:
- ❌ 无智能路由 (用户不知道该用哪个 agent)
- ❌ 无 fallback 机制 (agent 失败无降级)
- ❌ 无 A/B 测试能力

**理想架构**:
```
用户请求 → Intent Classifier (NLU) → Agent Router → 选择最佳 Agent
                                    ↓
                            [career-advisor, learning-coach, quick-qa]
                                    ↓
                            执行 + 监控 + 降级
```

### 2.3 工具注册机制分析

**文件**: `server-py/app/tools/registry.py`

**核心设计**:
```python
class ToolRegistry:
    def scan(self, extra_dirs: list[Path] | None = None):
        # 扫描 builtin/ 和 custom/ 目录
        # 每个包: manifest.yaml + tools.py

    def get_tools_for_role(self, role: str) -> list:
        # 基于 manifest.yaml 的 permissions.roles 过滤
```

**优点**:
- ✅ 插件化设计 (manifest.yaml 声明式)
- ✅ 角色权限控制 (student/teacher/admin)
- ✅ 自动发现机制

**问题**:
- ❌ 无工具版本管理 (manifest.version 未使用)
- ❌ 无工具依赖声明 (tool A 依赖 tool B)
- ❌ 无工具市场和分发机制

---

## 3. SDK 化架构设计方案

### 3.1 核心抽象层设计

```
┌─────────────────────────────────────────────────────────────┐
│  WebAgent SDK (对外提供)                                     │
│  - REST API / WebSocket / gRPC                              │
│  - 多语言客户端 (JS/Python/Go/Java)                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Agent Gateway (Go)                                         │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐ │
│  │ Agent       │ Session     │ Tool        │ Tenant      │ │
│  │ Router      │ Manager     │ Registry    │ Manager     │ │
│  └─────────────┴─────────────┴─────────────┴─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Agent Orchestrator (Python)                                │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐ │
│  │ Agent       │ Engine      │ WebAgent    │ MCP         │ │
│  │ Registry    │ Factory     │ Protocol    │ Server      │ │
│  └─────────────┴─────────────┴─────────────┴─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Business Adapter (可选)                                     │
│  - 业务数据访问接口 (REST/GraphQL)                           │
│  - 由业务系统实现并注入                                       │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Agent Registry 设计

**功能**:
- Agent 注册和发现
- Agent 元数据管理 (描述、能力、工具列表)
- Agent 版本管理

**接口**:
```go
type AgentRegistry interface {
    Register(agent AgentDefinition) error
    Discover(query AgentQuery) ([]AgentDefinition, error)
    Get(name string, version string) (AgentDefinition, error)
    List(filters AgentFilters) ([]AgentDefinition, error)
}

type AgentDefinition struct {
    Name        string
    Version     string
    Description string
    Capabilities []string  // ["text-generation", "tool-calling", "vision"]
    Tools       []string
    Model       ModelConfig
    Metadata    map[string]interface{}
}
```

### 3.3 Agent Router 设计

**功能**:
- 智能路由 (基于 prompt 分类)
- 负载均衡 (多实例)
- 故障转移 (fallback chain)

**路由策略**:
```go
type RoutingStrategy interface {
    SelectAgent(ctx context.Context, req AgentRequest) (AgentDefinition, error)
}

// 实现:
// 1. RuleBasedRouter: 关键词匹配
// 2. MLRouter: NLU 模型分类
// 3. LLMRouter: 使用 LLM 做 intent classification
// 4. HybridRouter: 组合策略
```

### 3.4 Session Manager 设计

**功能**:
- 会话创建和恢复
- 上下文管理 (跨 agent 共享)
- 会话持久化 (Redis + PostgreSQL)

**接口**:
```go
type SessionManager interface {
    Create(ctx context.Context, req SessionCreateRequest) (Session, error)
    Get(ctx context.Context, sessionID string) (Session, error)
    Update(ctx context.Context, sessionID string, updates SessionUpdates) error
    Delete(ctx context.Context, sessionID string) error
    List(ctx context.Context, filters SessionFilters) ([]Session, error)
}

type Session struct {
    ID          string
    TenantID    string
    UserID      string
    AgentName   string
    Context     map[string]interface{}
    Messages    []Message
    Metadata    map[string]interface{}
    CreatedAt   time.Time
    UpdatedAt   time.Time
    ExpiresAt   time.Time
}
```

### 3.5 Tool Registry 设计

**功能**:
- MCP 工具注册和发现
- 工具权限管理
- 工具市场和分发

**接口**:
```go
type ToolRegistry interface {
    Register(tool ToolDefinition) error
    Discover(query ToolQuery) ([]ToolDefinition, error)
    Get(name string, version string) (ToolDefinition, error)
    Execute(ctx context.Context, req ToolExecuteRequest) (ToolExecuteResponse, error)
}

type ToolDefinition struct {
    Name        string
    Version     string
    Description string
    Category    string
    Permissions ToolPermissions
    Schema      ToolSchema
    Endpoint    string  // HTTP/gRPC endpoint
}
```

### 3.6 多租户支持设计

**租户隔离**:
```go
type TenantManager interface {
    Create(ctx context.Context, tenant Tenant) error
    Get(ctx context.Context, tenantID string) (Tenant, error)
    Update(ctx context.Context, tenantID string, updates TenantUpdates) error
    Delete(ctx context.Context, tenantID string) error
}

type Tenant struct {
    ID          string
    Name        string
    Quota       TenantQuota
    Config      TenantConfig
    Status      TenantStatus
    CreatedAt   time.Time
}

type TenantQuota struct {
    MaxRequests     int64   // 每月最大请求数
    MaxCostUSD      float64 // 每月最大费用
    MaxConcurrency  int     // 最大并发数
    MaxAgents       int     // 最大 agent 数
    MaxTools        int     // 最大工具数
}
```

**配额管理**:
- Redis 计数器 (滑动窗口)
- PostgreSQL 账单记录
- 实时监控和告警

### 3.7 接口设计

#### REST API
```
POST   /v1/agents/query          # 同步查询
POST   /v1/agents/stream         # SSE 流式查询
GET    /v1/agents                # 列出 agents
GET    /v1/agents/{name}         # 获取 agent 详情
POST   /v1/agents/{name}/invoke  # 调用指定 agent

GET    /v1/sessions              # 列出会话
POST   /v1/sessions              # 创建会话
GET    /v1/sessions/{id}         # 获取会话
PUT    /v1/sessions/{id}         # 更新会话
DELETE /v1/sessions/{id}         # 删除会话

GET    /v1/tools                 # 列出工具
POST   /v1/tools/execute         # 执行工具

GET    /v1/tenants/{id}/usage    # 租户用量
GET    /v1/tenants/{id}/billing  # 租户账单
```

#### WebSocket
```
ws://api.webagent.ai/v1/stream?session_id=xxx&tenant_id=xxx

// 消息格式:
{
  "type": "query",
  "agent": "career-advisor",
  "prompt": "...",
  "context": {}
}

// 响应格式:
{
  "type": "text" | "tool_call" | "orchestrator" | "done",
  "content": "...",
  "metadata": {}
}
```

#### SDK 客户端 (JavaScript)
```typescript
import { WebAgentClient } from '@webagent/sdk';

const client = new WebAgentClient({
  apiKey: 'wa_xxx',
  tenantId: 'tenant_xxx',
});

// 同步查询
const result = await client.query({
  agent: 'career-advisor',
  prompt: '我适合什么职业？',
  context: { mbti: 'INTJ' },
});

// 流式查询
const stream = client.stream({
  agent: 'learning-coach',
  prompt: '帮我制定学习计划',
});

for await (const chunk of stream) {
  if (chunk.type === 'text') {
    console.log(chunk.content);
  }
}

// 会话管理
const session = await client.sessions.create({
  agent: 'quick-qa',
  context: { user_id: 'user_123' },
});

await client.sessions.query(session.id, {
  prompt: '继续上次的话题',
});
```

### 3.8 Plugin 机制设计

**第三方 Agent 接入**:
```yaml
# agent-plugin.yaml
name: custom-agent
version: 1.0.0
description: 自定义 agent
engine: claude
model: sonnet
tools:
  - custom_tool_1
  - custom_tool_2
endpoint: https://my-agent.example.com/invoke
auth:
  type: bearer
  token: ${CUSTOM_AGENT_TOKEN}
```

**MCP 协议支持**:
- 标准 MCP Server 接入
- 工具自动发现和注册
- 权限和配额管理

---

## 4. 演进路径

### Phase 1: 解耦业务逻辑 (2-3 周)

**目标**: 将 MCP tools 从直接访问数据库改为调用业务 API

**任务**:
1. 在 Go 后端新增 Business API 层
   - `GET /api/business/students/{id}/profile`
   - `GET /api/business/mbti/{code}/info`
   - `GET /api/business/careers/search`
   - 等 24 个业务接口

2. 修改 Python MCP tools 调用 Go Business API
   - 使用 httpx 替代直接数据库查询
   - 添加 API 认证 (内部 token)

3. 配置化业务 API 地址
   - 环境变量: `BUSINESS_API_URL`
   - 支持多业务系统接入

**验收标准**:
- Python 服务无 PostgreSQL 依赖
- MCP tools 通过 HTTP 调用业务数据
- 可独立部署 Python 服务

### Phase 2: 抽象 Agent 调度层 (3-4 周)

**目标**: 在 Go 层实现 Agent Router 和 Session Manager

**任务**:
1. 实现 AgentRouter
   - 规则路由 (关键词匹配)
   - 默认 agent 选择策略
   - Fallback chain

2. 实现 SessionManager
   - Redis 会话存储
   - PostgreSQL 会话持久化
   - 会话恢复和清理

3. 实现负载均衡
   - 多 Python 实例注册
   - 健康检查
   - 轮询/最少连接策略

4. 前端集成改造
   - 移除硬编码 agent_name
   - 使用智能路由接口
   - 会话恢复 UI

**验收标准**:
- 前端无需指定 agent_name
- 支持多 Python 实例
- 会话可恢复

### Phase 3: SDK 化封装 (4-6 周)

**目标**: 提供标准 SDK 和 API

**任务**:
1. 设计 REST API v1
   - OpenAPI 3.0 规范
   - 版本管理
   - 错误码标准化

2. 实现多租户支持
   - TenantManager
   - 配额管理
   - 计费系统

3. 开发 SDK 客户端
   - JavaScript/TypeScript
   - Python
   - Go

4. 文档和示例
   - API 文档
   - SDK 使用指南
   - 示例项目

**验收标准**:
- 完整 REST API
- 3 种语言 SDK
- 多租户隔离

### Phase 4: 开放平台和生态 (6-8 周)

**目标**: 构建 Agent 和 Tool 市场

**任务**:
1. Agent 市场
   - Agent 注册和发布
   - Agent 版本管理
   - Agent 评分和评论

2. Tool 市场
   - MCP Tool 注册和发布
   - Tool 权限审核
   - Tool 使用统计

3. 开发者平台
   - 开发者控制台
   - API Key 管理
   - 用量监控和告警

4. 生态建设
   - 社区论坛
   - 技术博客
   - 开发者大会

**验收标准**:
- Agent/Tool 市场上线
- 开发者控制台
- 100+ 注册开发者

---

## 5. 架构演进对比

| 维度 | 当前架构 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|------|---------|---------|---------|---------|---------|
| **业务耦合** | 强耦合 | 解耦 | 解耦 | 解耦 | 解耦 |
| **智能路由** | 无 | 无 | 有 | 有 | 有 |
| **负载均衡** | 无 | 无 | 有 | 有 | 有 |
| **会话管理** | 弱 | 弱 | 强 | 强 | 强 |
| **多租户** | 无 | 无 | 无 | 有 | 有 |
| **SDK 支持** | 无 | 无 | 无 | 有 | 有 |
| **插件机制** | 有 | 有 | 有 | 有 | 强 |
| **开放平台** | 无 | 无 | 无 | 无 | 有 |
| **智能化评分** | 7.5 | 7.5 | 8.5 | 9.0 | 9.5 |

---

## 6. 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| **业务 API 性能** | 高 | 中 | 缓存 + 批量查询 + 异步化 |
| **会话存储成本** | 中 | 高 | TTL 策略 + 冷热分离 |
| **多租户隔离** | 高 | 低 | 严格权限控制 + 审计日志 |
| **SDK 兼容性** | 中 | 中 | 语义化版本 + 弃用策略 |
| **生态冷启动** | 高 | 高 | 官方 Agent/Tool + 激励计划 |

---

## 7. 成本估算

### 开发成本
- Phase 1: 2 人 × 3 周 = 6 人周
- Phase 2: 3 人 × 4 周 = 12 人周
- Phase 3: 4 人 × 6 周 = 24 人周
- Phase 4: 5 人 × 8 周 = 40 人周
- **总计**: 82 人周 (约 20 人月)

### 基础设施成本 (月)
- Redis Cluster: $200
- PostgreSQL HA: $500
- Python 服务 (3 实例): $600
- Go 服务 (2 实例): $400
- 监控和日志: $300
- **总计**: $2000/月

---

## 8. 结论

PathMind AI 已具备完整的 Agent 编排能力和工具生态，当前架构智能化程度 **7.5/10**。通过 4 阶段演进，可将其转型为通用 WebAgent 平台，最终智能化程度可达 **9.5/10**。

**核心优势**:
1. 完整的 WebAgent 协议实现
2. 双引擎路由和分层模型策略
3. 插件化工具注册机制
4. 跨 agent 共享记忆

**关键挑战**:
1. 业务逻辑解耦 (Phase 1 重点)
2. 智能路由和负载均衡 (Phase 2 重点)
3. 多租户和计费系统 (Phase 3 重点)
4. 生态冷启动 (Phase 4 重点)

**建议优先级**:
1. **立即启动**: Phase 1 (解耦业务逻辑)
2. **3 个月内**: Phase 2 (抽象调度层)
3. **6 个月内**: Phase 3 (SDK 化)
4. **12 个月内**: Phase 4 (开放平台)

---

**附录**:
- A. 当前架构详细流程图
- B. SDK API 完整规范
- C. 多租户数据模型设计
- D. 工具市场技术方案

**文档版本**: v1.0
**最后更新**: 2026-02-20
