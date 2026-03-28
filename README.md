<div align="center">

# PathMind

**AI-Powered Personalized Learning Path System**

*Web-Local-Cloud 三端协同的 AI Agent 协议框架*

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org/)

</div>

---

## 愿景与定位

PathMind 的初衷源于一个核心问题：**如何让 AI Agent 真正穿透界面，操控真实的数字系统和物理世界？**

我们观察到两条技术路线的并行演进：

- **Web 端路线** — Claude Code、Codex 等工具在本地展现出强大的编程能力；OpenClaw 等新型 Agent 已能操控飞书、微信等平台
- **CLI 框架路线** — Ink、@opentui/core 等 TUI 框架的兴起，使得"终端即应用"成为可能

然而这两条路线**底层是割裂的**。每个平台（Web/Desktop/Mobile/Embedded）都维护自己独立的 Agent 实现，协议无法互通，工具无法复用。

PathMind 的回答是：**构建三层通讯架构，在轻量 CLI 总线之上，垂直领域应用与 Web 端协议层各司其职，底层接口向开发者完全开放，甚至可为具身智能物理设备预留接口。**

---

## 三层架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  应用层 (Application Layer)                                                  │
│  ├── Web 端协议 — AI Agent 直接操控 Web 元素与组件                          │
│  └── 垂直领域 — 学习路径、笔记智能、MBTI 分析、职业推荐等业务模块             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  通讯总线 (Communication Bus)                                         │   │
│  │  ├── SSE/WebSocket 通道 (Go → React)                                 │   │
│  │  ├── stdio Bridge (Go → Local CLI)                                   │   │
│  │  └── 统一事件协议 (OPC — Open Protocol for Agents)                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  基础设施层 (CLI Bus)                                                        │
│  ├── Linux / Windows / macOS                                               │
│  ├── Android / iOS (终端设备)                                              │
│  ├── 具身智能物理设备接口 (嵌入式 AI 节点)                                  │
│  └── 开放扩展接口 — 开发者可基于 stdio 接口自由拓展                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

**核心价值主张：**

- **开发者**：在 CLI Bus 层留出的接口上自由拓展，无需改动上层业务代码
- **垂直领域**：在应用层专注于业务逻辑，接入统一的 Agent 通讯能力
- **具身智能**：物理设备可通过标准 stdio 接口接入总线，成为可被 AI 操控的节点

---

## 技术架构

```
React 19 + Vite + Tailwind CSS 4
        ↓ HTTP/SSE
Go (Gin) — JWT 认证 / CRUD / SSE 代理
        ↓ HTTP 代理
Python (FastAPI) — Claude Agent SDK / MCP 工具 / RAG
        ↓
PostgreSQL + pgvector | Redis | Neo4j
```

### AI Agent 体系（Python 层）

| Agent | 模型 | 工具数 | 职责 |
|-------|------|--------|------|
| command-center | Sonnet | 13 | 中枢路由 + UI 控制 |
| note-assistant | Haiku | 11 | 笔记智能处理 |
| career-advisor | Sonnet | 9 | 职业规划 |
| learning-coach | Sonnet | 12 | 学习路径指导 |
| code-reviewer | Sonnet | 4 | 代码审查 |
| document-reader | Haiku | 6 | 文档理解 |
| quick-qa | Haiku | 8 | 快速问答 |
| mbti-analyst | Haiku | 7 | MBTI 分析 |

### MCP 工具生态（23 个工具，8 大类）

Student / MBTI / Career / Experiment / Document-RAG / Knowledge Graph / Gamification / Notes

### 通讯协议（OPC 设计草案）

> 参见 `docs/opc-protocol-draft.md`

核心设计原则：
- **传输层解耦**：SSE / WebSocket / stdio 三通道共用同一消息格式
- **渲染指令分离**：`render` 指令让终端自行决定如何呈现，AI 输出与 UI 布局解耦
- **差量更新**：`diff_patch` 机制避免高频区域全量刷新

---

## 核心技术亮点

### CLI TUI 渲染（参考 OpenCode / QuickCLI）

终端输出采用 Flexbox 布局 + 24-bit ANSI 真彩色，零外部库依赖：

```typescript
// 布局指令示例
{ "type": "render", "action": "box", "id": "msg_001",
  "layout": { "flex_direction": "column", "gap": 1 },
  "style": { "border": { "style": "round", "color": "#36A4D9" } } }

// 差量更新
{ "type": "diff_patch", "region": "notes_preview",
  "patch": [{ "op": "replace", "path": "/title", "value": "新标题" }] }
```

### 导航意图识别（FloatingAgent.tsx）

AI 能理解"带我去笔记页面"等自然语言导航指令，自动跳转并联动对应面板：

```typescript
// 路由解析示例
"/documents" ← ["pdf工作台", "文档实验区"]
"/learning-path" ← ["学习路径", "learning-path"]
"/notes" ← ["笔记", "notes 页"]
```

### Agent 委托架构

```
FloatingAgent (灵动岛)
    ↓ 用户输入
command-center (中枢，13 工具)
    ↓ delegate_to_agent
note-assistant (侧栏编辑) / career-advisor / learning-coach ...
```

---

## 项目结构

```
PathMind-AI/
├── src/                          # React 前端
│   ├── components/
│   │   ├── FloatingAgent.tsx      # 灵动岛 Agent 入口
│   │   ├── ui/                   # TUI 风格组件
│   │   └── notes/                # 笔记系统组件
│   ├── hooks/
│   │   └── useAgentStream.ts     # SSE 流式消费 Hook
│   ├── contexts/
│   │   └── AgentSessionContext.tsx
│   └── services/
│       └── api.ts                # 统一 API 客户端
│
├── server-go/                    # Go 后端
│   └── cmd/server/main.go
│       └── internal/
│           ├── handler/          # HTTP Handler (agent / mbti / notes...)
│           ├── service/          # 业务逻辑 (agent_proxy / auth / mbti...)
│           ├── middleware/       # JWT / CORS / Metrics
│           └── repository/       # PostgreSQL / Redis / Neo4j
│
├── server-py/                    # Python Agent 服务
│   └── app/
│       ├── agents/registry.py    # 8 个 Agent 定义
│       ├── engines/             # 多引擎支持 (Claude / OpenAI / 本地)
│       ├── mcp_tools/           # 23 个 MCP 工具
│       └── api/agent_routes.py   # FastAPI 路由
│
└── docs/
    └── opc-protocol-draft.md     # OPC 协议草案
```

---

## 快速开始

```bash
# 前端
npm install && npm run dev          # port 5173

# Go 后端
cd server-go && go run cmd/server/main.go   # port 8080

# Python Agent 服务
cd server-py && uvicorn app.main:app --port 9090
```

**环境变量：**

| 服务 | 必需变量 |
|------|---------|
| Go | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `AGENT_SERVICE_URL` |
| Python | `ANTHROPIC_API_KEY`, `NVIDIA_API_KEY`, `DATABASE_URL` |

---

## 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 前端框架 | React 19 + Vite | 组件化开发 |
| 语言 | TypeScript 5.9 | 类型安全 |
| 样式 | Tailwind CSS 4 | Utility-first |
| 后端 | Go (Gin) | 高性能 HTTP 代理 |
| Agent 引擎 | Python (FastAPI) | Claude Agent SDK |
| 主数据库 | PostgreSQL + pgvector | 关系 + 向量检索 |
| 缓存 | Redis | 会话与指标缓存 |
| 知识图谱 | Neo4j | 学习路径图谱查询 |
| AI 模型 | Claude (Anthropic) + NVIDIA NIM | LLM 推理 |

---

## License

MIT © 2025 PathMind
