# PathMind AI 架构深度分析报告

**生成时间**: 2026-02-20
**协议版本**: webagent.v1
**分析范围**: 三层架构 + WebAgent 编排协议 + 双路智能引擎

---

## 执行摘要

PathMind AI 采用三层解耦架构（React → Go → Python Agent），通过 HTTP/SSE 实现前后端分离和服务隔离。Python 层实现了 **webagent-protocol-v1** 编排协议，支持 DAG 多 worker 并发执行，并通过统一的 BaseEngine 抽象层实现 Claude 和 OpenAI 双路智能切换。

**核心优势**:
- 清晰的职责边界：Go 负责业务逻辑和权限控制，Python 专注 AI 编排
- 可扩展的引擎抽象：新增 LLM 提供商只需实现 BaseEngine 接口
- 标准化的编排协议：webagent.v1 协议可独立打包为 SDK

**主要挑战**:
- 业务逻辑与通用能力耦合（8 agents 硬编码在 registry.py）
- 缺少 artifact contract（worker 产物格式未标准化）
- 跨引擎状态管理依赖 Redis，缺少持久化层

---

## 1. 三层架构评估

### 1.1 架构图

```mermaid
graph TB
    subgraph "Frontend Layer (React 19)"
        A[Browser] --> B[Vite Dev Server :5173]
        B --> C[React Components]
        C --> D[API Client<br/>src/services/client.ts]
        D --> E[Agent API<br/>src/services/api.ts]
    end

    subgraph "Backend Layer (Go Gin :8080)"
        F[JWT Middleware] --> G[AgentHandler]
        G --> H[AgentProxyService]
        H --> I[HTTP Client]
        I --> J[SSE Scanner<br/>bufio.Scanner]
    end

    subgraph "Agent Layer (Python FastAPI :9090)"
        K[agent_routes.py] --> L[AgentService]
        L --> M{Orchestrator?}
        M -->|Yes| N[Planner]
        M -->|No| O[Direct Execution]
        N --> P[DAG Executor]
        P --> Q[Worker Pool]
        O --> R[EngineFactory]
        Q --> R
        R --> S{Engine Type}
        S -->|Claude| T[ClaudeEngine<br/>Agent SDK]
        S -->|OpenAI| U[OpenAIEngine<br/>httpx]
        T --> V[MCP Tools<br/>24 tools]
        U --> V
    end

    subgraph "Data Layer"
        W[(PostgreSQL<br/>pgvector)]
        X[(Redis<br/>Session/Context)]
        Y[(Neo4j<br/>Knowledge Graph)]
    end

    E -->|POST /api/agent/stream| F
    J -->|Proxy SSE| K
    V --> W
    L --> X
    V --> Y

    style M fill:#ff9
    style R fill:#9f9
    style V fill:#99f
