# PathMind WebAgent 演进路线图
## AI 原生 Web 智能演进规划

**文档版本**: v1.0
**创建日期**: 2026-02-20
**规划师**: WebAgent 专席规划师
**目标**: 从 MBTI 学习系统到通用 WebAI 平台

---

## 执行摘要

PathMind AI 当前已实现基础的 WebAgent 编排能力（planner + DAG executor + worker），但距离"AI 原生 Web 生存智能"还有显著差距。本路线图基于现状评估，提出 4 个演进阶段，预计 18-24 个月完成从业务系统到通用 WebAI 平台的转型。

**核心发现**:
- 智能化程度: **6.5/10** — 具备 DAG 编排和多模型分层，但缺乏自主决策和外部工具集成
- MCP 协议集成: **内部实现完整，外部集成缺失** — 未支持标准 MCP stdio/SSE transport
- Skill Engine: **基础可用，扩展性受限** — 仅 3 个 skills，无组合能力和 marketplace
- Web 智能能力: **0/10** — 无浏览器自动化、无 DOM 操作、无视觉导航

---

## 执行进展快照（2026-02-21）

> 本节用于同步路线图与当前代码落地状态，避免规划与实现脱节。

### 已完成（P4-1A / P4-1B）
- ✅ Go 网关稳定性首批：Agent 限流、连接池治理、超时治理、轻量熔断、503 语义化。
- ✅ Python 启动参数化：`PATHMIND_UVICORN_*` 并发/超时/队列参数已接入。
- ✅ 容器启动统一：`server-py` 容器改为 `python -m app.main`，配置路径统一。

### 已完成（P4-1C 基础能力）
- ✅ 指标采集与查询：429/503/latency/circuit state 已接入网关内存指标并提供查询接口。
- ⏳ 告警策略：阈值告警与外部监控系统联动待后续接入。

### 后续衔接
- ✅ P4-2A 已启动并落地：Embedding/RAG 缓存骨架 + 命中统计。
- ✅ P4-2B 已完成：note/unified search 缓存扩展。
- ✅ P4-2C 首版完成：已生成 cold/warm 基线报告（JSON + Markdown）。

## 第一部分: 智能化程度评估

### 1.1 当前架构分析

#### 核心组件

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentService (Orchestrator)               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Planner    │→ │ DAG Executor │→ │  Synthesizer │      │
│  │ (quick-qa)   │  │ (multi-worker)│  │ (base agent) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
         ↓                    ↓                    ↓
┌─────────────────────────────────────────────────────────────┐
│              ToolRegistry (24 MCP Tools)                     │
│  Student | MBTI | Career | Document | Note | Graph | ...    │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│         EngineFactory (Claude + NVIDIA OpenAI-compatible)    │
│  Sonnet | Haiku | DeepSeek v3.2 | Qwen3-next-80b           │
└─────────────────────────────────────────────────────────────┘
```

#### 实现细节

**Planner (规划器)**:
- 模型: `quick-qa` agent (Qwen3-next-80b, fast mode)
- 输出: JSON Schema 定义的 DAG 计划 (WebAgentPlan)
- 节点类型: `reason` | `gather` | `act` | `synthesize`
- 模式选择: `fast` | `balanced` | `deep` (基于复杂度自动选择)
- 限制: max_steps=5, max_workers=3 (可配置 2-12, 1-8)

**DAG Executor (执行器)**:
- 拓扑排序: 构建层级依赖图 (build_dag_layers)
- 并发控制: asyncio.Semaphore 限制并发 worker 数
- 容错机制: asyncio.gather(return_exceptions=True) 捕获单节点失败
- 依赖注入: 上游 artifacts 通过 prompt 注入下游 worker

**Worker (工作节点)**:
- 类型特化: 每种 kind 有默认 mode (reason→deep, gather→fast, act→balanced, synthesize→deep)
- 工具过滤: 根据 node.tools 字段限制可用工具 (当前未实现)
- 上下文传递: 依赖节点的 summary + response_preview 注入 prompt
- 成本追踪: 每个 worker 记录 input_tokens, output_tokens, cost_usd

**Synthesizer (综合器)**:
- 模型: 使用 base agent (如 career-advisor 用 Sonnet)
- 输入: 原始 prompt + DAG 计划 + 所有 worker artifacts
- 输出: 最终用户响应 (text 或 structured_output)

### 1.2 智能化能力矩阵

| 能力维度 | 当前状态 | 评分 | 业界标准 (LangGraph/AutoGPT) |
|---------|---------|------|------------------------------|
| **任务分解** | ✅ Planner 生成 DAG | 7/10 | LangGraph: 手动定义图结构 |
| **并发执行** | ✅ 层级并发 (semaphore) | 8/10 | AutoGPT: 串行执行 |
| **依赖管理** | ✅ 拓扑排序 + 依赖注入 | 7/10 | LangGraph: 显式边定义 |
| **容错恢复** | ⚠️ 捕获异常但不重试 | 5/10 | BabyAGI: 无容错 |
| **自主决策** | ❌ 无动态调整能力 | 3/10 | AutoGPT: 有 self-critique |
| **工具选择** | ⚠️ 静态工具列表 | 4/10 | LangGraph: 动态工具绑定 |
| **记忆管理** | ✅ shared_memory (summary) | 6/10 | AutoGPT: 向量记忆 |
| **成本优化** | ✅ 分层模型 (Haiku/Sonnet) | 8/10 | 业界少见 |
| **流式输出** | ✅ SSE 事件流 | 9/10 | LangGraph: 支持 streaming |
| **可观测性** | ✅ orchestrator 事件 | 7/10 | LangSmith: 完整 trace |

**综合评分: 6.5/10**

### 1.3 与业界标准对比

#### LangGraph (LangChain)
- **优势**: 显式图定义，状态管理清晰，工具生态丰富
- **劣势**: 手动编排，无自动规划，成本高 (全 GPT-4)
- **PathMind 优势**: 自动 DAG 规划，分层模型降低成本

#### AutoGPT
- **优势**: 自主循环，self-critique，长期记忆
- **劣势**: 串行执行慢，成本爆炸，易陷入循环
- **PathMind 优势**: 并发执行，成本可控，有明确终止条件

#### BabyAGI
- **优势**: 任务队列管理，优先级排序
- **劣势**: 无 DAG 依赖，无容错，工具集成弱
- **PathMind 优势**: DAG 依赖管理，工具集成完整

### 1.4 关键缺陷

1. **无自主决策**: Planner 一次性生成计划，无法根据 worker 结果动态调整
2. **工具选择静态**: node.tools 字段未实际使用，worker 可访问所有工具
3. **无重试机制**: worker 失败后不重试，直接标记 error
4. **无反思能力**: 缺少 self-critique 节点验证输出质量
5. **记忆浅层**: 仅保存 summary (120 chars)，无向量检索

---

## 第二部分: 外部 MCP 协议集成分析

### 2.1 当前 MCP 实现

#### 内部 MCP 工具 (24 个)

**工具包结构** (`app/tools/builtin/`):
```
builtin/
├── student/     (3 tools) — get_student_profile, get_learning_history, get_learning_progress
├── mbti/        (3 tools) — get_mbti_type_info, get_psycot_questions, score_mbti_dimension
├── career/      (2 tools) — search_careers, get_learning_path
├── document/    (3 tools) — search_documents, get_document_summary, unified_search
├── note/        (4 tools) — search_notes, semantic_search_notes, get_note_content, create_note
├── graph/       (3 tools) — query_knowledge_graph, get_learning_path, get_related_concepts
├── points/      (3 tools) — get_point_balance, get_achievements, get_leaderboard
├── experiment/  (2 tools) — get_experiment_details, validate_code_syntax
├── homepage/    (9 tools) — emit_ui_command, navigate_page, show_toast, scroll_to_section, ...
└── search/      (1 tool)  — unified_search (跨文档+笔记+代码)
```

**工具注册机制**:
- `ToolRegistry.scan()` 自动发现 `manifest.yaml` + `tools.py`
- `@tool` 装饰器创建 `SdkMcpTool` 对象
- `create_sdk_mcp_server()` 构建 MCP 服务器
- 权限控制: manifest.yaml 定义 `permissions.roles`

**评估**: ✅ 内部 MCP 实现完整，架构清晰，可扩展性强

### 2.2 外部 MCP 协议支持

#### 标准 MCP 协议

**官方规范** (@modelcontextprotocol):
- **Transport**: stdio (子进程通信) | SSE (HTTP 流式)
- **协议**: JSON-RPC 2.0
- **能力**: tools, resources, prompts, sampling
- **官方工具**: fetch (HTTP), filesystem (文件), brave-search (搜索), puppeteer (浏览器)

**PathMind 当前状态**: ❌ **完全不支持**

检查结果:
```bash
# 依赖已安装
.venv/lib/python3.14/site-packages/mcp/
├── client/stdio.py  — stdio_client
├── server/stdio.py  — stdio_server
└── cli/cli.py       — MCP inspector

# 但项目代码中无任何使用
grep -r "stdio_client\|stdio_server\|StdioServerParameters" server-py/app/
# 结果: 0 匹配
```

### 2.3 外部 MCP 集成方案

#### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentService                              │
│                         ↓                                    │
│              ToolRegistry (Unified)                          │
│         ┌──────────────┴──────────────┐                     │
│         ↓                              ↓                     │
│  BuiltinTools (24)          ExternalMcpTools (dynamic)      │
│  - student                   - @modelcontextprotocol/fetch  │
│  - mbti                      - @modelcontextprotocol/brave  │
│  - career                    - @modelcontextprotocol/fs     │
│  - ...                       - custom MCP servers           │
└─────────────────────────────────────────────────────────────┘
         ↓                              ↓
┌──────────────────┐          ┌──────────────────┐
│  Internal API    │          │  MCP Client      │
│  (Go backend)    │          │  (stdio/SSE)     │
└──────────────────┘          └──────────────────┘
```

#### 实施步骤

**Phase 1: MCP Client 基础设施** (2 周)

1. 创建 `app/tools/external/` 目录
2. 实现 `McpClientManager`:
   ```python
   class McpClientManager:
       async def connect_stdio(self, command: list[str], env: dict) -> McpClient
       async def connect_sse(self, url: str, headers: dict) -> McpClient
       async def list_tools(self, client_id: str) -> list[SdkMcpTool]
       async def call_tool(self, client_id: str, tool_name: str, args: dict) -> Any
   ```
3. 配置文件 `mcp_servers.yaml`:
   ```yaml
   servers:
     - id: fetch
       type: stdio
       command: ["npx", "@modelcontextprotocol/server-fetch"]
       tools: [fetch, post]

     - id: brave-search
       type: stdio
       command: ["npx", "@modelcontextprotocol/server-brave-search"]
       env:
         BRAVE_API_KEY: ${BRAVE_API_KEY}
       tools: [brave_web_search, brave_local_search]

     - id: filesystem
       type: stdio
       command: ["npx", "@modelcontextprotocol/server-filesystem"]
       args: ["/tmp/pathm