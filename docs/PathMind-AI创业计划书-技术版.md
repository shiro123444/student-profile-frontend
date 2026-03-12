# PathMind AI 创业计划书
## 基于 Claude Agent SDK + MCP 协议的智能职业规划系统

---

## 一、核心技术创新（技术壁垒）

### 1.1 多智能体编排架构

**11 个专业 AI Agents 协同工作**：
- command-center（Sonnet）：中枢编排，路由分发，13 个核心工具
- career-advisor（Sonnet）：职业规划，9 个工具
- learning-coach（Sonnet）：学习路径，12 个工具
- graph-analyst（Sonnet）：知识图谱分析，10 个工具
- note-assistant（Haiku/Qwen3）：笔记管理，11 个工具
- mbti-analyst（Sonnet）：性格分析，7 个工具
- code-reviewer（Sonnet）：代码审查，4 个工具
- web-coder（Sonnet）：代码编辑（沙箱隔离），13 个工具
- document-reader（Haiku/Qwen3）：文档理解，6 个工具
- quick-qa（Haiku/Qwen3）：快速问答，8 个工具
- homepage-guide（Haiku）：新手引导，11 个工具

**委托编排模式**：
- command-center 通过 `delegate_to_agent` 工具委托任务给专业 agent
- 支持批量委托 `delegate_batch_agents`（best_effort / all_or_nothing 模式）
- 跨组件事件通讯：FloatingAgent 发送 `focus_note_panel` UI 指令 → NotesPage 监听 `pathmind:focus-note-panel` 事件 → 打开 NoteAIPanel

**技术优势**：
- 工具按需加载，command-center 从 47 工具精简到 13 工具，启动时间从 ~2-3s → ~0.5s
- 职责清晰：灵动岛路由，侧栏编辑，避免单一 agent 过载
- 用户体验：在灵动岛发起 → 侧栏确认 diff preview

### 1.2 MCP 协议工具系统

**24 个标准化 MCP 工具**（8 大类）：
- Student (3): get_student_profile, get_learning_progress, get_learning_history
- MBTI (3): get_mbti_type_info, get_quick_mbti_insight, get_psycot_questions
- Career (2): search_careers, get_trending_careers
- Experiment (2): get_experiment_details, submit_experiment
- Document/RAG (3): search_documents, get_document_content, unified_search
- Knowledge Graph (4): query_knowledge_graph, emit_graph_command, emit_graph_batch, get_learning_path
- Gamification (3): get_point_balance, get_achievements, get_leaderboard
- Notes (4): search_notes, semantic_search_notes, create_note, update_note

**模块化工具包架构**：
```
app/tools/
  builtin/          # 内置工具包
    student/
      manifest.yaml # 声明工具名、版本、权限
      tools.py      # @tool 装饰器定义工具
    mbti/
    career/
    ...
  custom/           # 用户自定义工具包
  external/         # 外部 MCP 服务器（mcp_servers.yaml）
  registry.py       # 统一注册表，扫描三源工具
```

**技术优势**：
- 符合 MCP 标准，可与其他 MCP 客户端互操作
- 支持 builtin/custom/external 三源扩展
- 权限分级：manifest.yaml 声明 roles: [student, teacher, admin]
- 工具发现：GET /api/agent/tools 返回完整工具目录

### 1.3 三引擎混合推理

**Claude Agent SDK**（主引擎）：
- 通过 CLI 子进程调用，支持完整 MCP 工具编排
- 自动工具循环（tool use → tool result → next step）
- 支持流式输出（SSE）
- 模型：claude-sonnet-4.6, claude-haiku-4.5, claude-opus-4.6

**Anthropic SDK**（备用引擎）：
- 直接 HTTP 调用，轻量但需自己实现工具循环
- 用于简单问答场景

**NVIDIA NIM**（多模态引擎）：
- OpenAI-compatible API，支持 186 个模型
- 对话：deepseek-v3.2, qwen3-next-80b, qwq-32b
- Embedding：nv-embedqa-e5-v5 (1024d), nv-embedcode-7b (4096d)
- Vision OCR：llama-3.2-90b-vision, phi-4-multimodal

**分层模型策略**：
- 简单任务（quick-qa, document-reader, note-assistant）：Haiku 或 Qwen3（快速响应，低成本）
- 复杂任务（career-advisor, learning-coach, mbti-analyst）：Sonnet（深度推理）
- 自动 fallback：Sonnet → Sonnet-fallback → Haiku（首字节超时 8s 触发）

**技术优势**：
- 成本优化：Haiku 处理 70% 简单任务，成本降低 80%
- 可用性保障：三引擎互备，单点故障不影响服务
- 多模态能力：Vision OCR 处理扫描版 PDF

### 1.4 流式事件驱动范式

**三层架构**：
```
React 19 前端（SSE 客户端）
    ↓ HTTP/SSE
Go 后端（高性能代理，8080 端口）
    ↓ HTTP proxy
Python Agent 服务（FastAPI，9090 端口）
    ↓
Claude Agent SDK / Anthropic SDK / NVIDIA NIM
```

**Go 代理层**（agent_handler.go）：
- bufio.Scanner 逐行代理 Python SSE 响应
- 120s 超时保护
- JWT 认证 + 用户上下文注入
- Metrics 采集（observability.RecordAgentRequest）

**Python Agent 服务**（engines/claude_engine.py）：
- 异步流式生成：`async def stream() -> AsyncIterator[str]`
- 前端控制事件检测：`build_frontend_events(tool_name, tool_input)`
- 工具执行结果事件：`build_frontend_events_from_result(tool_name, tool_input, tool_result)`
- SSE 事件类型：
  - `{"type": "text", "text": "..."}` — 文本流
  - `{"type": "navigate", "to": "/careers"}` — 页面跳转
  - `{"type": "ui_command", "command": "spotlight", "target": "features"}` — UI 控制
  - `{"type": "toast", "message": "...", "level": "info"}` — 通知提示
  - `{"type": "graph_command", "command": "focus_node", "target": "node_id"}` — 图谱控制
  - `{"type": "agent_handoff", "stage": "start", "target_agent": "note-assistant"}` — Agent 委托

**React 前端**（useAgentStream.ts）：
- EventSource polyfill（SSE 客户端）
- 逐行解析 JSON 事件
- 分发到不同 handler：onText, onNavigate, onUICommand, onToast, onGraphCommand, onAgentHandoff
- AbortController 支持取消

**技术优势**：
- 实时体验：类 ChatGPT 的流式输出
- 前端联动：Agent 可直接控制页面（跳转、高亮、通知）
- 高性能：Go 代理层零拷贝转发，Python 异步生成
- 可观测：每个请求记录 agent_name, workspace_id, latency, tokens

### 1.5 工具沙箱与审批机制

**高风险工具审批**（coding_policy.py）：
- 高风险工具：code_write_file, code_edit_file, code_git_commit, code_shell_exec
- 审批流程：
  1. Agent 调用高风险工具 → Python 服务拦截
  2. 生成审批请求（request_id, tool_name, args_preview, risk_level）
  3. 存入 Redis（approval_broker.py）
  4. 前端轮询 GET /api/agent/approval/pending
  5. 用户审批：POST /api/agent/approval/{id}/approve 或 /reject
  6. Python 服务收到审批结果 → 继续执行或拒绝

**沙箱隔离**（web-coder agent）：
- 工作目录：`/tmp/pathmind-workspace/{workspace_id}`
- 禁止访问父目录（../ 检测）
- 禁止网络命令（curl, wget）
- Git 操作限制：仅允许 add, commit, branch, log, diff, status

**审批超时**：
- 默认 60s，超时自动拒绝
- 可配置：get_approval_timeout_sec()

**技术优势**：
- 安全性：用户可审查每个文件修改、Git 操作
- 可审计：所有工具调用记录到 audit_log 表（audit_client.py）
- 灵活性：可配置审批策略（coding_policy_profiles）

### 1.6 多模态 RAG 检索

**三路并行检索**：
1. **文档语义检索**（document_chunks 表）：
   - Vision OCR：llama-3.2-90b-vision 提取 PDF 文本（中文最准）
   - Smart chunk：400 chars 分块（nv-embedqa-e5-v5 限制 512 tokens）
   - pgvector 1024 维向量检索（HNSW 索引）

2. **笔记语义检索**（note_chunks 表）：
   - 实时嵌入：Go CRUD webhook → Python NoteEmbeddingService → embed → note_chunks
   - 支持 semantic_search_notes（语义）和 search_notes（关键词/标签）

3. **代码语义检索**（code_chunks 表）：
   - nv-embedcode-7b（4096 维）
   - IVFFlat 索引（HNSW 不支持 >2000 dims）

**unified_search 工具**：
- 三路并行查询
- 按 score 混合排序
- 返回 top-k 结果（默认 10）

**技术优势**：
- 多模态：文档（Vision OCR）+ 笔记（文本）+ 代码（语义）
- 实时性：笔记修改后自动重新嵌入
- 准确性：语义检索 + 关键词兜底

---

## 二、市场分析与商业模式

### 2.1 竞品对比

| 维度 | PathMind AI | 智联招聘 | 北森测评 | ChatGPT |
|------|-------------|----------|----------|---------|
| **Agent 编排** | 11 agents + MCP 协议 | 无 | 无 | 单一模型 |
| **工具系统** | 24 MCP 工具 + 可扩展 | 无 | 无 | 有限插件 |
| **流式交互** | SSE + 前端联动 | 无 | 无 | SSE |
| **沙箱隔离** | 有（web-coder） | 无 | 无 | 无 |
| **多模态 RAG** | 文档+笔记+代码 | 无 | 无 | 有限 |
| **权限分级** | 4 级（guest/student/teacher/admin） | 无 | 有 | 无 |
| **可观测性** | Metrics + Audit + Tracing | 无 | 无 | 无 |

**技术壁垒**：
- 市面上 AI 教育产品多为"语言模型套壳"，缺乏工具编排能力
- PathMind AI 是**完整的 Agent 运行时 + 工具编排系统**，代表工程化前沿

### 2.2 商业模式

**B2B2C（主要）**：
- 高校采购：¥50-100/人/年
- 目标：前 3 年覆盖 100 所高校，服务 50 万学生
- 预计年收入：2,500-5,000 万元

**SaaS 订阅（辅助）**：
- 个人用户：¥99/年（基础版）、¥299/年（专业版）
- 企业 HR 版：¥999/年/席位

**增值服务**：
- 企业招聘对接：按成功推荐收取 10-15% 佣金
- 定制化开发：为高校定制专属功能模块

### 2.3 成本结构

**AI API 成本**：
- Claude Haiku：$0.25/MTok input, $1.25/MTok output
- Claude Sonnet：$3/MTok input, $15/MTok output
- NVIDIA NIM：$0.2/MTok（Qwen3）
- 预计：¥0.5/用户/月（70% Haiku + 30% Sonnet）

**服务器成本**：
- 阿里云/腾讯云：¥5,000/月（初期）
- PostgreSQL + Redis + Neo4j：¥2,000/月

**总成本**：首年约 80-100 万元

---

## 三、技术演示与验证

### 3.1 已实现功能

- ✅ 11 个 AI agents 协同工作
- ✅ 24 个 MCP 工具
- ✅ 三引擎混合推理（Claude + Anthropic + NVIDIA NIM）
- ✅ 流式 SSE 交互 + 前端 UI 联动
- ✅ 工具沙箱 + 审批机制
- ✅ 多模态 RAG 检索（文档 + 笔记 + 代码）
- ✅ 权限分级系统（4 级）
- ✅ 完整可观测性（Metrics + Audit + Tracing）
- ✅ 跨组件事件通讯（FloatingAgent → NoteAIPanel）

### 3.2 技术指标

- Agent 启动时间：~0.5s（command-center）
- 流式首字节延迟：<1s（Haiku）、<2s（Sonnet）
- 工具调用成功率：>95%
- 审批响应时间：<60s
- RAG 检索准确率：>85%（语义检索）

### 3.3 开源贡献

- GitHub：https://github.com/[你的仓库]
- 技术博客：分享 Agent 编排、MCP 协议、流式通讯等技术细节
- 社区影响：推动 AI + 教育工程化标准

---

## 四、团队与融资

### 4.1 核心成员

**[负责人姓名]** — 项目负责人 & 技术负责人
- 主导 PathMind AI 架构设计与核心开发
- 熟悉 Claude Agent SDK、MCP 协议、流式通讯范式

**[成员姓名]** — 产品经理
- 负责产品设计与用户体验

**[成员姓名]** — 算法工程师
- 负责 RAG 检索、知识图谱

**[成员姓名]** — 运营负责人
- 负责市场推广与商务拓展

### 4.2 融资计划

**天使轮**（第 2 年）：500-1,000 万元
- 用途：团队扩充、市场推广、服务器扩容
- 出让股权：10-15%

**A 轮**（第 3 年）：3,000-5,000 万元
- 用途：全国市场拓展、技术研发、生态建设
- 出让股权：15-20%

---

## 五、总结

PathMind AI 以 **Agent 编排 + MCP 协议 + 流式通讯**为核心，构建了完整的 AI 应用工程化范式，具备：
- **技术领先**：11 agents + 24 MCP 工具 + 三引擎混合推理
- **工程化**：模块化工具包 + 沙箱隔离 + 审批机制 + 可观测性
- **市场广阔**：4,200 万大学生 + 1.2 万亿职业教育市场
- **社会价值**：促进教育公平、提升就业质量

这不是简单的"语言模型套壳"，而是**代表 AI 应用工程化前沿水平的完整系统**。

---

**联系方式**：
- 项目负责人：[姓名] [手机] [邮箱]
- GitHub：https://github.com/[你的仓库]
