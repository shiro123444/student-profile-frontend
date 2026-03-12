# Findings & Decisions

## 2026-02-25 `/api/complete` 502 根因定位（已修）

### 根因
- Go 日志明确报错：`inline completion api key not configured`。
- 前端请求实际已命中 Go `/api/complete`，但服务在调用上游前即失败并返回 502。

### 修复
- Go 配置增加 fallback：
  - 当 `INLINE_COMPLETION_API_KEY` / `NVIDIA_API_KEY` 未设置时，回退读取 `PATHMIND_OPENAI_API_KEY`。
  - 自动加载 `../server-py/.env` 作为同仓共享凭据来源（只做补充，不覆盖已有环境变量）。
  - `PATHMIND_OPENAI_BASE_URL` 若为 `.../v1`，自动归一化到 host 级 URL，避免拼接出 `/v1/v1/chat/completions`。

### 验证
- 使用有效 JWT 调用：
  - `POST /api/complete` 返回 `200`
  - 响应示例：`{"completion":"a + b"}`

## 2026-02-25 Notes Inline 代码块/正文模式判别修复

### 问题复现
- 在 Markdown 笔记中，内联补全未区分“正文区域”与“fenced code block”，导致代码块场景偶发自然语言候选。

### 修复策略
- 前端新增光标模式识别：
  - 基于 cursor 前文做 fence 配对，识别 `mode=code|prose` 与 `language`。
  - 请求 `/api/complete` 时显式携带 `mode` 与 `language`。
- 后端新增模式化 system prompt：
  - `mode=code`：加强“位于 fenced code block”的约束，附带语言提示。
  - `mode=prose`：降级为 markdown 正文续写语义（仍保持纯文本输出）。
- 前端候选过滤增加 code 模式兜底：
  - 若候选被判定为明显叙述性文本（非代码形态），静默丢弃。

### 结果
- 代码块内候选的“自然语言漂移”明显收敛。
- 不引入额外网络 round-trip，仅增加本地判别与轻量参数，时延开销可忽略。

## 2026-02-25 Inline 补全时延实测（Go `/api/complete`）

### 实测结论
- 采用 `qwen/qwen2.5-coder-32b-instruct` + NIM chat 非流式时，热路径已基本落在“可接受的人类观感”范围。
- 端到端（Go `/api/complete`）30 次连续请求结果：
  - `min=404.5ms`
  - `p50=511.6ms`
  - `p95=714.1ms`
  - `max=917.9ms`
- 前端 300ms 防抖后，用户“停键到看到 ghost text”大致为：
  - 常态：`~0.8s`（300ms + p50）
  - 高分位：`~1.0s`（300ms + p95）

### 模型对比观察
- `qwen/qwen3-next-80b-a3b-instruct` 在同链路下出现明显长尾（个别 5~6s），不适合作为默认 inline 模型。
- `qwen/qwen2.5-coder-32b-instruct` 在稳定性和代码贴合度上更均衡，建议作为 notes inline 默认值。

### 记忆互通成本（A/B）
- 新增 `context_summary` 注入后（约 500 字符上下文摘要）：
  - `p50` 仅增加约 `+6ms`
  - `p95` 基本无变化
- 说明“快慢系统互通”可通过短摘要注入实现，且不会显著破坏补全时延。

## 2026-02-25 Notes Inline Completion 链路收敛（No FIM + No Stream）

### 结论
- 现有 `NotesPage` 内联补全仍保留 FIM token 清洗与流式派发路径，不满足“只走 NIM `/v1/chat/completions` + `stream:false`”约束。
- 已将补全核心链路切换为 Go 网关 `/api/complete`，由后端统一组装 `prefix + [CURSOR] + suffix`，并通过严格 system prompt 限制输出为纯代码。

### 关键实现
- 后端（Go）：
  - 新增 `InlineCompletionService`（`server-go/internal/service/inline_completion_service.go`），使用全局单例 `http.Client` + keep-alive transport。
  - 上游请求固定为：`POST /v1/chat/completions`、`temperature=0.1`、`max_tokens=15`、`stop=["\\n\\n","```"]`、`stream=false`。
  - 新增鉴权端点 `/api/complete`（`server-go/internal/handler/inline_completion_handler.go`）。
- 前端（Notes）：
  - `NotesPage` 内联补全改用 `notesApi.completeInline(...)` 非流式请求。
  - 输入触发防抖统一为 300ms；在新输入时中断上一个请求（AbortController）。
  - 增加轻量括号冲突校验（`prefix + candidate`），不合法候选静默丢弃。

### 测试观察
- 新增前端单测 `src/services/inlineCompletionCore.test.ts`：覆盖 300ms 防抖、中途中断、括号校验逻辑。
- 新增后端单测 `server-go/internal/service/inline_completion_service_test.go`：验证 NIM 请求契约（chat/completions、stream=false、参数固定、`[CURSOR]` 拼装）。

## 2026-02-24 Inline 补全异常污染根因

### 现象
- 模型异常时返回“AI 服务出现错误，请稍后再试。”被前端当作普通补全文本，直接展示/可被接受到正文。

### 根因
- 前端补全解析有“首行兜底”策略，未区分“系统错误文本”与“真实候选”。
- 后端引擎异常时会发 `type=text` 兜底文本，dispatch 层未对 inline 任务做文本过滤。

### 处理
- 前端：`NotesPage` 增加 `isInlineSuggestionNoise`，在候选解析与流式拼接阶段统一拦截。
- 后端：`AIDispatcher` 对 `inline_*` 任务增加 error-text 过滤，不再转发到客户端。

## 2026-02-24 P7 补全“智商”提升实现

### 结论
- 之前补全“不聪明”的核心不是 CM6，而是上下文协议过于单薄（仅简短 prefix + 单候选弱约束）。
- 已升级为 FIM + 局部记忆注入：补全时同时看到前后文、双链摘要、共享记忆摘要，显著降低“离题续写”概率。
- `inline_complete` 路由从通用低优先级快链改为 `fast/claude-haiku`，提升中文写作与衔接质量。

### 关键实现
- 前端：
  - `buildInlineCompletionPrompt` 强制 JSON candidates 协议。
  - `parseInlineSuggestionCandidates` 支持 JSON/XML/列表兜底解析。
  - `requestInlineSuggestion` 注入 `relatedSummaries` 到 `context_snapshot`。
- 后端：
  - `AIDispatcher._pick_runtime` 新增 `_INLINE_TASKS`，对 `inline_complete` 走 `engine=claude, mode=fast`。

### 已知边界
- 当前 ghost text 仍默认使用首候选；候选轮换（Tab 连续切换候选）未启用。
- 若希望完全贴近 Cursor，可在下一步增加“候选池 + Tab 循环 + Esc 清空”状态机。

## 2026-02-24 模型可用性核验与默认模型收敛

### `/models` 核验结果（实时拉取）
- Anthropic 网关可见：`claude-sonnet-4.6`、`claude-haiku-4.5`，并存在 `*-thinking` 与 `*-agentic` 变体。
- OpenAI-compatible 网关未见 `gpt-4o-mini`，可见 `qwen/qwen3-next-80b-a3b-instruct` 与 `qwen/qwen3-next-80b-a3b-thinking` 等。

### 结论与调整
- 将默认 Claude 主模型收敛到 `claude-sonnet-4.6`，Haiku 保持 `claude-haiku-4.5`。
- 将 `opus_model` 设置为 `claude-sonnet-4.6` 作为 fallback，避免无 Opus 额度导致请求失败。
- 将 OpenAI-compatible 默认模型从代码默认 `gpt-4o-mini` 改为网关可用的 `qwen/qwen3-next-80b-a3b-instruct`。

### 追加修复（启动覆盖问题）
- 发现 `app/main.py` 的 `detect_models()` 会在启动时无条件覆盖三档模型，导致 `.env` 中的 `opus_model=claude-sonnet-4.6` 被改回 `claude-opus-4.6`。
- 已改为“仅当当前配置不在可用模型列表中时才自动回填最新候选”，显式配置优先级高于自动探测。

## 2026-02-24 P6 行内编辑（Cursor-style Inline Replace）落地

### 结论
- 笔记助手新增 XML 替换协议：可识别 `<replace><original>...</original><replacement>...</replacement></replace>`。
- 自动写入逻辑已改为“优先行内替换预览”：检测到 XML 后不再直接 append，而是先在 CM6 中高亮 diff，等待用户 Accept/Reject。
- `NoteEditor` 增加 `previewInlineReplace`：先用 `SearchCursor` 近光标匹配，失败再走宽松空白容错匹配，定位成功后复用现有 revision decoration 做红绿预览。
- 应用阶段支持重新定位与一致性校验：若预览位置失效会二次定位，避免把旧范围误写到新内容。

### 关键实现点
- `src/components/notes/NoteEditor.tsx`
  - 引入 `@codemirror/search`。
  - 新增 `NoteEditorHandle.previewInlineReplace(original, replacement)`。
  - 匹配策略：近光标精确查找 → 全文精确查找 → whitespace 容错匹配。
- `src/components/notes/NoteAIPanel.tsx`
  - 扩展 props：`onPreviewInlineReplace` / `onApplyInlineReplace` / `onClearInlineReplacePreview` / `getEditorCursorContext`。
  - 新增 XML 解析与协议提示，增加行内替换确认卡（Accept/Reject）。
  - 在会话切换/新建记录时清理行内预览状态，避免跨记录残留。
- `src/pages/NotesPage.tsx`
  - 增加 `pendingInlineReplaceRef`，保存预览定位结果。
  - 新增预览/应用/清理回调并接入 `NoteAIPanel`。
  - 应用成功后接入原有自动保存、AI undo 快照、记忆沉淀链路。

### 风险与边界
- XML `original` 仍依赖模型返回质量；当原文偏差过大时会返回“定位失败”而不写入，默认安全。
- 目前替换协议是单块 `<replace>`；多块批量替换可作为下一步扩展（支持 `<replacements><replace/>...</replacements>`）。

## 2026-02-23 Note Agent 引擎链路核验（SDK 接口级）

### 结论
- `note-assistant` 当前默认走 OpenAI 链路，不是默认 Claude 链路。
- OpenAI 链路内置了 `escalate_to_claude` 函数工具，可在复杂任务时升级到 Claude 执行。
- 运行时仍支持 `context._runtime` 强制切引擎/模型，因此笔记入口可按策略切到 Claude。

### 证据
- `server-py/app/agents/registry.py:295` 定义 `NOTE_ASSISTANT`，其中 `engine="openai"`，`engine_model="qwen/qwen3-next-80b-a3b-instruct"`。
- `server-py/app/engines/tool_converter.py:78` 定义 OpenAI 注入工具 `escalate_to_claude`。
- `server-py/app/engines/openai_engine.py:108` 在工具调用命中 `escalate_to_claude` 时进入 `_escalate_query(...)`。
- `server-py/app/services/__init__.py:1708` 支持 `context._runtime` 的 `engine/engine_model/model_tier/mode` 运行时路由覆盖。

### 前端闭环状态（本轮复核）
- `NoteAIPanel` 已具备写入事务阶段事件（start/locate/apply/done/error）与工具轨迹展示。
- `NoteAIPanel` 已接入 `agentApi.listSessions` 展示 `note-assistant` 服务端历史摘要。
- `npm run -s build` 通过，当前变更可编译。

## 2026-02-23 P0 编辑器迁移结论（MDX → CM6）

### 已完成
- Notes 主编辑器已切换到原生 CodeMirror 6（不再依赖 MDXEditor 运行链路）。
- `@mdxeditor/editor` 已从依赖移除，`package-lock.json` 同步更新。
- 移除 `.pm-note-mdx*` 样式与旧渲染检测路径，改为 `.pm-note-cm-editor`/`.cm-content`。

### 收益
- 消除 MDXEditor 引发的渲染降级/空白风险源。
- 组件复杂度下降，后续可直接在 CM6 上做 Obsidian 语法扩展与事务级流式写入。

## 2026-02-23 Notes 体验专项结论

### 根因定位（用户体感“卡、遮挡、像报错”）
- 笔记助手默认启用 orchestrator，会在首个可见文本前经历 planner + worker + critique，导致首屏等待明显增长（实测可达几十秒）。
- 侧栏高风险确认采用全屏遮罩，阻断主编辑区交互，用户感知为“卡死/报错”。
- 消息区对所有 assistant 消息每帧都做 Markdown 渲染，流式阶段重排开销偏高。
- `useNote` 存在请求竞态窗口，快速切换笔记可能被旧请求结果回写覆盖，表现为“切换后内容没变”。
- 侧栏工具执行信息直出、不可折叠，视觉负担高且影响主编辑聚焦。

### 已落地修复
- 笔记助手默认关闭 runtime orchestrator（保留后端能力，不在笔记入口强制启用）。
- `useNote` 增加请求序列保护 + 切换时清理 autosave timer。
- 高风险确认改为侧栏内联卡片，不再覆盖全屏。
- 工具日志改为可折叠查看（默认收起）。
- 流式阶段采用轻量文本 + 光标，完成后再 Markdown 渲染。
- AI 侧栏支持拖拽宽度，改善不同屏幕下的可读性与编辑区占比。

## 2026-02-23 Notes AI Panel 第二轮修复结论

### 新增根因识别
- “编辑器不可用”并不总是数据问题，主要是富文本编辑器偶发渲染异常后没有可编辑兜底。
- “思考内容溢出与卡顿”来自流式阶段长文本连续 Markdown 全量重渲染与未截断输出。
- “工具写入过程不可见”来自工具事件只做轻提示，没有形成连续可读的执行轨迹。

### 本轮实现
- 重构 `NoteAIPanel` 渲染链路：分析区默认折叠，仅显示两行摘要，支持展开查看全文。
- 流式阶段保留 Markdown 渲染，但对超长内容做尾部窗口化，减少重排压力与溢出风险。
- 新增工具轨迹自动展开策略：首个工具事件触发时自动展开，展示检索/写入/成功失败全过程。
- 增加内联写入阶段事件：开始、成功、失败均写入轨迹，便于用户感知 agent 正在执行。
- 增加控制块半截输出清理：避免 streaming 阶段把未闭合的 `pathmind-edit` 控制块直接暴露到消息区。
- Notes 页 `ErrorBoundary` 改为可编辑降级模式（textarea + 保存），避免编辑流程被中断。
- Notes 页改为单一编辑器语义（不再展示“高级编辑器”概念），保留稳定降级通道仅用于异常场景。
- 降级模式移除手动保存按钮，完全继承自动保存链路，避免用户误以为需手动提交。
- AI 可应用片段新增外层 ` ```markdown ` 自动解包，防止整篇内容被当作代码块渲染。
- 删除未引用的 `NoteEditorLite` 组件，避免“快速/高级”双模式认知残留。

## 2026-02-23 Notes 第三轮：切换一致性 + 交互闭环 + Agent 记忆

### 根因补充
- 切换笔记时 `useNote` 在新请求返回前保留旧 `note`，导致用户可见旧内容并可继续编辑，形成“串笔记”错觉与误写风险。
- 侧栏缺少删除与拖拽归档动作，造成核心笔记管理流断裂。
- `NoteAIPanel` 对话仅内存态，面板收起/刷新后丢失；FloatingAgent 与笔记助手缺少共享上下文桥。

### 已落地
- `useNote` 切换时立即 `setNote(null)`，并在 `NotesPage` 增加 `noteReady` 守卫，未加载完成前显示占位，阻断串写。
- 侧栏新增笔记删除入口（含当前笔记删除后的回退策略）。
- 侧栏新增拖拽到文件夹并持久化 `folder`。
- `NoteAIPanel` 新增按 `noteId` 的本地历史持久化与“历史”可视入口。
- 新增 `agentMemoryBridge`：笔记助手完成后写入摘要，FloatingAgent 在 `/notes` 自动注入最近笔记记忆到 `context`。
- 侧栏列表与文件夹项增加 motion layout 过渡，交互体感更连贯。

### 验证结果
- `npm run -s build` 通过，`NoteAIPanel` 与 `NotesPage` 编译成功。
- 侧栏消息长文本不再把主页面挤出；分析区默认折叠从流式起始阶段即生效。

## Requirements
- 先整体盘点当前通过 Claude Code/Agent SDK 中枢实现的功能。
- 关注 Claude Code SDK 近期 Git 更新，提炼“新增能力”。
- 将新增能力映射到 PathMind 网页端，给出可完整利用方案。

## Research Findings
- 系统为三层：React 前端 → Go 网关（8080）→ Python Agent 服务（9090）。
- `server-py` 已使用 `claude_agent_sdk`，并有 builtin/custom tool registry。
- 先前会话已修复 homepage 导航工具：
  - `navigate_page.to` 增加 enum，避免模型输出截断路由。
  - prompt 路由从 `/career` 更正为 `/careers`。
- 项目根目录存在 `claude-agent-sdk-python/`，可用于本地对照 SDK 能力。

### 现状能力盘点（代码审计）
- Agent 中枢：`server-py/app/agents/registry.py` 定义 8 个 agent，`server-py/app/api/agent_routes.py` 提供 query/stream/agents。
- 引擎层：`server-py/app/engines/claude_engine.py` 使用 `ClaudeAgentOptions` + `query()`，支持 `resume` 会话续接与 `include_partial_messages`。
- 工具中枢：`server-py/app/tools/registry.py` + `server-py/app/tools/server.py` 通过 `create_sdk_mcp_server()` 暴露工具。
- 技能中枢：`server-py/app/tools/skill_engine.py` + `/tools/skills/execute` 支持 YAML workflow（tool/agent 混编）。
- 前端中枢：`src/hooks/useAgentStream.ts` 能消费 SSE 结构化事件（meta/text/ui_command/navigate/toast/scroll_to/set_theme/tool_call/done）。
- 前端已接入点：
  - 全局浮动助手 `src/components/FloatingAgent.tsx`
  - AI 顾问页 `src/pages/AIAdvisor.tsx`
  - 笔记助手 `src/components/notes/NoteAIPanel.tsx`
  - 多页面一键洞察 `src/components/ui/AIInsightButton.tsx`（career/learning/mbti/code-review）

### 当前可改进点（审计发现）
- Agent 工具声明与实际加载不完全一致：agent 引用了 `semantic_search_notes` / `search_similar_code` / `index_student_code`，但 builtin manifest 未提供这些工具（会被静默跳过）。
- `get_class_overview` / `check_ai_credits` 已注册在 manifest，但当前没有 agent 实际引用，处于“可用但未利用”状态。
- Go 端 `GET /api/agent/sessions` 仍是占位返回空数组（`server-go/internal/handler/agent_handler.go`）。
- 前端 `skills/tools` 面板是静态常量，未调用 `/agent/tools`、`/agent/skills` 做动态发现。
- Python Tools 访问 Go API 多数未携带用户 JWT（按代码推断可能遇到受保护路由 401，需要联调确认）。
- `tool_handler` 读取 `user_role`，但鉴权中间件写入的是 `role`，存在上下文 key 不一致风险。

### Claude Agent SDK 最新更新（已核对）
- 本地与远端主分支一致：`claude-agent-sdk-python` 当前 `HEAD` = `origin/main` = `v0.1.39`（2026-02-18 tag）。
- 0.1.39 / 0.1.38 / 0.1.37：核心是 bundled CLI 升级（2.1.49 / 2.1.47 / 2.1.44）。
- 0.1.36：新增 `thinking` 配置与 `effort` 选项（深度思考控制）。
- 0.1.31：新增 MCP `annotations`（readOnly/destructive/idempotent/openWorld hints）；并修复大 agent 定义 ARG_MAX 问题。

### 可直接映射到网页产品的 SDK 新能力
- `thinking` + `effort`：可用于“快速模式/深度模式”切换，并在 UI 展示“响应深度”。
- `output_format`：可做结构化 JSON 输出（卡片化推荐、步骤化学习计划、可视化图谱节点）。
- `hooks`（含 Notification/PermissionRequest/SubagentStart 等）：可映射为前端实时系统事件流（权限提示、子任务进度）。
- MCP tool `annotations`：可在前端工具面板做风险标识（只读/破坏性/幂等）。
- `get_mcp_status()` + `get_server_info()`：可做“Agent 连接状态页 + 能力探测面板”。
- `enable_file_checkpointing` + `rewind_files()`：可用于代码实验/文档编辑场景的“回滚到上次 AI 操作前”。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 先审本地代码再查外部更新 | 能精确识别“哪些新特性已经有/还缺” |
| 外部信息优先官方来源 | 减少误解“刚更新”内容的风险 |
| 更新信息以 Git tag + CHANGELOG 双重确认 | 避免仅靠 README 导致版本时序误判 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 初次执行 session-catchup 命令语法错误 | 改为显式变量方式执行，已恢复正常 |

## Resources
- `CLAUDE.md`
- `server-py/app/main.py`
- `server-py/app/agents/registry.py`
- `server-py/app/tools/`
- https://github.com/anthropics/claude-agent-sdk-python
- https://github.com/anthropics/claude-agent-sdk-python/releases/tag/v0.1.39
- https://github.com/anthropics/claude-agent-sdk-python/releases/tag/v0.1.36
- https://github.com/anthropics/claude-agent-sdk-python/blob/main/CHANGELOG.md
- https://platform.claude.com/docs/en/agent-sdk/migration
- https://platform.claude.com/docs/en/agent-sdk/python-sdk

### 本轮实施策略（P0/P1/P2）
- P0 先修一致性与稳定性：工具注册缺口、角色上下文 key、双引擎统一路由基础。
- P1 再做体验入口：前端可选择 fast/balanced/deep，映射 OpenAI 快速模型与 Claude 深度模型。
- P2 做可视化与结构化：output_format、hooks 事件流、会话管理增强。

### 本轮已实施（P0 完成，P1 持续推进）
- 补齐 builtin 工具注册缺口：
  - `semantic_search_notes` 已加入 `server-py/app/tools/builtin/note/tools.py`
  - `search_similar_code` / `index_student_code` 已加入 `server-py/app/tools/builtin/experiment/tools.py`
  - 对应 manifest 已更新：`server-py/app/tools/builtin/note/manifest.yaml`、`server-py/app/tools/builtin/experiment/manifest.yaml`
- 修复 Go 端角色上下文 key：`server-go/internal/handler/tool_handler.go` 中 `user_role` → `role`。
- 增加双引擎运行时路由基础：
  - `server-py/app/services/__init__.py` 支持 `context._runtime`（mode/engine/model_tier/engine_model）
  - 新增 stream `meta` 事件（agent/engine/model/mode）
  - query 响应新增 `engine_used` / `model_used` / `mode_used`
- Claude 预算控制接入：`server-py/app/engines/claude_engine.py` 增加 `max_budget_usd=settings.agent_max_budget_usd`。
- 前端 runtime 透传能力：
  - `src/services/api.ts` 新增 `AgentRuntimeOptions` 与 `_runtime` 构建
  - `src/hooks/useAgentStream.ts` 新增 `runtime` 参数透传
  - `src/components/ui/AIInsightButton.tsx` 默认 `runtime: { mode: 'fast' }`，验证快速模型链路
- P1 前端交互增强落地：
  - `src/hooks/useAgentStream.ts` 新增 `meta` 事件回调（onMeta）
  - `src/components/FloatingAgent.tsx` 增加 fast/balanced/deep 模式切换 + engine/model/mode 徽标
  - `src/components/homepage/HomeAIChat.tsx` 增加模式切换 + 路由徽标
  - `src/pages/AIAdvisor.tsx` 增加模式切换 + 路由徽标
- P1 工具 annotations 风险标识落地：
  - `server-py/app/api/tool_routes.py` 的 `/tools/list` 新增 `tool_details`（name/description/annotations/risk_level）
  - 多个 builtin 工具补充 `ToolAnnotations`（readOnly/destructive/idempotent）
  - `src/components/FloatingAgent.tsx` 与 `src/components/homepage/HomeAIChat.tsx` 根据 annotations 显示风险徽标（只读/高风险/幂等/外部/未标注）

### 验证结果
- Agent 工具声明一致性脚本检查：8 个 agent 的 tools 全部可在 manifest 中找到（missing_total=0）。
- Python 语法检查通过（`py_compile`）。
- Go 编译检查通过（`go test ./...`，无测试文件但可编译）。
- 前端构建通过（`npm run build`）。

## P2 本轮新增实现（output_format + 卡片化 UI）

### 后端编排层
- `server-py/app/services/__init__.py` 新增 `output_format` 解析：
  - 支持 `_runtime.output_format` 传字符串预设（`advisor_card_v1`）
  - 支持直接传 `{"type":"json_schema","schema":...}` 自定义 schema
- 新增预设映射 `_OUTPUT_FORMAT_PRESETS`，首个预设为 `advisor_card_v1`。
- query/stream 均向底层 engine 透传 `output_format`。
- stream `meta` 事件新增 `output_format` 字段（当启用结构化输出时）。
- query 结果新增 `output_format_used` 回传。

### 引擎层
- `ClaudeEngine` 已在上轮具备 `output_format` + `structured_output` 能力，本轮与服务层完成贯通。
- `server-py/app/engines/openai_engine.py` 本轮补齐兼容：
  - 对齐 `BaseEngine` 签名，支持 `output_format` 参数。
  - 对 OpenAI-compatible 模型采用“prompt 约束 + JSON 解析”的降级策略。
  - query 返回新增 `structured_output` 字段（可解析时）。
  - stream 新增 `structured_output` 事件（可解析时）。
  - 升级到 Claude 的链路会继续透传 `output_format`，保持双链路一致行为。

### API/网关与前端
- `server-py/app/api/agent_routes.py`：
  - 请求文档补充 `_runtime.output_format` 说明。
  - 响应模型补充 `structured_output`、`output_format_used`。
- `server-go/internal/service/agent_proxy_service.go`：
  - `AgentQueryResponse` 增加 `structured_output`、`engine/model/mode`、`output_format_used` 字段透传。
- `src/services/api.ts`：
  - `AgentRuntimeOptions` 增加 `outputFormat`。
  - `_runtime.output_format` 透传映射。
  - query 返回类型补充 `structured_output`、`output_format_used`。
- `src/hooks/useAgentStream.ts`：
  - 新增 `onStructuredOutput` 回调。
  - `meta` 事件增加 `outputFormat` 字段消费。
- `src/pages/AIAdvisor.tsx`：
  - 发送请求时默认携带 `runtime.outputFormat = 'advisor_card_v1'`。
  - 消费 `structured_output` 事件并渲染卡片（title/summary/analysis/next_steps/risk_level）。
  - UI 顶部展示 schema 标识，保留 Markdown 文本流作为兜底输出。

### 验证
- Python 语法检查通过（services/engines/api）。
- Go 编译通过（`go test ./...`）。
- 前端构建通过（`npm run build`）。

## P2 本轮新增实现（会话管理增强）

### 会话数据底座（Python + Redis）
- `server-py/app/services/shared_memory.py` 新增会话索引存储：
  - `pathmind:sessions:{student_id}`（ZSET，按更新时间排序）
  - `pathmind:session:{student_id}:{session_id}`（会话元数据）
- 新增能力函数：`upsert_session`、`list_sessions`、`clear_sessions`。
- `AgentService.stream` 在 `done` 事件后自动写入会话索引，并记录：agent/engine/model/mode、summary、token、cost。
- OpenAI 链路补齐 `done.session_id`（合成 ID：`openai:{agent}:{student}`），与 Claude 链路行为统一。

### 会话 API（Python / Go）
- Python: `server-py/app/api/agent_routes.py`
  - 新增 `GET /agent/sessions`（支持 `student_id`、`limit`）
  - 新增 `DELETE /agent/sessions`（支持单条或全部清理）
- Go 代理: `server-go/internal/service/agent_proxy_service.go`
  - 新增 `ListSessions` / `ClearSessions` 调用
  - 新增 `AgentSessionInfo` / `ClearSessionsResponse` 结构
- Go Handler: `server-go/internal/handler/agent_handler.go`
  - `ListSessions` 从占位实现改为真实代理调用
  - 新增 `ClearSessions`
- Go Router: `server-go/cmd/server/main.go`
  - 新增 `DELETE /api/agent/sessions`

### 前端会话恢复与清理
- `src/services/api.ts`
  - 新增 `AgentSessionItem` 类型
  - 新增 `agentApi.listSessions()` / `agentApi.clearSessions()`
- `src/hooks/useAgentStream.ts`
  - 新增 `resume` 控制（可显式禁用自动续接）
  - 新增 `onDone` 回调，暴露 session/token/cost
- `src/contexts/AgentSessionContext.tsx`
  - 新增本地持久化（localStorage）
  - 新增 `removeSession` / `listSessions`
- `src/pages/AIAdvisor.tsx`
  - 新增会话历史面板（列表、恢复、单条清理、全部清理）
  - 支持“恢复模式”对话与“退出恢复”
  - 与结构化卡片能力并行工作

### 验证
- Python 语法检查通过（`py_compile`）。
- Go 编译通过（`go test ./...`）。
- 前端构建通过（`npm run build`）。

## P2 本轮新增实现（Hooks 事件流可视化）

### Claude SDK hooks 事件接入
- `server-py/app/engines/claude_engine.py` 在 streaming 模式启用 hooks 回调：
  - `PermissionRequest`
  - `SubagentStart`
  - `SubagentStop`
  - `Notification`
- hooks 回调转为统一 SSE 事件 `type: "hook_event"`，并按 category 分流：
  - `permission`（工具权限请求）
  - `subtask`（子任务 start/stop）
  - `notification`（通知）

### 前端事件解析与可视化
- `src/hooks/useAgentStream.ts` 新增 hook 事件类型与回调：
  - `onHookEvent`
  - `onPermissionRequest`
  - `onSubtask`
  - `onNotification`
- `src/pages/AIAdvisor.tsx` 新增「Hooks 事件流」面板：
  - 展示权限请求、子任务启动/结束、通知事件时间线
  - 支持清空事件列表
  - 与结构化卡片、会话恢复功能并行工作

### 结果
- P2 三项能力均已落地：
  1) output_format 卡片化输出
  2) 会话管理（列表/恢复/清理）
  3) Hooks 事件流可视化（权限/子任务/通知）

## Phase Delivery 总结（2026-02-20）

### 每阶段变更清单
- **P0 稳定性与一致性**
  - 修复 agent 声明与工具 manifest 缺口（`semantic_search_notes`、`search_similar_code`、`index_student_code`）。
  - 修复 Go 侧上下文 key 不一致（`user_role` → `role`）。
  - 在 AgentService 建立统一 runtime 路由基础（支持 Claude/OpenAI-compatible 双链路编排）。
- **P1 体验增强**
  - 前后端贯通 `fast/balanced/deep` 运行模式，UI 可显式切换。
  - stream 新增 `meta` 运行态可观测（engine/model/mode）。
  - `/tools/list` 输出 `tool_details`（annotations + risk_level），前端工具面板展示风险徽标。
- **P2 高阶能力**
  - 上线 `output_format`（preset + custom schema）并在 AIAdvisor 落地卡片化结构化输出。
  - 上线会话管理（列表/恢复/清理），并接入 Python/Go/API/前端全链路。
  - 上线 Claude hooks 事件流可视化（权限请求、子任务、通知时间线）。

### 后续实施建议（P3+）
- 补齐 OpenAI-compatible 链路 hooks 等效事件，降低与 Claude 链路的观测能力差异。
- 将 OpenAI 会话 ID 从“合成粒度（agent+student）”升级为“真实多会话粒度”。
- 会话索引从 Redis TTL 扩展到长期历史存储（可选 MySQL/PG + 归档策略）。
- 将 `output_format` 从 AIAdvisor 扩展到 `career/learning/mbti/code-review` 四类 Insight 场景。
- 增加链路级 SLA 指标面板（耗时、成本、token、失败率），支撑模式路由策略优化。

### 风险与缓解
- **风险：双链路能力不对齐（hooks 主要在 Claude）**
  - 缓解：为 OpenAI-compatible 链路定义统一事件协议，并在服务层做标准化适配。
- **风险：OpenAI 会话恢复粒度较粗**
  - 缓解：引入 per-turn/per-thread session key，UI 按 agent+thread 展示。
- **风险：Redis 7 天 TTL 导致历史不可追溯**
  - 缓解：将会话摘要异步落长期库，Redis 仅作热数据缓存。
- **风险：结构化输出 schema 漂移**
  - 缓解：在前端加 schema 版本校验与 fallback 渲染，并在后端保留 Markdown 兜底。

## P3 本轮新增实现（WebAgent 标准化内核启动）

### 目标
- 将当前 Claude/OpenAI 双链路能力抽象为可 SDK 化的统一协议层，为后续“新一代 WebAgent 范式”打基础。

### 已落地能力
- 新增标准协议模块 `server-py/app/services/webagent_protocol.py`：
  - 协议版本：`webagent.v1`
  - 统一计划结构：`WebAgentPlan` / `WebAgentPlanStep`
  - 统一编排配置：`OrchestratorConfig`
  - 统一 schema 输出：`build_plan_output_format()`
  - 统一模式决策：`pick_execution_mode()`
- `AgentService` 接入编排器（planner → executor）：
  - 支持 `_runtime.orchestrator` 开关
  - 规划阶段（planner）使用快速链路生成结构化计划
  - 执行阶段（executor）根据计划复杂度自动选 `fast/balanced/deep`
  - planner 侧禁用业务工具（`tools=[]`）以避免副作用
- 标准化可观测输出：
  - query 响应新增 `orchestrator` 元数据
  - stream 新增 SSE 事件 `type: "orchestrator"`
  - `meta` 事件增加 `orchestrator_profile`
- API/网关/前端标准接口同步：
  - Python API 响应模型支持 `orchestrator`
  - Go 代理结构透传 `orchestrator`
  - 前端 runtime 支持 `runtime.orchestrator`
  - 前端 stream hook 支持 `onOrchestrator` 回调
  - AIAdvisor 默认启用编排器并展示“任务编排”时间线

### 当前边界（仍需推进）
- 目前是“单 planner + 单 executor”编排，不是完整 DAG/多 worker 调度器。
- OpenAI 链路仍未具备 Claude hooks 同等级别事件粒度。
- 仍缺少“网页爬虫/外部搜索/笔记导出 PDF”等端到端工具链原子能力。

### P3 下一步建议
- 抽出 `webagent_core`（协议 + 编排器 + 事件协议）作为独立 package（内部 SDK 形态）。
- 定义 worker contracts（reason/gather/act/synthesize）并引入多 worker 编排。
- 增加 artifact 协议（如 `note_markdown`, `report_json`, `pdf_url`）做真正产物化闭环。

## P3-2 本轮新增实现（多 Worker DAG 编排）

### 核心升级
- 将编排协议从“线性 steps”升级为“DAG nodes + depends_on”。
- 支持按拓扑层执行（layer），层内并发 worker 执行，受 `max_workers` 控制。
- worker 采用 `reason/gather/act/synthesize` 四类角色，并可按节点 mode 路由到快慢模型链路。

### 后端实现要点
- `server-py/app/services/webagent_protocol.py`
  - 新增 `WebAgentPlanNode`（含 `depends_on`）
  - 新增 `build_dag_layers()` 拓扑分层算法（含循环图降级顺序执行）
  - `OrchestratorConfig` 新增 `max_workers`
- `server-py/app/services/__init__.py`
  - 新增 `_plan_orchestration()`（planner 只负责出 DAG 计划）
  - 新增 `_execute_orchestration_dag()`（按 layer 并发执行 worker）
  - 新增 `_run_worker_node()`（单 worker 执行与产物封装）
  - 新增 `_build_worker_prompt()`（将依赖节点产物注入下游节点）
  - query 路径支持完整 DAG 执行后汇总；stream 路径支持 DAG 事件透出后再流式汇总

### 事件与接口
- SSE `orchestrator` 事件新增阶段语义：
  - `planned`
  - `layer_start` / `layer_done`
  - `worker_start` / `worker_done`
- query `orchestrator` 元数据新增：
  - `max_workers`
  - `worker_count`
  - `workers[]`（压缩执行摘要）

### 前端同步
- runtime 新增 `orchestrator.maxWorkers` 参数透传。
- stream hook 的 `OrchestratorEvent` 补充 worker/layer 字段。
- AIAdvisor 时间线支持展示 DAG 编排、并行层与 worker 执行进度。

### 当前限制
- 目前是“单 planner + 多 worker + 单 final synthesizer”，尚未拆成独立 `webagent_core` package。
- worker 并发在服务进程内调度，尚未接入分布式任务执行（如 queue/worker pool）。
- DAG 计划由单次 planner 生成，尚未引入执行中“自适应重规划”。

## 2026-02-20 报告综合研判（4/4 Expert Reports）

### 综合结论（跨报告一致）
- 当前 WebAgent 能力已进入“可编排可并发”阶段：`planner + DAG executor + multi-worker + 双引擎路由` 已成型。
- 主要短板不在“有没有编排”，而在“编排是否可控可扩展”：
  1) `node.tools` 未真正生效（worker 工具边界弱）
  2) worker 失败仅标记 error，缺少重试与自我修正
  3) 外部 MCP 协议（stdio/SSE）尚未落地
  4) 前端 Agent 接入覆盖率不足（8 个仅 2 个高频）
- SDK 化可行性高（4/5 星）：核心协议、编排、事件流、双引擎抽象已具备基础。

### 与当前实现对照
- 已完成：`webagent.v1` 协议、DAG 分层并发、worker 级事件流、runtime 模式路由。
- 已完成（P3-3 本轮）：`node.tools` 强约束执行、worker retry/timeout/budget guard、Agent Catalog & Capabilities API。
- 已完成（P3-3B）：`webagent_core` 包边界（`protocol/runtime/contracts/orchestrator`）与兼容迁移。
- 未完成：外部 MCP client。

### 优先级重排建议（执行顺序）
1. **P3-3A（高优先）**: `node.tools` 白名单执行 + worker retry/backoff + timeout/budget guard
2. **P3-3B（高优先）**: `webagent_core` 抽象（不含业务工具实现）
3. **P3-3C（高优先）**: Agent Catalog & Capabilities API + 前端 Agent Hub
4. **P3-4（中高优先）**: 外部 MCP stdio/SSE 接入 + unified registry

### 性能侧约束（落地时必须同步）
- Python 多 worker（短期 4 workers）
- embedding 缓存（Redis）
- Go/Python 连接池参数上收
- 先加监控指标（P99、错误率、缓存命中率）再放量

### 文档质量观察
- `docs/webagent-evolution-reports/webagent-evolution-roadmap.md` 当前文件尾部疑似截断（最后停在 `args: ["/tmp/pathm`）。
- 建议后续补全该报告的 Phase 2/3/4 细节段，避免 roadmap 丢阶段信息。

## P3-3 本轮新增实现（可靠性 + 能力发现 API）

### P3-3A: 编排可靠性与工具边界
- `server-py/app/services/webagent_core/protocol.py`
  - `OrchestratorConfig` 新增：
    - `worker_timeout_s`
    - `worker_max_retries`
    - `worker_retry_backoff_ms`
    - `max_budget_usd`
  - `parse_orchestrator_config()` 增加安全解析与范围钳制（避免非法 runtime 值导致异常）。
- `server-py/app/services/__init__.py`
  - **worker 工具白名单生效**：`node.tools` 会映射为 worker 的可用工具子集（默认沿用 agent 全量工具）。
  - **重试机制**：worker 失败后按指数退避重试，并新增 `worker_retry` 事件。
  - **超时治理**：单 worker 调用受 `worker_timeout_s` 限制。
  - **预算守卫**：编排层累计 `cost_usd` 超预算时停止后续层，并发出 `budget_exhausted` 事件。
  - `query/stream` 的 `orchestrator` 元数据新增 `worker_cost_usd`。

### P3-3C: Agent Catalog / Capabilities API
- `server-py/app/api/agent_routes.py`
  - 新增 `GET /agent/list`（标准 Agent 目录）。
  - 新增 `GET /agent/{agent_name}/capabilities`（单 Agent 能力详情）。
  - 保留 `GET /agent/agents` 作为兼容别名。
- `server-go`
  - 新增 Go 代理能力透传：`GetAgentCapabilities()`。
  - 路由新增 `/api/agent/list` 与 `/api/agent/:name/capabilities`。
- `src/services/api.ts`
  - 新增 `agentApi.capabilities()`。
  - `agentApi.list()` 切到 `/agent/list`。

### 前端事件可视化对齐
- `src/hooks/useAgentStream.ts`
  - 扩展 orchestrator 事件字段：timeout/retry/budget/cost/tools。
- `src/pages/AIAdvisor.tsx`
  - 时间线新增 `worker_retry`、`budget_exhausted` 展示。
  - 在 `planned/worker_start/worker_done/layer_done` 中补充 retry、budget、tools 信息。

### 协议文档同步
- `docs/webagent-protocol-v1.md`
  - Runtime Contract 新增 retry/timeout/budget 参数。
  - Streaming stage 新增 `worker_retry` 与 `budget_exhausted`。
  - Current Scope 新增“工具白名单 + 预算守卫 + 重试治理”说明。


## P3-3B 本轮新增实现（webagent_core 包抽象）

### 包结构
- 新增 `server-py/app/services/webagent_core/__init__.py`（稳定导出入口）
- 新增 `server-py/app/services/webagent_core/protocol.py`（协议与 DAG 逻辑）
- 新增 `server-py/app/services/webagent_core/runtime.py`（runtime 解析导出）
- 新增 `server-py/app/services/webagent_core/contracts.py`（核心类型契约）
- 新增 `server-py/app/services/webagent_core/orchestrator.py`（worker trace/tool whitelist 辅助函数）

### 兼容迁移策略
- `server-py/app/services/webagent_protocol.py` 改为兼容 shim，继续对外暴露历史导入路径。
- `AgentService` 主体导入切换到 `app.services.webagent_core`，并将 worker helper 委托到 core 包实现。

### 导出边界（当前稳定）
- `parse_orchestrator_config`
- `build_plan_output_format`
- `parse_webagent_plan`
- `build_dag_layers`
- `compact_plan_for_prompt`
- `summarize_plan_steps`
- `calc_worker_trace_cost`
- `compact_worker_trace`
- `resolve_worker_tools`

## Update: 2026-02-20 (P3-4 启动：External MCP + Unified Registry)

### Actions Taken
- 新增外部 MCP 管理层：`app/tools/external/manager.py`
  - 支持 `mcp_servers.yaml` 加载（stdio / sse / http）
  - 支持 `${ENV_VAR}` 占位符展开
  - 输出统一 registry package（external source）与 Claude `mcp_servers` 配置
  - 提供外部 MCP 健康诊断（命令存在性 / URL 配置完整性）
- ToolRegistry 升级为 Unified 视图：builtin + custom + external
  - 新增工具到 MCP 全名映射（`mcp__<server>__<tool>`）
  - 新增 MCP 全名反向解析（用于权限回调）
  - 新增 registry 健康聚合输出
- Claude 引擎接入统一映射：
  - `allowed_tools` 不再固定 `pathmind` 前缀，改为由 registry 映射生成
  - `mcp_servers` 改为合并 internal + external（`get_claude_mcp_servers()`）
- Tool API 增强：
  - `/tools/list` 增加 `mcp_name` / `mcp_server` / `engine_support` / `external`
  - 新增 `/tools/health` 用于 external MCP 状态巡检
- 启动流程增加 registry warm-up，避免首次请求冷启动抖动。
- 增加示例配置：`server-py/mcp_servers.yaml.example`。

### Files Modified
- `server-py/app/tools/external/__init__.py`
- `server-py/app/tools/external/manager.py`
- `server-py/app/tools/registry.py`
- `server-py/app/tools/permissions.py`
- `server-py/app/tools/server.py`
- `server-py/app/engines/claude_engine.py`
- `server-py/app/api/tool_routes.py`
- `server-py/app/config.py`
- `server-py/app/main.py`
- `server-py/mcp_servers.yaml.example`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查（external MCP + registry） | 无语法错误 | 通过（`py_compile`） | ✅ |
| Go 编译检查 | 不受回归影响 | 通过（`go test ./...`） | ✅ |
| 前端构建检查 | 不受回归影响 | 通过（`npm run build`） | ✅ |

### Notes
- 当前 external MCP 已完成 **标准化接入与 Claude 可执行路径**。
- OpenAI 引擎对 external MCP 仍为渐进式方案：当前以元数据可见 + Claude 优先执行为主，后续补齐 OpenAI 直连执行器。

## Update: 2026-02-20 (P3-4.2 OpenAI External Adapter + Agent Hub)

### Actions Taken
- 新增 OpenAI 外部 MCP 适配器：`app/tools/external/openai_adapter.py`
  - 通过 MCP stdio framing（`Content-Length`）执行 `initialize` + `tools/call`
  - 支持 external tool 本地名到 `mcp__server__tool` 映射解析
  - 首版支持 `stdio` 直连；`sse/http` 在 OpenAI 链路暂保持提示性回退
- OpenAIEngine 工具执行链路升级：
  - 新增 `_execute_tool_call()`，优先识别 external tool 并走 adapter
  - 内部 tool 继续沿用本地 handler，保持兼容
- 前端 Agent Hub 落地（AIAdvisor）：
  - 通过 `agentApi.list()` 动态加载 agent catalog
  - 增加显式 Agent 选择（自动路由/手动指定）
  - 选中 agent 时动态查询 capabilities（engine/tool_count）
  - 会话恢复、消息气泡、建议按钮均对齐动态 agent 显示
- API 类型扩展：
  - `AgentCatalogItem` 类型化
  - Tool 元数据增加 `mcp_name/mcp_server/engine_support/external`

### Files Modified
- `server-py/app/tools/external/openai_adapter.py`
- `server-py/app/tools/external/__init__.py`
- `server-py/app/engines/openai_engine.py`
- `server-py/app/config.py`
- `src/services/api.ts`
- `src/pages/AIAdvisor.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查（OpenAI adapter + engine） | 无语法错误 | 通过（`py_compile`） | ✅ |
| Go 编译检查 | 不受回归影响 | 通过（`go test ./...`） | ✅ |
| 前端构建检查（Agent Hub 动态化） | TS + Vite 构建成功 | 通过（`npm run build`） | ✅ |

### Notes
- OpenAI 链路 external MCP 已进入可用阶段（stdio）。
- 下一步重点为 `sse/http` 传输补齐 + 在多页共享 Agent Hub 状态。

## Update: 2026-02-20 (P3-4.3 OpenAI External SSE/HTTP 补齐)

### Actions Taken
- `OpenAIExternalMcpAdapter` 从 `stdio-only` 扩展为三传输：`stdio` / `http` / `sse`。
- `http` 适配实现：
  - `initialize` -> `notifications/initialized` -> `tools/call` 标准 MCP JSON-RPC 流程
  - 兼容 `application/json` 与 `text/event-stream` 响应
  - 自动识别并复用 `Mcp-Session-Id` header
- `sse` 适配实现：
  - 连接 SSE 流并监听 `endpoint` 事件获取 message endpoint
  - 通过 message endpoint 发起 JSON-RPC POST
  - 支持从 SSE message queue 回收 request/response
- `/tools/list` 元数据对齐：`engine_support` 按 external transport 动态计算，不再固定 external=claude-only。

### Files Modified
- `server-py/app/tools/external/openai_adapter.py`
- `server-py/app/api/tool_routes.py`
- `task_plan.md`
- `findings.md`
- `progress.md`
- `docs/webagent-protocol-v1.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查（adapter + routes） | 无语法错误 | 通过（`py_compile`） | ✅ |
| Go 编译检查 | 不受回归影响 | 通过（`go test ./...`） | ✅ |
| 前端构建检查 | 不受回归影响 | 通过（`npm run build`） | ✅ |

### Notes
- P3-4 定义范围内的关键目标已全部完成。
- 下一阶段可聚焦 SDK 打包边界与多页 Agent Hub 一致性（AIAdvisor/FloatingAgent）。

## Update: 2026-02-21 (第二轮评估 v2 交叉校验)

### 输入材料
- `docs/webagent-evolution-reports-v2/architecture-analysis-v2.md`
- `docs/webagent-evolution-reports-v2/performance-analysis-v2.md`
- `docs/webagent-evolution-reports-v2/sdk-integration-v2.md`
- `docs/webagent-evolution-reports-v2/webagent-ecosystem-v2.md`

### 关键结论（按可信度分层）

#### A. 已被当前代码验证（可信）
1. **外部 MCP 全协议能力完成**：`stdio/http/sse` 均可通过统一 registry 暴露。
2. **Claude + OpenAI 双链路均可执行 external MCP**（OpenAI 走 adapter）。
3. **WebAgent 编排核心能力完整**：DAG 分层并发、worker timeout/retry/budget、SSE 编排事件。
4. **Agent Catalog 能力已标准化**：`/agent/list` + `/agent/{name}/capabilities`。

#### B. 报告存在时间差（部分过时）
1. **前端 Agent 接入率偏低**：报告描述的“1/8 或 2/8”已经落后于当前实现。
2. **external MCP 健康监控缺失**：当前已有 `/tools/health` 基础诊断能力。

#### C. 仍然成立且应进入 P4（高优先级）
1. **生产稳定性缺口**：无统一 Rate Limiting、无熔断、监控体系未成型。
2. **性能主瓶颈未处理**：
   - embedding 仍是 512 token 模型路径（文本截断仍在）
   - embedding/RAG 缓存未系统化
   - Python worker 扩展策略未产品化（部署默认仍单 worker）
3. **生态激活缺口**：`external_mcp_enabled` 默认关闭，官方 MCP 示例仍需落地为“开箱即用”。
4. **SDK 产品化缺口**：DataAdapter、多租户隔离、开发者文档与测试覆盖尚未完成。

### 代码证据快照
- `server-py/app/config.py`
  - `external_mcp_enabled: bool = False`
- `server-py/mcp_servers.yaml.example`
  - 已有示例，但默认运行仍需用户手动复制/启用
- `server-go/internal/service/agent_proxy_service.go`
  - `streamClient.Timeout = 0`（长连接策略缺少治理边界）
- `server-py/app/db/postgres.py`
  - Python pg pool `max_size=10`（高并发下可能成为瓶颈）
- `server-py/app/services/note_embedding.py`
  - `MAX_CHUNK_CHARS = 400`（受 512 token 模型约束）

### 建议执行顺序（P4）
1. **P4-1（1 周）**：先做稳定性底座（限流/超时/连接池/熔断）。
2. **P4-2（1-2 周）**：做缓存与并发参数化（embedding/RAG cache + worker 策略）。
3. **P4-3（2-4 周）**：做 SDK 抽象与文档化（DataAdapter/Tenant/Artifact + examples）。
4. **P4-4（并行探索）**：多 Agent 协作与动态 Replan（面向复杂任务智能化）。

## Update: 2026-02-21 (P4-1A 实施发现：网关稳定性)

### Implementation Summary
- 新增 Go 侧限流中间件：`server-go/internal/middleware/rate_limit.go`
  - 采用固定窗口计数器（内存态）
  - 保护范围：
    - `/api/agent/*`（认证后接口）
    - `/api/agent/public/*`（公开接口）
- `AgentServiceConfig` 扩展可调参数：
  - 超时：`REQUEST_TIMEOUT`、`RESPONSE_HEADER_TIMEOUT`、`STREAM_HEADER_TIMEOUT`
  - 连接池：`MAX_IDLE_CONNS`、`MAX_IDLE_CONNS_PER_HOST`、`IDLE_CONN_TIMEOUT`
  - 熔断：`CB_FAILURE_THRESHOLD`、`CB_OPEN_SEC`
  - 限流：`AGENT_RATE_LIMIT_*`、`AGENT_PUBLIC_RATE_LIMIT_*`
- `AgentProxyService` 增加统一保护路径：
  - 所有对 Python Agent 请求通过 `doRequest()`
  - 熔断状态机：closed → open → half-open
  - 连续失败触发 open，冷却后单探针半开恢复
  - 请求取消/超时（context canceled/deadline）不计入熔断失败
- `AgentHandler` 错误码增强：
  - 熔断/上游不可用类错误返回 `503 Service Unavailable`
  - 其他错误保持 500

### Files Modified
- `server-go/internal/config/config.go`
- `server-go/internal/middleware/rate_limit.go` (new)
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `server-go/.env.example`

### Validation
- `cd server-go && go test ./...` ✅

### Notes
- 当前限流为单实例内存窗口，适用于单机/单副本；多副本场景后续建议升级为 Redis 分布式限流。
- 熔断已覆盖 Go→Python 代理调用主路径，先解决“上游抖动拖垮网关”风险。

## Update: 2026-02-21 (P4-1B 实施发现：Python worker 并发标准化)

### Implementation Summary
- `server-py/app/config.py` 新增 Uvicorn 运行参数：
  - `uvicorn_workers`
  - `uvicorn_timeout_keep_alive_s`
  - `uvicorn_timeout_graceful_shutdown_s`
  - `uvicorn_limit_concurrency`
  - `uvicorn_backlog`
  - `uvicorn_log_level`
- `server-py/app/main.py` 启动流程改造：
  - 构建统一 `uvicorn_kwargs`，由 PATHMIND 配置驱动
  - debug 模式下自动强制 `workers=1`，并输出警告日志
  - 非 debug 模式可直接启用多 worker（如 2/4）
- `server-py/Dockerfile` 启动入口切换为 `python -m app.main`，避免 Docker 启动路径绕过配置层。
- `server-py/.env.example` 新增 P4-1B 参数样例，便于部署与压测时快速调优。

### Files Modified
- `server-py/app/config.py`
- `server-py/app/main.py`
- `server-py/Dockerfile`
- `server-py/.env.example`

### Validation
- `python3 -m py_compile server-py/app/main.py server-py/app/config.py` ✅
- `cd server-go && go test ./...` ✅

### Notes
- 当前实现聚焦“参数化 + 启动一致性”，尚未引入 Gunicorn；后续可在生产环境新增 Gunicorn profile。
- 建议初始线上配置：`PATHMIND_UVICORN_WORKERS=2` 起步，压测后再上调至 4。

## Update: 2026-02-21 (P4-1C 实施发现：429/503/latency/circuit 指标)

### Implementation Summary
- 新增指标聚合器：`server-go/internal/observability/agent_metrics.go`
  - 维度：global + `protected/public` scope
  - 指标：`requests_total`, `status_counts`, `rate_limited_429_total`, `upstream_unavailable_503_total`
  - 延迟：按路由记录 `latency_avg_ms/max_ms/total_ms`
  - 熔断：`current_state` + `transition_count` + `updated_at`
- 新增指标中间件：`server-go/internal/middleware/agent_metrics.go`
  - 在 agent/public-agent 路由链路采集请求状态与延迟
- 熔断状态接入指标：
  - `AgentProxyService` 的熔断状态迁移写入 `RecordCircuitState()`
- 新增 metrics 查询接口：
  - `GET /api/agent/metrics`（需登录）

### Files Modified
- `server-go/internal/observability/agent_metrics.go` (new)
- `server-go/internal/middleware/agent_metrics.go` (new)
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
- `cd server-go && go test ./...` ✅
- `python3 -m py_compile server-py/app/main.py server-py/app/config.py` ✅

### Notes
- 当前 metrics 为进程内存聚合；多副本部署建议后续导出 Prometheus/OpenTelemetry。
- 本次已完成“采集 + 查询”，告警规则（如 503/429 阈值告警）可在 P4-2/P4-3 接入。


## Update: 2026-02-21 (P4-2A 实施发现：Embedding/RAG 缓存)

### Implementation Summary
- 新增 `CacheService`：`server-py/app/services/cache_service.py`
  - 统一 Redis key 规范：`cache:embedding:*` / `cache:rag_query:*`
  - 统一序列化：JSON + SHA256 payload key
  - 命中统计：`cache:stats:<scope>:hit|miss`
- Embedding 缓存接入：`server-py/app/rag/embedding.py`
  - `embed_query`：优先读缓存，miss 后写回
  - `embed_texts`：按文本粒度复用 passage cache，miss 批量回源后回填
- RAG 查询缓存接入：`server-py/app/services/rag_service.py`
  - 查询参数 `query/course_id/limit` 命中直接返回
  - miss 执行向量检索并缓存结果
- 健康诊断扩展：`server-py/app/main.py`
  - `/health` 新增 `cache` 字段（enabled/available/hit_ratio/ttl）
- 配置扩展：`server-py/app/config.py` + `server-py/.env.example`
  - `PATHMIND_CACHE_ENABLED`
  - `PATHMIND_EMBEDDING_CACHE_ENABLED`
  - `PATHMIND_RAG_QUERY_CACHE_ENABLED`
  - `PATHMIND_EMBEDDING_CACHE_TTL_SEC`
  - `PATHMIND_RAG_QUERY_CACHE_TTL_SEC`

### Files Modified
- `server-py/app/services/cache_service.py` (new)
- `server-py/app/rag/embedding.py`
- `server-py/app/services/rag_service.py`
- `server-py/app/main.py`
- `server-py/app/config.py`
- `server-py/.env.example`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
- `python3 -m py_compile server-py/app/config.py server-py/app/services/cache_service.py server-py/app/rag/embedding.py server-py/app/services/rag_service.py server-py/app/main.py` ✅
- `cd server-go && go test ./...` ✅

### Notes
- 当前统计为 Redis counter 累加，适合先验证缓存收益；后续可对接 Prometheus。
- 当前优先覆盖文档 RAG 主链路；notes/unified_search 缓存将放入 P4-2B。

## Update: 2026-02-21 (P4-2B 实施发现：Note + Unified Search 缓存)

### Implementation Summary
- 扩展 `CacheService`（`server-py/app/services/cache_service.py`）：
  - 新增缓存域：`note_search`、`unified_search`
  - 新增方法：`get/set_note_search`、`get/set_unified_search`
  - `get_stats()` 新增两类命中率与 TTL 输出
- `NoteEmbeddingService.search_notes` 接入缓存：
  - 先查缓存命中，miss 再做向量查询并回填
- `unified_search` 双实现接入缓存：
  - `server-py/app/tools/builtin/search/tools.py`（variant=`builtin`）
  - `server-py/app/mcp_tools/search_tools.py`（variant=`mcp`）
- 配置扩展：
  - `PATHMIND_NOTE_SEARCH_CACHE_ENABLED`
  - `PATHMIND_UNIFIED_SEARCH_CACHE_ENABLED`
  - `PATHMIND_NOTE_SEARCH_CACHE_TTL_SEC`
  - `PATHMIND_UNIFIED_SEARCH_CACHE_TTL_SEC`

### Files Modified
- `server-py/app/config.py`
- `server-py/app/services/cache_service.py`
- `server-py/app/services/note_embedding.py`
- `server-py/app/tools/builtin/search/tools.py`
- `server-py/app/mcp_tools/search_tools.py`
- `server-py/.env.example`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
- `python3 -m py_compile server-py/app/config.py server-py/app/services/cache_service.py server-py/app/services/note_embedding.py server-py/app/tools/builtin/search/tools.py server-py/app/mcp_tools/search_tools.py server-py/app/services/rag_service.py server-py/app/rag/embedding.py server-py/app/main.py` ✅
- `cd server-go && go test ./...` ✅

### Notes
- 当前 `unified_search` 缓存按 `variant` 隔离，避免 builtin 与 mcp 结果结构冲突。
- P4-2 核心缓存链路已覆盖文档/笔记/统一检索，下一步重点转向压测与容量基线。

## Update: 2026-02-21 (P4-2C 实施发现：压测工具链)

### Implementation Summary
- 新增压测脚本：`server-py/scripts/benchmark_cache_baseline.py`
  - 场景覆盖：`rag_query` / `note_search` / `unified_builtin` / `unified_mcp`
  - 冷热两阶段：`cold_cache`（可选 reset）→ `warm_cache`
  - 指标：`requests/success/errors/avg/p50/p95/p99/max/min/qps/duration`
  - 产出：自动生成 `docs/perf-baselines/p4-2c-cache-baseline-<timestamp>.json|md`
  - 支持 `--dry-run`、`--queries-file`、`--cases`、`--iterations`
- 新增执行手册：`docs/perf-baselines/p4-2c-cache-baseline-runbook.md`
- 新增样本查询：`docs/perf-baselines/queries-sample.txt`

### Validation
- `python3 -m py_compile server-py/scripts/benchmark_cache_baseline.py` ✅
- `python3 server-py/scripts/benchmark_cache_baseline.py --dry-run` ✅
- `python3 -m py_compile server-py/app/config.py server-py/app/services/cache_service.py server-py/app/services/note_embedding.py server-py/app/tools/builtin/search/tools.py server-py/app/mcp_tools/search_tools.py server-py/scripts/benchmark_cache_baseline.py server-py/app/services/rag_service.py server-py/app/rag/embedding.py server-py/app/main.py` ✅
- `cd server-go && go test ./...` ✅

### Notes
- 当前已完成“压测框架与执行标准化”；首版实测基线（含 cold/warm 对比数据）需在联调环境执行。
- 由于脚本为服务层调用，能直接衡量缓存策略效果，且避免前端网络噪声。

## Update: 2026-02-21 (P4-2C 首版实测结果)

### Executed
- `server-py/.venv/bin/python server-py/scripts/benchmark_cache_baseline.py --iterations 1 --queries-file docs/perf-baselines/queries-sample.txt --cases rag_query note_search unified_builtin unified_mcp`

### Generated Reports
- `docs/perf-baselines/p4-2c-cache-baseline-20260221-051712.json`
- `docs/perf-baselines/p4-2c-cache-baseline-20260221-051712.md`

### Notes
- 当前为首版基线（iterations=1）用于链路验证；建议后续在稳定环境使用 `iterations=3~5` 复测，作为正式容量基线。
- 脚本已移除 UTC 弃用写法，改为 `datetime.now(UTC)`。


## Update: 2026-02-21 (P4-3A 实施发现：SDK 边界契约)

### Implementation Summary
- 已将 P4-3 的三大契约落到 `webagent_core`：
  1. `DataAdapter`：统一数据访问接口，默认 `HttpDataAdapter`，支持 DI 注入。
  2. `TenantContext`：统一租户作用域模型，可由工具/宿主在运行时注入。
  3. `Artifact Contract`：统一 worker 产物类型，支持 `text` / `note_markdown` / `report_json` / `pdf_url`。
- 编排链路已消费 artifact 契约：
  - worker 结果新增 `artifact` 标准字段。
  - API/SSE 摘要中新增 `artifact_type` / `artifact_uri`，前端后续可直接按类型渲染。
- 工具层已验证 DataAdapter 可行性：
  - `student`、`homepage`、`note` 三组 builtin 工具完成迁移。
  - `note` 工具已示范 `TenantContext` 绑定（`tenant_id=student:<id>`）。

### SDK 化收益（当前已获得）
- 工具不再直接绑定 `httpx + GO_API`，数据源可替换。
- 多租户作用域从“隐式 header 拼接”演进为“显式上下文契约”。
- worker 产物具备可消费语义，为后续“笔记归档/PDF 导出/多 Agent 汇总”打基础。

### Remaining Gaps
- tenant context 仍未完全透传到 `/agent/query` 与 stream meta（观测面尚不完整）。
- 仍需一份独立的 `webagent_core` 对外 API reference 与发布清单（打包前置条件）。
- 仍需将更多 builtin/custom 工具迁移到 DataAdapter，避免新旧两套路由长期并存。

## Update: 2026-02-21 (P4-3B 实施发现：Tenant Context 透传)

### Implementation Summary
- 已完成租户作用域从请求到执行事件的贯通：
  - 输入：`context._tenant`（兼容 `context.tenant`）
  - 处理：统一标准化为 `TenantContext`
  - 输出：`query` 响应与 stream 事件均携带 `tenant`
- 编排链路已具备“租户可观测”：
  - `planned` / `layer_start` / `worker_start` / `worker_retry` / `worker_done` / `layer_done` / `budget_exhausted`
  - 所有事件携带相同 tenant payload，便于前端和监控系统聚合。

### Impact
- 为后续 SDK 多租户策略（配额、审计、路由）提供统一上下文承载。
- 为 OpenAI/Claude 双链路统一“tenant-aware telemetry”打通底层前提。

### Remaining Gaps
- 前端目前尚未将 `tenant` 做显式 UI 呈现（仅可消费）。
- 仍需统一 Go 代理层结构体，以便文档与跨语言 SDK 完全一致。

## Update: 2026-02-21 (P4-3C/P4-3D 实施发现：SDK 交付闭环)

### 关键收敛
- SDK 交付从“代码可用”推进到“开发者可消费”：
  - 有统一 reference（接口边界）
  - 有 quickstart（最小接入路径）
  - 有示例（adapter 注入 + tenant）
- 前端/后端事件语义已趋于一致：
  - tenant 作用域可从请求直达 SSE 事件
  - worker 产物类型可被前端直接消费

### 仍需补齐
- Go 代理层 query 响应结构尚未显式声明 `tenant` 字段（stream 已天然透传）。
- SDK 打包仍缺 release contract（语义版本、兼容矩阵、弃用策略）。

## Update: 2026-02-21 (P4-3E 实施发现：跨语言响应结构对齐)

### Implementation Summary
- Go 代理层 query 响应已与 Python `AgentQueryResponse` 对齐 `tenant` 字段。
- 前端现在可以通过 Go API 与 Python 直连两条路径获得一致的 tenant payload。

### Impact
- 消除“Python 已有 tenant，Go 转发丢字段”的潜在一致性风险。
- 为后续 SDK 外部接入提供稳定的跨语言 response contract。

### Remaining
- 若后续需要强类型化治理，可将 `tenant` 从 `interface{}` 进一步收敛为显式 struct（v2）。

## Update: 2026-02-21 (P4-4A/B 实施发现：SDK 发布治理)

### Implementation Summary
- 已从“能力开发”进入“发布治理”阶段：
  - 有 release contract（版本/兼容/弃用）
  - 有 packaging checklist（范围/流程/门禁）
  - 有可执行 contract-check（自动化验证 public surface）

### Impact
- 降低后续 SDK 化对外发布时的接口漂移风险。
- 为 CI 接入和版本化发布打下可执行基础（不是仅文档约定）。

### Remaining
- 仍需把 contract-check 纳入 CI 或统一命令入口（P4-4C）。
- 后续若计划独立仓库发布，需要补充 package metadata 与 changelog 自动化。

## Update: 2026-02-21 (P4-4C 实施发现：门禁命令统一)

### 实施结果
- 已将分散的 release gates 收敛为一个统一入口命令。
- 对协作与发布的价值：
  - 降低“漏跑检查项”风险
  - 新成员可通过单命令完成核心校验
  - 后续接 CI 时可直接复用同一脚本

### 下一步建议
- 在 CI 中直接调用 `npm run check:webagent:full`，并将日志归档到 release artifact。

## Update: 2026-02-21 (P4-5 实施发现：Critique/Replan 质量门)

### Core Findings
- Critique Worker 放在 DAG 执行后、最终汇总前，可显著降低“一次规划失败直接进入最终回答”的风险。
- 将 Replan 设计为“有界轮次”（`max_replans`）可避免无限循环，同时保留任务自修复能力。
- 事件协议新增 `critique_done/replan_start/replan_done` 后，前端可完整重建复杂任务执行路径。

### Integration Findings
- 后端返回层需要同时暴露“配置态 + 执行态”字段：
  - 配置态：`critique_enabled` / `critique_mode` / `dynamic_replan_enabled` / `max_replans`
  - 执行态：`replan_count` / `critique` / `replan_round` / `should_replan` / `success`
- 前端如果只消费 `worker_*` 事件，会遗漏“为何重规划”的关键上下文；必须显示 critique 结论。

### Remaining Gaps
- 目前尚未提供跨会话的 critique/replan 统计（仅当前会话可见）。
- 尚未沉淀策略模板（例如高风险任务默认 `deep critique + max_replans=2`）。
- 后续可将 critique 结果写入 artifact，供笔记/PDF 生成链路复用质量审计信息。

## Update: 2026-02-21 (P4-5C/D 实施发现：策略即配置，统计即反馈)

### Core Findings
- 将 orchestrator 策略模板化（Fast/Balanced/Deep）后，用户可以直接控制智能深度与成本，减少“黑盒”感。
- 仅展示时间线不足以支持调参；必须叠加聚合统计（pass rate / avg score / replan）才能形成可迭代闭环。
- `critique_summary` 对定位“为何 replan”价值很高，应长期保留在 UI 反馈中。

### Product Implication
- 当前 UI 已接近“WebAgent 控制台”雏形：
  - 运行前：选策略
  - 运行中：看事件
  - 运行后：看统计
- 下一步应把模板下沉为可配置资产（JSON/DB），让 SDK 与前端共享同一策略源。

### Remaining Gaps
- 统计尚未持久化，缺乏跨会话对比与历史趋势。
- 暂未把策略执行效果（成本/时延/成功率）自动回流用于模板推荐。

## Findings: 2026-02-21 (P5-P0 实施结果)

### Backend (Python)
- 新增 `coding` 内建工具包，覆盖文件/Git/Shell 13 个工具。
- 新增 `coding_sandbox`，实现路径/命令策略控制与输出限制。
- 新增 `approval_broker`，支持 pending 审批、超时默认拒绝。
- Claude 链路：`can_use_tool` 回调接入审批 + 审计。
- OpenAI 链路：tool call 接入审批 + 审计，stream 改为 queue 事件桥接避免审批阻塞。
- AgentService 接入 `coding runtime context` 与 `agent request context`，实现运行时策略和审计元信息透传。

### Backend (Go)
- 新增 `agent_action_audit` 模型与 `006_agent_action_audit.sql` migration。
- 新增 internal ingest handler：`POST /api/internal/agent/audit`。
- Agent 代理新增审批接口：
  - `POST /api/agent/approvals/:id/approve`
  - `POST /api/agent/approvals/:id/reject`

### Frontend
- `agentApi` 扩展 `runtime.coding` 字段与审批 API。
- `useAgentStream` 支持 `approval_request` / `approval_result` 事件。
- AIAdvisor 新增 `Learning / Coding` 模式切换、workspace 输入、待审批面板、批准/拒绝操作。
- 新增 `web-coder` agent 入口用于 coding 场景。

### SDK Boundary (P2 partial)
- `webagent_core.contracts` 增加：
  - `ApprovalProvider`
  - `SandboxPolicy`
  - `AuditSink`

## Findings: 2026-02-21 (P5-P1-2/P1-3 实施结果)

### Core
- 已完成 run 级 `scratchpad`（`ContextVar` 作用域），并在 `AgentService` 每次 query/stream 初始化与回收。
- `scratchpad` 已注入系统提示词（`_build_system_prompt`），支持 Claude/OpenAI 链路共享中间记忆。
- OpenAI 升级到 Claude 时携带 `snapshot_for_prompt`，降低链路切换信息丢失。

### Runtime Policy
- 新增高风险并发闸门：`coding_high_risk_max_concurrency`（默认 `1`），并在高风险 coding 工具执行层生效。
- 新增低风险重试策略：`coding_low_risk_retry_count` + `coding_low_risk_retry_backoff_ms`。
- OpenAI 工具执行链路新增 `tool_retry` 事件，便于前端观察自动重试。

### Approval Observability
- `approval_broker` 新增指标聚合：`total_requests/approved/rejected/timed_out/avg_wait_ms/pending`。
- 新增接口：`GET /agent/approvals/metrics`。

### Remaining
- Claude SDK 原生工具执行的“低风险自动重试”仍主要依赖模型策略；后续可在 MCP server 层补统一重试中间件。
- external MCP 风险映射与降级策略（P2-2）已完成，下一步是 P2-3 文档化收口。


## Findings: 2026-02-21 (P5-P2-2 收尾：External MCP 回退可观测)

### Core Findings
- external MCP 风险分级已形成三层决策：
  1. manifest `tool_overrides.risk`（最高优先）
  2. 注解推断（`destructiveHint/readOnlyHint/openWorldHint`）
  3. 全局默认（`coding_external_*_risk`）
- OpenAI 链路 now supports “内建优先 + 外部兜底 + 外部失败回退内建”策略，可减少外部 MCP 抖动导致的任务中断。
- 回退策略若无可用 fallback，会在错误信息中提示 `escalate_to_claude`，有助于复杂任务链条继续推进。

### UX / Observability Findings
- 仅后端发 `tool_fallback` 事件不足以支持调试；前端必须显示“为什么回退、回退到哪里”。
- 把 `tool_retry` / `tool_fallback` 统一挂到 `onToolCall` 可避免前端接口爆炸，同时兼容现有调用方。
- AIAdvisor 时间线增加工具级事件后，审批事件与执行事件可以串成完整因果链（审批→执行→重试/回退→结果）。

### Remaining
- P2-3 仍需补齐开发者文档（coding quickstart、安全 runbook、API reference）。


## Findings: 2026-02-21 (P5-P2-3 交付发现：文档即契约)

### Core Findings
- Coding 闭环已从“实现可用”升级为“对外可集成”：
  - 有 Quickstart（上手路径）
  - 有 Runbook（运维与故障处理）
  - 有 API Reference（接口契约）
- `approval_request/approval_result/tool_retry/tool_fallback` 四类关键事件形成了 coding 可观测最小集。
- external MCP 风险策略必须与审批策略联动文档化，否则不同链路（Claude/OpenAI）会出现行为认知偏差。

### Delivery Impact
- 前端、网关、Python、审计表之间的 contract 已可被单文档追踪。
- 后续 SDK 打包时，可直接将这三份文档纳入开发者交付清单。

### Next Suggestion
- 下一阶段可把策略模板（risk/approval/fallback）参数化为可版本化 JSON，减少环境漂移。


## Findings: 2026-02-21 (P6-1 实施发现：策略模板是治理中枢)

### Core Findings
- 将 risk/approval/fallback/retry/concurrency 参数统一收敛到模板层后，Claude/OpenAI 双链路行为一致性显著提升。
- `policy_profile` 作为 runtime 参数可按请求切换策略，适合“同一会话不同任务风险等级”场景。
- mtime 热更新避免了“改配置必须重启服务”的运维摩擦，适合灰度调参。

### Architecture Findings
- `coding_policy_profiles.py` 采用“文件配置优先 + settings fallback”模式，可避免配置文件损坏导致服务不可用。
- 增加 `/api/agent/coding/policies` 快照接口后，策略生效状态可观测，排查成本显著降低。

### Product Findings
- 当前已经具备“策略可切换”后端能力，下一步价值点在前端可视化选择与效果指标回流。

### Remaining
- 尚未提供 AIAdvisor 的策略模板显式选择器（仅默认透传 `strict_v1`）。
- 尚未形成策略模板效果评估面板（审批率/超时率/fallback 率趋势）。


## Findings: 2026-02-21 (P6-2 实施发现：策略模板可视化完成)

### Core Findings
- 策略模板能力从“后端可配置”升级为“用户可选择、请求可透传”，`policy_profile` 在真实交互链路中闭环。
- AIAdvisor 不再硬编码 `strict_v1`，Coding 请求会携带当前选择模板，确保策略实验可控可回放。
- 通过展示 `source_version`，可以快速判断当前策略来自 `settings` 还是 JSON 模板，降低排障成本。

### UX / Product Findings
- Coding 模式下将 Workspace、Policy、Source 状态聚合到同一区域，用户能在发起任务前完成风险策略确认。
- 液态玻璃 chip 风格在不破坏原布局的前提下，提高了策略控件可识别性，并与现有视觉语言保持一致。
- 流式执行期间锁定策略选择与刷新动作，可避免“运行中切换策略”造成的结果不可解释。

### Remaining
- 尚未提供策略效果面板（审批率、超时拒绝率、fallback 率的时间序列）。
- 尚未将策略模板 contract（字段语义、版本兼容）沉淀为 SDK 对外规范文档章节。


## Findings: 2026-02-21 (P6-3 实施发现：治理指标可观测闭环)

### Core Findings
- P6-3 首版不需要新增后端接口；复用 `/agent/approvals/metrics` + 前端 run 级事件计数即可形成有效治理视图。
- “全局审批快照 + 当前 run 工具回退统计”组合，能同时回答“系统整体是否稳”和“本轮任务是否异常”。
- 将指标刷新绑定到“事件面板开启态”可减少无效轮询，兼顾可观测性与前端负载。

### UX / Product Findings
- 指标放在事件面板顶部比放在主对话区更合适，和时间线上下文一致，排障路径更短。
- 手动刷新按钮与自动轮询并存，可覆盖“调试时立即确认”与“常规观察”两类场景。

### Remaining
- 仍缺自动化回归阈值（审批通过率、超时率、fallback 率）与告警策略。
- 仍需把策略模板 + 指标语义收敛为 SDK 对外 contract（版本兼容说明）。


## Findings: 2026-02-21 (P6-UX 实施发现：用户可见的 Agent 集群)

### Core Findings
- 仅做后端能力增强用户感知不足；必须提供“跨页面、可操作、可观察”的集群视图，用户才会认为系统真的在执行复杂链路。
- `AgentClusterBoard` 作为共享可视组件后，实验区、笔记区、PDF 工作台形成统一“探针式体验”，能快速验证链路是否工作。
- 真实接入 `useAgentStream` 的 `orchestrator` 事件比静态状态灯更有说服力，适合对外演示“集群正在运行”。

### UX / Product Findings
- 实验/笔记/PDF 三个场景统一液态玻璃语言后，产品观感从“多页面拼接”提升为“同一系统工作台”。
- 在每个场景提供本地化默认 agent（`web-coder`/`note-assistant`/`document-reader`）能降低首次理解成本。

### Remaining
- PDF 工作台仍缺后端上传与解析（当前仅前端暂存，不做服务器持久化）。
- 集群看板仍是页面级探针，尚未与全局任务队列/审计指标完全统一。


## Findings: 2026-02-21 (P6-UX-2 实施发现：PDF 链路已从演示转为可用)

### Core Findings
- `DocumentsPage` 已不再是本地 mock：上传、列表、删除、语义检索都走真实后端接口。
- 文档链路现在对用户可见：上传后可看到 `is_indexed` 状态，并可直接做语义查询。
- 保留 `AgentClusterBoard` 与 `AIInsightButton` 后，用户可以同时看到“文档数据链路”和“Agent 执行链路”。

### Integration Findings
- `documentsApi` 统一收敛了文档侧前端契约：`list/get/query/upload/delete`。
- Go/Python 侧的 `uploaded_by` 过滤让学生默认只查询自己的文档，避免跨用户数据泄露。
- 当前缺口集中在“文档实体文件访问”（下载/预览），而非检索/索引主链路。

### Remaining
- 尚未提供文档下载或在线预览接口，前端仅能展示元数据和 RAG 片段。
- 集群看板仍偏页面探针，需要下一步与全局 telemetry 统一。


## Findings: 2026-02-21 (P6-UX-3 实施发现：实体文件访问闭环完成)

### Core Findings
- 文档主链路已从“索引可用”扩展到“实体文件可访问”：用户可在 PDF 工作台直接预览或下载。
- 预览/下载接口复用了与列表/详情一致的权限规则，学生默认只能访问自己上传的文档。
- 将 `Content-Disposition` 分为 `inline` 与 `attachment` 后，前端无需额外协议即可实现浏览器预览与下载。

### Integration Findings
- 新增 `documentsApi.fetchFile(id, mode)` 统一封装 token 注入、错误处理、文件名解析。
- 前端通过 `Blob + URL.createObjectURL` 处理预览/下载，避免额外公开文件 URL。
- 当前文档工作台对用户已经具备四类核心动作：上传、检索、预览、下载。

### Remaining
- 仍需把文档预览从“新窗口”升级为站内预览面板（可选）。
- 集群看板跨页统一 telemetry 仍是 P6-UX 下一关键缺口。


## Findings: 2026-02-21 (P6-UX-4 实施发现：跨页 Telemetry 统一完成)

### Core Findings
- `AgentClusterBoard` 从“页面内探针”升级为“页面探针 + 全局 telemetry”双通道。
- 接入 `/api/agent/metrics`（网关指标）+ `/api/agent/approvals/metrics`（审批指标）后，跨页面看到的是同一组治理数据。
- 通过 localStorage 缓存最近快照，切页后无需等待首次轮询也能看到统一指标基线。

### Integration Findings
- 新增 `agentApi.metrics()` 后，前端已具备统一读取网关韧性指标的能力（429/503/circuit/latency）。
- `AgentClusterBoard` 指标面板采用固定字段，和 AIAdvisor 治理指标语义一致，降低用户认知成本。
- 探针任务 `done` 事件触发一次立即刷新，可把“本轮执行”影响快速反映到全局指标。

### Remaining
- 还没有按 agent/workspace 维度拆分 telemetry，当前仍是全局聚合视图。
- 还没有时间序列趋势图与阈值告警（仅快照）。


## Findings: 2026-02-21 (P6-UX-5 实施发现：下钻维度与趋势已可见)

### Core Findings
- 仅有全局快照不足以定位瓶颈；加入 `agent/workspace` 维度后，问题定位从“系统级猜测”变成“链路级定位”。
- 15 秒 bucket 的内存趋势能覆盖实时调试场景，尤其适合演示探针执行前后指标变化。
- 在中间件层采集维度（通过 context 注入 `agent_name/workspace_id`）比在 observability 层解析 payload 更稳健。

### Integration Findings
- `RecordAgentRequestWithDimensions` 兼容原入口，老调用路径不受影响。
- Agent handler 在 query/stream/public_stream/capabilities 上统一注入 telemetry 上下文，指标语义保持一致。
- 前端看板“Top Agents / Top Workspaces + Trend”与原指标卡并列，保持液态玻璃风格且不破坏原交互。

### Remaining
- 趋势仍是轻量条形快照，不支持时间窗口切换与缩放。
- 指标仍为进程内内存态，服务重启后历史丢失。


## Findings: 2026-02-21 (P6-UX-6 实施发现：过滤与窗口切换闭环)

### Core Findings
- 增加 `agent/workspace/window_sec` 查询参数后，Telemetry 已具备“单看板按任务维度定位”的实用能力。
- 趋势保留窗口扩展到 1 小时（15s bucket）后，`5m/15m/1h` 切换具备真实数据基础，不再只是前端裁剪。
- `filtered` 聚合与 `trend` 同源，避免“卡片是全局、趋势是过滤”的语义错位。

### Integration Findings
- 过滤逻辑放在后端聚合层，前端只负责参数选择与展示，减少了页面端状态计算复杂度。
- `AgentClusterBoard` 使用同一 API 完成全局视图和过滤视图，接口契约保持统一。
- 缓存策略保留默认全局视图，避免把用户临时过滤状态污染跨页默认指标。

### Remaining
- 趋势仍是简版柱状图，缺少交互式时序分析（缩放、tooltip 详情、对比曲线）。
- 指标仍为进程内内存态，重启会清空历史。


## Findings: 2026-02-21 (P6-UX-7 实施发现：趋势交互可用于排障)

### Core Findings
- 将趋势图从“静态条形”升级为“可交互焦点视图”后，用户可以直接定位具体 bucket 的异常来源（4xx/5xx/429/503/latency）。
- 风险分级（稳定/观察中/高风险）统一后，趋势可读性显著提升，和卡片指标语义保持一致。
- 提供“后半段 vs 前半段”对比后，窗口内性能变化趋势可以被快速量化，不再只能肉眼判断柱高。

### Integration Findings
- 交互增强完全复用现有 `/api/agent/metrics` 数据，不引入新后端接口，改造成本低。
- 焦点详情、风险计数、窗口对比均与 `agent/workspace/window_sec` 过滤后的同源 `trend` 数据绑定，避免视图不一致。
- 通过 click/focus 事件补齐键盘可达性，趋势条不仅是视觉组件，也可作为可操作控件。

### Remaining
- 指标仍是进程内内存态，重启后历史清空，长期趋势对比仍受限。
- 当前对比是“前后半段摘要”，如需更精细分析可继续增加缩放、区间框选、多曲线叠加。


## Findings: 2026-02-21 (P6-UX-8 实施发现：持久化历史已可查询)

### Core Findings
- 将 request 级 telemetry 写入 Postgres 后，指标不再依赖进程内内存，服务重启后仍可保留历史分析能力。
- 持久化写入采用“异步队列 + 批量 flush”，避免把数据库写入延迟叠加到用户请求路径。
- 历史查询接口与实时接口保持统一过滤语义（`agent/workspace/window`），前后端使用成本低。

### Integration Findings
- `GET /api/agent/metrics/history` 提供 bucket 聚合查询，可直接用于趋势可视化和窗口对比。
- 中间件统一在 `protected/public` 两条 agent 路径写入历史，覆盖范围与实时 telemetry 一致。
- 前端看板新增 persisted history 摘要后，用户可区分“实时快照”与“持久化历史”，系统可信度更高。

### Remaining
- 目前为 request 明细写入模式，后续建议增加 TTL/归档和 rollup，控制长期存储成本。
- 历史趋势可视化目前是摘要级，后续可补区间缩放、多曲线对比和告警阈值策略。


## Findings: 2026-02-21 (P6-Graph-P0 实施发现：图谱已具备 Agent 控制能力)

### Core Findings
- 之前图谱页虽然能展示数据，但未形成“Agent 指令 → 图谱执行”的闭环；现已接通。
- `graph-analyst` 路由生效后，图谱相关问题默认进入专用 Agent，而非通用 `quick-qa`。
- `emit_graph_command` 现在可驱动前端可视化行为（聚焦、过滤、路径高亮、适配视图）。

### Integration Findings
- 采用“全局事件桥接”（`pathmind:graph-command`）可复用现有 FloatingAgent，无需新建第二套对话系统。
- `KnowledgeGraph` 执行层实现了命令语义映射，且与当前节点详情面板联动（`open_panel`/`focus_node`）。
- 图谱命令具备降级策略：找不到目标节点时不崩溃，仅忽略该动作。

### Remaining
- 目前闭环是单向（Agent→UI）；尚缺 UI 执行结果反向反馈给 Agent 的 ACK/错误语义。
- 后端图谱接口仍偏只读，尚不能通过 Agent 对图谱实体关系执行写操作。


## Findings: 2026-02-21 (P6-Graph-P1 实施发现：回执链路已接通到前端全局)

### Core Findings
- 图谱命令执行不再“静默”：每条命令都有 `success/ignored/error + message` 回执。
- 对于路径不存在、节点未命中、类型过滤无效等场景，用户可直接看到失败原因。
- 撤销能力已经具备实用价值：过滤、聚焦、展开等常见操作支持一键回退。

### Integration Findings
- 在 `KnowledgeGraph` 内统一产出回执，比在 `GraphPage` 猜测结果更准确（可拿到内部解析过程）。
- 通过 `pathmind:graph-command-result` 事件桥接，`FloatingAgent` 无需重构即可感知图谱执行异常。
- 使用命令唯一 key 防抖（issuedAt + payload）后，避免了状态更新导致的重复执行。

### Remaining
- 回执仍停留在前端事件层，尚未写回 Python 会话上下文，模型侧暂不可直接消费。
- undo 目前为“命令级回退”，还不是图谱状态快照级回滚。


## Findings: 2026-02-21 (P6-Graph-P2 实施发现：回执已进入模型上下文)

### Core Findings
- 图谱回执已经从“纯前端可见”升级为“后端可持有 + 下轮可注入”。
- `graph-analyst` 在下一轮推理时能读取最近图谱命令执行结果，减少“模型以为已执行成功”与 UI 实际不一致的问题。
- ACK 上报采用 best-effort，不阻塞图谱交互主链路，兼顾稳定性与时延。

### Integration Findings
- 使用 Redis student 维度回执池，能跨页面/跨回合复用，不依赖单一页面生命周期。
- Go 代理层新增 `/api/agent/graph/feedback`，保持前端仅对 Go 网关通信，架构一致。
- AgentService 只在 `graph-analyst` 注入图谱回执，避免污染其他 agent 的 system prompt。

### Remaining
- 目前仅注入“最近回执文本摘要”，还没有结构化检索/分页查询接口。
- 尚未支持“按 session 精确回放 + ACK 可视化时间线”。


## Findings: 2026-02-21 (P6-Graph-P3 实施发现：时间线可查询可回放)

### Core Findings
- 图谱 ACK 已从“可注入模型”进一步升级为“可查询时间线”，便于用户和工程侧回放执行轨迹。
- 在 GraphPage 同时展示“实时回执 + 会话时间线”，用户可区分当前动作和历史动作。
- 时间线基于会话维度查询，避免跨会话噪音影响当前排障与判断。

### Integration Findings
- Python/Go/Frontend 三层接口语义一致（agent/session/limit），便于后续 SDK 化抽象。
- 前端采用“手动刷新 + 定时轮询”双模式，既保证实时性也可控请求频率。
- 当前模型上下文注入和时间线查询共享同一 Redis 回执池，数据源一致。

### Remaining
- 尚无 ACK 时间线的高级过滤（按 status/command）与导出能力。
- 尚未实现“批量命令事务”级别的整体成功判定和回滚。


## Findings: 2026-02-21 (P6-Graph-P4 实施发现：时间线可筛选可导出，批次协议可执行)

### Core Findings
- ACK 时间线加上 `status/command` 过滤后，图谱执行排障从“浏览全量日志”升级为“按失败类型/命令快速定位”。
- 回执导出（JSON/CSV）补齐了“复盘与对外协作”能力，便于将用户侧执行历史交给研发或数据分析处理。
- 批次协议（`graph_batch`）已形成最小可用闭环：Agent 可下发多步动作，前端可按事务模式串行执行并给出批次级结果。

### Integration Findings
- Python/Go/Frontend 三层对 `status/command` 参数语义保持一致，后续可直接纳入 SDK contract。
- 批次执行通过 `__batch` 元信息绑定步骤上下文，无需重构 `KnowledgeGraph` 命令执行器即可实现步骤关联。
- `all_or_nothing` 与 `best_effort` 两种模式已可区分：前者失败即中止，后者继续执行并返回 partial 结果。

### Remaining
- 当前“事务”仍是执行控制语义，不含自动补偿回滚（compensation/undo chain）。
- 批次结果目前主要在前端事件层可见，尚未形成后端批次级审计实体。


## Findings: 2026-02-21 (P6-Graph-P5 实施发现：事务失败可自动补偿，批次审计已入后端)

### Core Findings
- `all_or_nothing` 批次在失败时已可自动进入 `rollback` 阶段，按 `undoCommand` 逆序执行补偿步骤。
- 批次结果不再仅有“成功/失败”，新增补偿维度（`rolledBack`、`rollbackFailed`），可判断失败后恢复程度。
- 批次级审计实体已在后端落地（Redis + API），前端可上报/查询，不再依赖命令级日志拼接推断。

### Integration Findings
- 回滚协议通过 `params.__batch.phase=forward|rollback` 与现有命令执行器兼容，无需改动 `KnowledgeGraph` 核心语义。
- Python/Go/Frontend 新增 `/graph/batch-feedback` 对齐，保持和命令级 `/graph/feedback` 同样的调用风格与过滤逻辑。
- 前端在 `finalizeBatch` 时自动上报批次审计，保证“用户可见结果”与“后端审计记录”同源。

### Remaining
- 批次审计当前仍在 Redis（短期保留）；若做长期合规追踪，建议迁移到 Postgres。
- 目前批次审计未提供独立可视化面板，仍需补一页按 `batch_id` 的回放视图。


## Findings: 2026-02-21 (P6-Graph-P6 实施发现：回放可用，审计链路已落 Postgres)

### Core Findings
- 批次回放不需要额外存储步骤表：可直接从命令级 ACK (`params.__batch`) 重建 forward 步骤并复播。
- 回放与真实执行共用 `graph_batch` 协议，复用率高，避免维护双套执行逻辑。
- 批次级审计可先复用统一 `agent_action_audit` 表，而不是立即新增专用表，能更快打通长期留痕。

### Integration Findings
- 前端回放入口放在图谱回执面板内即可满足首版可用，不需要新页面即可验证“可重放”体验。
- Python 批次 ingest 复用 `audit_client` 后，数据自动进入 Go 内部审计入口，链路与 coding 工具审计保持一致。
- `audit_client` 增加上下文覆盖参数后，可在非 engine 流程（如 API ingest）中稳定写入完整审计字段。

### Remaining
- 当前批次时间线查询仍然是 Redis 源；要满足合规检索，下一步应让查询改读 Postgres。
- 回放目前是“批次重放”，还未提供“单步调试/跳步回放/回放前确认”能力。


## Findings: 2026-02-22 (P6-Graph-P7 实施发现：批次查询已切 Postgres 主链路)

### Core Findings
- 批次审计写入与读取已在同一持久化介质（Postgres `agent_action_audit`）闭环，图谱批次时间线不再依赖 Redis 才可查看。
- 迁移期采用“PG 优先 + Redis 回退”比一次性切换更稳健：既保留历史兼容，也避免因短时 PG 查询异常导致前端不可用。
- 复用统一审计表而非新建专表，短期交付速度更快，并与 coding 审计链路保持一致（统一检索口径）。

### Integration Findings
- Go 新增 `GraphBatchTimelineService`，将审计表 JSON 字段（`args/result`）反序列化为前端可消费的批次时间线结构。
- `GET /api/agent/graph/batch-feedback` 现在优先返回 Postgres 数据；若无数据或查询失败，自动降级到原 Python/Redis 接口。
- 响应新增 `source` 字段，前端可直接展示当前数据来源，便于排障与迁移观察。

### Remaining
- 当前仍是 limit 模式，尚未提供 cursor 分页与时间区间筛选。
- 批次详情仍是摘要级，缺少按步骤（forward/rollback）展开的深度回放视图。


## Findings: 2026-02-22 (P6-Graph-P8 实施发现：批次分页与详情已可用)

### Core Findings
- 批次时间线已从“固定条数”升级为“游标分页”：`before_ts + next_before_ts` 可以稳定向后翻页，不再依赖一次拉大 `limit`。
- 批次详情已从摘要升级为 step 级可视化：可直接查看 `forward/rollback` 每步执行轨迹与状态。
- PG 主链路与 Redis 回退链路都支持同一分页参数，迁移期接口语义保持一致，前端无需分支处理。

### Integration Findings
- Python `list_graph_batch_feedback` 已支持 `before_ts` 过滤并返回 `next_before_ts`，用于 fallback 路径连续分页。
- Go `GraphBatchTimelineService` 采用 `limit+1` 判定是否有下一页，并在响应中返回 `next_before_ts` 游标。
- `GraphPage` 批次面板新增：
  - “详情/收起”切换
  - step 级 `forward/rollback` 列表
  - “加载更多批次”按钮（基于游标）

### Remaining
- 详情仍以命令级摘要为主，尚未展示每步 `params/message` 的完整展开视图。
- 还未加入“回放前确认 / 回放前 N 步”控制。


## Findings: 2026-02-22 (P6-Graph-P9 实施发现：调试可读性与操作安全提升)

### Core Findings
- 批次详情加入 step 级 `message + params` 展开后，排障效率明显提升：不再需要在命令时间线和批次时间线之间来回对照。
- 单步复制与批次详情导出解决了“前端看得到、外部无法复盘”的协作断点，研发/测试可直接共享结构化证据。
- 回放前确认属于低成本高收益安全护栏，能显著降低误点击触发大批次回放的风险。

### Integration Findings
- 详情展开与复制能力完全复用现有 ACK 数据，不依赖新增后端接口，落地成本低。
- 批次详情导出使用前端本地 JSON 生成，不阻塞主执行链路，也不增加服务端负载。
- 回放确认在 `GraphPage` 层实现即可生效，不影响 Agent 协议与后端路由契约。

### Remaining
- 当前回放仍是“整批回放”；尚未支持“回放前 N 步/仅 forward/仅 rollback”。
- 详情目前按批次单次查看，尚未提供全文检索与跨批次对比分析。


## Findings: 2026-02-22 (P6-Graph-P10 实施发现：回放策略可控)

### Core Findings
- 回放加入 `phase + step limit` 后，用户可以把“重放整批”改为“最小可验证片段”，显著降低误操作成本。
- `forward/rollback/all` 选择让批次回放从“单一重演”升级为“受控调试工具”，尤其适合排查补偿链问题。
- 回放前确认文案包含“范围 + 命令数”后，用户对即将执行动作有明确预期，安全性更高。

### Integration Findings
- 回放控制完全在前端实现，复用既有 ACK 重建链路，不新增后端接口与协议字段。
- 批次头部控件（phase 选择 + N 步输入）对当前 UI 侵入低，仍保持图谱回执面板的紧凑形态。
- 由于回放输入最终仍是 `graph_batch.steps[]`，与现有执行器兼容，不影响已上线批次协议。

### Remaining
- 当前仅支持“前 N 步”，尚未支持“起止区间回放”。
- 仍缺“按状态过滤回放”（例如仅回放失败步骤）能力。


## Findings: 2026-02-22 (P7 启动评估：能力矩阵基线)

### Core Findings
- 已形成可执行的系统级能力基线文档：`docs/webagent-capability-matrix-v1.md`。
- 现阶段最准确定位是 `L3.5 ~ L4.0`，并非“全域自治 L5”：
  - 强项在编排（DAG）、审批（per-call）、审计（Postgres）、图谱回放（batch/rollback）
  - 短板在跨域事务协议（notes/pdf/graph/rag 一体化）与统一执行入口
- `AIAdvisor` 是当前最深接入点，具备升级为“全站任务中枢”的工程基础。

### Product Findings (User-visible)
- 用户已可感知图谱命令执行、批次回放与导出，但跨板块任务仍偏“多页面分散能力”。
- Notes/Documents/Experiments 的 Agent 能力以建议与观察为主，缺少统一可执行回执闭环。
- 下一步最高 ROI 不是继续堆单点能力，而是把现有能力收敛为“一个任务入口 + 一个回执协议”。

### Architecture Findings (Backend pathways)
- 双引擎与共享 run scratchpad 已能支撑快慢模型协同，但尚未抽象成标准“任务模板路由策略”。
- 图谱域已经接近事务语义（batch + rollback），可作为跨域协议模板的第一来源。
- 当前最小风险路径是“先做 P7-1 用户可见闭环”，再把图谱事务能力外扩到 notes/pdf/rag。

### Decisions
| Decision | Rationale |
|----------|-----------|
| 先执行 P7-1（任务模板启动器 + 统一回执） | 最快把分散能力转为用户可感知的“完整 Agent 闭环” |
| P7-2 才推进图谱写操作 | 写操作涉及审批与补偿，需在统一回执协议稳定后接入 |
| P7-3 再做跨域事务 contract | 避免在 UI 入口未统一前过早抽象，降低返工概率 |

### Immediate Next Actions
- 定义最小 `task_template` 协议（`task_type/steps/receipt_schema`）。
- 在 `AIAdvisor` 加入跨板块任务模板启动器（beta）。
- 在 Notes/Documents/Experiments 统一回执面板骨架与事件消费。


## Findings: 2026-02-22 (P7-1A 前端实施发现：任务模板与统一回执已可见)

### Core Findings
- 仅做“建议按钮”不足以体现 Agent 集群能力，新增“任务模板启动器”后，用户可一键启动跨板块任务流。
- 在后端接口未全部就绪前，`agentApi.taskTemplates/startTaskTemplate` 的 fallback 策略可以保证前端功能连续可演示。
- 统一回执需要跨页面共享；采用 `localStorage + pathmind:task-receipts-updated` 事件比全局状态库改造成本更低。

### Implementation Findings
- 新增任务模板 contract：
  - `task_type / label / steps / receipt_schema / risk_level`
  - 三条模板：文档沉淀、笔记到图谱、实验复盘
- `AIAdvisor` 新增能力：
  - 模板选择、prompt 覆写、启动动作、source 标识（api/fallback）
  - 启动后写入统一回执并联动现有审批/工具/编排事件
- `useAgentStream` 增加 `task_receipt` 事件解析，支持后续后端直接推送结构化回执。
- `NotesPage / DocumentsPage / ExperimentsPage` 已接入 `TaskReceiptPanel`（只读），用户可在业务页直接看到任务执行回执。

### Validation Findings
- 前端构建通过：`npm run build`。
- WebAgent 快速门禁通过：`npm run check:webagent`。
- 当前已完成 P7-1A 的“可见闭环”，但 P7-1 正式验收仍依赖后端任务模板接口落地与 E2E 用例。

### Remaining
- 后端尚缺 `task-templates` 正式接口与执行策略，当前为前端 fallback 联调态。
- 任务 step 状态仍是启发式映射，需在 P7-1 下一轮补精确状态机与失败语义。


## Findings: 2026-02-22 (P7-1B 后端联通 + 全栈运行)

### Core Findings
- `task-templates` 已从“前端 fallback-only”升级为“前后端正式链路可用”。
- Python 侧采用内建模板目录，避免依赖额外配置文件，能快速稳定提供模板 catalog。
- 启动模板动作写入审计链路（`task_template_start`），与既有审批/图谱审计口径保持一致。

### Integration Findings
- Python 新增：
  - `GET /agent/task-templates`
  - `POST /agent/task-templates/start`
- Go 新增：
  - `GET /api/agent/task-templates`
  - `POST /api/agent/task-templates/start`
- 前端 `agentApi.taskTemplates/startTaskTemplate` 已可走真实 API；fallback 仍保留为降级路径。

### Runtime Findings
- Go 网关启动前置依赖是 Postgres + Redis + Neo4j；此前无法启动的根因是本地 5432/6379/7687 未提供服务。
- 拉起本地依赖容器后，Python(19090) / Go(18080) / Frontend(5173) 可同时运行并通过健康检查。
- 受保护 Go 路由 `/api/agent/task-templates` 返回 `401`（无 token）说明路由已生效且鉴权正常。
- 初始化空库后还需补齐 `users` 相关 schema（`organization_id/is_active`），否则 `/api/auth/register` 会失败。
- 完成 schema 补齐后，登录态下 `GET/POST /api/agent/task-templates*` 已验证可用。

### Remaining
- 补一条登录态 E2E 验收：模板启动 → Agent 执行 → 审批（如触发）→ 回执导出。
- 将 `task_receipt` 事件从启发式映射逐步升级为后端标准事件流（减少前端推断逻辑）。


## Findings: 2026-02-22 (Hotfix：PDF 一直“索引中”)

### Root Causes (confirmed)
- 根因 1（环境）：Python RAG ingest 返回 `status=db_unavailable`，因为本地 Postgres 镜像不含 pgvector 扩展，`init_pg_pool()` 迁移失败后 pool 置空。
- 根因 2（路径）：Go 上传落库的 `file_path` 是相对路径（如 `uploads/documents/...`），跨进程工作目录不同会导致 Python 侧潜在找不到文件。
- 根因 3（可观测）：Go `triggerRAGIngest` 仅在 `status=completed` 时落库，无 else 分支，失败时用户侧长期显示“索引中”。
- 体验缺口：Documents 页面只在上传后刷新一次，无 pending 自动轮询，后台成功也可能不即时可见。

### Fixes Applied
- Go：
  - `server-go/internal/handler/document_handler.go`
    - 上传时将 `file_path` 改为绝对路径落库。
    - ingest 失败（请求失败、非 200、decode 失败、status 非 completed）统一记录失败日志并写回 `page_count=-1`。
- Frontend：
  - `src/pages/DocumentsPage.tsx`
    - 增加 pending 文档 5 秒轮询刷新。
    - 增加“索引失败”红色状态展示（`!is_indexed && page_count < 0`）。
- Python：
  - `server-py/app/main.py` `/health` 新增 `rag.pgvector_ready`。
  - `server-py/app/db/postgres.py` 增加 pg/pgvector 初始化异常日志。
- Runtime / infra：
  - 本地 Postgres 容器切换为 `pgvector/pgvector:pg16`。
  - Python DB 连接改为与 Go 一致的本地默认：`postgresql://postgres:postgres@localhost:5432/pathmind`。

### Validation Evidence
- 新上传文档从 `is_indexed=false` 轮询到 `is_indexed=true`（`page_count=14`）成功收敛。
- 历史卡住文档补偿重试后成功：`status=completed`，`chunks=19`，并回填绝对路径。
- Python 健康检查显示 `rag.pgvector_ready=true`。
- `GET /api/documents` 返回两个文档均已 `is_indexed=true`。


## Findings: 2026-02-22 (Hotfix：文档语义检索“请求失败”)

### Root Cause
- Python `/rag/query` 抛出 SQL 类型错误：`operator does not exist: text = uuid`。
- 当前本地 `documents` 表里 `uploaded_by` / `course_id` 是 `text` 列，而查询 SQL 使用了 `$n::uuid` 比较，触发 `500`。

### Fix
- `server-py/app/services/rag_service.py` 将过滤条件改为兼容写法：
  - `d.uploaded_by::text = $n`
  - `d.course_id::text = $n`
- 该写法同时兼容列类型为 `text` 或 `uuid` 的环境，避免同类迁移差异问题。

### Validation
- `POST /api/documents/query`（登录态）从 `500` 恢复为 `200` 并返回结果列表。


## Findings: 2026-02-22 (重启后运行态 + PDF 检索质量复核)

### Runtime Status
- 重启后本地依赖容器仍在运行（Postgres/Redis/Neo4j 正常监听），但应用层服务（Go 18080 / Python 19090 / Frontend 5173）默认未常驻。
- 这会导致前端出现“请求失败”类假性报错（并非业务逻辑错误，而是服务未启动）。

### Current RAG Model Chain (from code/config)
- 文档嵌入模型：`nvidia/nv-embedqa-e5-v5`（1024d）。
- 代码嵌入模型：`nvidia/nv-embedcode-7b-v1`（4096d）。
- PDF 解析/OCR模型：`nvidia/nemoretriever-parse`（`VisionExtractor` 默认使用 `nvidia_parse_model`）。
- 重排模型：当前**未实现**独立 reranker（仅 pgvector 相似度排序，无 cross-encoder 二阶段重排）。
- 备注：`nvidia_vision_model` 配置存在，但当前路径未被 `VisionExtractor` 默认调用。

### Database Quality Check (document_chunks)
- 当前两份文档均为 `extraction_method=vision` 入库。
- 抽样分块中出现大量 OCR 乱码/重复片段（例如“条条条”“発置”等），语义检索质量会明显下降。
- 同一 PDF 直接用 `pypdf` 文本提取时，原文中文可读性明显更好，说明“识别差”核心在 OCR 解析链路而非向量检索本身。

### Practical Conclusion
- 你体感“识别效果差”是合理的，主因是**解析阶段（vision OCR）质量**，不是 embedding 维度或索引丢失。
- 在未引入 reranker 的情况下，解析噪声会直接污染向量库并放大检索误差。


## Findings: 2026-02-22 (按建议落地：模型组合与重排)

### Model Decision (implemented)
- 通用文本 embedding：`baai/bge-m3`（已切换默认）。
- 代码 embedding：`nvidia/nv-embedcode-7b-v1`（保持不变）。
- 视觉抽取模型：`meta/llama-3.2-90b-vision-instruct`（已切换默认）。
- rerank 模型：`nvidia/llama-3.2-nemoretriever-300m-embed-v2`（已接入二阶段重排）。

### What “rerank” does (in this implementation)
- Step1 召回：仍由 pgvector + 主 embedding 先召回候选（TopK）。
- Step2 重排：对候选文本用 rerank embedding 模型重新打分（query/passages 同模型向量相似度）。
- Step3 生成：把重排后前 N 条返回给上层 agent/LLM。
- 价值：召回阶段“广撒网”，重排阶段“精准挑”，减少答非所问。

### Pipeline Changes
- ingestion 策略从 `vision-first` 改为 `text-first + vision-fallback`，并增加可配置开关：
  - `PATHMIND_RAG_PREFER_TEXT_EXTRACTION`
  - `PATHMIND_RAG_USE_STRUCTURED_PARSER`
- 查询阶段新增 rerank，候选上限由 `PATHMIND_RAG_RERANK_MAX_CANDIDATES` 控制。
- 缓存键加入 `query_model` + `rerank_model` 维度，避免模型切换后命中旧缓存。

### Validation Evidence
- NVIDIA 模型可用性实测：
  - `baai/bge-m3` 可用（1024d）
  - `meta/llama-3.2-90b-vision-instruct` 在模型列表可用
  - `nvidia/llama-3.2-nemoretriever-300m-embed-v2` 可用（2048d）
- 两份现有 PDF 已重建索引：
  - `extraction_method` 从 `vision` 变为 `text`
  - 法律文档分块可读性明显提升（乱码显著减少）
- RAG query 抽样已返回与“回归模型”直接相关片段。

## Findings: 2026-02-22 (复核补充：重启后与线上接口一致性)

### Runtime Re-check
- 重启后 infra 容器可自动恢复（Postgres/Redis/Neo4j），应用层服务需手动拉起。
- Python 服务拉起后 `/health` 返回：
  - `status=ok`
  - `rag.pgvector_ready=true`
  - `tools.total=47`

### Model Availability (NVIDIA OpenAI-compatible endpoint)
- 目标模型二次确认均可用：
  - `baai/bge-m3`
  - `nvidia/nv-embedcode-7b-v1`
  - `meta/llama-3.2-90b-vision-instruct`
  - `nvidia/llama-3.2-nemoretriever-300m-embed-v2`
- 实测 embedding 维度：
  - `baai/bge-m3` = 1024
  - `nvidia/nv-embedqa-e5-v5` = 1024
  - `nvidia/nv-embedcode-7b-v1` = 4096
  - `nvidia/llama-3.2-nemoretriever-300m-embed-v2` = 2048

### Query Path Validation
- 直接调用 `POST /rag/query` 返回稳定、可读片段，Top 命中与“回归模型/法律援助需求”语义一致。
- 数据库抽样显示当前文档 `extraction_method=text`，分块预览中文可读性稳定。

## Findings: 2026-02-22 (登录失败根因修复)

### Root Cause
- 前端默认 API 地址曾指向固定端口（历史为 `localhost:8080`），与当前网关端口 `18080` 不一致。
- 本机 `8080` 被其他服务占用（SOCKS5 面板），导致登录请求命中错误服务，前端表现为“登录失败，请重试”。

### Fix
- `src/services/client.ts` 改为默认使用相对路径 `'/api'`，仅在显式配置 `VITE_API_URL` 时覆盖。
- `vite.config.ts` 增加 `server.proxy`：将 `'/api'` 统一代理到 `http://127.0.0.1:18080`（含 ws）。

### Validation
- `POST http://127.0.0.1:5173/api/auth/login` 返回 `200` 且包含 token。

## Findings: 2026-02-22 (登录报 internal error 的直接根因)

### Root Cause
- 本地基础依赖被停掉：`pm-local-postgres`（以及同组 redis/neo4j）处于 `Exited`。
- Go 网关仍在运行，但登录时访问用户表失败，接口返回 `401 {"error":"internal error"}`。

### Fix
- 恢复依赖容器：`docker start pm-local-postgres pm-local-redis pm-local-neo4j`。

### Validation
- `POST http://127.0.0.1:18080/api/auth/login` 使用 `test/testtest` 返回 `200`。
- `POST http://127.0.0.1:5173/api/auth/login`（经前端代理）同样返回 `200`。

## Findings: 2026-02-22 (Agent Delegation Mesh P0)

### 现有底座可直接复用
- `AgentService.query` 已具备双链路调度能力（Claude/OpenAI）和 runtime 覆写。
- `run_scratchpad` 已提供跨链路共享记忆容器，可承载委托前后摘要。
- ToolRegistry 支持新增 builtin 工具包，无需改引擎协议。

### 本轮实现结论
- 新增 `delegation_runtime` 作为统一护栏层：
  - 白名单目标约束（按 source agent）
  - 委托深度上限（默认 2）
  - 环路检测（如 `A->B->A` 直接拒绝）
- 新增 builtin 工具 `delegate_to_agent`：
  - 在工具层调用目标 agent 的 `AgentService.query`
  - 保留学生身份与角色上下文
  - 将 handoff start/done 写入 run scratchpad
  - 限制返回字符长度，避免上下文膨胀
- 关键 agent 已接入委托能力：`quick-qa/document-reader/note-assistant/mbti-analyst/career-advisor/learning-coach/graph-analyst`。

### 前端可见性
- 引擎公共事件新增 `agent_handoff`（start），用于标识“已发起委托”。
- `useAgentStream` 将 `agent_handoff` 归一到 `onToolCall`。
- AIAdvisor 时间线新增“Agent 委托”事件展示，用户可感知 agent 间协作。

### 风险与边界
- 当前委托路径为 `query`（非流式），目标 agent 的中间流式过程不会逐 token 透出。
- Claude 链路暂时只有 handoff start 的前端事件；handoff done 在 OpenAI 链路更容易精细透出。
- 本轮优先做 P0 闭环，未引入跨 worker 并行委托与事务批次协议。

## Findings: 2026-02-22 (Agent Delegation Mesh P0.5)

### 新增能力
- 新增委托完成态事件标准化：
  - `agent_handoff(stage=start)`：委托发起
  - `agent_handoff(stage=done|failed)`：委托完成/失败（OpenAI 链路）
- 新增批次委托工具 `delegate_batch_agents`：
  - 语义：一次提交多个委托请求
  - 模式：`best_effort`（尽力执行）/`all_or_nothing`（首失败即停）
  - 协议回执：`delegation.batch.v1`

### 协议回执（最小）
- 顶层字段：
  - `batch_id`
  - `mode`
  - `transaction.protocol=delegation.batch.v1`
  - `transaction.committed`
  - `summary.total/success/failed/skipped`
  - `items[]`（每个子委托状态）
- 这套结构可直接作为后续“跨 agent 事务批次执行”UI 与审计输入。

### 前端观测链路
- `useAgentStream` 已解析：
  - `agent_handoff` → `onToolCall(handoff_*)`
  - `agent_handoff_batch` → `onToolCall(handoff_batch_*)`
- `AIAdvisor` 现有时间线复用 `handoff*` 状态，无需新增面板即可看到委托进度。

### 当前边界
- 委托完成态事件目前主要由 OpenAI 工具执行链路透出；Claude 原生工具执行链路暂未拿到统一 result hook。
- 批次执行为顺序语义（非并行），用于先稳定协议与可观测性，再推进并行 DAG 融合。

## Findings: 2026-02-22 (P7-UX-2 用户端可感知完善)

### 目标与约束
- 用户目标：优先“看得见、感受得到”的智能协作体验，不先扩后端协议复杂度。
- 约束：沿用现有液态玻璃视觉体系，保持 AIAdvisor 单页闭环，不新增独立页面。

### 本轮关键实现
- AIAdvisor 新增“用户可感知工作台”：
  - 展示 `notes/documents/pdf/experiments/graph/rag/coding` 七类板块卡片。
  - 每张卡片实时显示状态（待触发/执行中/稳定/异常/部分完成）、总量、运行数、成功数、失败数。
  - 每张卡片提供 `打开板块` + `让 Agent 执行` 快捷动作，降低用户跨页和操作成本。
- task receipt 快照机制升级：
  - 引入 `TASK_RECEIPTS_UPDATED_EVENT` 监听 + `storage` 监听。
  - 以 `receiptSnapshot` 驱动 UI 与导出，避免“页面显示状态”和“导出回执”出现来源不一致。
- Hooks 事件流筛选升级：
  - 在原有类别筛选基础上增加 `status` 过滤（info/success/warning）。
  - 增加 `command` 过滤（来自事件 command 字段，自动收集选项）。
  - 搜索范围扩展到 title/detail/command/status，支持更精准定位。
- 事件语义补齐：
  - `tool/handoff` 事件统一写入 `status + command`，并为普通 `tool_call` 增加可见时间线记录。
  - 时间线卡片展示 kind + level + command + status 四类标签，便于用户理解执行态。

### 设计决策
- 工作台状态来自 task receipt 而非临时 UI 状态：
  - 原因：可跨会话保留、可导出、可对接审计，后续 SDK 化可复用 contract。
- 事件筛选采用“类别 + 状态 + 命令 + 搜索”四层组合：
  - 原因：复杂任务中仅类别筛选噪音仍高，命令维度是用户最直接的排障入口。
- 快捷动作优先“发送标准化 prompt”而非“隐式状态跳转”：
  - 原因：避免在 React 异步状态切换中触发错误 mode，保证执行可预期。

## Findings: 2026-02-22 (P7-UX-3 页面偶发不显示根因与修复)

### 问题归因（可复现/高概率路径）
- 路由级 ErrorBoundary 在某些异常后会保持错误态，用户切换到目标页面时仍可能停留在错误 fallback。
- 懒加载页面存在 chunk 资源失配风险（常见于前端重新构建后 hash 变化），会出现 “Failed to fetch dynamically imported module / ChunkLoadError”。
- `Documents/Notes/Experiments` 共用 `AgentClusterBoard` + `TaskReceiptPanel`，若其中任一组件抛错，会导致整页渲染失败。

### 本轮修复策略
- 在 `ErrorBoundary` 增加 `resetKey`：
  - 路由变化时自动 reset 错误态，避免错误状态跨页面残留。
- 在 `App` 懒加载链路引入 `lazyWithRetry`：
  - 对 chunk 失败做一次自动刷新恢复，减少偶发白屏。
- 在三大页面做“局部容错”：
  - 用局部 `ErrorBoundary` 包裹 `AgentClusterBoard` 与 `TaskReceiptPanel`。
  - 即使看板/回执组件异常，页面核心功能（文档列表、笔记编辑、实验列表）仍可使用。

### 验证结论
- 前端生产构建通过，说明新增容错链路与类型改动无编译回归。
- 这轮修复属于“可达性保障”，优先级高于新增视觉特效，符合当前用户反馈痛点。

## Findings: 2026-02-22 (P7-Hotfix-DocAgent 工具调用失败)

### 现象
- 用户在文档场景触发“查看 PDF 知识库”时，前端显示工具调用失败或通用错误文案。
- SSE 仅返回 `meta` 后很快进入错误兜底，`cost/token` 均为 0。

### 根因
- `document-reader` 默认绑定 `deepseek-ai/deepseek-v3.2`，在当前环境下该模型链路不稳定（请求直接走到错误兜底）。
- 同一请求切换到 `qwen/qwen3-next-80b-a3b-instruct` 可稳定返回，说明工具链与文档数据本身并非主因。

### 修复
- 更新 `server-py/app/agents/registry.py`：
  - `document-reader.engine_model` 由 `deepseek-ai/deepseek-v3.2` 调整为 `qwen/qwen3-next-80b-a3b-instruct`。
- 重启 Python Agent 服务使配置生效。

### 验证
- `POST /agent/query`（document-reader）恢复正常返回。
- 通过 Go 网关携带登录态调用文档查询，能够得到实际文档库内容回复。

## Findings: 2026-02-22 (P7-Perf-4 卡顿诊断与修复)

### 现象复盘
- 用户主观体验为“前端卡顿 + 偶发页面加载失败”。
- 该问题并非单点故障，属于前端加载链路与后端回源配置共同叠加。

### 证据与根因
- 配置错配：
  - `vite.config.ts` 代理目标为 `127.0.0.1:18080`，但 `server-go/.env` 与 `server-py/.env` 默认仍为 `8080`。
  - 结果：Python 工具链回源 Go 容易连接失败或超时，前端部分页面会表现为“网络错误/长时间等待”。
- 运行模式抖动：
  - `server-py/.env` 默认 `PATHMIND_DEBUG=true`，会启用 reload，CPU 抖动与请求波动明显增加。
- 前端体积与加载：
  - 构建前出现多个 `500KB+` chunk，Notes/编辑器等重依赖导致切页卡顿。
  - 该问题会放大“首开某些页面时卡住”的感知。

### 修复策略
- 统一本地端口约定为 `18080`：
  - Go `.env/.env.example` 与 Python `go_backend_url` 同步。
- 关闭 Python 默认 debug reload：
  - `.env/.env.example` 设置 `PATHMIND_DEBUG=false`（需要调试时再手动打开）。
- 前端性能治理：
  - `vite.config.ts` 增加 `optimizeDeps.include`（重依赖预构建）。
  - `build.rollupOptions.output.manualChunks` 按依赖域拆包（react/charts/graph/markdown/codemirror/motion）。
  - 代理目标改为 `VITE_API_PROXY_TARGET` 可配置，减少环境差异导致的问题。

### 效果验证
- 前端构建通过；路由页面 chunk 分布更合理，`NotesPage` 主 chunk 显著收敛。
- Python 语法检查通过；Go 编译通过。
- 快速结论：用户感知的“卡”主要来自前端加载与链路超时，不是 Go 语言本身性能瓶颈。

## Findings: 2026-02-22 (P7-UI-Minimal 交互简化与信息分层)

### 用户体验问题
- AIAdvisor 与业务页面默认暴露大量“系统观测内容”，挤占主任务区域。
- 用户在 Notes/Documents/Experiments 中更关注“编辑/上传/执行结果”，而不是实时编排日志。

### 本轮策略
- 信息架构改为两层：
  - 主层：标题、简介、输入、结果。
  - 次层：编排、事件、回执、会话（统一放入“系统细节”可折叠区域）。
- 视觉层级调整：
  - 主标题放大（`text-3xl~5xl`）。
  - 系统指标缩为 `text-[11px]`，降低注意力竞争。

### 关键实现
- `AIAdvisor`：
  - 新增 Hero 区与右侧媒体位占位；
  - 新增 `detailsOpen`，默认关闭；
  - 当细节关闭时自动收起集群/事件/会话。
- `DocumentsPage` / `ExperimentsPage`：
  - 新增 `showSystemPanels` 开关；
  - Agent 集群与任务回执默认隐藏。
- `NotesPage`：
  - `showCluster` 默认由 `true` 改为 `false`。

### 性能增益（继续压缩）
- `NoteEditor` 移除 `@codemirror/language-data` 全量语言包接入：
  - `markdown({ base: markdownLanguage })` 替代全量 `codeLanguages`。
  - 构建后 `vendor-codemirror` 从约 `1.55MB` 降到约 `500KB`（minified）。

## Findings: 2026-02-22 (P7-UI-Minimal-2 抽屉化 + 媒体位)

### 新增交互点
- AIAdvisor Hero 媒体位支持 URL 配置：
  - 支持 GIF/图片、WebM/MP4；
  - 值写入 `localStorage`，刷新后仍保留；
  - 默认无媒体时显示文案占位。

### 布局优化
- 事件流与会话历史由“正文下方块”改为“右侧浮层抽屉”（仅系统细节模式）。
- 事件与会话切换改为互斥，避免同时打开两个大面板抢占空间。
- 细节抽屉增加遮罩与显式关闭按钮，减少视觉干扰。

### 用户价值
- 主内容区保持稳定（输入框 + 对话结果不跳动）。
- 系统观测能力仍完整保留，但不再主导页面视觉。

## Findings: 2026-02-22 (P7-UI-Minimal-3 单一侧栏与笔记主任务)

### AIAdvisor 结构收敛
- 抽屉状态统一为 `detailDrawerTab`：
  - `overview/events/sessions` 三类面板互斥；
  - 避免此前多个布尔状态并存造成的布局冲突和认知负担。
- 原本插在主流程中的系统总览卡片迁移到右侧抽屉：
  - 对话主区只保留输入与回答；
  - 系统信息改为按需访问。

### Notes 页“写作优先”
- 顶栏强调 Notes 主任务（书写），降低系统功能显著性。
- 系统能力仍保留在“系统”按钮里，但默认关闭，不影响写作连贯性。
- 结论：信息层级从“系统优先”调整为“内容优先”，更符合笔记产品定位。

## Findings: 2026-02-22 (P7-Notes-ObsidianLite)

### Obsidian 仓库结论
- `obsidian-releases` 明确声明不包含 Obsidian 源码，仅包含发布与社区插件/主题目录。
- 这意味着当前项目无法直接“原样运行” Obsidian 插件 `main.js`（缺少 Obsidian Runtime API）。

### 可行方案（已落地）
- 先做“目录级兼容 + 扩展入口兼容”：
  - 生成 `public/obsidian/community-plugins-top.json`（Top 300 + 下载量 + 更新时间）。
  - Notes 系统面板新增插件目录组件，支持搜索与启用入口（本地持久化）。
- 优势：用户可立即获得“像 Obsidian 的插件发现/管理体验”，且不牺牲现有稳定性。

### 专注写作体验
- Notes 增加专注模式，进入后自动隐藏侧栏/AI/图谱/系统面板并切为编辑模式。
- 快捷键 `Ctrl/Cmd + Shift + F`，符合重度写作场景效率预期。

## Findings: 2026-02-22 (P7-Notes-ObsidianLite-2 命令运行时)

### 新增能力
- Notes 已具备“轻量 Obsidian 运行时”第一版：
  - 内建命令：`插入今日小节`、`生成目录`、`汇总待办`、`规范 WikiLink`。
  - 执行入口：顶栏 `扩展命令` 菜单，执行后自动写回编辑内容并触发自动保存。
- Obsidian 启用插件与 Notes 顶栏命令联动：
  - 启用任意社区插件后，会自动生成对应“迁移入口命令”。
  - 入口命令跳转插件仓库，作为后续 PathMind 适配迁移起点。

### 架构结论
- 通过 `notesPluginRuntime` 将“命令定义 / 内容变换 / 状态统计”从页面剥离，后续可直接演进到 SDK 接口层。
- `obsidianCatalog` 已支持 `pathmind:obsidian-enabled-changed` 事件，解决了跨组件启用状态不同步问题。
- 目前仍属于“受控轻量运行时”，不执行第三方插件 JS；这与现有安全策略一致。

## Findings: 2026-02-22 (P7-UX-Refine-NotesAI)

### Notes：单栏所见即所得
- 原有 Notes 分屏/预览路径已移除，默认单栏编辑，避免编辑态分裂。
- 编辑器切换为 `@mdxeditor/editor`：
  - Markdown 作为输入/输出；
  - 所见即所得编辑体验；
  - 保留 Markdown 快捷与格式语义。
- 样式层增加 `pm-note-mdx-*`，与液态玻璃视觉保持一致。

### AIAdvisor：控制项默认隐藏
- 原常驻控制区（模式/agent/编排/策略等）已从主视图下沉为“能力卡片”弹窗。
- 默认界面只保留主任务信息、输入与对话流。
- 新增 `AI 提示` 气泡，提供快捷 prompt，不主动请求时不展示复杂配置。
- 支持自然语言触发能力卡片（例如“打开设置/能力卡片/控制面板”）。

### 后端链路确认（Notes）
- Notes 前端调用 `notesApi`（`/notes/*`）；
- 网关由 Go 提供受保护路由（`/api/notes/*`）；
- 前端 TS + 后端 Go 的链路保持不变，仅编辑器和页面交互被重构。

## Findings: 2026-02-23 (P7-Notes-Perf-1 语法支持与性能诊断)

### Markdown/代码块能力结论
- 之前 Notes 编辑器未启用 `codeBlockPlugin` / `codeMirrorPlugin`，导致三引号代码块不能完整进入代码编辑语义。
- 现已补齐 `codeBlockPlugin`，并采用“检测到 ``` 再动态加载 CodeMirror”策略。
- 结果：默认写作路径保持轻量；进入代码笔记场景时可启用语言选择与高亮。

### 卡顿来源（现场快照）
- 当前主机内存总量 `31Gi`，已用约 `14Gi`，可用约 `16Gi`（系统层面不存在 OOM）。
- 进程快照（关键）：
  - Vite 前端 dev 进程：约 `378MB`（`node`，端口 `5173`）。
  - Go API 网关：约 `25.8MB`（端口 `18080`）。
  - Python Agent 主进程：约 `78.8MB`（端口 `9090`，另有 worker 子进程约 `133MB`）。
  - Chrome 单个 renderer 峰值超过 `600MB` 且 CPU 高占用（>100%），是“肉眼卡顿”主要贡献方之一。
- 结论：卡顿并非 Go 后端瓶颈主导，更多来自前端页面重型模块与浏览器渲染压力叠加。

### 本轮优化要点
- Notes 页将 Agent 看板/任务回执/插件目录/图谱/AI 面板切为懒加载，减少主路径首屏负担。
- 自动保存增加“内容未变化不请求”与 `1200ms` debounce，降低输入期间网络与状态震荡。

## Findings: 2026-02-23 (P7-Notes-Perf-2 输入链路性能结论)

### 关键观察
- 当前卡顿热点不在后端吞吐，而在前端“输入触发广域重渲染”。
- 在 Notes 页面中，键入内容会牵动顶部状态和侧栏组件参与渲染循环，形成体感顿挫。

### 定向优化
- 采用 `requestAnimationFrame + startTransition` 处理编辑内容状态更新，减少同步更新打断输入与动画。
- 采用 `useDeferredValue(editContent)` 计算状态徽标（字数/双链/待办），把统计更新降级为低优先级。
- `NoteSidebar` 使用 `React.memo` 与 `ref` 定时器，避免键入时侧栏反复重渲染。

### 结果预期
- 打字流畅度提升（尤其在长笔记 + 系统面板打开场景）。
- 既有动画与转场保持原样，无视觉降级。

## Findings: 2026-02-23 (P7-Nav-FirstPaint-1 首屏空白问题)

### 问题归因
- `DashboardLayout` 使用 `AnimatePresence mode="wait"` 时，旧路由退出与新路由进入严格串行，切页期间更容易感知空挡。
- `DocumentsPage` 之前静态引入系统面板组件，首次进入页面时会增加解析/执行负载。
- `NotesPage` 之前从 `components/notes` barrel 同时取 `NoteEditor`，会在首进笔记页时提前拉起 MDX 编辑器重模块。

### 修复策略
- 保持液态玻璃与动效参数不变，仅调整加载策略与切页编排。
- 将文档/笔记的重型面板与编辑器改为 `React.lazy + Suspense`。
- 在布局层使用 `requestIdleCallback` 预取 `Experiments/Notes/Documents` 路由 chunk。
- 路由过渡切换为 `mode="sync"`，减轻视觉“空屏等待”。
- 调整 `vite` manual chunks：去掉 `codemirror` 的全局 vendor 绑定，避免非笔记路由被编辑器依赖牵连。

### 构建后观测
- 构建产物中 `NoteEditor` 已独立拆包（`dist/assets/NoteEditor-*.js` + `NoteEditor-*.css`）。
- `ExperimentsPage`/`DocumentsPage` 维持中等体积，系统面板改为按需拉取。
- `ExperimentsPage`/`DocumentsPage` 新产物不再直接引用 `vendor-codemirror`，首切页阻塞风险降低。

## Findings: 2026-02-23 (P7-Nav-FirstPaint-2 渲染失败与卡顿根因闭环)

### 根因矩阵（最终）
- **首帧隐藏态导致“看起来像没渲染”**
  - 多个页面容器使用 `initial={{ opacity: 0, y: ... }}`；
  - 当主线程繁忙时，进入动画首帧延迟，页面会短时保持“透明不可见”。
- **入口链路包体过重导致首屏阻塞**
  - `FloatingAgent` 静态导入会把 markdown 相关依赖链提前拉入入口；
  - 入口脚本与 preload 项过多会放大首次交互延迟。
- **开发态双渲染放大体感卡顿**
  - `StrictMode` 在开发环境触发副作用双执行；
  - 对流式请求/数据拉取/动画初始化场景，卡顿与“抖动感”会明显放大。

### 本轮落地修复
- `FloatingAgent` 改为懒加载并延迟挂载，降低首屏竞争。
- `DashboardLayout` 路由容器取消 entering hidden 初始态。
- `Notes/Experiments/Documents` 主容器取消 `opacity: 0` 首帧隐藏。
- `DashboardLayout` 固定玻璃层 blur 由 `20px` 调整为 `14px`（保留视觉风格）。
- `vite optimizeDeps` 排除 MDX/CodeMirror/Three 重型依赖，降低 dev 预构建压力。
- `main.tsx` 开发环境关闭 StrictMode 双渲染，生产保持 StrictMode。

### 可量化结果
- `dist/index.html` 已移除 `vendor-markdown` 预加载。
- 入口 `index` chunk 从约 `113.51k` 降到约 `61.93k`（构建输出对比）。
- `FloatingAgent` 已拆为独立懒加载 chunk（`FloatingAgent-*.js`）。

### 剩余高优先级（下一轮）
- `@mdxeditor/editor` 相关 chunk 仍然较大（`NoteEditor` + `index-*.js`），建议追加“轻量编辑器 fallback + 高级编辑器按需切换”。
- 图谱与 3D 相关 vendor 体积仍大，建议按页面再细分动态 import（目前已做首轮隔离）。

## Findings: 2026-02-23 (P7-Notes-Perf-3 极速编辑默认化 + 切页稳定性补丁)

### 本轮结论
- Notes 默认编辑路径已经切换到轻量模式（`NoteEditorLite`），高级模式保留为按需切换。
- 输入卡顿的一个次级根因是“全局平滑滚动 + 路由滚动重置”叠加，导致页面已加载但视口回位延迟。
- 路由主容器的 path-keyed 动画会放大 remount 成本，移除后切页可见性更稳定。

### 已落地修复
- `NotesPage` 新增编辑器模式持久化键：`pathmind.notes.editor.mode`。
- 顶栏加入 `极速 / 高级` 模式按钮，保持玻璃风格，不增加主区噪音。
- 极速模式输入直接 `setEditContent`，高级模式维持 `requestAnimationFrame + startTransition`。
- 插件命令写回内容统一走 `handleContentChange`，避免内容写回路径分裂。
- `DashboardLayout` 主内容区移除 path-keyed route transition wrapper，减少首帧空白。
- `index.css` 将全局 `scroll-behavior` 从 `smooth` 调整为 `auto`。

### 构建观测
- `npm run -s build` 两次回归通过。
- `NoteEditor` 继续保持独立 chunk（高级模式按需加载）。

## Findings: 2026-02-23 (P7-Notes-AI-Simplify：简约化与可控 AI 编辑)

### 关键结论
- Notes 用户主路径应聚焦“写作 + AI 共创”，过多系统级控制会显著增加认知负担。
- “极速/高级”双模式在当前阶段带来的价值低于维护和解释成本，统一高级模式更稳定。
- AI 输出必须结构化且可拆分，用户才能安全地做分段落笔，而不是整段盲贴。

### 本轮落地
- 页面层：`NotesPage` 收敛控制项，仅保留 `AI` 与 `专注写作`。
- AI 层：`NoteAIPanel` 支持四类写入动作（追加、锚点后插入、锚点段替换、整篇替换）、多段分块应用、定位与撤销。
- 编辑层：`NoteEditor` 补齐 Undo/Redo、table/frontmatter/admonition 与搜索定位桥接。
- 兼容层：Callout 双向转换（Obsidian `> [!NOTE]` ⇄ editor `:::note`）。
- agent 约束层：`note-assistant` 提示词新增权限边界与风格规范（客观、少修辞、禁止伪造工具结果）。

### 联网参考（性能与实现取舍）
- MDXEditor 官方：插件化能力与工具栏组件（table/frontmatter/directives/search/undo）可按需启用。
- React 官方：优先减少不必要渲染与状态扩散，输入链路保持最短路径。
- Vite 官方：依赖预构建与分包策略会直接影响开发态稳定与首屏交互。

## Findings: 2026-02-23 (P7-Notes-AI-Minimal)

- 用户偏好是“自然语言驱动 + 简约界面”，不适合在 AI 面板暴露过多编辑策略控件。
- 可执行编辑能力仍可保留，但由 agent 通过轻量协议输出（`pathmind-edit`），前端只做最小确认按钮。
- 该模式在可用性与安全性之间平衡较好：不牺牲能力，同时降低认知负担。

## Findings: 2026-02-23 (P7-Notes-Perf-4 流式与滚动性能)

### 关键瓶颈
- `useAgentStream` 每个 `text` 事件直接 `setMessages`，在高 token 速率下触发高频 React 提交。
- `NoteAIPanel` 每次消息变化都执行平滑滚动（`behavior: smooth`），导致持续滚动动画竞争主线程。
- 历史消息在流式阶段被重复参与渲染，Markdown 解析开销会被放大。
- 路由切换时只做一次滚动重置，在懒加载/异步布局场景下会出现“页面已渲染但视口未回位”的体感。

### 本轮修复
- `useAgentStream` 改为文本分片缓冲 + 28ms 批处理写入。
- `NoteAIPanel` 消息气泡组件 memo 化，历史消息引用不变时不重渲染。
- 流式阶段滚动行为改为 `auto`，仅在非流式完成态使用 `smooth`。
- 流式阶段暂停 `pathmind-edit` 计划解析，避免边生成边解析。
- `NotesPage` 给 AI 侧栏传入 `useDeferredValue(editContent)`，降低输入路径与侧栏渲染耦合。
- `DashboardLayout` 路由切换滚动重置加固（同步 + 双 RAF + 延迟补偿）。

### 结果判断
- 本轮优化属于“无损动效”路径：保留现有液态玻璃与动画，只优化更新策略和渲染边界。
- 构建回归通过，未引入类型或打包错误。

## Findings: 2026-02-23 (P7-Notes-UX-5 + RAG-Robustness)

### 用户侧问题复现
- AI 长输出时会带动页面整体滚动，笔记编辑区被“拖着走”。
- 回复中的 `pathmind-edit` 控制块与“分析段”全部直出，信息噪音大。
- 未选择笔记时，AI 可回复但写入动作无法真正落库，导致“工具看似执行但笔记没变”。
- 个别场景 PDF 已索引但仍反馈“检索不到”，需要提升查询鲁棒性。

### 本轮修复
- 前端：
  - AI 消息滚动改为容器内 `scrollTop`，并引入贴底判断，避免整页滚动联动。
  - 助手回复新增“分析折叠”与“控制块隐藏为 action 提示”，默认展示可应用正文。
  - 流式阶段优先 Markdown 渲染（超长内容才退化纯文本），并保持光标反馈。
  - 写入前新增 `ensureNoteTarget`：无选中笔记时自动创建目标笔记，再执行写入。
- 后端：
  - `RAGService.query` 新增关键词兜底检索：
    - embedding key 缺失时自动走关键词检索；
    - 向量查询失败时自动回退关键词检索；
    - 向量命中为空时补一轮关键词检索。

### 结果
- 长输出不再拉动主页面，AI 面板内可独立滚动。
- 分析内容默认收起，用户按需展开；可应用片段更聚焦。
- AI 写入在“未选中笔记”路径也可完成落库。
- 文档检索链路在弱配置场景可用性提升，减少“导入成功却搜不到”的空返回。

## Findings: 2026-02-23 (P7-Notes-UX-6 收尾修正)

### 风险点补充
- `parseEditPlan` 早期逻辑在“无控制块”的普通回复下也可能回退为 `append`，存在误写风险。
- Markdown 输出在超长 token / 宽表格 / 长链接场景下，仍可能出现侧栏横向撑出。

### 收尾修复
- `NoteAIPanel.parseEditPlan` 增加硬约束：只有出现 `pathmind-edit` 控制块，或明确出现 `## 可应用片段` 时，才允许进入自动应用链路。
- `MarkdownMessage` 增强溢出保护：
  - 启用 `overflow-wrap:anywhere` + `break-words`；
  - `pre/table` 增加 `max-w-full + overflow` 限制；
  - `th/td` 强制断词，避免内容撑破面板。

### 结果
- 普通问答回复不再触发误写入，AI 修改动作更可控。
- 长文本/宽内容在 AI 面板内稳定显示，不再超出侧栏边界。

## Findings: 2026-02-23 (P7-Notes-UX-7 切换错位与写入可见性)

### 日志证据
- Go 日志显示笔记切换请求命中不同 ID（`GET /api/notes/{id}`），后端返回正常，说明“切换后内容看起来相同”更可能在前端编辑器状态层。
- Go 日志显示 `POST /api/agent/stream` 后紧接 `PUT /api/notes/{id}` 且状态 `200`，内联写入链路是成功执行的。
- PostgreSQL 实查两条笔记内容不同（`5e436...` 与 `d4b0b...`），进一步排除“数据库写错笔记”。

### 根因判断
- MDX 编辑器在 note 切换时未强制重建内部状态，导致视觉上继续显示上一个文档内容。
- 分析折叠使用原生 `details`，在长文本场景展开时体感不够顺滑。

### 已修复
- `NotesPage` 给 `NoteEditorAdvanced` 增加 `key={activeNoteId}`，切换笔记时强制编辑器重挂载。
- `NoteAIPanel` 将分析区改为轻量可控折叠块（按需渲染 Markdown + max-height/opacity 过渡）。
- `NoteAIPanel` 工具轨迹新增“内联写入成功/失败”事件，用户可直接看到落笔结果。

## 2026-02-24 Notes 输入中断根因修复（CM6 重建回环）

### 结论
- “一次只能输入一个字母 / 中文英文输入异常” 的核心根因是 `NoteEditor` 初始化 `useEffect` 依赖了 `content`（及 `isDark`），导致每次内容变化触发编辑器销毁+重建。
- 该行为会破坏焦点与 IME 组合输入连续性，表现为输入被频繁打断。

### 修复
- 将 `src/components/notes/NoteEditor.tsx` 中初始化 `EditorView` 的 effect 依赖收敛为一次挂载路径（移除 `content/isDark` 触发重建）。
- 保留已有外部同步 effect (`[content]`) 负责文档内容更新，避免实例重建。

### 验证
- `npm run -s build` 通过（2026-02-24）。

## 2026-02-24 CM6 官方/GitHub调研：Live Preview 与 Inline Completion

### 外部证据（官方优先）
- CodeMirror 官方 Decorations 示例明确支持 `mark/widget/replace/line` 四类装饰，且推荐通过 `StateField + transaction.changes.map(...)` 保证文档变化时位置稳定。
- CodeMirror 官方建议通过 `ViewPlugin` 只在可视区域更新 decoration，可降低大文档重绘成本。
- CodeMirror 官方 Tab 示例与 Autocomplete 示例表明：`Tab` 拦截必须放在高优先级 keymap，并与默认缩进行为显式分流。
- Obsidian 官方文档确认 Live Preview 模式本质是“编辑态内联渲染 + 光标进入时回显原始语法”；其插件开发文档同样基于 CM6 Decorations。

### 对当前实现的差距判断
- 已具备：`@codemirror/lang-markdown`、`StateField`、`Decoration.widget`、`Tab` keymap、Wikilink/Callout 装饰。
- 缺失 1（核心）：当前是“编辑区 + 可选预览面板”，不是 Obsidian 式“同一编辑区内联 Live Preview”。
- 缺失 2（体验）：Inline completion 触发条件较严，且 `showAI=true` 时被直接禁用，用户容易感知为“没有补全”。
- 缺失 3（可观测）：补全请求失败时仅静默清空，无可见状态提示，难以区分“未触发”与“触发失败”。

### 规划方向（不改技术栈）
- P0：先恢复“可见可控”——补全状态可观测 + 触发门槛调整 + AI 面板打开时允许补全。
- P1：实现 CM6 内联 Live Preview（基于语法树与 Decorations，按可视区更新）。
- P2：补全质量增强（缓存/节流/Abort/降级策略）与 markdown 语法覆盖扩展。

## 2026-02-24 P0 落地：内联补全触发释放与可见性

### 变更
- 移除“AI 侧栏打开时禁用补全”的互斥逻辑，内联补全与侧栏可并行。
- 触发门槛收紧为快速响应：输入静默阈值 `700ms -> 280ms`，最小上下文 `24 -> 5` 字符。
- 增加补全本地缓存：以“光标前 50 字归一化 + hash + noteId”作为 key，10 分钟 TTL 命中直接回填。
- 补全请求阶段新增可见状态：编辑器顶部与页面状态区显示微型呼吸点，避免“无反馈”。
- 继续保留 AbortController 中断路径：输入新字符时立即取消旧请求。

### 结果预期
- 补全触发频率明显提升，用户可感知“正在补全”与“缓存命中”。
- 在侧栏 AI 打开状态下仍可获得幽灵补全文本。

## 2026-02-24 补充修复：Markdown 预览可见性

### 根因
- 预览容器在编辑器下方流式堆叠，编辑器占满整高时需要额外滚动才能看到预览，体感为“预览没生效”。

### 修复
- 预览开启时改为固定双区布局（编辑器 + 预览区）而非下方堆叠，保证预览始终可见。
- 预览渲染源使用实时 `editContent`，避免 deferred 内容更新带来的“像没刷新”。

### 验证
- `npm run -s build` 通过（2026-02-24）。

## 2026-02-24 P1 首版：CM6 内联 Live Preview（视口裁剪）

### 实现内容
- 新增 `livePreviewPlugin`（CM6 `ViewPlugin`）：仅对可视区域上下各 5 行计算装饰器，避免全量扫描。
- 规则（仅在“非当前光标行”生效）：
  - 标题 `#` 标记隐藏，并按级别注入行样式（H1~H6）。
  - 粗体 `**...**` 的包裹符号隐藏，正文加粗。
  - 行内代码 `` `...` `` 的反引号隐藏，正文使用 code 样式。
  - 双链 `[[...]]` 的外层括号隐藏，内容保持链接样式。
- 双链解析兼容升级：`extractWikilinkTarget` 增加 plain-text 回退，避免符号隐藏后点击失效。

### 性能守卫
- 插件更新条件限制在 `docChanged | viewportChanged | selectionSet`。
- 使用 `visibleRanges` + 行号去重集合，控制装饰器构建范围。

### 验证
- `npm run -s build` 通过（2026-02-24）。

## 2026-02-24 调整：移除分屏 Markdown 预览 + 补齐斜体内联

### 根因说明
- 截图中的 “Markdown Live Preview” 属于旧的分屏面板逻辑，不是 CM6 内联渲染失效。

### 修复内容
- 删除 Notes 顶栏“预览”开关与分屏预览面板，统一为单编辑区内联渲染路径。
- Live Preview 增加斜体规则：支持 `*italic*` 与 `_italic_` 的符号消隐与内容样式。
- 标题匹配增强为支持最多 3 个前导空格，减少 `###` 未消隐的漏判。

### 验证
- `npm run -s build` 通过（2026-02-24）。

## 2026-02-24 修复：编辑器半高与双反引号触发失效

### 问题1：编辑器只占半边/半高
- 根因：`NotesPage` 中编辑器容器仅 `min-h-0`，缺少 `h-full`，导致子级 `NoteEditor(h-full)` 无法撑满。
- 修复：容器改为 `h-full min-h-0`。

### 问题2：输入第二个反引号后内联渲染“全部失效”
- 根因：P1 初版采用“整行跳过 active line”，在光标所在行任何语法都不做装饰，造成体感为失效。
- 修复：改为“token 级避让”策略：仅当光标位于该 token 内时跳过该 token 的符号消隐，其它 token 仍渲染。
- 影响：闭合 `##`/`**`/`*`/`` ` ``/`[[ ]]` 后，光标在 token 外时可即时保留渲染，不再整行熄火。

### 验证
- `npm run -s build` 通过（2026-02-24）。

## 2026-02-24 规则修正：标题触发时机 + 代码语法支持

### 标题触发时机
- 调整为“提交式渲染”：当前行输入 `## + 空格` 后不会立即隐藏 `##`。
- 仅当满足其一才渲染：
  1) 光标离开该行；
  2) 当前行已存在标题文本且行尾再次输入空格（用户显式提交）。

### 行内代码
- inline code 匹配从单反引号升级为“同长度反引号对”：支持 `code` 与 ``code``。
- 仍采用 token 级光标避让，避免输入过程闪烁或整行失效。

### fenced code block
- 新增 ` ``` ` / `~~~` 行级识别与样式：
  - fence 行样式（分隔行）
  - fence 内行样式（代码行）
  - 非活动行可隐藏 fence 标记（仅保留内容视觉）

### 验证
- `npm run -s build` 通过（2026-02-24）。

## 2026-02-24 热修：token 内样式保留 + 全角反引号兼容

### 症状
- 用户在输入代码 token（尤其 ` 或 ``）时体感“全部渲染失效”。

### 根因
- 旧策略在光标进入 token 时完全跳过该 token 渲染，视觉上像“渲染被关闭”。
- 中文输入法可能产出全角反引号 `｀`，先前 regex 仅识别 ASCII 反引号。

### 修复
- token 内改为“保留内容样式，仅不隐藏标记符”策略（bold/italic/inline-code/wikilink）。
- 代码标记规则支持全角反引号：inline (` + ``) / fence (```/~~~) 均兼容 `｀`。
- 活动行判定增加 `view.hasFocus` 条件，编辑器失焦时不会把某行错误当作活动行。

### 验证
- `npm run -s build` 通过（2026-02-24）。

## 2026-02-24 — Live Preview regression root-cause
- 症状：`##`、`` `code` `` 等在输入后会“整体失效”。
- 根因：`livePreviewPlugin` 使用 `RangeSetBuilder.add` 时，按“语法类型”分批写入装饰，导致同一行中出现“后处理语法在更早位置”的情况（如前面是 inline-code、后面是 bold），触发装饰范围顺序违规并在运行时抛错，后续渲染链中断。
- 修复：改为先收集 `pendingDecorations`，按 `from/to` 排序后统一写入 builder，保证顺序合法；同时补齐 fenced-code 预扫描对全角反引号 `｀` 的识别一致性。

## 2026-02-24 — 语法高亮未生效根因（控制台直证）
- 控制台报错：`CodeMirror plugin crashed: TypeError: Cannot read properties of undefined (reading 'some')`。
- 该错误发生在 Lezer 高亮流程（`TreeHighlighter`/`HighlightBuilder`），说明高亮扩展链在运行时崩溃，导致代码块退化为普通文本。
- 同屏 404 (`/api/ai/dispatch/stream`) 与高亮无直接关系：它会影响 AI 补全/流式，但不决定 CM6 代码 token 着色。
- 修复策略：将高亮配置简化为稳定 tag 子集，并把高亮扩展从主题 compartment 的 reconfigure 中剥离，避免主题切换时触发高亮插件重建异常。

## 2026-02-24 — 第二轮高亮崩溃处理
- 用户新截图仍报 `CodeMirror plugin crashed`，且栈持续指向 `TreeHighlighter`。
- 本轮策略：完全移除 `syntaxHighlighting(...)` 路径（即 Lezer TreeHighlighter 链路），改为代码块内联正则高亮（关键字/字符串/注释/函数/数字）并按 fence 语言切换规则（python/js/ts/go）。
- 目的：先确保编辑器稳定无红错，再保证代码块可见高亮；后续再评估恢复 AST 高亮。

## 2026-02-25 — Notes Obsidian 化落地发现

- `notes` 历史数据与新树模型并存时，必须在服务层维护 `folder(string)` 与 `folder_id(uuid)` 双写，否则老查询会出现路径漂移。
- 文件树重排在「文件夹段/笔记段分段排序」约束下，可通过统一 `kind + parent_id + index` payload 覆盖 before/after/inside 语义，无需后端混排复杂度。
- 标题实时同步最稳方案是：`editTitle` 做 400ms debounce 保存 + 左栏乐观更新，不依赖 `onBlur`，避免切换焦点造成视觉回跳。
- 编辑区右键若要稳定执行 cut/copy/paste，不能依赖浏览器默认菜单；需要在 `NoteEditorHandle` 暴露动作接口并由自定义菜单统一调度。
- 全局右键兜底应挂在 App 根部，且尊重 `event.defaultPrevented`，这样 Notes 页特化菜单能覆盖全局菜单而不冲突。

## 2026-02-25 — 未完成项补齐中的实现结论

- 将拖拽目标解析从 UI 组件中抽离为纯函数（`treeDnd.ts`）后，可稳定覆盖 before/after/inside 语义测试，且避免 UI 回归时 payload 漂移。
- 标题防抖保存应抽为独立 hook（`useDebouncedNoteTitleSave`），这样可以在不依赖重型页面组件的情况下做精确 fake timers 测试。
- Notes 右键菜单将 action resolver 抽为 `notesContextMenus.ts` 后，node/editor/blank 三类菜单可以直接做 deterministic 断言。

## 2026-02-25 — 剩余两项落地发现（E2E + 事务并发集成）

- Notes Playwright 场景若直接依赖真实后端会受鉴权与全局悬浮 Agent 请求噪声影响，采用 `page.route('**/api/**')` 内存态 mock 能稳定覆盖交互链路并保留真实页面渲染。
- Notes 树拖拽在 E2E 中使用原生 `dragstart/dragover/drop` 事件（带 `DataTransfer`）比纯鼠标路径更稳定，且可显式控制 `clientY` 来验证 before/after 落点语义。
- 左栏宽度持久化在 E2E 更适合断言 `localStorage(notes_sidebar_width)` 与 reload 后一致，能规避布局动画瞬态抖动造成的像素级误差。
- Go service 的 sqlite 集成测试不能直接 `AutoMigrate(models.Note)`：`gen_random_uuid()` 与 `text[]` 属于 Postgres 语义；测试应手工创建兼容 schema（字段同名）再复用真实 service 逻辑。
- 为验证事务回滚，最直接的方法是在 sqlite 里对 `notes.sort_order` 增加故障 trigger（`RAISE(ABORT, ...)`），再调用 `Reorder`，可证明同事务中的前置更新会被完整回滚。
- 并发 reorder 的一致性验收应检查 `sort_order` 最终“连续且唯一”（`0..n-1`），而不是依赖最终具体顺序。
- 将 NoteHandler 依赖抽象成接口后，`/api/notes` 新接口的入参校验与 payload 映射可以直接用 gin+httptest 做合约测试，不再被真实数据库耦合。

## 2026-02-26 — Anthropic 工具回合与灵动岛轨迹展示排查结论

- `AnthropicDirectEngine` 原先将工具执行结果统一 `json.dumps(result)` 塞入 `tool_result.content`，但未在 `tool_result` 顶层设置 `is_error`，会降低模型对失败工具回合的可判别性，容易拖长回合。
- 工具层存在稳定失败源：大量 builtin tool schema 强依赖 `student_id`，模型在部分回合会遗漏该字段；若不做服务端兜底，会触发重复 tool_use / 长回合。
- 通过 `AgentRequestContext` 可稳定拿到请求侧 `student_id`，适合作为工具执行前的统一注入点（仅对 schema 显式声明 `student_id` 的工具生效，避免污染其他工具参数）。
- Anthropic 链路此前仅在工具“开始”时发前端事件，未在“结束”时根据结果派发 handoff/批量委托等结果事件；这会让前端轨迹可见性低于 OpenAI 链路。
- 灵动岛 UI 的轨迹块此前是“消息列表顶部单块”，不符合“每次调用在对应对话气泡中局部流式展示”的交互预期；应改为 message-scoped trace。
- 灵动岛发送消息时未显式透传 `studentId/tenant`，在登录态异常或边缘上下文下会提高工具缺参概率；补充显式透传更稳妥。

## 2026-02-27 — 本轮修复发现（P0+）

- 之前 `handoff_failed ... allowed: (none)` 的直接根因是 `command-center` 未在 `_DEFAULT_WHITELIST` 中声明，属于运行时策略与提示词脱节。
- “补充原笔记”失败不是单点问题：除委托失败外，笔记工具层确实缺少 `update_note`，导致模型只能在 `create_note` 与文本回复之间摇摆。
- `DataAdapter` 只有 GET/POST 也会形成架构层瓶颈：即便工具定义了更新动作，也无法通过统一适配层调用 `PUT /internal/notes/:id`。
- 将 `update_note` 同时接到 `note-assistant + command-center` 能减少“委托失败后回退到新建笔记”的概率，并与用户意图（补充现有笔记）一致。

## 2026-02-27 远程 Armbian 代理诊断任务（启动）

- 用户要求：由代理直接 SSH 上机排查，不要只给口头步骤。
- 目标主机：`root@10.51.166.90`（Armbian, RK.Panther-X2）。
- 预期检查项：`mihomo` 运行状态、代理端口监听、直连/代理出口 IP 对比、Web 控制器/API/UI 可达性。

## 2026-03-01 — 创业计划书重构（脑机模板 + MCP）调研结论

- “脑际接口模板”在仓库中最接近来源是 `docs/脑机与应急机器人算法应用赛 ... 技术报告.docx`，其高可复用结构为：`摘要 + 关键词 + 一、引言 + 分节展开`。
- 该模板偏技术报告，不适合直接照抄商业计划书；应保留其“问题-方案-验证”的线性叙事，迁移为“市场-产品-商业-实施-风险”结构。
- `mcp__fetch__fetch` 通道本轮返回 `Transport closed`，已改为检索官方公开网页并以来源链接落地数据，避免编造。
- 本轮可核验国内事实基线（用于计划书）：
  - 2025 届高校毕业生规模预计 `1222 万人`（教育部公开信息，人民网转载）。
  - 2024 年普通、职业本专科在校生 `3891.26 万人`（教育部统计公报）。
  - 2025 年全国城镇调查失业率平均值 `5.2%`（国家统计局）。
  - 2025 年 4 月中办、国办发布“高校毕业生高质量就业服务体系”文件（国务院网站）。
  - 截至 2025 年 6 月，生成式 AI 用户规模约 `5.15 亿`（CNNIC）。
  - 截至 2025 年 8 月，累计 `538` 款生成式 AI 服务完成备案（国家网信办通报）。
- 已输出新文档：`docs/PathMind-AI创业计划书-MCP主动编排版.md`。
- 成文策略：保留脑机报告“摘要→引言→分节展开”节奏，内容改写为创业计划书“市场→方案→商业→实施→风险→社会价值”。
