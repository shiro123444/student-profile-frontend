# Task Plan: Claude/OpenAI 双链路 Agent 中枢分阶段落地

## Goal
按 P0→P1→P2 稳步推进 PathMind Agent 能力升级，既强化 Claude Agent SDK 主链路，也完善 OpenAI-compatible 快速模型链路，并提供网页端可用控制能力。

## Current Phase
Phase P7-Delegate

### Hotfix Track: Notes UX & Performance（2026-02-23）
- [x] 定位笔记助手慢响应核心瓶颈（默认 orchestrator 导致首包延迟）
- [x] 修复笔记切换竞态（旧请求覆盖新笔记）
- [x] 将高风险确认改为侧栏内联（移除全屏阻断）
- [x] 工具调用日志折叠显示（默认收起）
- [x] AI 侧栏支持拖拽宽度（320~620）
- [x] 流式渲染轻量化（进行中先文本，完成后 markdown）
- [x] 修复 AI 长文本导致整页滚动（消息容器内滚动隔离）
- [x] 增加思考内容默认折叠与控制块隐藏展示
- [x] 修复“未选中笔记时 AI 无法自动写入”路径（自动建笔记目标）
- [x] 增加 RAG 关键词兜底检索（embedding 不可用时仍可命中）
- [x] 收紧自动写入触发条件（仅控制块/可应用片段触发）
- [x] 增强 Markdown 长文本/宽内容溢出保护（侧栏内收敛）
- [x] 修复笔记切换显示同内容（编辑器按 noteId 重挂载）
- [x] 优化分析折叠动画（展开时按需渲染，减少卡顿）
- [x] 工具轨迹增加“内联写入成功/失败”可见性
- [x] 思考区默认两行预览折叠（流式阶段生效）
- [x] 流式 Markdown 长文本窗口化渲染（避免侧栏卡顿）
- [x] 工具轨迹自动展开首条事件（用户可见执行过程）
- [x] 编辑器异常降级到可编辑兼容模式（不阻断写作）
- [x] 统一为单一路径编辑器语义（移除“高级/快速”文案混淆）
- [x] 兼容模式改自动保存（去除手动保存按钮）
- [x] AI 写入 markdown 外层 fence 自动解包（修复整篇代码块渲染）
- [x] 修复笔记切换串内容（未就绪不挂编辑器 + useNote 切换清空）
- [x] 修复输入中断（移除 CM6 `content` 依赖触发的实例重建回环）
- [x] 侧栏补齐删除与拖拽归档（文件夹 drop 持久化）
- [x] 笔记助手历史与记忆持久化（按 noteId）
- [x] 胶囊 Agent 接入笔记助手最近记忆（context bridge）
- [x] 核验 note-assistant 引擎链路（默认 OpenAI，可升级 Claude）
- [x] 校验 AI 写入事务提示与服务端会话历史展示闭环
- [x] P0: Notes 编辑器从 MDX 迁移到 CodeMirror 6
- [x] P0.1: 移除 `@mdxeditor/editor` 依赖与样式残留
- [x] P1-1: AI 写入切换到 CM6 Transaction（绕过 React 帧拼接）
- [x] P1-2: 关键词定位接入 CM6 选区滚动与高亮
- [x] P2-1: `[[wikilink]]` 双链点击跳转（Cmd/Ctrl + Click）
- [x] P2-2: `[!callout]` 块级样式增强（多行继承 + 图标）
- [x] P2-3: `[[wikilink]]` Hover 预览卡（防抖 + 缓存 + 单例）
- [x] P2-4A: Hover 预览卡接入 Agent Summary（流式 + 缓存）
- [x] P2-4B: summary 走 fast/openai runtime 路由（前端注入）
- [x] P2-4C: 后端显式路由 `/api/ai/dispatch/stream` + Dispatcher
- [x] P0: 内联补全触发释放（280ms/5字）+ 本地缓存 + 状态可见
- [x] P1: CM6 内联 Live Preview 首版（视口裁剪 + 非当前行符号消隐）
- [x] 移除分屏 Markdown 预览入口（统一内联渲染路径）
- [x] 内联渲染补齐斜体 `*...*` / `_..._` 与标题前导空格兼容
- [x] P6-1: Cursor 风格 XML 行内替换（预览高亮 + Accept/Reject）
- [x] 模型默认值收敛（Sonnet4.6/Haiku4.5 + OpenAI 默认模型改可用项）
- [x] 模型自动探测改为“显式配置优先”（避免启动覆盖 `.env`）
- [x] P7-1: 内联补全升级 FIM 协议 + 局部记忆注入 + Claude Haiku 路由
- [x] P7-1 Hotfix: 过滤 inline 补全错误兜底文本（防“AI 服务错误”写入正文）
- [x] P7-2: Notes 内联补全链路切换到 `/api/complete`（NIM `/v1/chat/completions`、`stream:false`、全局 keep-alive 连接池）
- [x] P7-3: Notes inline 接入轻量记忆摘要互通（`context_summary`）并完成时延 A/B
- [x] P7-4: Notes inline 增加 `code/prose` 模式识别与代码块约束（修复“代码块补成自然语言”）
- [ ] 后端内部鉴权通道（Python→Go notes/profile 401）收口
- **Status:** in_progress

## Phases

### Phase P0: 稳定性与一致性（立即）
- [x] 修复 agent 工具声明与 registry 不一致
- [x] 修复后端角色上下文 key 不一致
- [x] 确保 Claude/OpenAI 双引擎链路可被统一编排（后端 runtime 路由基础）
- [x] 完成基础回归检查
- **Status:** complete

### Phase P1: 体验增强（短期）
- [x] 引入运行时模式（fast/balanced/deep）并暴露给前端 API/hooks
- [x] 在网页端加入显式模式切换入口（UI Toggle）
- [x] 增加运行状态可观测能力（stream meta: engine/model/mode）
- [x] 增加工具风险标识（annotations）
- **Status:** complete

### Phase P2: 高阶能力（中期）
- [x] 结构化输出（output_format）驱动卡片化 UI（advisor_card_v1 首版）
- [x] 会话管理增强（历史列表、恢复、清理）
- [x] Hooks 事件流可视化（权限、子任务、通知）
- **Status:** complete

### Phase Delivery: 交付与验收
- [x] 输出每阶段变更清单
- [x] 输出后续实施建议与风险
- **Status:** complete

### Phase P3: WebAgent 范式标准化（进行中）
- [x] 定义 WebAgent 协议（webagent.v1）与计划 schema
- [x] AgentService 接入编排器（planner → executor 自动路由）
- [x] 标准化编排可观测输出（query.orchestrator + SSE orchestrator）
- [x] 前端 runtime/orchestrator 参数与事件消费接入
- [x] 多 worker DAG 拓扑执行（layer 并发 + 依赖约束）
- [x] Orchestrator worker 级事件流（layer/worker start/done）
- [ ] 提炼可独立打包 SDK 的 core package 边界与导出 API
- **Status:** in_progress

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 先做 P0“可用性修复”再扩展功能 | 避免在不稳定基线之上叠加复杂能力 |
| 将双链路能力抽象为运行时路由 | 降低前端与具体引擎的耦合 |
| 采用渐进式模式（fast/balanced/deep） | 对用户可理解，同时便于成本/时延控制 |
| 先在 AI Insight 按钮启用 fast 模式 | 低风险验证 OpenAI 快速链路，便于逐步推广 |
| P3 先抽象协议再扩展能力 | 确保后续可以 SDK 化输出，避免功能先行造成接口碎片化 |
| P3-2 采用拓扑层并发执行 | 在保证依赖正确性的前提下提升复杂任务执行效率 |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| 直接调用 `delegate_to_agent(...)` 报 `SdkMcpTool object is not callable` | 按 SDK 对象语义改为 `delegate_to_agent.handler(args)` 调用，验证通过 |

## Delivery Notes
- P0/P1/P2 三阶段能力已按计划全部完成并通过基础回归。
- 双链路目标达成：Claude 主链路可深度执行，OpenAI-compatible 快链路可低成本快速交互。
- 后续应继续推进 OpenAI 链路 hooks 事件等效能力，减少双链路观测差异。

## P3-3 Next Focus (from 4 expert reports)

### Phase P3-3: SDK Core + Reliability（已完成）
- [x] 抽象 `webagent_core` 包边界（protocol / orchestrator / runtime / contracts）
- [x] 落地 `node.tools` 工具白名单执行（worker 仅可访问声明工具）
- [x] 引入 worker 失败重试与超时治理（retry/backoff + timeout + budget guard）
- [x] 标准化 Agent Catalog API（`/agent/list`、`/agent/:name/capabilities`）
- **Status:** complete

### Phase P3-4: External MCP + Frontend Adoption（已完成）
- [x] 外部 MCP 配置加载（`mcp_servers.yaml` + stdio/SSE/HTTP 元数据）
- [x] Unified ToolRegistry（builtin + external）与健康检查 API
- [x] 前端 Agent Hub（AIAdvisor 全量动态发现/可切换）
- [x] OpenAI 链路外部 MCP 直连执行器（stdio 首版）
- [x] OpenAI external MCP 传输补齐（SSE/HTTP 直连）
- **Status:** complete

## Decisions Added (2026-02-20)
| Decision | Rationale |
|----------|-----------|
| 先做 P3-3（核心抽象 + 稳定性）再做 P3-4（外部 MCP 生态） | 报告一致指出当前瓶颈在“工具边界未生效 + 可靠性不足”，先补地基再扩生态 |
| 将“前端 Agent 全量接入”提升为并行 P0 级任务 | 8 个 Agent 只有 2 个被前端使用，直接限制现有智能能力释放 |
| 外部 MCP 先走“Claude 原生可执行 + OpenAI 渐进补齐” | 先打通标准 MCP 接入与统一注册，再补 OpenAI 直连执行器以控制复杂度与风险 |

## Update: 2026-02-21 (v2 四报告对齐后的下一阶段)

### 现实校准（报告结论与代码现状）
- ✅ 已落地：`P3-4` external MCP 三传输（`stdio/http/sse`）+ unified registry。
- ✅ 已落地：AIAdvisor 动态 Agent Hub（`/agent/list` + `capabilities`）。
- ⚠️ 部分过时：报告中“前端仅 1/8 或 2/8 Agent 接入”已不准确，当前已覆盖多页面入口，但 `document-reader`/跨页统一路由仍可继续增强。
- ❗ 仍待解决：`external_mcp_enabled` 默认关闭，官方 MCP 可用性仍需“一键激活”路径。
- ❗ 仍待解决：生产稳定性三件套（Rate Limiting / 熔断 / 监控）尚未系统化。
- ❗ 仍待解决：性能主瓶颈（embedding token 限制、缓存层缺失、Python worker 扩展策略）尚未进入实施。

### Phase P4: Productization + SDK（下一阶段）
- [ ] P4-1 生态激活：提供 `mcp_servers.yaml` 默认模板与官方 MCP 示例，补齐“开箱可用”文档。
- [ ] P4-2 运行稳定性：引入 API 限流、Go→Python 调用超时/连接池/熔断策略。
- [ ] P4-3 性能优化：落地 embedding/RAG 缓存与 Python worker 并发配置（先配置化再压测）。
- [ ] P4-4 SDK 核心抽象：提炼 `DataAdapter` / `TenantContext` / `Artifact Contract` 公共接口。
- [ ] P4-5 智能编排升级：Multi-Agent 协作 + 动态 Replan + Critique Worker。
- [ ] P4-6 开发者交付：SDK 快速开始、API 参考、外部 MCP 集成指南、最小示例工程。
- **Status:** pending

## Decisions Added (2026-02-21)
| Decision | Rationale |
|----------|-----------|
| 采用“先稳态后智能”的 P4 顺序 | v2 报告显示性能与生产治理短板仍是上线瓶颈，先补可靠性再扩高级智能更稳健 |
| 将“报告结论”分为已完成/部分过时/仍待解决三类 | 避免重复建设，保证后续投入直接命中真实缺口 |
| SDK 化从接口契约先行（DataAdapter/Tenant/Artifact） | 降低业务耦合，确保后续能真正独立打包并跨项目复用 |

## Update: 2026-02-21 (P4-1 启动：Agent Gateway 稳定性治理首批落地)

### P4-1A 已完成（Go 网关侧）
- [x] Agent API 限流中间件（登录用户按 `user_id`，游客按 `IP`）
- [x] Go → Python 连接池参数化（`MaxIdleConns/PerHost/IdleTimeout`）
- [x] Go → Python 响应超时治理（request timeout + stream header timeout）
- [x] 轻量熔断器（consecutive failures + open window + half-open probe）
- [x] 熔断错误语义化（代理层返回 503，便于前端降级）

### P4-1 下一步
- [x] P4-1B：补齐 Python 侧运行参数化（worker 并发与部署脚本）
- [x] P4-1C：补齐基础监控埋点（429/503/latency/circuit 指标对接）
- **Status:** in_progress

## Update: 2026-02-21 (P4-1B 完成：Python worker 参数化)

### P4-1B 已完成（Python Agent Service）
- [x] `uvicorn` 运行参数配置化（workers / keep-alive / graceful shutdown / backlog / log level）
- [x] debug 模式安全保护：`PATHMIND_DEBUG=true` 时强制 `workers=1`，避免 reload+workers 冲突
- [x] Docker 启动入口标准化：容器改为 `python -m app.main`，统一读取 PATHMIND 配置
- [x] `.env.example` 补齐 P4-1B 运行参数示例

### P4-1 剩余事项
- [x] P4-1C：基础指标化完成（429/503/latency/circuit state）
- **Status:** in_progress

## Update: 2026-02-21 (P4-1C 完成：Agent 可观测性基础)

### P4-1C 已完成（Go Gateway Observability）
- [x] 指标采集器：全局/分 scope（protected/public）请求统计
- [x] 状态码指标：2xx/4xx/5xx 桶统计 + 429 + 503 专项计数
- [x] 延迟指标：按路由记录 avg/max/total latency
- [x] 熔断状态指标：closed/open/half_open 状态与转移计数
- [x] 查询出口：`GET /api/agent/metrics`（鉴权后可访问）

### P4-1 总结
- P4-1A（网关韧性）✅
- P4-1B（Python 并发参数化）✅
- P4-1C（基础可观测性）✅
- **Status:** complete

### Next Focus
- [ ] P4-2：embedding/RAG 缓存与性能压测基线


## Update: 2026-02-21 (P4-2 启动：Embedding/RAG 缓存骨架)

### P4-2A 已完成（Cache Foundation）
- [x] Redis 缓存服务抽象（统一 key/hash、JSON 序列化、hit/miss 统计）
- [x] Embedding 缓存接入（query + passage）
- [x] RAG 查询缓存接入（query/course_id/limit）
- [x] `/health` 返回缓存统计快照（命中率 + TTL）
- [x] `.env.example` 增加缓存开关与 TTL 配置

### P4-2 后续
- [ ] P4-2B：扩展到 Note semantic search / unified search 缓存
- [x] P4-2C：压测基线（缓存命中率、P95 latency、QPS）
- **Status:** in_progress

## Update: 2026-02-21 (P4-2B 完成：Note/Unified Search 缓存扩展)

### P4-2B 已完成
- [x] `NoteEmbeddingService.search_notes` 缓存接入（query/student_id/limit）
- [x] `builtin unified_search` 缓存接入（variant=builtin）
- [x] `mcp_tools unified_search` 缓存接入（variant=mcp）
- [x] 缓存统计扩展：`note_search` / `unified_search` 命中率
- [x] 缓存配置扩展：enable + TTL（note/unified）

### P4-2 收尾事项
- [x] P4-2C：压测基线（缓存命中率、P95 latency、QPS）
- **Status:** complete

## Update: 2026-02-21 (P4-2C 启动：压测脚本与基线框架)

### P4-2C 当前完成
- [x] 压测脚本：`server-py/scripts/benchmark_cache_baseline.py`
  - 支持 cold/warm cache 双阶段
  - 输出 QPS / Avg / P95 / P99 / error
  - 输出 JSON + Markdown 报告到 `docs/perf-baselines/`
- [x] Runbook：`docs/perf-baselines/p4-2c-cache-baseline-runbook.md`
- [x] 查询样本：`docs/perf-baselines/queries-sample.txt`
- [x] 脚本 dry-run 验证通过

### P4-2C 收尾
- [x] 在联调环境执行标准压测并产出首版基线报告（含 cold vs warm 对比）
- **Status:** complete

## Update: 2026-02-21 (P4-2C 首版基线报告已生成)

### Baseline Run
- 执行命令：
  - `server-py/.venv/bin/python server-py/scripts/benchmark_cache_baseline.py --iterations 1 --queries-file docs/perf-baselines/queries-sample.txt --cases rag_query note_search unified_builtin unified_mcp`
- 产出文件：
  - `docs/perf-baselines/p4-2c-cache-baseline-20260221-051712.json`
  - `docs/perf-baselines/p4-2c-cache-baseline-20260221-051712.md`

### Phase Status
- P4-2A（Embedding/RAG 缓存）✅
- P4-2B（Note/Unified 缓存扩展）✅
- P4-2C（压测基线）✅
- **Status:** complete

### Next Focus
- [ ] P4-3：SDK 边界收口（DataAdapter / TenantContext / Artifact Contract）

## Update: 2026-02-22 (P7-Delegate 启动并完成：Agent 间委托链路 P0)

### Phase P7-Delegate: Delegation Mesh（P0）
- [x] 新增 `delegate_to_agent` 内建工具（受白名单、深度、环路约束）
- [x] 新增 `delegation_runtime` 运行时护栏（max depth + cycle break + target allowlist）
- [x] 委托结果接入共享记忆（handoff start/done 写入 run scratchpad）
- [x] 关键 agent 接入委托能力（quick/document/note/mbti/career/learning/graph）
- [x] 前端事件链路补齐（`agent_handoff` → AIAdvisor timeline）
- **Status:** complete

### Decisions Added (2026-02-22)
| Decision | Rationale |
|----------|-----------|
| 委托优先走“工具协议化”而非硬编码路由 | 保持与现有 ToolRegistry + 双引擎执行链统一，便于后续 SDK 抽象 |
| 先做 P0 安全委托（白名单+深度+环路） | 快速验证 agent mesh 价值，同时避免递归失控 |
| 委托沿用现有 run scratchpad 语义 | 保持 Claude/OpenAI 跨链路记忆连续性，不破坏现有 session 结构 |

## Update: 2026-02-22 (P7-Delegate-2 完成：完成态事件 + 批次协议)

### Phase P7-Delegate-2
- [x] 委托完成态事件标准化（`agent_handoff` start/done/failed）
- [x] 新增批次委托工具 `delegate_batch_agents`
- [x] 定义最小事务协议 `delegation.batch.v1`（`best_effort` / `all_or_nothing`）
- [x] 前端事件消费补齐（AIAdvisor 时间线可见批次状态）
- **Status:** complete

### Decisions Added (2026-02-22, P7-Delegate-2)
| Decision | Rationale |
|----------|-----------|
| 先在 OpenAI 链路落地完成态事件 | OpenAI 工具执行在本引擎内可拿到 tool result，最小改动可稳定交付 |
| 批次协议优先顺序执行，不先上并行 | 避免 run scratchpad 并发写入竞争，先保证协议与可观测性 |
| `all_or_nothing` 采用“首失败即停”语义 | 在无跨-agent回滚能力前，提供可解释且可审计的最小事务边界 |


## Update: 2026-02-21 (P4-3 启动：SDK 边界首轮落地)

### P4-3A 已完成（Core Contracts + 首批接入）
- [x] `DataAdapter` 协议 + `HttpDataAdapter` 默认实现 + 注入入口（`get/set_data_adapter`）
- [x] `TenantContext` 契约（`parse_tenant_context` / `compact_tenant_context`）
- [x] `Artifact Contract` 契约（`infer_artifact_contract`）
- [x] Orchestrator worker artifact 标准化（`artifact.kind` + `artifact_uri` 摘要）
- [x] 首批工具接入 DataAdapter（`student` / `homepage` / `note`）
- [x] SDK 最小示例与协议文档补充

### P4-3 下一步
- [ ] P4-3B：将 tenant context 透传到 query/stream 元数据（前后端观测统一）
- [ ] P4-3C：整理可独立发布的 `webagent_core` API 参考与 quickstart
- **Status:** in_progress

### Errors Encountered (P4-3A)
| Error | Attempt | Resolution |
|-------|---------|------------|
| `ModuleNotFoundError: pydantic_settings`（执行运行时 import smoke check） | 1 | 该容器未安装完整依赖，改用 `py_compile` 做静态语法校验，待联调环境再执行运行时验证 |

## Update: 2026-02-21 (P4-3B 完成：Tenant Context 透传)

### P4-3B 已完成
- [x] `context._tenant` / `context.tenant` 解析并标准化为 `TenantContext`
- [x] `query` 响应透传 `tenant`
- [x] stream `meta` 事件透传 `tenant`
- [x] stream `orchestrator`（planned + layer/worker/budget）事件透传 `tenant`
- [x] system prompt 注入租户上下文（tenant/role/user）
- [x] API 文档与响应模型补齐 `tenant` 字段

### P4-3 下一步
- [ ] P4-3C：整理 `webagent_core` SDK API 参考（contracts/data-adapter/orchestrator）
- [ ] P4-3D：补齐前端 typed schema（tenant + artifact）并做端到端演示
- **Status:** in_progress

## Update: 2026-02-21 (P4-3C 完成：SDK 文档交付 + 前端类型对齐)

### P4-3C 已完成（Developer Delivery）
- [x] `webagent_core` API Reference 文档（contracts/runtime/orchestrator/data_adapter）
- [x] SDK Quickstart 文档（tenant + adapter + artifact 消费）
- [x] 协议文档补充 P4-3C 交付项

### P4-3D 进展（前端 typed schema）
- [x] Agent API 类型增加 `tenant` 与 orchestrator worker `artifact_type/artifact_uri`
- [x] `useAgentStream` 增加 `tenant` 解析与事件类型（meta/orchestrator）
- [x] AIAdvisor 发送 `_tenant` 并显示 tenant runtime badge（student scope）
- [x] worker timeline 增加 artifact 类型提示

### Next
- [ ] P4-3E：Go 代理层 `AgentQueryResponse` 对齐 `tenant` 字段，确保跨语言响应结构完全一致
- [ ] P4-4：启动 SDK 打包清单（versioning + release contract）
- **Status:** in_progress

## Update: 2026-02-21 (P4-3E 完成：Go 代理层 tenant 对齐)

### P4-3E 已完成
- [x] Go `AgentQueryResponse` 新增 `tenant` 字段（`json:"tenant,omitempty"`）
- [x] `/api/agent/query` 透传 Python 返回的 tenant payload（无需额外映射）
- [x] Go 全量编译测试通过

### Next
- [ ] P4-4A：定义 SDK release contract（semver / compatibility matrix / deprecation policy）
- [ ] P4-4B：梳理 `webagent_core` 打包清单与最小发布流程
- **Status:** in_progress

## Update: 2026-02-21 (P4-4A/B 完成：Release Contract + Packaging Checklist)

### P4-4A 已完成（Release Contract）
- [x] 定义 SemVer 规则（MAJOR/MINOR/PATCH）
- [x] 定义 public contract surface 与兼容矩阵（Python/SSE/Go/Frontend）
- [x] 定义弃用策略（2 个 MINOR 窗口）
- [x] 定义 release gates（contract-check / py_compile / go test / frontend build）

### P4-4B 已完成（Packaging Checklist）
- [x] 定义 SDK 打包范围（core 6 模块）
- [x] 定义文档/示例打包范围
- [x] 定义最小发布流程（freeze contract → gate checks → tag/release）
- [x] 落地可执行契约校验脚本 `verify_webagent_core_contract.py`

### Next
- [ ] P4-4C：把 contract-check 接入 CI（或至少本地 Make/Script 统一入口）
- [ ] P4-5：多 Agent 协作与动态 Replan（Critique Worker）
- **Status:** in_progress

## Update: 2026-02-21 (P4-4C 完成：统一门禁命令)

### P4-4C 已完成（本地统一入口）
- [x] 新增 `scripts/check_webagent_release.sh`（quick/full 两种模式）
- [x] 新增 npm script：
  - `npm run check:webagent`
  - `npm run check:webagent:full`
- [x] quick 模式实测通过（contract-check + py_compile + go test）

### Remaining
- [ ] CI 工作流接入（GitHub Actions / self-hosted）
- **Status:** in_progress

## Update: 2026-02-21 (P4-5A/B 进展：Critique + Dynamic Replan 首轮闭环)

### P4-5A 已完成（后端编排闭环）
- [x] 修复 `AgentService` 中 critique/replan prompt 构造语法错误（阻塞解除）
- [x] `query` / `stream` 统一走 `_run_orchestration_loop`
- [x] 新增 Critique Worker 质量门（`webagent_critique_v1`）
- [x] 新增动态 Replan 轮次控制（`dynamic_replan_enabled` + `max_replans`）
- [x] 新增编排事件阶段：`critique_done` / `replan_start` / `replan_done`

### P4-5B 已完成（前端协议消费）
- [x] runtime orchestrator 参数补齐：`critique_enabled`/`critique_mode`/`dynamic_replan_enabled`/`max_replans`
- [x] `useAgentStream` 新增 critique/replan 字段解析（含 `replan_round`、`success`）
- [x] AIAdvisor 时间线新增 Critique/Replan 阶段可视化
- [x] 协议文档更新（runtime contract + query/stream 扩展）

### Validation
- [x] `python3 -m py_compile server-py/app/services/__init__.py server-py/app/services/webagent_core/protocol.py`
- [x] `npm run build`
- [x] `npm run check:webagent`

### P4-5 下一步
- [ ] P4-5C：增加编排回放/统计视图（replan 轮次与通过率）
- [ ] P4-5D：在 Agent Hub 暴露 critique/replan 策略模板（fast/balanced/deep）
- **Status:** in_progress

### Errors Encountered (P4-5)
| Error | Attempt | Resolution |
|-------|---------|------------|
| `SyntaxError: unterminated string literal` in `server-py/app/services/__init__.py` | 1 | 重写 `_build_orchestration_critique_prompt` 与 `_build_orchestration_replan_prompt`，统一使用显式 `\n` 拼接 |

## Update: 2026-02-21 (P4-5C/D 完成：统计面板 + 策略模板)

### P4-5C 已完成（编排统计可视化）
- [x] AIAdvisor 事件面板新增 Critique/Replan 统计卡：
  - Critique runs / pass-fail
  - Pass rate / Avg score
  - Replan count / success-failure
  - Round max / budget status
- [x] 统计状态由 orchestrator 事件实时驱动（`planned/critique_done/replan_start/replan_done/budget_exhausted`）
- [x] 展示最近一次 critique summary，便于调试重规划触发原因

### P4-5D 已完成（策略模板开关）
- [x] Agent Hub 顶部新增编排策略模板切换：`Fast / Balanced / Deep`
- [x] 模板参数自动映射到 runtime orchestrator：
  - `planner_mode`
  - `max_steps/max_workers`
  - `worker_timeout_s/retry/backoff`
  - `critique_mode`
  - `dynamic_replan_enabled`
  - `max_replans`
- [x] 发送请求时按模板组装 orchestrator runtime，实现“可调参即策略”

### Validation
- [x] `npm run build`

### Next
- [ ] P4-6：将策略模板抽象为可配置 JSON（便于 SDK 对外暴露）
- [ ] P4-6：补充 orchestrator stats 持久化与跨会话对比
- **Status:** in_progress

## Update: 2026-02-21 (P5-P0 首轮实现：Coding 闭环)

### P5-P0 已完成（最小可用闭环）
- [x] 内建 coding 工具包（filesystem/git/shell）
- [x] 严格沙箱策略（路径白名单/黑名单、命令白名单、危险模式拦截、超时与输出截断）
- [x] 高风险逐次审批闭环（approval_request / approval_result SSE + approve/reject API）
- [x] OpenAI/Claude 双链路审批接入
- [x] 审计落库链路（Python audit client → Go internal ingest → Postgres）
- [x] AIAdvisor Coding 模式、workspace 与审批面板接入

### P5-P0 状态
- **Status:** complete

### P5-P1/P2 当前进度
- [x] P1-1 部分完成：Coding 模式下新增 `coding_v1` profile 标识并接入前端 runtime。
- [x] P1-2 已完成：run 级 scratchpad 跨链路统一记忆（AgentService + Claude/OpenAI 双写入）。
- [x] P1-3 已完成：高风险并发上限（默认 1）+ 低风险重试 + 审批指标聚合。
- [x] P2-1 部分完成：在 `webagent_core` 抽象 `ApprovalProvider` / `SandboxPolicy` / `AuditSink` 契约。
- [x] P2-2 已完成：external MCP 风险映射与统一降级策略。
- [x] P2-3 已完成：coding quickstart / runbook / API reference 文档补齐。


## Update: 2026-02-21 (P5-P2-2 完成：External MCP 风险映射 + 回退可观测)

### P5-P2-2 已完成
- [x] external MCP 工具支持 YAML `risk` 覆写并注入 `permissions.tool_overrides`。
- [x] `coding_policy` 支持 external 风险推断（override > annotations > config defaults）。
- [x] OpenAI 链路支持 built-in 优先 / external 调用 / external 失败回退内建策略。
- [x] Go 代理新增 `GET /api/agent/approvals/metrics` 转发接口。
- [x] 前端 `agentApi.approvalMetrics` 接口与 `tool_retry` / `tool_fallback` 事件消费补齐。
- [x] AIAdvisor 时间线新增工具重试与回退提示。

### Remaining
- [x] P2-3：coding quickstart / runbook / API reference 文档补齐。
- **Status:** complete


## Update: 2026-02-21 (P5-P2-3 完成：Coding 文档交付)

### P5-P2-3 已完成
- [x] Quickstart：`docs/webagent-coding-quickstart-v1.md`
- [x] Security Runbook：`docs/webagent-coding-security-runbook-v1.md`
- [x] API Reference：`docs/webagent-coding-api-reference-v1.md`
- [x] 协议文档补充：`docs/webagent-protocol-v1.md` 增加 P5-P2-3 里程碑
- [x] 增强计划状态回写：`docs/claude-code-web-enhancement-plan.md`

### Status
- P5（P0→P2）既定范围已完成，进入下一阶段 SDK 化与策略持续优化。


## Update: 2026-02-21 (P6 启动：策略模板化 + 热更新)

### P6 当前完成（P6-1）
- [x] 新增策略模板加载器：`coding_policy_profiles.py`（JSON versioned + mtime 热重载 + fallback）
- [x] 运行时新增 `context._runtime.coding.policy_profile`（按请求切换策略模板）
- [x] 风险/审批/回退/重试/并发策略接入模板层（替换硬编码 settings 读取）
- [x] OpenAI/Claude 双引擎审批超时与 external fallback 统一走策略模板
- [x] 新增策略快照接口：`GET /agent/coding/policies`（Go 代理透传：`/api/agent/coding/policies`）
- [x] 新增模板示例：`server-py/coding_policy_profiles.json.example`

### P6 当前推进（P6-2）
- [x] AIAdvisor 增加策略模板选择 UI（支持 `strict_v1/balanced_v1/fast_iter_v1` 动态加载）
- [x] Coding runtime 动态透传 `policy_profile`（替代前端硬编码 `strict_v1`）
- [x] Coding 模式增加策略源状态、手动刷新与错误提示（液态玻璃控件风格）
- [ ] 将策略模板 contract 提炼进 SDK 文档与示例
- [ ] 增加策略切换回归用例（审批率/超时率/fallback 率）
- **Status:** in_progress


### P6 当前推进（P6-3）
- [x] AIAdvisor 增加 coding 治理指标面板（审批通过率/超时率/fallback 率）
- [x] 指标来源双通道：`/agent/approvals/metrics`（全局）+ `tool_retry/tool_fallback`（run 级）
- [x] 指标刷新机制：事件面板打开后 15s 轮询 + 手动刷新按钮
- [x] 审批决策与任务完成后自动刷新指标快照
- [ ] 策略切换自动化回归（审批率/超时率/fallback 率阈值断言）
- [ ] 策略模板 contract 提炼进 SDK 文档与示例
- **Status:** in_progress


### P6 当前推进（P6-UX）
- [x] 实验区接入统一液态玻璃头部与 Agent 集群实时看板
- [x] 笔记区接入液态玻璃顶栏动画与可开关集群看板
- [x] 新增 `PDF 工作台` 页面（文档暂存区 + AI 工作流动作 + 集群探针）
- [x] 主导航新增 `PDF 工作台` 入口与受保护路由
- [x] PDF 文件后端持久化上传、索引、语义检索流水线（用户侧已接通）
- [x] PDF 文件后端预览/下载接口与前端入口（用户侧可直接访问实体文件）
- [x] 集群看板跨页统一 telemetry（接入全局任务与审批指标）
- **Status:** in_progress


## Update: 2026-02-21 (P6-UX-2 完成：PDF 工作台接通后端文档链路)

### P6-UX-2 已完成
- [x] `DocumentsPage` 从“前端暂存”升级为真实后端文档库视图（`/documents` list）。
- [x] 文档上传改为调用 `documentsApi.upload`，并展示批量上传结果与错误。
- [x] 文档删除改为调用 `documentsApi.delete`，并同步清理页面检索结果。
- [x] 接入语义检索输入与结果展示（`documentsApi.query`）。
- [x] 保持液态玻璃 UI + Agent 集群看板 + AI 工作流动作区一致风格。

### Remaining
- [x] 已在 P6-UX-5 完成（下钻 + 趋势）。


## Update: 2026-02-21 (P6-UX-4 完成：跨页统一 Telemetry)

### P6-UX-4 已完成
- [x] 新增前端网关 telemetry 契约：`agentApi.metrics()`（`/api/agent/metrics`）。
- [x] `AgentClusterBoard` 接入全局 telemetry 轮询（15s）与手动刷新。
- [x] 增加跨页共享快照缓存（localStorage），页面切换后保持统一指标视图。
- [x] 看板新增全局指标卡：请求量、4xx/5xx、429/503、circuit、审批 pending/timeout/avg wait。
- [x] 任务完成后自动刷新 telemetry，保证探针执行后指标即时对齐。

### Remaining
- [x] 已在 P6-UX-5 完成（下钻 + 趋势）。


## Update: 2026-02-21 (P6-UX-5 完成：Telemetry 维度下钻 + 趋势)

### P6-UX-5 已完成
- [x] Go observability 扩展维度统计（`agents` / `workspaces`）并并入全局与 scope 指标。
- [x] Agent 请求指标采集支持上下文维度（`agent_name` + `workspace_id`）。
- [x] 网关 telemetry 增加趋势快照（15s bucket，滚动窗口）。
- [x] `AgentClusterBoard` 新增 Top Agents / Top Workspaces 展示。
- [x] `AgentClusterBoard` 新增请求趋势条形图（error bucket 高亮）。

### Remaining
- [x] 已在 P6-UX-6 完成窗口切换（5m/15m/1h）。
- [ ] 在后台侧增加持久化指标存储（当前仍是进程内内存态）。


## Update: 2026-02-21 (P6-UX-6 完成：Telemetry 过滤与窗口切换)

### P6-UX-6 已完成
- [x] `/api/agent/metrics` 支持查询参数：`agent` / `workspace` / `window_sec`。
- [x] 后端 trend retention 扩展至覆盖 `1h` 窗口（15s bucket）。
- [x] `AgentClusterBoard` 新增过滤控件：Agent / Workspace。
- [x] `AgentClusterBoard` 新增时间窗口切换：`5m / 15m / 1h`。
- [x] 指标卡在过滤后显示 `filtered` 聚合，趋势图与过滤条件一致。

### Remaining
- [ ] 在后台侧增加持久化指标存储（当前仍是进程内内存态）。


## Update: 2026-02-21 (P6-UX-3 完成：PDF 文件预览/下载闭环)

### P6-UX-3 已完成
- [x] Go 新增受鉴权控制的文档文件接口：
  - `GET /api/documents/:id/preview`
  - `GET /api/documents/:id/download`
- [x] 按角色/所属用户进行文档可见性校验（复用现有 document access 规则）。
- [x] 响应头标准化（`Content-Type` + `Content-Disposition`）并支持安全文件名。
- [x] 前端新增文件拉取 API：`documentsApi.fetchFile(id, mode)`。
- [x] PDF 工作台新增“预览/下载”按钮，完成实体文件访问闭环。

### Remaining
- [x] 已在 P6-UX-5 完成（下钻 + 趋势）。


## Update: 2026-02-21 (P6-UX-7 完成：交互趋势分析增强)

### P6-UX-7 已完成
- [x] `AgentClusterBoard` 趋势柱支持 hover/click 交互高亮与焦点切换。
- [x] 趋势详情支持逐 bucket 查看：`req/4xx/5xx/429/503/latency`。
- [x] 新增风险分级语义（稳定/观察中/高风险）并统一到颜色阈值。
- [x] 新增窗口内“后半段 vs 前半段”对比（请求量、错误率、延迟变化）。
- [x] 交互趋势图与 `agent/workspace/window_sec` 过滤条件保持同源联动。

### Remaining
- [ ] 在后台侧增加持久化指标存储（当前仍是进程内内存态）。
- [ ] 如需深度分析，可继续补充缩放与多曲线对比能力。


## Update: 2026-02-21 (P6-UX-8 完成：Telemetry 持久化历史)

### P6-UX-8 已完成
- [x] 新增 `agent_request_metrics` 持久化模型与迁移脚本（Postgres）。
- [x] 新增异步批量写入服务 `AgentMetricsHistoryService`（队列 + 批写 + flush）。
- [x] Agent metrics 中间件接入持久化写入（protected/public 双 scope）。
- [x] 新增历史查询接口：`GET /api/agent/metrics/history`（支持 `agent/workspace/window_sec/bucket_sec/scope`）。
- [x] 前端 `agentApi.metricsHistory()` 接入并在 `AgentClusterBoard` 展示持久化历史摘要。
- [x] 新增持久化历史配置项（enabled/window/bucket/queue/batch/flush）。

### Remaining
- [ ] 增加历史数据保留策略（TTL/归档/下采样 rollup）。
- [ ] 在前端补充区间缩放与多曲线叠加（历史趋势深度分析）。


## Update: 2026-02-21 (P6-Graph-P0：图谱 Agent 可执行闭环)

### P6-Graph-P0 已完成
- [x] 新增 `graph_command` 前端事件协议（`useAgentStream` 回调分发）。
- [x] `/graph` 路由默认 Agent 从 `quick-qa` 切换为 `graph-analyst`。
- [x] `FloatingAgent` 接收图谱指令后广播全局事件（`pathmind:graph-command`）。
- [x] `GraphPage` 监听指令并透传到 `KnowledgeGraph`，展示当前 Agent 指令徽标。
- [x] `KnowledgeGraph` 执行层接入：
  - `focus_node`
  - `filter_type`
  - `clear_filters`
  - `fit_view`
  - `highlight_path`
  - `expand_node`
  - `open_panel`
- [x] 图谱执行反馈增强：类型过滤 + 节点/路径高亮 + 聚焦/面板联动。

### P6-Graph 下一步
- [ ] 将图谱命令执行结果（成功/失败/原因）回传给 Agent（形成双向闭环）。
- [ ] 增加图谱“命令历史/撤销”能力，支持复杂多步探索。
- [ ] 打通图谱写操作（当前后端图谱 API 仍以只读查询为主）。


## Update: 2026-02-21 (P6-Graph-P1：执行回执与撤销能力)

### P6-Graph-P1 已完成
- [x] `KnowledgeGraph` 增加标准命令执行回执：
  - `status: success/ignored/error`
  - `success`、`message`
  - `undoCommand`（可撤销命令时返回）
- [x] 回执覆盖全部图谱命令：`focus/filter/clear/fit/highlight/expand/open_panel`。
- [x] `GraphPage` 接入回执历史面板（最近执行记录、状态展示、失败原因）。
- [x] `GraphPage` 接入“撤销上一步”（基于 `undoCommand`）。
- [x] 新增前端事件 `pathmind:graph-command-result`，供全局 Agent UI 感知图谱执行结果。
- [x] `FloatingAgent` 已监听回执事件，对 ignored/error 给出告警 toast。

### P6-Graph 下一步
- [ ] 回执上报到后端会话上下文（让模型在后续 turn 感知“图谱命令是否成功执行”）。
- [ ] 增加“命令批次/事务”语义，支持复杂多步图谱操作的整体验证与回滚。
- [ ] 打通图谱写操作（当前后端图谱 API 仍以只读查询为主）。


## Update: 2026-02-21 (P6-Graph-P2：后端 ACK ingest + 下轮可读上下文)

### P6-Graph-P2 已完成
- [x] Python 新增图谱回执 ingest API：`POST /agent/graph/feedback`。
- [x] Redis 新增图谱回执池（student 维度）与 prompt 注入函数：
  - `append_graph_feedback`
  - `get_graph_feedback_context`
- [x] `AgentService` 在 `graph-analyst` 场景下注入“图谱命令执行回执”上下文（stream/query 均接入）。
- [x] Go 代理新增转发链路：
  - `POST /api/agent/graph/feedback`
  - `AgentProxyService.ReportGraphCommandFeedback`
- [x] 前端 `GraphPage` 在命令执行后自动上报 ACK（best effort，不阻塞 UI）。

### P6-Graph 下一步
- [ ] 增加 ACK 查询接口与可视化（按 session 查看执行回执序列）。
- [ ] 增加“命令批次/事务”语义，支持复杂多步图谱操作的整体验证与回滚。
- [ ] 打通图谱写操作（当前后端图谱 API 仍以只读查询为主）。


## Update: 2026-02-21 (P6-Graph-P3：ACK 查询与时间线面板)

### P6-Graph-P3 已完成
- [x] Python 新增 ACK 查询接口：`GET /agent/graph/feedback`（支持 `student_id/agent_name/session_id/limit`）。
- [x] Redis 侧新增查询函数：`list_graph_feedback`（按 agent/session 过滤 + limit）。
- [x] Go 网关新增 ACK 查询代理：
  - `GET /api/agent/graph/feedback`
  - `AgentProxyService.ListGraphCommandFeedback`
- [x] 前端 API 新增 `agentApi.listGraphFeedback()`。
- [x] `GraphPage` 增加“会话时间线”面板：
  - 自动加载后端 ACK 历史
  - 手动刷新
  - 20s 轮询
  - 与实时回执并排显示

### P6-Graph 下一步
- [ ] 增加“命令批次/事务”语义，支持复杂多步图谱操作的整体验证与回滚。
- [ ] 增加 ACK 时间线筛选维度（状态/命令类型）与导出能力。
- [ ] 打通图谱写操作（当前后端图谱 API 仍以只读查询为主）。


## Update: 2026-02-21 (P6-Graph-P4 完成：时间线筛选 + 导出 + 批次事务最小协议)

### P6-Graph-P4 已完成
- [x] ACK 时间线查询支持 `status/command` 双过滤（Python API + Go proxy + 前端 API）。
- [x] `GraphPage` 新增时间线过滤 UI：
  - 状态标签：`all/success/ignored/error`
  - 命令关键字过滤：按 command 文本匹配
- [x] `GraphPage` 新增“导出回执”：
  - JSON 导出（保留 params 与筛选条件）
  - CSV 导出（适合人工审阅与二次分析）
- [x] 新增 `emit_graph_batch` 事件协议并贯通前端：
  - Agent 侧可下发批次步骤（`steps[]`）
  - `mode=all_or_nothing | best_effort`
  - GraphPage 串行执行批次并回传批次结果事件
- [x] `FloatingAgent` 已接入批次结果 toast（`pathmind:graph-batch-result`）。

### P6-Graph 下一步
- [ ] 批次执行增加“显式回滚步骤”（当前仅 all_or_nothing 的中止语义，不含自动补偿）。
- [ ] 增加图谱写操作工具（节点/关系创建与编辑）并接入审批策略。
- [ ] 批次执行结果沉淀到后端审计表，支持按批次 ID 全链路追踪。


## Update: 2026-02-21 (P6-Graph-P5 完成：自动补偿回滚 + 批次审计落地)

### P6-Graph-P5 已完成
- [x] `GraphPage` 批次状态机升级为双阶段：
  - `forward`：正常执行步骤
  - `rollback`：`all_or_nothing` 失败后自动执行补偿回滚
- [x] 回滚策略基于每步 `undoCommand` 自动生成补偿链（逆序执行）。
- [x] 批次结果增强：新增 `rolledBack` / `rollbackFailed` 指标，并展示在图谱回执面板。
- [x] 新增批次审计存储（Redis）：
  - `append_graph_batch_feedback`
  - `list_graph_batch_feedback`
- [x] 新增 Python API：
  - `POST /agent/graph/batch-feedback`
  - `GET /agent/graph/batch-feedback`
- [x] 新增 Go 代理路由：
  - `POST /api/agent/graph/batch-feedback`
  - `GET /api/agent/graph/batch-feedback`
- [x] 前端 `agentApi` 新增批次回执上报/查询方法，`GraphPage` 在批次结束后自动上报批次审计。

### P6-Graph 下一步
- [ ] 将批次审计从 Redis 提升到 Postgres（长期保留 + SQL 检索）。
- [ ] 增加批次级可视化面板（按 batch_id 回放每步执行与补偿详情）。
- [ ] 打通图谱写操作工具（节点/关系增删改）并接入审批策略。


## Update: 2026-02-21 (P6-Graph-P6 完成：批次回放面板 + Postgres 审计桥接)

### P6-Graph-P6 已完成
- [x] `GraphPage` 新增“批次时间线”区块（批次状态、模式、完成度、补偿统计）。
- [x] 新增“批次回放”能力：按 `batch_id` 重建 forward 步骤并重新派发 `graph_batch` 事件。
- [x] 批次回放步骤重建逻辑支持剥离 `__batch` 元信息，避免回放污染原批次上下文。
- [x] 批次结束时新增 Postgres 审计桥接：
  - Python `ingest_graph_batch_feedback` 复用 `audit_client.log_tool_action`
  - 写入 Go `internal/agent/audit` → `agent_action_audit`（统一审计表）
- [x] `audit_client` 增强为可接收显式上下文覆盖（student/session/agent/engine/mode），避免依赖 request context。

### P6-Graph 下一步
- [ ] 将批次审计“查询源”从 Redis 切换为 Postgres（支持长期保留、SQL 筛选、分页）。
- [ ] 新增批次回放详情页（每步 forward/rollback 执行轨迹与失败原因）。
- [ ] 打通图谱写操作工具（节点/关系增删改）并接入审批策略。


## Update: 2026-02-22 (P6-Graph-P7 完成：批次时间线查询切换 Postgres + Redis 回退)

### P6-Graph-P7 已完成
- [x] Go 新增 Postgres 批次时间线查询服务 `GraphBatchTimelineService`（基于 `agent_action_audit`）。
- [x] `GET /api/agent/graph/batch-feedback` 改为：
  - 先查 Postgres（`tool=graph_batch` + `student/agent/session/status` 过滤）
  - 空结果或查询异常自动回退 Python/Redis 查询（迁移期兼容）
- [x] 批次查询响应新增 `source` 字段（`postgres` / `redis`），用于前端诊断当前数据源。
- [x] 前端 `GraphPage` 接入批次数据源标识展示（批次时间线标题旁显示来源）。

### P6-Graph 下一步
- [ ] 批次回放详情页（forward/rollback 每步执行轨迹 + 错误原因）。
- [ ] 批次时间线增加 cursor 分页与时间窗口过滤。
- [ ] 图谱写操作工具（节点/关系增删改）接入审批与审计。


## Update: 2026-02-22 (P6-Graph-P8 完成：批次详情面板 + 游标分页协议)

### P6-Graph-P8 已完成
- [x] 批次时间线查询协议新增 `before_ts`（ms）游标参数，支持“向后翻页”。
- [x] 批次时间线响应新增 `next_before_ts`，用于前端无状态分页续拉。
- [x] Go `GraphBatchTimelineService` 支持 `before_ts` + `limit+1` 查询，返回 `next_before_ts`。
- [x] Python/Redis fallback 查询链路同步支持 `before_ts/next_before_ts`，保证 PG 回退路径语义一致。
- [x] `GraphPage` 批次时间线新增“加载更多批次”交互（游标分页）。
- [x] `GraphPage` 新增批次详情视图（forward/rollback step 级轨迹 + 状态）。

### P6-Graph 下一步
- [ ] 批次详情支持失败原因展开（message/params）与单步复制导出。
- [ ] 批次回放增加“回放前确认”与只回放前 N 步控制。
- [ ] 图谱写操作工具（节点/关系增删改）接入审批与审计策略。


## Update: 2026-02-22 (P6-Graph-P9 完成：详情展开/复制导出 + 回放确认)

### P6-Graph-P9 已完成
- [x] 批次详情支持 `message/params` 展开查看（step 级）。
- [x] 批次详情支持单步复制（JSON）与批次详情导出（JSON）。
- [x] 批次回放增加“回放前确认”提示，降低误触发风险。

### P6-Graph 下一步
- [ ] 批次回放增加“只回放前 N 步”与“按 phase 选择回放”控制。
- [ ] 批次详情增加 message/params 的全文检索与筛选。
- [ ] 图谱写操作工具（节点/关系增删改）接入审批与审计策略。


## Update: 2026-02-22 (P6-Graph-P10 完成：回放范围控制)

### P6-Graph-P10 已完成
- [x] 批次回放新增 `phase` 选择：`forward` / `rollback` / `all`。
- [x] 批次回放新增“前 N 步”限制（1~50，留空为全部）。
- [x] 批次回放确认文案增强：展示本次回放范围与命令条数。

### P6-Graph 下一步
- [ ] 批次回放增加“按 step 区间回放”（start/end）。
- [ ] 批次详情增加 message/params 的全文检索与筛选。
- [ ] 图谱写操作工具（节点/关系增删改）接入审批与审计策略。


## Update: 2026-02-22 (P7 启动：能力矩阵 -> 执行路线)

### P7 基线结论（已确认）
- [x] 新增能力矩阵基线文档：`docs/webagent-capability-matrix-v1.md`
- [x] 统一智能等级口径（L0-L5），并完成模块级与后端通路级评估
- [x] 当前系统定位：`L3.5 ~ L4.0`（已具备编排/审批/审计/回放，未达跨域自治事务）
- [x] 明确 P7 三波次：P7-1（用户可见闭环）/ P7-2（图谱写入+补偿）/ P7-3（跨域事务协议）

### Phase P7-1: 跨板块任务中枢（启动）
- [x] AIAdvisor 增加“跨板块任务模板启动器”（beta）
- [x] 定义统一任务回执协议（steps/tools/approval/result/error）
- [x] Notes/Documents/Experiments 接入统一回执面板（先只读）
- [x] 打通 3 条可执行模板（fallback contract）：
  - 文档沉淀到笔记
  - 笔记提炼到图谱分析
  - 实验复盘报告草稿
- [ ] E2E 验收：一次跨板块任务触发 + 一次审批 + 一次回执导出
- **Status:** in_progress

### P7-1A 首批实施票据（本轮执行入口）
- [x] 定义 `task_template` 协议最小字段：`task_type/label/steps/receipt_schema/risk_level`
- [x] 在 `AIAdvisor` 落地任务模板启动器 UI（液态玻璃风格）
- [x] 在 `useAgentStream` 增加任务回执事件聚合（与 approval/graph batch 并行）
- [x] 在 `src/services/api.ts` 增加任务模板查询与启动接口（先对齐前端 contract，可 mock/fallback）
- [x] 在 `NotesPage/DocumentsPage/ExperimentsPage` 增加统一回执区块骨架（复用 `AgentClusterBoard` 风格）

### P7-2 / P7-3 预留（未启动）
- [ ] P7-2：图谱写操作工具 + 审批 + 补偿事务最小协议
- [ ] P7-3：notes/pdf/graph/rag 跨域事务批次协议与 SDK contract 收口
- **Status:** pending

## Update: 2026-02-22 (P7-1A 首批前端闭环完成)

### P7-1A 本轮完成
- [x] 新增任务模板 API contract 与 fallback 机制（后端未就绪时前端可联调）。
- [x] 新增统一任务回执存储层（localStorage + window event）用于跨页面共享。
- [x] AIAdvisor 新增模板启动器、模板 prompt 覆写、任务启动动作与回执联动。
- [x] `useAgentStream` 新增 `task_receipt` 事件解析与 callback。
- [x] Notes/Documents/Experiments 三页接入统一任务回执面板（只读）。

### P7-1 下一步
- [ ] 后端补齐 `/agent/task-templates` 与 `/agent/task-templates/start` 正式接口，实现非 fallback 运行。
- [ ] 将审批/工具/graph batch 事件映射为更精确的 step 状态流转（running->success/failed）。
- [ ] 完成 P7-1 E2E 验收用例并记录回执导出样例。

## Update: 2026-02-22 (P7-1B 完成：后端 task templates + 本地全栈启动)

### P7-1B 已完成
- [x] Python 新增任务模板正式接口：
  - `GET /agent/task-templates`
  - `POST /agent/task-templates/start`
- [x] Go 网关新增转发与路由：
  - `GET /api/agent/task-templates`
  - `POST /api/agent/task-templates/start`
- [x] `task_templates` 后端内建目录与前端 fallback 模板对齐（3 条模板）。
- [x] 启动事件写入审计链路（`task_template_start`）。
- [x] 本地依赖容器拉起（Postgres/Redis/Neo4j）并完成前后端三服务启动。

### P7-1 当前状态
- [x] 前端任务模板启动器 + 统一回执面板
- [x] 后端 task-templates 正式接口
- [ ] P7-1 E2E：受保护路由下的登录态验收脚本（审批 + 回执导出）
- **Status:** in_progress

## Update: 2026-02-22 (Hotfix: PDF 上传长期“索引中”)

### Hotfix 已完成
- [x] 定位根因 1：Python RAG DB 未就绪（`db_unavailable`，本地 Postgres 缺失 pgvector）
- [x] 定位根因 2：Go 上传保存相对路径，跨服务调用时文件定位不稳定
- [x] Go `DocumentHandler.Upload` 改为保存绝对路径
- [x] Go `triggerRAGIngest` 增加非 completed 状态落库（`page_count=-1`）与失败日志
- [x] 前端 `DocumentsPage` 增加 pending 轮询刷新（5s）与“索引失败”显式状态
- [x] Python `/health` 增加 `rag.pgvector_ready` 可观测字段
- [x] 本地依赖切换为 `pgvector/pgvector:pg16`，RAG 可用
- [x] 历史卡住文档补偿重试并成功索引

### Follow-up
- [ ] 增加 `POST /api/documents/:id/reindex` 显式重试接口（避免仅能“删了重传”）
- [ ] 为索引失败增加结构化错误码字段（避免仅用 `page_count=-1` 语义）

## Update: 2026-02-22 (Hotfix: 文档语义检索 500)

### Hotfix 已完成
- [x] 复现并定位 `/api/documents/query` 的 `500` 根因（`documents.uploaded_by/course_id` 类型与 SQL cast 不一致）
- [x] 修复 RAG 查询过滤 SQL（改为 `column::text = $n`，兼容 text/uuid 列）
- [x] 回归验证查询接口恢复 `200` 并返回检索结果

### Follow-up
- [ ] 评估是否对 `documents` 表执行类型标准化迁移（`uploaded_by/course_id` -> uuid）

## Update: 2026-02-22 (RAG 模型升级：bge-m3 + text-first + rerank)

### 已完成
- [x] 文档嵌入默认模型切换为 `baai/bge-m3`（中文通用检索优先）
- [x] 视觉抽取默认模型切换为 `meta/llama-3.2-90b-vision-instruct`
- [x] 接入二阶段 rerank（`nvidia/llama-3.2-nemoretriever-300m-embed-v2`）
- [x] PDF ingestion 改为 `text-first` + `vision-fallback`（并支持结构化 parser 开关）
- [x] RAG 查询缓存键加入 query/rerank model 维度，避免模型切换后脏缓存
- [x] 对现有两份 PDF 执行重建索引，抽样验证分块质量提升

### Follow-up
- [ ] 增加“重建索引”API（按文档触发），避免手工脚本补偿
- [ ] 增加 OCR/文本提取质量评分与自动策略切换阈值

## Update: 2026-02-22 (RAG 复核确认：重启后可恢复 + 模型链路生效)

### 已确认
- [x] `baai/bge-m3` / `meta/llama-3.2-90b-vision-instruct` / `nvidia/llama-3.2-nemoretriever-300m-embed-v2` 在 NVIDIA 模型列表可用。
- [x] Python 服务启动后 `/health` 返回 `rag.pgvector_ready=true`。
- [x] 直接调用 `POST /rag/query` 可返回高相关片段，重排分数正常。
- [x] 当前已索引文档保持 `extraction_method=text`，chunk 质量较 OCR 路径更稳定。

### 下一步建议（不阻塞当前）
- [ ] 增加 `POST /api/documents/:id/reindex`，将“手工脚本重建”产品化。
- [ ] 在 ingestion 增加“文本质量评分门槛”与自动降级策略（text/vision 双向切换）。

## Update: 2026-02-22 (P7-UX-1：用户可感知协作体验增强)

### P7-UX-1 已完成
- [x] AIAdvisor 接入可开关的 `AgentClusterBoard`，用户可直接看到集群编排链路。
- [x] 新增“Agent 协作态势”面板（委托总量、成功率、in-flight、批次提交率）。
- [x] 新增“最近委托轨迹”列表（running/done/failed）。
- [x] Hooks 事件流新增筛选与搜索（全部/委托/编排/审批/工具）。
- [x] 新增“导出用户侧回执”按钮（timeline + delegation + task receipts）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-UX-1)
| Decision | Rationale |
|----------|-----------|
| 先增强 AIAdvisor 单页可观测性 | 用户入口集中，最短路径提升“能看到/能感知”的智能协作体验 |
| 回执导出优先做 JSON | 便于联调与后续接入 PDF/审计系统，避免早期格式锁定 |
| 事件筛选聚焦委托/编排/审批 | 先覆盖用户最关注的智能行为主线，控制信息噪音 |

## Update: 2026-02-22 (P7-UX-2：跨板块感知 + 时间线精准筛选)

### P7-UX-2 已完成
- [x] AIAdvisor 新增“用户可感知工作台”，覆盖笔记/文档/PDF/实验/图谱/RAG/Coding 七类板块。
- [x] 基于 task receipts 实时计算各板块状态（待触发/执行中/稳定/异常/部分完成）。
- [x] 每个板块提供“双入口”动作：`打开板块` + `让 Agent 执行`（快捷 prompt）。
- [x] Hooks 事件流新增 `status` + `command` 双过滤（含二级筛选：类别/状态/命令/关键词）。
- [x] 时间线事件卡片补齐 level/command/status 标签，支持用户快速排查智能链路。
- [x] 回执导出改为复用内存快照（避免 localStorage 重读造成视图与导出不一致）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-UX-2)
| Decision | Rationale |
|----------|-----------|
| 先做“工作台状态+快捷动作”，再做更多视觉动画 | 用户首先需要感知“系统能做什么、现在做到哪一步”，信息架构优先于动效 |
| 时间线先补状态/命令过滤 | 复杂协作场景下定位问题效率提升最大，直接提升可操作性 |
| 工作台状态统一由 task receipt 派生 | 保持前后端语义一致，后续可平滑对接审计与 SDK contract |

## Update: 2026-02-22 (P7-UX-3：页面偶发不显示修复)

### P7-UX-3 已完成
- [x] `ErrorBoundary` 增加 `resetKey` 机制（路由切换时自动清理错误态，避免“错误态粘住”）。
- [x] 对动态 chunk 加载失败增加专门识别与恢复提示（`ChunkLoadError / Failed to fetch dynamically imported module`）。
- [x] `App` 引入 `lazyWithRetry`，首次 chunk 失败自动刷新一次，降低热更新后 hash 失配导致的白屏概率。
- [x] `Documents/Notes/Experiments` 的 `AgentClusterBoard` 与 `TaskReceiptPanel` 改为局部容错，不再拖垮整页。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-UX-3)
| Decision | Rationale |
|----------|-----------|
| 优先修复“页面可达性”而非继续堆新功能 | 用户端首要体验是“能稳定打开和操作”，可达性优先级高于功能扩展 |
| 路由级重置 + 组件级隔离双保险 | 同时覆盖“整页错误态残留”和“局部组件异常拖垮页面”两类高频故障 |
| 对 chunk 加载失败做一次自动恢复 | 对 dev/build 更新后的 hash 失配是低成本高收益防护 |

## Update: 2026-02-22 (P7-Hotfix-DocAgent：文档助手工具失败)

### 已完成
- [x] 复现 `document-reader` 在默认模型下返回通用错误（`AI 服务出现错误，请稍后再试`）。
- [x] 验证同一 agent 在 `qwen/qwen3-next-80b-a3b-instruct` 下可稳定响应。
- [x] 将 `document-reader.engine_model` 从 `deepseek-ai/deepseek-v3.2` 切换到 `qwen/qwen3-next-80b-a3b-instruct`。
- [x] Python Agent 服务重启并完成 `/agent/query` 回归验证。
- **Status:** complete

### Decisions Added (2026-02-22, P7-Hotfix-DocAgent)
| Decision | Rationale |
|----------|-----------|
| 文档助手默认模型改为 qwen | 当前环境下该模型在工具调用链路稳定，DeepSeek 路由出现高概率失败 |
| 先热修默认模型，不改用户交互 | 最短路径恢复“文档检索可用性”，降低用户中断时间 |

## Update: 2026-02-22 (P7-Perf-4：卡顿与偶发加载失败治理)

### P7-Perf-4 已完成
- [x] 统一本地默认端口到 `18080`（Go `.env/.env.example` + Python `go_backend_url`）。
- [x] 关闭 Python 默认 debug reload（`.env/.env.example` 设为 `PATHMIND_DEBUG=false`）。
- [x] Vite 增加重依赖预构建（`optimizeDeps.include`），减少 dev 首次页面切换卡顿。
- [x] Vite 增加 `manualChunks` 分包（react/charts/graph/markdown/codemirror/motion）。
- [x] Coding Quickstart 与 API 注释同步到最新端口约定（避免 8080/18080 混淆）。
- [x] 构建与编译回归通过（前端构建、Python 语法、Go 编译）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-Perf-4)
| Decision | Rationale |
|----------|-----------|
| 先修“端口错配 + reload 抖动”再调优 UI 动效 | 两者是导致“卡、超时、偶发空白页”的高频根因，投入产出比最高 |
| 分包与预构建同时做 | 分别覆盖生产加载与开发态首跳卡顿，不依赖单一手段 |
| 以 `18080` 作为本地网关默认端口 | 当前前端代理与实际联调链路已使用该端口，统一后最少摩擦 |

## Update: 2026-02-22 (P7-UI-Minimal：前端极简化 + 继续压缩)

### P7-UI-Minimal 已完成
- [x] AIAdvisor 改为“大标题 + 主交互优先”布局，弱化系统观测信息默认展示。
- [x] 新增 `detailsOpen` 机制，将编排/会话/事件/集群等系统细节折叠到次级区域。
- [x] Notes/Documents/Experiments 的集群与回执面板改为默认收起，按需查看。
- [x] NoteEditor 去除 `@codemirror/language-data` 全量语言包依赖，进一步压缩大 chunk。
- [x] 新增 `docs/frontend-minimal-ux-plan-v1.md`，固化简约信息架构与下一步路线。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-UI-Minimal)
| Decision | Rationale |
|----------|-----------|
| 默认隐藏系统日志/编排细节 | 用户首要关注任务输入与结果，系统实现信息应后置 |
| 主标题与摘要层级上移 | 先建立“能做什么”的心智，再进入具体交互 |
| 保留“按需展开”而非删除能力 | 不牺牲调试与可观测能力，同时保留简洁主界面 |
| 优先砍掉编辑器全语言包 | 对包体和首屏切页卡顿影响最大，属于高收益优化 |

## Update: 2026-02-22 (P7-UI-Minimal-2：Claude 观感抽屉化)

### P7-UI-Minimal-2 已完成
- [x] AIAdvisor Hero 媒体位支持 URL 配置（本地持久化，支持 gif/image/webm/mp4）。
- [x] 事件流面板改为右侧抽屉浮层（详情模式下），避免占据主消息区高度。
- [x] 会话历史改为右侧抽屉浮层（详情模式下），与事件面板互斥展示。
- [x] 详情模式下新增背景遮罩与关闭按钮，交互更接近 Claude 风格“主内容 + 侧栏”。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-UI-Minimal-2)
| Decision | Rationale |
|----------|-----------|
| 事件/会话改侧抽屉而非页面内长卡片 | 保持主内容连续性，减少“信息墙”带来的压迫感 |
| 抽屉仅在系统细节模式启用 | 默认体验保持极简，调试能力按需开启 |
| 媒体位采用 URL 注入并本地持久化 | 方便快速替换开源动图，不引入额外上传系统复杂度 |

## Update: 2026-02-22 (P7-UI-Minimal-3：单一侧栏 + 笔记写作优先)

### P7-UI-Minimal-3 已完成
- [x] AIAdvisor 抽屉来源统一为单一状态 `detailDrawerTab`（overview/events/sessions 互斥）。
- [x] 系统“总览”迁移到右侧抽屉，主内容区不再插入大块系统卡片。
- [x] Notes 顶栏改为“书写优先”语义，移除喧宾夺主的系统按钮样式。
- [x] Notes 系统能力（集群/回执）保留但默认收起，集中在“系统”次级入口。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-UI-Minimal-3)
| Decision | Rationale |
|----------|-----------|
| 单一抽屉状态管理所有系统面板 | 降低状态复杂度，避免多面板并开发生布局冲突 |
| 总览也抽屉化 | 最大化保留主消息流空间，贴近 Claude 的主交互优先范式 |
| 笔记页突出“写作主任务” | 用户心智是“写笔记”，而非“看系统日志” |

## Update: 2026-02-22 (P7-Notes-ObsidianLite：专注写作 + 插件扩展入口)

### P7-Notes-ObsidianLite 已完成
- [x] Notes 增加 `专注写作` 模式（快捷键 `Ctrl/Cmd + Shift + F`）。
- [x] 进入专注模式自动折叠侧栏/AI/图谱/系统面板，并强制单栏编辑视图。
- [x] 基于本地 `obsidian-releases` 生成社区插件精选目录（Top 300）。
- [x] Notes 系统面板新增 `Obsidian 插件扩展（轻量兼容）`：搜索、Repo 跳转、启用入口持久化。
- [x] 输出 Obsidian 兼容性说明文档，明确“目录兼容 vs 运行时兼容”边界。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-Notes-ObsidianLite)
| Decision | Rationale |
|----------|-----------|
| 先做 Obsidian “目录级兼容” | Obsidian 主程序非开源，直接插件运行不可一步到位，先做可用入口更稳妥 |
| 插件能力放在 Notes 系统面板 | 保持写作主流程简洁，扩展能力按需启用 |
| 专注模式默认压平复杂 UI | 明确“笔记产品主任务是书写” |

## Update: 2026-02-22 (P7-Notes-ObsidianLite-2：命令运行时)

### P7-Notes-ObsidianLite-2 已完成
- [x] 新增 Notes 轻量插件运行时（`notesPluginRuntime`）与状态计算能力。
- [x] 顶栏接入 `扩展命令` 下拉菜单，支持内建命令一键执行。
- [x] 启用的 Obsidian 插件自动生成“迁移入口命令”（Repo 跳转）。
- [x] 启用状态支持跨组件实时同步（`pathmind:obsidian-enabled-changed`）。
- [x] 文档更新兼容边界（目录 + 命令入口 + 内建运行时）。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-Notes-ObsidianLite-2)
| Decision | Rationale |
|----------|-----------|
| 先做“内建命令运行时”而非直接执行第三方 JS | 控制安全边界并保持稳定性，避免引入 Obsidian 私有 API 依赖 |
| 外部插件先映射为迁移入口命令 | 给用户可见的扩展闭环，同时为后续 P1 迁移 API 预留通道 |
| 顶栏状态徽标保持极简 | 仅展示写作直接相关指标（字数/双链/待办/扩展） |

## Update: 2026-02-22 (P7-UX-Refine-NotesAI：单栏所见即所得 + 控制项按需显示)

### P7-UX-Refine-NotesAI 已完成
- [x] Notes 取消分屏/预览切换，回归单栏编辑主路径。
- [x] Notes 编辑器切换为 `MDXEditor`（WYSIWYG Markdown，所见即所得）。
- [x] AIAdvisor 取消常驻复杂控制条，默认仅保留主任务与对话入口。
- [x] 新增 `AI 提示` 气泡入口与 `能力卡片` 弹窗（按需打开）。
- [x] 支持通过自然语言触发能力卡片（如“打开设置/能力卡片/控制面板”）。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-22, P7-UX-Refine-NotesAI)
| Decision | Rationale |
|----------|-----------|
| Notes 强制单栏写作路径 | 满足“写作场景优先”与 Obsidian Live Preview 心智，减少模式切换成本 |
| 采用 `MDXEditor` 作为 WYSIWYG Markdown 内核 | React 19 兼容，且原生以 Markdown 作为输入输出，便于与现有后端接口衔接 |
| AIAdvisor 控制项默认隐藏 | 对齐 Claude 式“任务主流程优先”，减少视觉噪音与认知负担 |
| 能力配置改为弹窗卡片 | 保留全能力可达性，同时做到“未主动请求不展示” |

## Update: 2026-02-23 (P7-Notes-Perf-1：Markdown 代码块 + 卡顿治理)

### P7-Notes-Perf-1 已完成
- [x] Notes 编辑器补齐 fenced code block 支持（`codeBlockPlugin`）。
- [x] 代码高亮改为“按需加载”（仅内容出现 ``` 时动态加载 CodeMirror 插件）。
- [x] Notes 页面重型模块改为懒加载（Agent 看板/任务回执/插件目录/图谱/AI 面板）。
- [x] 自动保存优化：变更去重 + 延迟提升到 `1200ms`，降低高频请求导致的输入抖动。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-23, P7-Notes-Perf-1)
| Decision | Rationale |
|----------|-----------|
| 代码高亮采用延迟激活 | 兼顾“支持代码语法高亮”与“默认写作路径流畅度” |
| 系统面板组件全部按需加载 | 避免初始进入 Notes 时解析不必要的大组件，降低首屏卡顿 |
| 自动保存做去重与更长 debounce | 减少写作时网络风暴与 React 频繁状态切换 |

## Update: 2026-02-23 (P7-Notes-Perf-2：无损动画的输入链路优化)

### P7-Notes-Perf-2 已完成
- [x] Notes 编辑内容更新改为 `requestAnimationFrame + startTransition`，降低同步阻塞。
- [x] Notes 状态徽标计算切换为 `useDeferredValue`，减轻输入主线程压力。
- [x] `NoteSidebar` 接入 `React.memo`，避免输入时无关侧栏重渲染。
- [x] 侧栏搜索定时器改 `ref` 管理，去除每次键入导致的额外状态更新。
- [x] 保留现有 framer-motion 动效，不做降级处理。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-23, P7-Notes-Perf-2)
| Decision | Rationale |
|----------|-----------|
| 优先优化渲染路径而非删减动画 | 满足“性能提升 + 视觉动效完整”双目标 |
| 用 React 并发特性处理非关键更新 | 保障输入与动效的主交互优先级 |
| 对无关组件做 memo 隔离 | 避免“键入驱动整页重绘”放大卡顿 |

## Update: 2026-02-23 (P7-Nav-FirstPaint-1：实验/笔记/PDF 首次切页空白治理)

### P7-Nav-FirstPaint-1 已完成
- [x] `ExperimentsPage` 系统面板保持懒加载 + Suspense（仅用户展开时加载）。
- [x] `DocumentsPage` 的 Agent 看板/回执改为懒加载 + Suspense。
- [x] `NotesPage` 的 `NoteEditor` 改为懒加载，首屏先走轻量骨架。
- [x] `NotesPage` 从 barrel 改为直连 `NoteSidebar`，避免隐式拉入重型依赖。
- [x] `DashboardLayout` 路由过渡从 `mode="wait"` 调整到 `mode="sync"`，降低切页感知空档。
- [x] `DashboardLayout` 增加 `requestIdleCallback` 路由空闲预取（实验/笔记/PDF）。
- [x] 调整 `vite` 分包策略：取消 `codemirror` 强制公共 vendor chunk，避免实验/PDF 路由间接拉取编辑器大包。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-23, P7-Nav-FirstPaint-1)
| Decision | Rationale |
|----------|-----------|
| 首屏优先剥离系统面板依赖 | 用户主路径先可交互，系统细节按需加载 |
| 路由过渡保持动画但改同步 | 不削减动效质量，同时减少“页面空一下”的体感 |
| 空闲预取而非强制预载 | 降低首次切页等待，又避免主线程启动拥塞 |

## Update: 2026-02-23 (P7-Nav-FirstPaint-2：渲染空白根因闭环)

### P7-Nav-FirstPaint-2 已完成
- [x] `FloatingAgent` 从静态导入改为懒加载，并延迟挂载。
- [x] `DashboardLayout` 路由容器移除 entering hidden 初始态（`initial={false}`）。
- [x] `Notes/Documents/Experiments` 关键容器移除首帧 `opacity: 0` 初始隐藏。
- [x] `DashboardLayout` 固定玻璃层 blur 从 `20px` 调整到 `14px`（保留玻璃视觉）。
- [x] `main.tsx` 改为“开发环境不启用 StrictMode 双渲染”。
- [x] `vite optimizeDeps` 排除 MDX/CodeMirror/3D 重型依赖，降低 dev 预构建阻塞。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-23, P7-Nav-FirstPaint-2)
| Decision | Rationale |
|----------|-----------|
| 优先移除首帧隐藏态 | 直接消除“页面已加载但不可见”的体感空白问题 |
| 入口大组件延迟挂载 | 把主线程资源优先让给当前页面首屏内容 |
| 开发态先追求交互真实性能 | 双渲染会夸大卡顿与抖动，不利于问题定位 |

## Update: 2026-02-23 (P7-Notes-Perf-3：极速编辑默认化 + 导航滚动稳定性)

### P7-Notes-Perf-3 已完成
- [x] Notes 新增编辑器模式持久化（`fast/advanced`，默认 `fast`）。
- [x] 顶栏接入“极速 / 高级”双模式切换，保留液态玻璃视觉样式。
- [x] 极速模式下输入链路改为同步更新，避免并发降级造成的键入迟滞。
- [x] 高级模式保持懒加载（仅切换到高级时加载 `NoteEditor` 大包）。
- [x] 路由主容器取消 path-keyed 切换动画，减少切页首帧空白与抖动。
- [x] 全局 `scroll-behavior` 调整为 `auto`，修复切页后“需滚轮触发回位”的问题。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-23, P7-Notes-Perf-3)
| Decision | Rationale |
|----------|-----------|
| Notes 默认走极速编辑器 | 优先保证“进入即能写、键入无阻塞”的主任务体验 |
| 高级编辑器改按需进入 | 将重型编辑能力变成显式选择，避免拖慢默认路径 |
| 去除路由层切页动画 key 依赖 | 降低切页 remount 开销与首帧不可见概率 |
| 禁用全局平滑滚动 | 避免路由重置滚动时出现延迟回滚与空白错觉 |

## Update: 2026-02-23 (P7-Notes-AI-Simplify：仅 AI 主控 + Obsidian 兼容增强)

### P7-Notes-AI-Simplify 已完成
- [x] Notes 页面删除“极速模式”入口，统一高级编辑体验（单栏写作为主）。
- [x] 顶栏控制收敛为“专注写作 + AI”，移除扩展命令/系统/图谱等干扰项。
- [x] AI 面板增强：Markdown 输出、分段可应用、锚点插入/替换、整篇替换。
- [x] AI 面板新增“定位关键词 + 撤销最近 AI 修改”能力。
- [x] 编辑器新增 Undo/Redo、Table、Frontmatter、Admonition（Callout）工具。
- [x] 增加 Obsidian Callout 兼容：`> [!NOTE]` 与 `:::note` 双向转换。
- [x] 接入 orchestrator 运行参数（`webagent_v1`）到 Notes AI 对话链路。
- [x] `note-assistant` 系统提示词升级：客观表达、权限边界、来源约束、结构化输出。
- [x] 构建与语法回归通过。
- **Status:** complete

### Decisions Added (2026-02-23, P7-Notes-AI-Simplify)
| Decision | Rationale |
|----------|-----------|
| Notes 只保留 AI 主入口 | 最大化主任务聚焦，降低视觉和交互噪音 |
| AI 修改必须“用户确认应用” | 明确 agent 权限边界，避免隐式写入 |
| 分段应用优先 | 支持多次小步迭代，降低整篇覆盖风险 |
| Obsidian 兼容先做高价值语法 | 先覆盖 callout/frontmatter/table，兼顾性能与可用性 |

## Update: 2026-02-23 (P7-Notes-AI-Minimal：自然语言优先)

### P7-Notes-AI-Minimal 已完成
- [x] AI 面板删减显式操作控件，回归自然语言驱动。
- [x] 保留最小确认链路：`应用建议` + `撤销`。
- [x] 引入 `pathmind-edit` 轻协议，动作由 agent 自主选择并输出。
- [x] 保持“用户确认后写入”的权限边界。
- **Status:** complete

## Update: 2026-02-23 (P7-Notes-Perf-4：流式批处理 + 滚动稳定性)

### P7-Notes-Perf-4 已完成
- [x] `useAgentStream` 文本流改为 28ms 批量 flush，降低 token 级重渲染频率。
- [x] `NoteAIPanel` 消息气泡组件 `memo` 化，历史消息渲染隔离。
- [x] `NoteAIPanel` 流式阶段改 `auto` 滚动，完成后再 `smooth`，避免持续平滑滚动卡顿。
- [x] `NoteAIPanel` 在流式期间暂停 `pathmind-edit` 解析，减少正则计算与副作用触发。
- [x] `NotesPage` 向 AI 面板传入 `useDeferredValue(editContent)`，减轻打字时侧栏重渲染。
- [x] `DashboardLayout` 路由切换滚动重置升级为多次补偿（layout + raf + timeout），降低“需手动滚轮触发回位”概率。
- [x] 前端构建回归通过（`npm run -s build`）。
- **Status:** complete

### Decisions Added (2026-02-23, P7-Notes-Perf-4)
| Decision | Rationale |
|----------|-----------|
| 优先降低“流式更新频次”而不是阉割功能 | 保持实时反馈与 Markdown 能力，同时减少主线程压力 |
| 仅优化滚动策略，不删动效 | 满足“保留丝滑动画”的产品要求 |
| AI 侧栏内容使用 deferred 值 | 避免编辑器输入被侧栏同步渲染拖慢 |

## Update: 2026-02-23 (P3-Metrics-Prework)

### P3-Metrics-Prework 已完成
- [x] Python 端新增 dispatcher 内存指标采集（requests/cache/fallback/p95 ttft/p95 duration）。
- [x] Python 暴露 `GET /api/ai/dispatch/metrics` 快照接口。
- [x] Go 网关新增 `GET /api/ai/dispatch/metrics` 代理路由与 handler。
- [x] 前端摘要流新增 `dispatch_meta` 解析与“备用引擎”微提示。
- [x] Python / Go / 前端构建验证通过。
- **Status:** complete

## Update: 2026-02-23 (P3-Invisible + P4.1)

### P3-Invisible + P4.1 已完成
- [x] 后端根据 TTFT 指标做静默分流降级（openai summary -> claude）。
- [x] ContextSnapshot 在高负载下自动缩放，减少首包等待。
- [x] CM6 编辑器新增内联幽灵补全（Decoration）与 `Tab` 接受机制。
- [x] Notes 接入 500ms 停顿触发的流式补全请求（含 abort/防抖/并发保护）。
- [x] 构建与回归验证通过。
- **Status:** complete

## Update: 2026-02-23 (P4.2)

### P4.2 已完成
- [x] `Tab` 接受补全后快速触发下一轮联想（连续补全）。
- [x] `Esc` 快速清理幽灵补全，减少打断成本。
- [x] 输入时立即中断进行中补全请求，防止错位回填。
- [x] Notes 页面升级为三栏液态布局（左导航 / 中编辑 / 右上下文）。
- [x] 顶栏新增健康指示点，右侧栏预留共享记忆展示区。
- [x] Python / Go / 前端构建回归通过。
- **Status:** complete

## Update: 2026-02-23 (P4.3)

### P4.3 已完成（前端优先）
- [x] 记忆桥接层升级为 CAS 快照存储（content hash）。
- [x] 新增上下文相关记忆检索（Jaccard 相似度 + 同笔记优先）。
- [x] 新增回溯应用接口（应用前自动快照备份）。
- [x] 右侧 Shared Memory 卡片支持：预览 diff / 回溯应用 / 关闭预览。
- [x] NoteEditor 增加非侵入 diff 预览层（added/removed）。
- [x] Python / Go / 前端构建回归通过。
- **Status:** complete

## Update: 2026-02-23 (P5)

### P5 已完成（交互抛光）
- [x] CM6 `ai.output` 流式入场动效接入（ViewUpdate + rAF 批量调度）。
- [x] 补全文本/输出文本统一短时 fade-in 动画。
- [x] 三栏布局切换升级为弹性过渡（spring + layout）。
- [x] Shared Memory 卡片升级为层叠玻璃动效（AnimatePresence）。
- [x] 顶栏健康指示增加 thinking/cache 命中环境动画。
- [x] Python / Go / 前端构建回归通过。
- **Status:** complete

## Update: 2026-02-25 (Notes Obsidian 化 P-A~E)

### 本轮已完成
- [x] 后端新增 `note_folders` 模型与 `notes.folder_id/sort_order` 兼容改造。
- [x] 后端新增 `GET /notes/tree`、folder CRUD、`POST /notes/reorder`，并在 `/api/internal` 同步。
- [x] Notes 服务增加 backfill（legacy `folder` -> `folder_id`）与排序持久化逻辑。
- [x] 前端新增 `useNotesTree`，侧栏改为单栏树（文件夹+笔记同栏）并支持拖拽重排。
- [x] 左栏宽度支持拖拽，范围 `220-420px`，本地持久化 `notes_sidebar_width`。
- [x] 顶栏改为极简（左栏开关 + 标题输入 + 右栏 Agent 开关）。
- [x] 标题改为 `400ms` 防抖自动保存，并乐观同步左栏树节点；右栏 Agent 改用 `noteTitle={editTitle}`。
- [x] 新增全局右键菜单系统（Provider）+ Notes 树节点/空白区/编辑区自定义菜单。
- [x] 前后端编译/测试通过（见 progress.md）。
- **Status:** complete (core scope)

### 本轮未覆盖（可在下一轮补）
- [x] Playwright 交互用例（拖拽/右键/宽度持久化）。
- [x] 后端 folder/reorder 服务层独立单测。

### 补充收尾（2026-02-25）
- [x] 前端补齐 tree/reorder/title-debounce/context-menu resolver 单测。
- [x] 后端补齐 notes service 辅助逻辑单测。
- [x] 全量构建与测试回归通过。
- **Status:** complete
- [x] 后端新增 notes handler API 合约测试（tree/folder/reorder）并通过。

### 补充收尾（2026-02-25，第二轮）
- [x] 新增 Playwright Notes 交互测试（左栏宽度持久化、树重排持久化、标题同步、编辑区右键菜单）。
- [x] 新增 Go sqlite 集成测试（事务回滚 + 并发 reorder 后 `sort_order` 连续唯一）。
- [x] `npm run -s test`、`npm run -s build`、`npm run -s test:e2e`、`cd server-go && go test ./...` 全部通过。
- **Status:** complete

## Update: 2026-02-26（灵动岛 Anthropic 工具链路 Hotfix）

### 本轮目标
- [x] 修复 Anthropic 工具回合在缺参/失败时的闭环稳定性，避免长时间卡住后前端兜底“AI 服务暂时不可用”。
- [x] 修复灵动岛思考/工具轨迹展示语义：从“顶部单块”改为“每条 assistant 气泡内联可折叠轨迹”。
- [x] 补齐灵动岛会话的 `student_id` 透传，减少 `student_id` 缺失导致的工具失败。

### 已完成改动
- [x] `build_tool_defs` 包装工具 handler，自动注入请求上下文 `student_id`（仅在工具 schema 包含该字段且请求缺失时）。
- [x] Anthropic 引擎 `tool_result` 回传改为规范结构：`content` + 顶层 `is_error`，并补发基于工具结果的前端事件。
- [x] Anthropic 引擎工具完成事件增加 `status=error` + `reason`，前端可见失败原因。
- [x] 灵动岛 `FloatingAgent` 透传 `studentId + tenant`，并将轨迹按消息维度持久到单个 assistant 气泡内。
- [x] `useAgentStream` 解析 `tool_call` 时透传 `reason/stage` 字段。

### 验证
- [x] Python 语法校验：`python -m py_compile app/engines/tool_converter.py app/engines/anthropic_engine.py`
- [x] TypeScript 校验：`npx tsc -p tsconfig.app.json --noEmit --noUnusedLocals false`

### 风险与后续
- [ ] 当前仓库默认 `npm run -s build` 仍被既有无关告警阻断（`NoteAIPanel.tsx` 未使用变量），本轮未改该非目标问题。

## Update: 2026-02-27（P0+ 笔记补充链路打通）

### 本轮目标
- [x] 修复 `command-center -> note-assistant` 被拒绝委托（allowed: none）。
- [x] 增加“更新笔记”工具，避免“补充笔记”误降级为新建笔记。
- [x] 打通 SDK 数据适配层 PUT 能力。

### 已完成改动
- [x] `delegation_runtime` 白名单新增 `command-center` 可委托目标（含 `note-assistant`）。
- [x] note 工具包新增 `update_note`，并同步 manifest 注册。
- [x] `DataAdapter` 新增 `put_json`（Protocol + HttpDataAdapter 实现）。
- [x] `note-assistant` 与 `command-center` 工具列表接入 `update_note`。
- [x] `command-center` 系统提示词中“修改笔记”策略改为优先 `update_note/get_note_content/search_notes`。

### 验证
- [x] `python -m py_compile` 通过（4 个改动文件）。
- [x] ToolRegistry 扫描确认 `update_note` 已注册。
- [x] 白名单读取确认 `command-center` 已可委托 `note-assistant`。

---

## Remote Ops Task: Armbian Proxy + Web UI（2026-02-27）

### Goal
- 直接 SSH 到 `root@10.51.166.90`，确认是否通过外网代理出站。
- 评估并落地可通过 Web 前端动态更新订阅的可行配置（基于 mihomo）。

### Execution Phases
- [ ] R1: 建立 SSH 会话并采集当前代理进程/端口/配置状态
- [ ] R2: 执行直连 vs 代理出口 IP 对比，确认代理是否生效
- [ ] R3: 检查/修复 external-controller 与 external-ui 配置
- [ ] R4: 给出可复用的运维命令与安全收口建议
- **Status:** in_progress

---

## Update: 2026-03-01（创业计划书重构：脑机模板 + MCP）

### 本轮目标
- [x] 按 `planning-with-files` 完成会话恢复与上下文核对。
- [x] 定位“脑机接口模板”来源文档并抽取可复用结构（摘要/引言/分层叙事）。
- [x] 采集可核验国内市场与政策数据（教育部/国家统计局/国务院/CNNIC/网信办）。
- [x] 产出一版“创业计划书风格、突出 Agent 主动编排与 MCP”的新文档。
- [x] 回填本轮执行记录与交付路径。
- **Status:** complete
