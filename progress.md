# Progress Log

## Update: 2026-02-25 (`/api/complete` 502 热修与验证)

### Actions Taken
- 复核前端报错截图后定位 Go 日志：`inline completion api key not configured`，导致 `/api/complete` 返回 502。
- 在 `server-go/internal/config/config.go` 增加 inline key/base-url fallback：
  - `INLINE_COMPLETION_API_KEY` → `NVIDIA_API_KEY` → `PATHMIND_OPENAI_API_KEY`
  - 自动补充加载 `../server-py/.env`
  - 归一化 base URL，处理 `.../v1` 尾缀
- 重启 Go 服务后，使用 JWT 直接调用 `/api/complete` 进行端到端验证。

### Files Modified
- `server-go/internal/config/config.go`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Go 回归 | 配置变更不破坏现有功能 | `go test ./...` 通过 | ✅ |
| Inline API 实测 | `/api/complete` 不再 502 | `POST /api/complete` 返回 200，`{\"completion\":\"a + b\"}` | ✅ |

## Update: 2026-02-25 (Notes inline 模式判别修复：code vs prose)

### Actions Taken
- 前端内联核心新增模式识别：
  - `src/services/inlineCompletionCore.ts` 增加 `detectMarkdownCursorMode` 与 code-mode 下 `isLikelyProseForCodeCompletion`。
- `NotesPage` 请求链路扩展：
  - `/api/complete` payload 新增 `mode` / `language`。
  - 缓存 key 增加 mode/lang 维度，避免跨场景复用错误候选。
  - code 模式候选校验增加“叙述文本过滤 + 括号匹配校验”。
- Go 后端链路扩展：
  - `inline_completion_handler` 接收并校验 `mode` / `language`。
  - `inline_completion_service` 按 mode 组装 system prompt（code/prose 分流）。
  - inline 默认模型改为 `qwen/qwen2.5-coder-32b-instruct`（可由 env 覆盖）。

### Files Modified
- `src/services/inlineCompletionCore.ts`
- `src/services/inlineCompletionCore.test.ts`
- `src/pages/NotesPage.tsx`
- `src/services/api.ts`
- `server-go/internal/handler/inline_completion_handler.go`
- `server-go/internal/service/inline_completion_service.go`
- `server-go/internal/service/inline_completion_service_test.go`
- `server-go/internal/config/config.go`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端单测 | 新增模式识别/过滤后通过 | `npm run -s test -- src/services/inlineCompletionCore.test.ts` 通过（8 tests） | ✅ |
| 前端全量单测 | 无回归 | `npm run -s test` 通过 | ✅ |
| 前端构建 | Notes/接口改动后可编译 | `npm run -s build` 通过 | ✅ |
| Go 回归 | handler/service 新签名后通过 | `go test ./...` 通过 | ✅ |

## Update: 2026-02-25 (Inline 时延压测 + 记忆摘要互通)

### Actions Taken
- 基于真实 NIM key 对 Go `/api/complete` 做端到端时延采样（冷/热）。
- 对比多模型后确认：
  - `qwen/qwen3-next-80b-a3b-instruct` 存在明显长尾（秒级抖动）。
  - `qwen/qwen2.5-coder-32b-instruct` 热路径稳定在 400~700ms 区间。
- 增加轻量互通能力（不引入实时检索）：
  - 前端内联请求增加 `contextSummary`（来自双链摘要 + 记忆摘要）
  - 后端 `/api/complete` 增加 `context_summary` 字段，注入 system prompt（限长裁剪）

### Files Modified
- `server-go/internal/service/inline_completion_service.go`
- `server-go/internal/handler/inline_completion_handler.go`
- `server-go/internal/service/inline_completion_service_test.go`
- `src/services/api.ts`
- `src/pages/NotesPage.tsx`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Notes inline 回归 | 防抖/中断/校验逻辑不回归 | `npm run -s test` 通过 | ✅ |
| 前端构建 | 接口字段扩展后可编译 | `npm run -s build` 通过 | ✅ |
| Go 回归 | 新签名/新字段后服务测试通过 | `go test ./...` 通过 | ✅ |
| `/api/complete` 时延（qwen2.5-coder-32b） | 常态 <1s | p50≈511.6ms, p95≈714.1ms | ✅ |
| `context_summary` 开销 | 额外开销可忽略 | p50 +6ms, p95 基本不变 | ✅ |

## Update: 2026-02-25 (Notes Inline Completion：NIM Chat 非流式链路)

### Actions Taken
- 新增 Go 侧内联补全服务：
  - `server-go/internal/service/inline_completion_service.go`
  - 全局单例 keep-alive `http.Client`（连接池复用 TCP/TLS）
  - 固定 NIM 请求契约：`/v1/chat/completions` + `stream:false` + `temperature=0.1` + `max_tokens=15` + `stop=["\\n\\n","```"]`
- 新增 Go 侧路由与处理器：
  - `server-go/internal/handler/inline_completion_handler.go`
  - `POST /api/complete`（鉴权组）
  - `server-go/cmd/server/main.go` 路由接入
- 前端 `NotesPage` 内联补全改造：
  - 不再通过 SSE 分发路径请求 inline，改为 `notesApi.completeInline(...)`
  - 打字防抖调整为 300ms
  - 请求中断保留（新输入 `abort` 上次请求）
  - 增加括号冲突校验，不合法候选静默丢弃
- 新增前端核心测试模块：
  - `src/services/inlineCompletionCore.ts`
  - `src/services/inlineCompletionCore.test.ts`
  - 补齐 `src/__tests__/setup.ts`

### Files Modified
- `server-go/cmd/server/main.go`
- `server-go/internal/config/config.go`
- `server-go/internal/handler/inline_completion_handler.go`
- `server-go/internal/service/inline_completion_service.go`
- `server-go/internal/service/inline_completion_service_test.go`
- `src/pages/NotesPage.tsx`
- `src/services/api.ts`
- `src/services/inlineCompletionCore.ts`
- `src/services/inlineCompletionCore.test.ts`
- `src/__tests__/setup.ts`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端单测 | 防抖/中断/校验测试通过 | `npm run -s test` 通过（4 tests） | ✅ |
| 前端构建 | Notes 改造后可编译 | `npm run -s build` 通过 | ✅ |
| Go 单测 | 新服务契约测试通过 | `go test ./...` 通过 | ✅ |

## Update: 2026-02-24 (Inline 补全错误文本防污染热修)

### Actions Taken
- 修复内联补全“服务错误提示词”误入 ghost text：
  - 前端新增噪声识别（`AI 服务出现错误 / 请稍后再试 / fallback / error`）并在解析/流处理阶段丢弃。
  - 后端 dispatch 层新增 inline 文本过滤，拦截引擎异常兜底文本不下发到编辑器。
- 重启 `server-py` 生效本次后端热修。

### Files Modified
- `src/pages/NotesPage.tsx`
- `server-py/app/services/ai_dispatcher.py`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | 热修后可编译 | `npm run -s build` 通过 | ✅ |
| Python 语法检查 | dispatcher 语法正常 | `python -m py_compile app/services/ai_dispatcher.py` 通过 | ✅ |
| 服务运行 | 9090 正常监听 | `python -m app.main` 已运行 | ✅ |

## Update: 2026-02-24 (P7 补全智能化：FIM + 本地记忆 + Claude 路由)

### Actions Taken
- 重构 Notes 内联补全提示词为 FIM 协议：
  - 显式 `BEFORE_CURSOR` + `AFTER_CURSOR`
  - 要求模型输出 JSON `{"candidates":[...]}`
- 增加“局部 RAG”上下文注入：
  - 双链目标摘要（同笔记库命中）
  - Shared Memory 摘要（当前相关记忆）
  - 合并后写入 `context_snapshot.referenced_summaries`
- 增强补全结果解析：
  - 支持 JSON candidates、XML `<candidate>`、编号列表兜底
  - 保留首候选作为 ghost text，避免脏文本直接渲染
- 调整后端调度策略：
  - `inline_complete` 强制路由 `fast/claude`（Haiku）
  - 避免 `priority=low` 被错误分流到 OpenAI 低质链路
- 重启 `server-py` 使调度策略即时生效。

### Files Modified
- `src/pages/NotesPage.tsx`
- `server-py/app/services/ai_dispatcher.py`
- `server-py/.run-logs/server-py.log` (runtime log)

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P7） | FIM + 记忆注入变更可编译 | `npm run -s build` 通过 | ✅ |
| Python 语法检查 | dispatcher/main/config 无语法错误 | `python -m py_compile ...` 通过 | ✅ |
| 服务重启验证 | 9090 启动且健康检查可达 | `/health` 正常返回 | ✅ |

## Update: 2026-02-24 (模型默认值调整 + `/models` 实测)

### Actions Taken
- 使用本地 `server-py/.env` 网关配置实测拉取：
  - Anthropic: `GET {base}/v1/models`
  - OpenAI-compatible: `GET {base}/models`
- 基于实测结果调整后端默认模型：
  - `default_model` → `claude-sonnet-4.6`
  - `haiku_model` → `claude-haiku-4.5`
  - `opus_model` → `claude-sonnet-4.6`（无 Opus 权限时 fallback）
  - `openai_default_model` → `qwen/qwen3-next-80b-a3b-instruct`
- 同步更新：
  - `server-py/app/config.py`
  - `server-py/.env`
  - `server-py/.env.example`

### Notes
- 当前容器未安装 `pydantic_settings`，无法在本环境直接运行 Python settings import 做运行期验证；配置文件修改已落盘。

## Update: 2026-02-24 (server-py 重启与模型覆盖逻辑修正)

### Actions Taken
- 重启 `server-py` 时发现首次失败：缺少 `pydantic_settings` 依赖。
- 执行 `python -m pip install -e .` 补齐 `server-py/pyproject.toml` 依赖后恢复启动。
- 修复 `app/main.py` 中模型自动探测覆盖问题：改为“仅在当前配置不可用时才自动回填”。
- 以 `setsid -f python -m app.main` 后台重启并验证服务。

### Runtime Verification
- `GET http://127.0.0.1:9090/health` 返回：
  - `haiku = claude-haiku-4.5`
  - `sonnet = claude-sonnet-4.6`
  - `opus = claude-sonnet-4.6`

### Files Modified
- `server-py/app/main.py`
- `server-py/.run-logs/server-py.log` (runtime log)

## Update: 2026-02-24 (P6 行内替换预览与确认闭环)

### Actions Taken
- 在 `NoteEditor` 增加 `previewInlineReplace` handle，支持 `SearchCursor` 精确匹配 + whitespace 容错匹配。
- 在 `NoteAIPanel` 增加 XML 行内替换解析（`<replace>`），并新增 Accept/Reject 确认卡。
- 自动写入流程改为“inline replace 优先”：命中 XML 时先预览，不再直接 append。
- 在 `NotesPage` 增加行内替换预览状态缓存与应用回调，并打通 AI undo/history/memory 持久链路。
- 发送新请求、切换线程、切换笔记时统一清理行内预览状态，避免跨上下文污染。
- 新增依赖 `@codemirror/search`。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/components/notes/NoteAIPanel.tsx`
- `src/pages/NotesPage.tsx`
- `package.json`
- `package-lock.json`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P6 行内替换） | 新增 inline replace 流程可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P0.1 Notes 编辑器迁移收口)

### Actions Taken
- 用原生 `CodeMirror 6` 重写 `NoteEditor`，替换原 `@mdxeditor/editor` 方案。
- 保留现有 `NotesPage` 的 AI 写入与自动保存接口，不改后端存储格式（仍为 `.md` 原文）。
- 实现 CM6 基础能力：Markdown、行号、撤销/重做、深浅色主题、`[[wikilinks]]` 与 callout 标记高亮。
- 删除 MDX 依赖并清理样式残留（`.pm-note-mdx*` → `.pm-note-cm-editor`）。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/index.css`
- `src/pages/NotesPage.tsx`
- `package.json`
- `package-lock.json`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（CM6 迁移后） | 全量可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (Note Agent 链路核验 + 闭环复核)

### Actions Taken
- 核验 `note-assistant` 实际路由：确认默认引擎是 OpenAI（Qwen），非默认 Claude。
- 核验 OpenAI → Claude 升级接口：`escalate_to_claude` 已在 OpenAI 工具层注入并可触发 `_escalate_query`。
- 核验运行时覆盖能力：`context._runtime` 可强制切换 `engine/engine_model/model_tier`。
- 复核 Notes AI 面板：事务写入阶段提示、工具轨迹、服务端会话历史展示逻辑已接入。
- 执行前端构建验证并通过。

### Files Updated
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（本轮复核） | Notes AI 面板链路可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (Notes AI 面板稳定性 + 流式体验第二轮)

### Actions Taken
- 重构 `NoteAIPanel`：统一 assistant 消息渲染路径，流式阶段也支持 Markdown 输出。
- 分析区改为默认两行预览折叠，支持用户主动展开，减少首屏信息噪音。
- 新增流式长文本窗口化策略（截断前文保留尾部），降低渲染抖动与卡顿。
- 工具轨迹增强：首个事件自动展开，新增“内联写入开始/成功/失败”可见状态。
- 控制块清理增强：流式中自动隐藏未闭合 `pathmind-edit` 片段，避免输出污染。
- `NotesPage` 增加编辑器故障降级组件（可编辑 textarea + 保存），避免“编辑器不可用”阻断。
- Notes 编辑器入口调整为单一路径（移除“高级”语义），降低 chunk 失效导致的降级概率。
- 降级模式改为自动保存，不再要求用户手动点击“保存”。
- AI 写入片段增加外层 ` ```markdown ` 自动解包，修复整篇被代码块包裹的渲染问题。

### Files Modified
- `src/components/notes/NoteAIPanel.tsx`
- `src/pages/NotesPage.tsx`
- `src/components/notes/NoteEditorLite.tsx` (deleted)
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（本轮改动） | 新面板与兜底编辑器可编译 | `npm run -s build` 通过 | ✅ |
| 前端构建（单编辑器语义） | 无混合动态/静态导入冲突 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (Notes 交互与记忆闭环第三轮)

### Actions Taken
- 修复笔记切换串内容根因：切换 `id` 时立即清空 `useNote.note`，并在 `NotesPage` 增加 `noteReady` 守卫，未就绪不挂编辑器。
- 侧栏补齐删除能力：支持单条删除（含当前激活笔记兜底切换/清空）。
- 侧栏补齐拖拽归档：笔记可拖拽到「文件夹」页签中的目标文件夹，调用 `notesApi.update({folder})` 持久化。
- 增加笔记助手会话历史：按 `noteId` 持久化 `messages` 到 localStorage，重开面板不丢对话。
- 打通胶囊 Agent 上下文桥：新增 `agentMemoryBridge`，笔记助手完成后写入摘要，FloatingAgent 在 `/notes` 场景自动注入最近笔记记忆到请求 `context`。
- 笔记侧栏增加过渡动画：列表与文件夹项使用 `motion` layout spring 过渡，降低“硬切”体感。

### Files Modified
- `src/hooks/useNotes.ts`
- `src/components/notes/NoteSidebar.tsx`
- `src/components/notes/NoteAIPanel.tsx`
- `src/components/FloatingAgent.tsx`
- `src/services/agentMemoryBridge.ts` (new)
- `src/pages/NotesPage.tsx`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（第三轮） | 切换/拖拽/记忆链路变更后可编译 | `npm run -s build` 通过 | ✅ |

## Session: 2026-02-23 (Notes UX/P性能热修)

### Current Status
- **Phase:** Notes 用户可感知体验优化（进行中）

### Actions Taken
- 关闭笔记助手默认重编排调用，恢复直连流式响应（避免长时间“思考中”）。
- 修复笔记切换竞态：`useNote` 增加请求序列保护，避免旧请求覆盖新笔记内容。
- 修复切笔记残留自动保存定时器，避免误保存到旧笔记。
- AI 侧栏改为卡片化液态玻璃风格，统一圆角边框与层次。
- 高风险确认由全屏遮罩改为侧栏内联确认卡，避免遮挡主编辑区。
- 工具调用日志改为可折叠面板（默认收起），减少主对话视觉噪音。
- 新增流式“光标”反馈，流式中采用轻量文本渲染，完成后再 Markdown 渲染。
- 新增 AI 侧栏拖拽调宽能力（320~620px）。
- Notes 页面增加编辑器/AI 面板懒加载预热，降低首次进入白屏等待。
- Notes 页主容器改为 `overflow-hidden + min-h-0`，减少整体页面滚动干扰。
- `useAgentStream` 增强错误透传，展示具体 HTTP 状态与简要错误信息。

### Files Modified
- `src/components/notes/NoteAIPanel.tsx`
- `src/pages/NotesPage.tsx`
- `src/hooks/useNotes.ts`
- `src/components/notes/NoteEditor.tsx`
- `src/hooks/useAgentStream.ts`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | Notes 热修后可正常编译 | `npm run -s build` 通过 | ✅ |
| Agent 流式 | 笔记助手应直接流式返回 | `api/agent/stream` 可持续输出 `text` 事件 | ✅ |

## Session: 2026-02-20

### Current Status
- **Phase:** P3-3 - SDK Core + Reliability（进行中）
- **Started:** 2026-02-20

### Actions Taken
- 制定并落地 P0→P1→P2 实施节奏，优先修复中枢一致性问题。
- 完成 builtin 工具缺口修复：补齐 `semantic_search_notes`、`search_similar_code`、`index_student_code` 及 manifest 注册。
- 修复 Go 端 `role` 上下文读取错误（`user_role` → `role`）。
- 在 AgentService 引入 runtime 路由能力：支持 `context._runtime` 控制 `fast/balanced/deep` 与 engine/model 覆写。
- 增加 stream `meta` 事件与 query 运行元数据（engine/model/mode）。
- Claude 引擎接入 `max_budget_usd`（使用现有配置 `agent_max_budget_usd`）。
- 前端 API/hook 增加 runtime 透传能力，并在 `AIInsightButton` 默认启用 fast 模式。
- `useAgentStream` 增加 `meta` 事件消费（onMeta），可透出当前 engine/model/mode。
- 在 `FloatingAgent`、`HomeAIChat`、`AIAdvisor` 三个聊天入口加入 fast/balanced/deep 模式切换 UI。
- 在上述聊天入口展示路由徽标（engine/model/mode），实现双链路运行态可观测。
- `/tools/list` 新增 `tool_details` 元数据（annotations + risk_level），前端可直接消费。
- 为核心 builtin 工具补充 `ToolAnnotations`（readOnly/destructive/idempotent），覆盖 student/mbti/career/document/graph/search/note/experiment/homepage/points。
- `FloatingAgent` 与 `HomeAIChat` MCP 工具面板接入风险徽标（高风险/只读/幂等/外部/未标注）。

### Files Modified
- `server-py/app/tools/builtin/note/tools.py`
- `server-py/app/tools/builtin/note/manifest.yaml`
- `server-py/app/tools/builtin/experiment/tools.py`
- `server-py/app/tools/builtin/experiment/manifest.yaml`
- `server-go/internal/handler/tool_handler.go`
- `server-py/app/services/__init__.py`
- `server-py/app/engines/claude_engine.py`
- `server-py/app/api/agent_routes.py`
- `src/services/api.ts`
- `src/hooks/useAgentStream.ts`
- `src/components/ui/AIInsightButton.tsx`
- `src/components/FloatingAgent.tsx`
- `src/components/homepage/HomeAIChat.tsx`
- `src/pages/AIAdvisor.tsx`
- `server-py/app/api/tool_routes.py`
- `server-py/app/tools/builtin/student/tools.py`
- `server-py/app/tools/builtin/mbti/tools.py`
- `server-py/app/tools/builtin/career/tools.py`
- `server-py/app/tools/builtin/document/tools.py`
- `server-py/app/tools/builtin/graph/tools.py`
- `server-py/app/tools/builtin/search/tools.py`
- `server-py/app/tools/builtin/note/tools.py`
- `server-py/app/tools/builtin/experiment/tools.py`
- `server-py/app/tools/builtin/homepage/tools.py`
- `server-py/app/tools/builtin/points/tools.py`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Agent tools 声明一致性检查 | 所有 agent tool 可注册 | missing_total=0 | ✅ |
| Python 语法检查 | 无语法错误 | 通过 (`py_compile`) | ✅ |
| Go 编译检查 | 可通过编译 | 通过 (`go test ./...`) | ✅ |
| 前端构建 | TS + Vite 构建成功 | 通过 (`npm run build`) | ✅ |
| Python 语法检查（tools/api） | 无语法错误 | 通过 (`py_compile`) | ✅ |
| 前端构建（annotations 风险标识） | TS + Vite 构建成功 | 通过 (`npm run build`) | ✅ |

### Errors
| Error | Resolution |
|-------|------------|
| 无新增错误 | - |

## Update: 2026-02-20 (P2-1 output_format)

### Actions Taken
- 打通 `output_format` 全链路：前端 runtime → Go 代理 → Python service → engine。
- 新增 `advisor_card_v1` 结构化输出预设，服务层支持 preset/custom schema 两种模式。
- OpenAI-compatible 引擎补齐 `output_format` 兼容与 `structured_output` 事件回传。
- AIAdvisor 页面增加结构化建议卡片渲染，保留原 Markdown 流式输出。

### Files Modified
- `server-py/app/services/__init__.py`
- `server-py/app/engines/openai_engine.py`
- `server-py/app/api/agent_routes.py`
- `server-go/internal/service/agent_proxy_service.go`
- `src/services/api.ts`
- `src/hooks/useAgentStream.ts`
- `src/pages/AIAdvisor.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查（P2 output_format） | 无语法错误 | 通过（`py_compile`） | ✅ |
| Go 编译检查（网关字段透传） | 可编译通过 | 通过（`go test ./...`） | ✅ |
| 前端构建（structured card） | TS + Vite 构建成功 | 通过（`npm run build`） | ✅ |

## Update: 2026-02-20 (P2-2 session management)

### Actions Taken
- 完成会话管理全链路：列表、恢复、清理（单条/全部）。
- Python Redis 新增会话索引与元数据存储，stream 完成后自动落库。
- OpenAI stream `done` 增加合成 `session_id`，统一前端恢复行为。
- Go 网关新增 `/api/agent/sessions` DELETE，替换原有 ListSessions 占位实现。
- AIAdvisor 新增会话历史面板，支持恢复会话与清理操作。

### Files Modified
- `server-py/app/services/shared_memory.py`
- `server-py/app/services/__init__.py`
- `server-py/app/api/agent_routes.py`
- `server-py/app/engines/openai_engine.py`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `src/services/api.ts`
- `src/hooks/useAgentStream.ts`
- `src/contexts/AgentSessionContext.tsx`
- `src/pages/AIAdvisor.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查（session management） | 无语法错误 | 通过（`py_compile`） | ✅ |
| Go 编译检查（sessions API） | 可编译通过 | 通过（`go test ./...`） | ✅ |
| 前端构建（AIAdvisor session UI） | TS + Vite 构建成功 | 通过（`npm run build`） | ✅ |

## Update: 2026-02-20 (P2-3 hooks event visualization)

### Actions Taken
- ClaudeEngine 接入 SDK hooks 回调并向 SSE 透出 `hook_event`。
- 事件覆盖权限请求、子任务开始/结束、通知三类。
- `useAgentStream` 新增 hooks 事件解析回调（permission/subtask/notification）。
- AIAdvisor 新增 Hooks 事件流时间线面板，可观察 agent 执行过程。

### Files Modified
- `server-py/app/engines/claude_engine.py`
- `src/hooks/useAgentStream.ts`
- `src/pages/AIAdvisor.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查（hooks events） | 无语法错误 | 通过（`py_compile`） | ✅ |
| Go 编译检查（兼容回归） | 可编译通过 | 通过（`go test ./...`） | ✅ |
| 前端构建（hooks timeline UI） | TS + Vite 构建成功 | 通过（`npm run build`） | ✅ |

## Update: 2026-02-20 (Phase Delivery 收尾)

### Actions Taken
- 完成 `task_plan.md` 的 Phase Delivery 勾选与状态收尾。
- 在 `findings.md` 输出 P0/P1/P2 每阶段变更清单。
- 在 `findings.md` 输出后续实施建议（P3+）与关键风险缓解策略。
- 对齐双链路当前边界：明确 Claude 主链路能力领先项与 OpenAI-compatible 待补齐项。

### Files Modified
- `task_plan.md`
- `findings.md`
- `progress.md`

### Acceptance Summary
| Item | Result |
|------|--------|
| P0 阶段目标 | ✅ 完成 |
| P1 阶段目标 | ✅ 完成 |
| P2 阶段目标 | ✅ 完成 |
| Phase Delivery 文档化交付 | ✅ 完成 |

### Validation Notes
- 本次为文档收尾更新，无新增业务代码变更。
- 代码可用性验证沿用上一轮通过结果：`py_compile`、`go test ./...`、`npm run build` 均已通过。

## Update: 2026-02-20 (P3-1 WebAgent 标准化内核)

### Actions Taken
- 新增 `webagent_protocol` 协议模块，统一 plan schema / orchestrator config / mode 选择规则。
- `AgentService` 新增编排流程：planner（结构化计划）→ executor（执行与工具调用）。
- 在 stream 中新增 `orchestrator` 事件并在 meta 中暴露 `orchestrator_profile`。
- API/Go/前端类型同步扩展 `orchestrator` 字段，实现端到端透传。
- AIAdvisor 默认启用 orchestrator，并将编排结果接入事件时间线。

### Files Modified
- `server-py/app/services/webagent_protocol.py` (new)
- `server-py/app/services/__init__.py`
- `server-py/app/api/agent_routes.py`
- `server-go/internal/service/agent_proxy_service.go`
- `src/services/api.ts`
- `src/hooks/useAgentStream.ts`
- `src/pages/AIAdvisor.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查（P3 services/api） | 无语法错误 | 通过（`py_compile`） | ✅ |
| Go 编译检查（orchestrator 字段透传） | 可编译通过 | 通过（`go test ./...`） | ✅ |
| 前端构建（runtime orchestrator + stream callbacks） | TS + Vite 构建成功 | 通过（`npm run build`） | ✅ |

### Notes
- 本轮为 P3 第一阶段：先标准化协议与编排内核，后续继续推进 SDK 化拆分与多 worker 调度。
- 补充协议草案文档：`docs/webagent-protocol-v1.md`（供后续 SDK 化拆分对齐）。

## Update: 2026-02-20 (P3-2 多 Worker DAG 执行器)

### Actions Taken
- WebAgent 协议升级到 DAG 语义（`nodes + depends_on`），并新增 `max_workers` 并发控制。
- AgentService 新增多 worker 编排执行链路：
  - planner 生成 DAG
  - layer 拓扑分层
  - 层内并发 worker 执行
  - final synthesizer 汇总输出
- 新增 worker 级执行事件：`layer_start/layer_done/worker_start/worker_done`。
- query 响应补充 worker 执行摘要，stream 事件补充编排阶段细粒度状态。
- 前端 runtime/hook/AIAdvisor 对齐 DAG 编排参数与事件可视化。
- 补充协议草案更新：`docs/webagent-protocol-v1.md`（从线性步骤更新为 DAG）。

### Files Modified
- `server-py/app/services/webagent_protocol.py`
- `server-py/app/services/__init__.py`
- `server-py/app/api/agent_routes.py`
- `server-go/internal/service/agent_proxy_service.go`
- `src/services/api.ts`
- `src/hooks/useAgentStream.ts`
- `src/pages/AIAdvisor.tsx`
- `docs/webagent-protocol-v1.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查（P3-2 DAG） | 无语法错误 | 通过（`py_compile`） | ✅ |
| Go 编译检查（orchestrator 扩展字段） | 可编译通过 | 通过（`go test ./...`） | ✅ |
| 前端构建（DAG 事件 + runtime 参数） | TS + Vite 构建成功 | 通过（`npm run build`） | ✅ |

### Notes
- P3 已进入“可用 DAG 多 worker”阶段；下一步重点是拆分 `webagent_core` 并形成稳定 SDK 导出接口。

## Update: 2026-02-20 (Expert Reports Synthesis → P3-3 Planning)

### Actions Taken
- 深读 4 份专家报告并交叉对齐当前已落地能力（P3-2 DAG 多 worker）。
- 提炼跨报告一致结论：当前短板集中在“工具边界、可靠性、外部 MCP、前端接入覆盖”。
- 将下一阶段明确为 P3-3（核心抽象+可靠性）与 P3-4（外部 MCP+生态接入）。
- 将上述结论同步回 `task_plan.md` 与 `findings.md`，形成执行基线。

### Proposed Next Execution (Ready)
1. P3-3A: `node.tools` 白名单执行 + worker retry/backoff + timeout/budget guard
2. P3-3B: 抽取 `webagent_core`（protocol/orchestrator/contracts）
3. P3-3C: Agent Catalog API + 前端 Agent Hub（8 agents 可发现/可切换）
4. P3-4: 外部 MCP stdio/SSE + `mcp_servers.yaml`

### Notes
- 发现 `webagent-evolution-roadmap.md` 文件尾部疑似截断，后续需补全。
- 本轮为设计与规划同步，无新增业务代码变更与构建回归。

## Update: 2026-02-20 (P3-3 启动：可靠性与 Catalog API)

### Actions Taken
- 执行 P3-3A：
  - 编排 runtime 新增 `worker_timeout_s / worker_max_retries / worker_retry_backoff_ms / max_budget_usd`。
  - worker 执行支持 `node.tools` 白名单约束。
  - worker 新增 timeout + retry(backoff) + budget guard 机制。
  - 新增编排事件：`worker_retry`、`budget_exhausted`。
- 执行 P3-3C（后端/网关/API 对齐）：
  - 新增 `GET /agent/list` 与 `GET /agent/{name}/capabilities`。
  - Go 代理层补齐 capabilities 透传。
  - 前端 API 增加 `agentApi.capabilities()`。
- 前端编排可视化同步：
  - hook 增加 retry/budget/cost/tools 解析。
  - AIAdvisor 时间线展示 retry 与预算耗尽事件。

### Files Modified
- `server-py/app/services/webagent_protocol.py`
- `server-py/app/services/__init__.py`
- `server-py/app/api/agent_routes.py`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `src/services/api.ts`
- `src/hooks/useAgentStream.ts`
- `src/pages/AIAdvisor.tsx`
- `docs/webagent-protocol-v1.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查（P3-3 services/api/protocol） | 无语法错误 | 通过（`py_compile`） | ✅ |
| Go 编译检查（catalog/capabilities 透传） | 可编译通过 | 通过（`go test ./...`） | ✅ |
| 前端构建（orchestrator 新字段与事件） | TS + Vite 构建成功 | 通过（`npm run build`） | ✅ |

### Notes
- P3-3 目前进入进行中：P3-3B 随后已完成，下一步转入 P3-4。


## Update: 2026-02-20 (P3-3B webagent_core 抽象)

### Actions Taken
- 抽离 `webagent_core` 包边界，拆分为 `protocol/runtime/contracts/orchestrator` 四类模块。
- `AgentService` 的编排导入切换到 `app.services.webagent_core`。
- `webagent_protocol.py` 改为兼容 shim，保证旧导入路径不破坏。
- worker trace/tool whitelist helper 下沉到 `webagent_core/orchestrator.py`，服务层通过委托调用。

### Files Modified
- `server-py/app/services/webagent_core/__init__.py`
- `server-py/app/services/webagent_core/protocol.py`
- `server-py/app/services/webagent_core/runtime.py`
- `server-py/app/services/webagent_core/contracts.py`
- `server-py/app/services/webagent_core/orchestrator.py`
- `server-py/app/services/webagent_protocol.py`
- `server-py/app/services/__init__.py`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Notes
- P3-3 三个子目标（A/B/C）目前均已完成；下一阶段进入 P3-4（外部 MCP + 生态接入）。

## Update: 2026-02-20 (P3-4 第一里程碑：External MCP + Unified Registry)

### Progress
- ✅ 已完成外部 MCP 配置加载与统一注册（builtin/custom/external）。
- ✅ 已打通 Claude SDK 的 external MCP 路由（`allowed_tools` 映射 + `mcp_servers` 合并）。
- ✅ 已提供 `/tools/health` 诊断接口与 `mcp_servers.yaml.example`。
- ⏳ 待完成：前端 Agent Hub 全量接入、OpenAI external MCP 直连执行器。

### Implementation Snapshot
- 新增 `ExternalMcpManager`（配置解析、ENV 展开、健康检查、registry package 输出）。
- ToolRegistry 增加 MCP 名称映射与反向解析，权限回调可识别 `mcp__<server>__<tool>`。
- Tool API 新增 external 元数据透出（`mcp_name`, `mcp_server`, `engine_support`）。
- FastAPI 启动时预热 registry，降低首次请求延迟。

### Validation
- `python3 -m py_compile ...` ✅
- `cd server-go && go test ./...` ✅
- `npm run build` ✅

### Risk / Next
- 风险：OpenAI 链路当前不直接执行 external MCP（依赖下一步执行器实现）。
- 下一步建议：
  1. 实现 OpenAI external MCP adapter（stdio 优先，SSE 次之）
  2. AIAdvisor 引入显式 Agent Hub 切换 + capability 标签
  3. 将 external MCP config/schema 文档化并纳入 SDK export contract

## Update: 2026-02-20 (P3-4.2 已推进)

### 完成项
- ✅ OpenAI external MCP adapter（stdio 首版）已接入。
- ✅ OpenAIEngine 已支持 external tool 识别并调用 adapter。
- ✅ AIAdvisor 已升级为动态 Agent Hub（agent list/capabilities + 手动切换）。

### 用户可感知变化
- AIAdvisor 右上角新增 Agent 选择器，可在自动路由与具体 agent 间切换。
- 选中 agent 后可见其 engine 与工具数，帮助理解“快慢模型 + 工具能力”差异。
- OpenAI 链路在 external MCP（stdio）场景可直接执行，不再仅是占位提示。

### 验证
- `python3 -m py_compile ...` ✅
- `cd server-go && go test ./...` ✅
- `npm run build` ✅

### 下一步
1. 完成 OpenAI external MCP 的 SSE/HTTP 传输适配。
2. 将 Agent Hub 选择状态下沉为全局上下文（FloatingAgent/AIAdvisor 共享）。
3. 为 external tool 增加调用追踪事件（SSE timeline 中可视化 server/tool）。

## Update: 2026-02-20 (P3-4 完成)

### 完成项
- ✅ OpenAI external MCP 传输补齐：`stdio + http + sse`。
- ✅ `/tools/list` 的 external `engine_support` 元数据动态化。
- ✅ P3-4 全部子项完成，阶段状态转为 complete。

### 技术说明
- HTTP 路径支持 JSON/SSE 混合响应，并保留 `Mcp-Session-Id` 会话头。
- SSE 路径实现 endpoint discovery + queue response matching。
- OpenAI tool call 对 external/internal 分流保持兼容，不影响既有内部工具链。

### 验证
- `python3 -m py_compile ...` ✅
- `cd server-go && go test ./...` ✅
- `npm run build` ✅

## Update: 2026-02-21 (v2 报告复核与下一阶段计划)

### Actions Taken
- 完整复核 `docs/webagent-evolution-reports-v2/` 四份第二轮评估报告。
- 对照当前代码主干，完成“已完成/过时/仍待解决”三类结论归档。
- 将下一阶段实施方向写回 `task_plan.md`（新增 P4 Productization + SDK）。

### Key Outcomes
- 明确：当前系统在 **WebAgent 编排 + 双链路引擎 + 外部 MCP** 上已进入可用成熟区间。
- 明确：真正限制上线和 SDK 化的短板已收敛到三类：
  1) 稳定性治理（限流/熔断/监控）
  2) 性能治理（缓存/并发/embedding 路径）
  3) SDK 产品化（DataAdapter/多租户/文档测试）
- 明确：后续推进采用 `P4-1 → P4-2 → P4-3` 顺序，避免先做高级智能却受底座限制。

### Files Updated
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
- 本轮为评估与计划同步，未改动业务代码。
- 暂未触发构建/测试回归（下一次进入 P4 实施时统一执行）。

## Update: 2026-02-21 (P4-1A 完成：限流 + 连接治理 + 熔断)

### Actions Taken
- 为 Go API 网关新增 Agent 侧限流中间件（鉴权用户与公开接口分流策略）。
- 为 AgentProxy 新增连接池、header timeout、request timeout 配置化能力。
- 为 AgentProxy 新增轻量熔断器和统一 `doRequest` 防护路径。
- 将上游不可用错误映射为 503（含 Query/Stream/PublicStream/List/Skills 等路径）。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建与测试通过 | 通过 | ✅ |

### Next
1. P4-1B: Python 侧 worker 并发与启动参数标准化。
2. P4-1C: 接入可观测指标（429/503/latency/circuit state）。
- 补充回归：`python3 -m py_compile server-py/app/main.py server-py/app/api/agent_routes.py server-py/app/config.py` ✅

## Update: 2026-02-21 (P4-1B 完成：Python 并发参数化)

### Actions Taken
- Python Agent 服务新增 Uvicorn 并发与超时参数（环境变量驱动）。
- `__main__` 启动逻辑支持多 worker，并在 debug 下自动降为单 worker。
- Docker 启动入口改为 `python -m app.main`，保证容器与本地启动行为一致。
- `.env.example` 补全 PATHMIND_UVICORN_* 参数。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/app/main.py server-py/app/config.py` | Python 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | 网关侧改动无回归 | 通过 | ✅ |

### Next
1. P4-1C: 增加 429/503/circuit 状态指标埋点。
2. P4-2: 进入 embedding/RAG 缓存落地与压测基线建设。

## Update: 2026-02-21 (P4-1C 完成：Agent 指标采集与查询)

### Actions Taken
- 新增 in-memory 指标采集器（global/protected/public 三级视图）。
- 新增 AgentMetricsMiddleware，采集每次请求的状态码与延迟。
- 将熔断状态迁移写入指标（closed/open/half_open）。
- 新增受保护 metrics 查询接口：`GET /api/agent/metrics`。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建与测试通过 | 通过 | ✅ |
| `python3 -m py_compile server-py/app/main.py server-py/app/config.py` | Python 语法通过 | 通过 | ✅ |

### Next
1. P4-2: embedding/RAG 缓存实现。
2. P4-2: 建立压测基线与容量观测脚本。


## Update: 2026-02-21 (P4-2A 完成：缓存骨架接入)

### Actions Taken
- 新增 Python 侧 Redis CacheService（embedding/rag_query + hit/miss 统计）。
- EmbeddingClient 接入 query/passage 缓存，保留批量回源能力。
- RAGService.query 接入查询缓存并在 miss 后回填。
- `/health` 新增缓存指标快照，支持快速诊断命中率与 TTL 配置。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/app/config.py server-py/app/services/cache_service.py server-py/app/rag/embedding.py server-py/app/services/rag_service.py server-py/app/main.py` | Python 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 网关无回归 | 通过 | ✅ |

### Next
1. P4-2B: 扩展 note/unified search 缓存。
2. P4-2C: 建立缓存命中率 + 延迟压测基线。

## Update: 2026-02-21 (P4-2B 完成：检索缓存覆盖)

### Actions Taken
- 将 note semantic search 纳入 Redis 缓存（服务层）。
- 将 unified_search（builtin + mcp 两条链路）纳入 Redis 缓存。
- 扩展缓存统计维度到 `note_search` 与 `unified_search`。
- 补齐 `.env.example` 的 note/unified 缓存开关与 TTL。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/app/config.py server-py/app/services/cache_service.py server-py/app/services/note_embedding.py server-py/app/tools/builtin/search/tools.py server-py/app/mcp_tools/search_tools.py server-py/app/services/rag_service.py server-py/app/rag/embedding.py server-py/app/main.py` | Python 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 无回归 | 通过 | ✅ |

### Next
1. P4-2C: 设计压测脚本（无缓存 vs 预热缓存）。
2. P4-2C: 输出命中率、P95、QPS 基线报告。

## Update: 2026-02-21 (P4-2C 进行中：基线压测脚本交付)

### Actions Taken
- 交付 `benchmark_cache_baseline.py`（cold/warm 双阶段 + 自动报告生成）。
- 交付压测 runbook 与样本查询集。
- 完成脚本 dry-run 与语法回归验证。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/scripts/benchmark_cache_baseline.py` | 脚本语法通过 | 通过 | ✅ |
| `python3 server-py/scripts/benchmark_cache_baseline.py --dry-run` | 参数与流程可运行 | 通过 | ✅ |
| `python3 -m py_compile server-py/app/config.py server-py/app/services/cache_service.py server-py/app/services/note_embedding.py server-py/app/tools/builtin/search/tools.py server-py/app/mcp_tools/search_tools.py server-py/scripts/benchmark_cache_baseline.py server-py/app/services/rag_service.py server-py/app/rag/embedding.py server-py/app/main.py` | Python 无语法回归 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 无回归 | 通过 | ✅ |

### Next
1. 在联调环境执行标准压测命令，生成首版 JSON/MD 基线报告。
2. 回填 cold/warm 的 P95/QPS 提升幅度，完成 P4-2C 收口。

## Update: 2026-02-21 (P4-2C 首版基线已跑通)

### Actions Taken
- 使用项目虚拟环境执行了 P4-2C 标准压测脚本（iterations=1）
- 成功输出 JSON 与 Markdown 报告文件
- 修复脚本中的 UTC 弃用警告（`datetime.utcnow` → `datetime.now(UTC)`）

### Artifacts
- `docs/perf-baselines/p4-2c-cache-baseline-20260221-051712.json`
- `docs/perf-baselines/p4-2c-cache-baseline-20260221-051712.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `server-py/.venv/bin/python server-py/scripts/benchmark_cache_baseline.py --iterations 1 --queries-file docs/perf-baselines/queries-sample.txt --cases rag_query note_search unified_builtin unified_mcp` | 脚本端到端执行并产出报告 | 通过 | ✅ |
| `python3 -m py_compile server-py/scripts/benchmark_cache_baseline.py` | 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 无回归 | 通过 | ✅ |

### Next
1. 以 `iterations=3~5` 在稳定联调环境复测，产出正式容量基线。
2. 进入 P4-3：SDK 边界收口与接口文档化。


## Update: 2026-02-21 (P4-3A 完成：SDK 边界契约首版)

### Actions Taken
- 新增 `webagent_core` 契约扩展：
  - `TenantContext` / `ArtifactContract` / `WorkerArtifact`
  - `parse_tenant_context()` / `compact_tenant_context()` / `infer_artifact_contract()`
- 新增 `DataAdapter` 抽象层与默认实现：
  - `DataAdapter` Protocol
  - `HttpDataAdapter`
  - `get_data_adapter()` / `set_data_adapter()` 注入机制
- Orchestrator worker 产物标准化：
  - worker artifact 增加 `artifact` 字段（kind/mime/value/uri）
  - worker trace 摘要新增 `artifact_type`、`artifact_uri`
- 工具层首批迁移到适配器：
  - `builtin/student/tools.py`
  - `builtin/homepage/tools.py`
  - `builtin/note/tools.py`（含 `TenantContext` 构造）
- 文档与示例：
  - `docs/webagent-protocol-v1.md` 新增 P4-3 SDK Boundary 章节
  - `server-py/examples/webagent_sdk_boundary_example.py`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/app/services/webagent_core/contracts.py server-py/app/services/webagent_core/data_adapter.py server-py/app/services/webagent_core/__init__.py server-py/app/services/webagent_core/orchestrator.py server-py/app/services/webagent_protocol.py server-py/app/services/__init__.py server-py/app/tools/builtin/student/tools.py server-py/app/tools/builtin/homepage/tools.py server-py/app/tools/builtin/note/tools.py server-py/examples/webagent_sdk_boundary_example.py` | 语法与导入通过 | 通过 | ✅ |

### Next
1. P4-3B：tenant context 贯穿 query/stream 响应元数据。
2. P4-3C：补齐 SDK quickstart + API reference（面向独立打包）。

### Notes
- 运行时 import smoke check 受当前容器依赖缺失影响（`pydantic_settings` 未安装），已改用 `py_compile` 完成本轮校验；运行时联调需在完整依赖环境执行。

## Update: 2026-02-21 (P4-3B 完成：Tenant Context 全链路)

### Actions Taken
- `AgentService` 已完成 tenant context 全链路透传：
  - `_split_context_and_runtime` 支持 `_tenant` / `tenant` 双 key 解析。
  - `query` 返回新增 `tenant`。
  - stream `meta` 与 `orchestrator` 事件新增 `tenant`。
  - planner/executor/worker 调用链统一传递 `tenant_context`。
  - system prompt 新增租户上下文注入。
- `agent_routes` 协议模型更新：
  - `AgentQueryResponse` 新增 `tenant` 字段。
  - 请求示例新增 `_tenant` 说明（与 `_runtime` 同级）。
- `docs/webagent-protocol-v1.md` 新增 P4-3B 协议段落。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/app/services/__init__.py server-py/app/api/agent_routes.py` | 语法与导入通过 | 通过 | ✅ |

### Next
1. P4-3C：输出 `webagent_core` API reference + quickstart。
2. P4-3D：前端类型补齐（tenant/artifact）并完成演示流。

## Update: 2026-02-21 (P4-3C/P4-3D 完成：文档 + 前端类型收口)

### Actions Taken
- 文档交付：
  - 新增 `docs/webagent-sdk-reference-v1.md`
  - 新增 `docs/webagent-sdk-quickstart.md`
  - `docs/webagent-protocol-v1.md` 新增 P4-3C 交付段落
- 前端类型与解析：
  - `src/services/api.ts`
    - 新增 `AgentTenantContext`、`AgentQueryResponse`、`AgentOrchestrator*` 类型
    - `buildAgentContext` 支持 `tenant -> _tenant` 映射
  - `src/hooks/useAgentStream.ts`
    - `meta/orchestrator` 增加 `tenant` 解析
    - `orchestrator` 增加 `artifactType/artifactUri`
  - `src/pages/AIAdvisor.tsx`
    - `sendMessage` 传入 `tenant`（`student:<id>`）
    - runtime badge 增加 tenant 显示
    - worker done 时间线增加 artifact 类型提示
- 后端事件补齐：
  - `server-py/app/services/__init__.py` 的 `worker_done` 事件新增 `artifact_type` / `artifact_uri`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/app/services/__init__.py server-py/app/api/agent_routes.py server-py/app/services/webagent_core/contracts.py server-py/app/services/webagent_core/data_adapter.py server-py/app/services/webagent_core/orchestrator.py` | Python 语法通过 | 通过 | ✅ |
| `npm run build` | 前端类型/构建通过 | 通过（含 chunk size warning） | ✅ |

### Notes
- Vite 的 chunk size 为提示级告警（非阻断），不影响本轮交付有效性。

## Update: 2026-02-21 (P4-3E 完成：Go Proxy Query Response 对齐)

### Actions Taken
- `server-go/internal/service/agent_proxy_service.go`
  - `AgentQueryResponse` 新增：
    - `Tenant interface{} \`json:"tenant,omitempty"\``
- 由于 Go 代理采用结构体 decode + 原样 JSON 返回，新增字段可直接透传至前端。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建与测试通过 | 通过 | ✅ |

### Next
1. P4-4A：SDK release contract（版本策略/兼容策略/弃用策略）。
2. P4-4B：SDK 打包清单（core exports + docs + examples）。

## Update: 2026-02-21 (P4-4A/B 完成：SDK 产品化规则)

### Actions Taken
- 新增发布契约文档：`docs/webagent-sdk-release-contract-v1.md`
- 新增打包清单文档：`docs/webagent-sdk-packaging-checklist-v1.md`
- 新增契约校验脚本：`server-py/scripts/verify_webagent_core_contract.py`
  - AST 静态解析 `__all__`，避免运行时依赖影响
  - 校验 `webagent_core` 与 `webagent_protocol` shim 的必备导出
- 协议文档新增 P4-4A/B 里程碑段落：`docs/webagent-protocol-v1.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 server-py/scripts/verify_webagent_core_contract.py` | 必备导出不缺失 | PASS | ✅ |
| `python3 -m py_compile server-py/scripts/verify_webagent_core_contract.py` | 脚本语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 回归通过 | 通过 | ✅ |

### Notes
- contract-check 对“额外导出”仅提示不阻断，保持 MINOR 版本的扩展弹性。

## Update: 2026-02-21 (P4-4C 完成：Release Gate 统一脚本)

### Actions Taken
- 新增脚本：`scripts/check_webagent_release.sh`
  - quick: contract-check + py_compile + go test
  - full: quick + frontend build
- 新增 npm 命令：
  - `check:webagent`
  - `check:webagent:full`
- 文档同步：
  - `docs/webagent-sdk-release-contract-v1.md`
  - `docs/webagent-sdk-packaging-checklist-v1.md`
  - `docs/webagent-protocol-v1.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `bash scripts/check_webagent_release.sh` | quick 门禁全通过 | PASS | ✅ |


## Update: 2026-02-21 (P4-5A/B 执行记录)

### Actions Taken
- 修复 `server-py/app/services/__init__.py` 中 P4-5 新增 prompt 构造函数语法问题，恢复可编译状态。
- 确认 `AgentService` 的 `query/stream` 均接入 `_run_orchestration_loop`（Critique + Replan 共用链路）。
- 扩展前端 runtime 参数与协议类型：
  - `src/services/api.ts`
  - `src/hooks/useAgentStream.ts`
  - `src/pages/AIAdvisor.tsx`
- AIAdvisor 新增 3 类编排阶段可视化：
  - `critique_done`
  - `replan_start`
  - `replan_done`
- 更新协议文档 `docs/webagent-protocol-v1.md`（runtime/query/stream 均补齐新字段）。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/app/services/__init__.py server-py/app/services/webagent_core/protocol.py` | 后端语法通过 | 通过 | ✅ |
| `npm run build` | 前端 TS + Vite 构建通过 | 通过 | ✅ |
| `npm run check:webagent` | WebAgent quick gate 通过 | 通过 | ✅ |

### Notes
- 当前 P4-5 已形成“planner → worker DAG → critique → replan(optional) → synthesize”闭环。
- 下一步建议补充前端聚合指标（replan 轮次、critique 分数趋势）以便调参。

## Update: 2026-02-21 (P4-5C/D 执行记录)

### Actions Taken
- `src/pages/AIAdvisor.tsx`
  - 新增编排策略模板（`Fast/Balanced/Deep`）与参数映射配置。
  - 新增 `OrchestratorStats` 状态机，按 SSE 事件实时聚合 critique/replan 指标。
  - 新增事件面板统计卡（Pass Rate、Avg Score、Replan 成败、Round、Budget）。
  - 发送请求时基于模板生成 orchestrator runtime，而非硬编码单一参数组。
- 同步对话重置逻辑：新对话/新发送时清空本轮 orchestrator 统计。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端构建通过 | 通过（含 chunk warning） | ✅ |

### Notes
- 本轮完成后，前端已具备“策略选择 + 执行反馈 + 质量统计”闭环。
- 当前统计是会话内实时视角；跨会话趋势需后续接后端指标存储。

## Update: 2026-02-21 (P5-P0 实施日志)

### Actions Taken
- 新增 Python coding 模块：
  - `server-py/app/tools/builtin/coding/manifest.yaml`
  - `server-py/app/tools/builtin/coding/tools.py`
  - `server-py/app/services/coding_sandbox.py`
  - `server-py/app/services/coding_runtime.py`
  - `server-py/app/services/approval_broker.py`
  - `server-py/app/services/audit_client.py`
  - `server-py/app/services/coding_policy.py`
  - `server-py/app/services/agent_request_context.py`
- 修改 Claude/OpenAI 引擎审批与审计逻辑：
  - `server-py/app/engines/claude_engine.py`
  - `server-py/app/engines/openai_engine.py`
- 扩展 Agent API：
  - `server-py/app/api/agent_routes.py`
- 扩展 Agent runtime/context 注入：
  - `server-py/app/services/__init__.py`
- 新增 Go 审计落库链路：
  - `server-go/internal/models/agent_audit.go`
  - `server-go/internal/handler/agent_audit_handler.go`
  - `server-go/migrations/006_agent_action_audit.sql`
  - `server-go/internal/service/agent_proxy_service.go`
  - `server-go/internal/handler/agent_handler.go`
  - `server-go/cmd/server/main.go`
  - `server-go/internal/database/database.go`
- 前端接入 coding+审批：
  - `src/services/api.ts`
  - `src/hooks/useAgentStream.ts`
  - `src/pages/AIAdvisor.tsx`
- 新增 coding agent：
  - `server-py/app/agents/registry.py`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile` (P5 相关 Python 文件) | 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端构建通过 | 通过（含 chunk warning） | ✅ |

### Notes
- 本轮为 P5-P0 主体落地 + P1/P2 部分先行抽象。
- run 级 scratchpad、多会话统计持久化、external MCP 风险映射将放入下一轮。

### Additional Gate
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run check:webagent` | quick release gate 通过 | 通过（contract-check/python-compile/go-test） | ✅ |

## Update: 2026-02-21 (P5-P1-2/P1-3 实施日志)

### Actions Taken
- 新增 run 级记忆模块：
  - `server-py/app/services/run_scratchpad.py`
- `AgentService` 接入 scratchpad 生命周期与提示注入：
  - `server-py/app/services/__init__.py`
- 双链路记忆写入：
  - `server-py/app/engines/openai_engine.py`（文本/工具结果/升级链路记忆 + tool retry）
  - `server-py/app/engines/claude_engine.py`（审批结果/工具调用/流式文本记忆）
- 策略治理增强：
  - `server-py/app/services/coding_policy.py`（高风险并发闸门 + 低风险重试策略）
  - `server-py/app/tools/builtin/coding/tools.py`（高风险工具统一并发槽）
- 审批指标：
  - `server-py/app/services/approval_broker.py`
  - `server-py/app/api/agent_routes.py`（`GET /agent/approvals/metrics`）
- 配置与示例环境：
  - `server-py/app/config.py`
  - `server-py/.env.example`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile` (P5-P1 相关文件) | 语法通过 | 通过 | ✅ |
| `npm run check:webagent` | quick gate 通过 | PASS | ✅ |

### Notes
- P1-2（跨链路 run scratchpad）已落地。
- P1-3（高风险并发上限 + 低风险重试 + 审批指标）已落地。


## Update: 2026-02-21 (P5-P2-2 收尾：前端回退事件接入 + 全链路验证)

### Actions Taken
- 完成 external MCP 风险/回退链路收尾验证（Python/Go/前端）。
- `useAgentStream` 新增 `tool_retry`、`tool_fallback` 事件解析，并透传到既有 `onToolCall` 回调。
- `ToolCallEvent` 扩展字段：`attempt/maxAttempts/reason/stage`。
- `AIAdvisor` 新增工具事件时间线：
  - 工具重试（含轮次与原因）
  - external 失败后 fallback 到 builtin 的可视化提示。

### Files Modified
- `src/hooks/useAgentStream.ts`
- `src/pages/AIAdvisor.tsx`
- `task_plan.md`
- `progress.md`
- `findings.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/app/config.py server-py/app/services/coding_policy.py server-py/app/tools/external/manager.py server-py/app/engines/openai_engine.py server-py/app/api/agent_routes.py server-py/app/services/approval_broker.py` | Python 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run check:webagent` | quick gate 通过 | PASS | ✅ |
| `npm run build` | 前端构建通过 | 通过（含 chunk warning） | ✅ |

### Notes
- P5-P2-2 已进入可交付状态，当前仅剩 P2-3 文档化收口（quickstart/runbook/API reference）。


## Update: 2026-02-21 (P5-P2-3 实施日志：文档化收口)

### Actions Taken
- 新增 Coding Quickstart：`docs/webagent-coding-quickstart-v1.md`
- 新增 Coding 安全 Runbook：`docs/webagent-coding-security-runbook-v1.md`
- 新增 Coding API Reference：`docs/webagent-coding-api-reference-v1.md`
- `docs/webagent-protocol-v1.md` 增加 P5-P2-3 里程碑与文档索引
- 回写 `docs/claude-code-web-enhancement-plan.md` 当前实施状态
- 回写 `task_plan.md`，标记 P2-3 完成

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 文档与实现一致性核对（代码对读） | 字段/接口/事件与源码一致 | 已完成 | ✅ |

### Notes
- 本轮仅文档资产交付，无业务代码改动。
- P5（P0→P2）已形成“可运行 + 可治理 + 可交付”的完整闭环。


## Update: 2026-02-21 (P6-1 实施日志：策略模板化 + 热更新)

### Actions Taken
- 新增 `server-py/app/services/coding_policy_profiles.py`：
  - 版本化 JSON 策略模板加载（`version/default_profile/profiles`）
  - mtime 热重载（文件变更后下一请求自动生效）
  - 配置缺失或解析失败时回退到 settings 默认策略
- 扩展 runtime：`context._runtime.coding.policy_profile`
  - `server-py/app/services/coding_runtime.py`
  - 前端类型/透传：`src/services/api.ts`
- 策略接入执行链路：
  - `server-py/app/services/coding_policy.py`
  - `server-py/app/services/approval_broker.py`
  - `server-py/app/engines/openai_engine.py`
  - `server-py/app/engines/claude_engine.py`
- 新增策略快照接口：
  - Python: `GET /agent/coding/policies`
  - Go Proxy: `GET /api/agent/coding/policies`
  - Frontend API: `agentApi.codingPolicies()`
- 新增模板示例：`server-py/coding_policy_profiles.json.example`
- 文档同步：quickstart/runbook/api-reference 增加 `policy_profile` 与策略快照接口说明

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 -m py_compile server-py/app/config.py server-py/app/services/coding_runtime.py server-py/app/services/coding_policy_profiles.py server-py/app/services/coding_policy.py server-py/app/services/approval_broker.py server-py/app/engines/openai_engine.py server-py/app/engines/claude_engine.py server-py/app/api/agent_routes.py` | Python 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端构建通过 | 通过（含 chunk warning） | ✅ |
| `npm run check:webagent` | quick gate 通过 | PASS | ✅ |

### Notes
- 本轮完成 P6-1 后，策略从“环境变量散点配置”升级为“可版本化模板 + 运行时按请求切换”。


## Update: 2026-02-21 (P6-2 实施日志：AIAdvisor 策略模板 UI 收口)

### Actions Taken
- `src/pages/AIAdvisor.tsx` 新增 coding 策略模板加载与状态管理：
  - `codingPolicyProfile` / `codingPolicyOptions` / `codingPolicyVersion`
  - `codingPolicyLoading` / `codingPolicyError`
  - `loadCodingPolicies()`（读取 `/api/agent/coding/policies`）
- 首次进入页面与切换到 Coding 模式时自动拉取策略快照，并支持手动刷新。
- Coding 请求 runtime 去除硬编码，改为动态透传：`runtime.coding.policyProfile = codingPolicyProfile`。
- Coding 模式顶部新增液态玻璃风格控件：
  - Workspace 输入（带显式 label）
  - Policy 选择器（动态选项）
  - 策略源状态 chip（`source_version`）
  - 策略加载失败提示 chip
- 交互细节：流式执行中禁用策略切换与刷新按钮，避免运行中配置漂移。

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- P6 从“后端可切换策略”升级为“前后端可见可控策略”，coding 治理闭环进一步完整。
- 下一步建议进入 P6-3：策略效果指标回流（审批率/超时率/fallback 率）与回归用例自动化。


## Update: 2026-02-21 (P6-3 实施日志：治理指标面板)

### Actions Taken
- `src/pages/AIAdvisor.tsx` 新增 coding run 级指标状态：
  - `toolCalls/toolRetries/toolFallbacks`
  - `approvalRequests/approvalApproved/approvalRejected/approvalTimeouts`
- 复用现有 API：`agentApi.approvalMetrics()`，接入审批全局快照（pending/approved/rejected/timed_out/avg_wait_ms）。
- 指标刷新策略：
  - 首次进入页面预取审批快照；
  - Coding + 事件面板开启时每 15 秒轮询；
  - 支持手动“刷新指标”；
  - 审批决策提交、审批结果回流、任务 `done` 后自动刷新。
- 事件面板新增治理统计卡：
  - Approval（通过率）
  - Timeout（超时率 + 平均等待）
  - Fallback（run 级回退率）
  - Run Approval（本轮审批通过率）

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 本轮未新增后端接口：`/agent/approvals/metrics` 已可满足 P6-3 首版需求。
- 下一步建议补“策略切换自动回归”脚本，把关键比率做阈值断言。


## Update: 2026-02-21 (P6-UX 实施日志：实验/笔记/PDF 统一可视)

### Actions Taken
- 新增共享组件：`src/components/agent/AgentClusterBoard.tsx`
  - 液态玻璃视觉容器 + 分阶段动画（planner/gather/act/synthesize）
  - 接入真实 `useAgentStream` 回调（meta/orchestrator/done）
  - 支持“启动探针/停止”与事件、输出可视
- 实验区升级：`src/pages/ExperimentsPage.tsx`
  - 统一液态玻璃头部
  - 接入 coding 探针看板（`web-coder`）
- 笔记区升级：`src/pages/NotesPage.tsx`
  - 顶栏升级为液态玻璃动画样式
  - 新增可开关集群看板（`note-assistant`）
- 新增 PDF 工作台：`src/pages/DocumentsPage.tsx`
  - 文档暂存区（前端多文件选择）
  - 文档工作流动作区（摘要/关键概念/沉淀笔记/导出建议）
  - 集群探针看板（`document-reader`）
- 路由与导航接入：
  - `src/App.tsx` 新增 `/documents`
  - `src/components/DashboardLayout.tsx` 新增“PDF 工作台”导航项

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 当前 PDF 工作台是“前端工作流可视 + Agent 编排探针”版本，用于验证用户侧体验闭环。
- 下一步可直接接 P6-UX-2：PDF 上传解析、知识抽取、笔记落库与导出链路。


## Update: 2026-02-21 (P6-UX-2 实施日志：PDF 工作台后端闭环)

### Actions Taken
- `src/pages/DocumentsPage.tsx` 重构为真实后端工作台：
  - 文档列表：`documentsApi.list()`
  - 文档上传：`documentsApi.upload()`（支持多文件批量）
  - 文档删除：`documentsApi.delete()`
  - 语义检索：`documentsApi.query()`
- 页面新增索引状态、上传结果、检索结果与错误提示，保留液态玻璃视觉风格。
- 使用登录用户 `user.id` 作为 `studentId` 透传到 Agent 探针与 AI 工作流按钮。

### Files Modified
- `src/pages/DocumentsPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |
| `python3 -m py_compile server-py/app/api/rag_routes.py server-py/app/services/rag_service.py` | Python 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |

### Notes
- PDF 工作台已从“前端演示态”升级为“可用态”。
- 下一步优先级：补文档下载/预览接口 + 集群看板全局 telemetry。


## Update: 2026-02-21 (P6-UX-3 实施日志：PDF 预览/下载接口接通)

### Actions Taken
- Go 文档处理器新增实体文件访问能力：
  - `PreviewDocument`（inline）
  - `DownloadDocument`（attachment）
- 新增文档访问公共逻辑：权限可见性校验、文件名安全化、MIME 推断。
- 路由新增：
  - `GET /api/documents/:id/preview`
  - `GET /api/documents/:id/download`
- 前端 API 新增：
  - `documentsApi.fetchFile(id, mode)`
  - `Content-Disposition` 文件名解析
- `DocumentsPage` 新增每条文档“预览 / 下载”按钮与加载状态，仍保持液态玻璃风格。

### Files Modified
- `server-go/internal/handler/document_handler.go`
- `server-go/cmd/server/main.go`
- `src/services/api.ts`
- `src/pages/DocumentsPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- PDF 工作台已具备“上传→索引→检索→预览→下载”的端到端用户链路。
- 下一步优先级转为：集群看板跨页统一 telemetry。


## Update: 2026-02-21 (P6-UX-4 实施日志：集群看板跨页统一 Telemetry)

### Actions Taken
- `src/services/api.ts`
  - 新增 `AgentGatewayMetricsResponse` 相关类型（scope/route/circuit）。
  - 新增 `agentApi.metrics()`，读取 `/api/agent/metrics`。
- `src/components/agent/AgentClusterBoard.tsx`
  - 接入 global telemetry 刷新（15 秒轮询 + 手动刷新）。
  - 接入跨页快照缓存（`pathmind:agent:telemetry:global:v1`）。
  - 新增全局指标卡：
    - 请求量（protected）
    - 4xx/5xx
    - 429/503
    - Circuit 状态
    - 审批 pending/timeout/avg wait
  - 探针 `onDone` 后自动刷新 telemetry。

### Files Modified
- `src/services/api.ts`
- `src/components/agent/AgentClusterBoard.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- P6-UX 既定“跨页统一 telemetry”目标已完成。
- 下一步建议：做 telemetry 维度下钻（agent/workspace）和趋势图。


## Update: 2026-02-21 (P6-UX-5 实施日志：维度下钻 + 趋势图)

### Actions Taken
- Go observability 扩展：
  - `server-go/internal/observability/agent_metrics.go`
  - 新增 `agents/workspaces` 维度聚合指标
  - 新增 `trend`（15s bucket，滚动窗口）输出
  - 保持旧接口兼容：`RecordAgentRequest` -> `RecordAgentRequestWithDimensions`
- 采集中间件扩展：
  - `server-go/internal/middleware/agent_metrics.go`
  - 读取 `agent_name/workspace_id` context 注入维度采集
- Agent handler 注入上下文：
  - `server-go/internal/handler/agent_handler.go`
  - query/stream/public_stream/capabilities 统一设置 telemetry 维度
- 前端看板升级：
  - `src/services/api.ts` 扩展 gateway telemetry 类型（dimensions + trend）
  - `src/components/agent/AgentClusterBoard.tsx` 新增：
    - Top Agents
    - Top Workspaces
    - Request Trend（错误高亮）

### Files Modified
- `server-go/internal/observability/agent_metrics.go`
- `server-go/internal/middleware/agent_metrics.go`
- `server-go/internal/handler/agent_handler.go`
- `src/services/api.ts`
- `src/components/agent/AgentClusterBoard.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- Telemetry 已从“全局总览”升级到“可下钻可观察”。
- 下一步优先级：趋势图窗口切换 + 指标持久化。


## Update: 2026-02-21 (P6-UX-6 实施日志：过滤参数 + 窗口切换)

### Actions Taken
- 后端 API 能力扩展：
  - `GET /api/agent/metrics` 支持 `agent/workspace/window_sec` 参数过滤。
  - observability 引入过滤快照返回字段：`selected_agent/selected_workspace/window_sec/filtered`。
  - trend retention 扩展为 360 bucket（15s），覆盖 1 小时窗口。
- 前端类型与调用扩展：
  - `src/services/api.ts` 为 `agentApi.metrics()` 增加参数化调用。
  - gateway telemetry 类型补齐 `filtered/window_sec/selected_*` 字段。
- 看板交互扩展：
  - `src/components/agent/AgentClusterBoard.tsx` 新增过滤控件（Agent、Workspace）。
  - 新增窗口控件（`5m/15m/1h`）。
  - 指标卡优先显示过滤聚合，趋势图按窗口和过滤条件刷新。

### Files Modified
- `server-go/internal/observability/agent_metrics.go`
- `server-go/internal/handler/agent_handler.go`
- `src/services/api.ts`
- `src/components/agent/AgentClusterBoard.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- P6-UX 已完成过滤与窗口切换闭环。
- 下一步仅剩：指标持久化 + 更强交互趋势图。


## Update: 2026-02-21 (P6-UX-7 实施日志：交互趋势图增强)

### Actions Taken
- `src/components/agent/AgentClusterBoard.tsx` 趋势区升级为交互式：
  - 支持 hover/click/focus 选中 bucket
  - 支持聚焦详情卡（`req/4xx/5xx/429/503/latency`）
  - 支持风险分级颜色（稳定/观察中/高风险）
- 新增趋势风险计数统计（健康/警告/高风险 bucket 数量）。
- 新增窗口内前后半段对比摘要：
  - 请求量变化（% + 绝对值）
  - 错误率变化（pp）
  - 延迟变化（ms）

### Files Modified
- `src/components/agent/AgentClusterBoard.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 本轮未新增后端接口，交互能力在现有 telemetry 合约上完成增强。
- 下一步建议：推进指标持久化，再补缩放/区间分析能力。


## Update: 2026-02-21 (P6-UX-8 实施日志：Telemetry 持久化历史)

### Actions Taken
- 后端新增持久化模型与迁移：
  - `server-go/internal/models/agent_metrics_history.go`
  - `server-go/migrations/007_agent_request_metrics.sql`
- 后端新增历史服务：
  - `server-go/internal/service/agent_metrics_history_service.go`
  - 异步队列写入、批量 flush、shutdown 优雅回收、窗口聚合查询
- 中间件与路由接入：
  - `middleware.AgentMetricsMiddleware(scope, recordFn)` 支持持久化回调
  - `GET /api/agent/metrics/history`（handler + router）
  - protected/public agent 路由均写入历史指标
- 配置项补齐：
  - `server-go/internal/config/config.go`
  - `server-go/.env.example` 增加 history 开关与窗口/bucket/queue/batch/flush 配置
- 前端接入：
  - `src/services/api.ts` 新增 `agentApi.metricsHistory()`
  - `src/components/agent/AgentClusterBoard.tsx` 新增 persisted history 摘要展示

### Files Modified
- `server-go/internal/config/config.go`
- `server-go/.env.example`
- `server-go/internal/models/agent_metrics_history.go`
- `server-go/internal/database/database.go`
- `server-go/migrations/007_agent_request_metrics.sql`
- `server-go/internal/service/agent_metrics_history_service.go`
- `server-go/internal/middleware/agent_metrics.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `src/services/api.ts`
- `src/components/agent/AgentClusterBoard.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 本轮实现了“实时 + 持久化”双通道 telemetry。
- 下一步建议：补历史数据保留策略与 rollup 下采样。


## Update: 2026-02-21 (P6-Graph-P0 实施日志：图谱 Agent 执行闭环)

### Actions Taken
- 前端流式协议扩展：
  - `useAgentStream` 新增 `GraphCommandEvent` 与 `onGraphCommand` 回调。
  - SSE 解析链新增 `parsed.type === 'graph_command'` 分发。
- 路由与 Agent 绑定修正：
  - `FloatingAgent` 将 `/graph` 路由默认 Agent 切换为 `graph-analyst`。
  - 图谱工具分类展示补齐 `emit_graph_command`。
- 图谱命令桥接与执行：
  - `FloatingAgent` 收到图谱命令后，广播 `pathmind:graph-command` 事件。
  - `GraphPage` 监听事件并传递给 `KnowledgeGraph`，同时显示 Agent 指令徽标。
  - `KnowledgeGraph` 新增命令执行层，支持 focus/filter/clear/fit/highlight/expand/open panel。
  - 新增类型过滤状态、路径/节点高亮与聚焦逻辑。

### Files Modified
- `src/hooks/useAgentStream.ts`
- `src/components/FloatingAgent.tsx`
- `src/pages/GraphPage.tsx`
- `src/components/KnowledgeGraph.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 当前已实现“Agent 控制图谱”的用户可见闭环，但尚未实现图谱执行 ACK 回传给 Agent。


## Update: 2026-02-21 (P6-Graph-P1 实施日志：命令回执 + 历史撤销)

### Actions Taken
- `KnowledgeGraph` 回执能力：
  - 新增 `GraphCommandExecutionResult` 类型与 `onCommandExecuted` 回调。
  - 全命令执行后返回 `status/success/message/undoCommand`。
  - 增加命令防重键（`issuedAt + payload`）避免重复执行。
- `GraphPage` 交互增强：
  - 接入执行回执历史面板（最近命令、结果、失败原因）。
  - 接入“撤销上一步”按钮（使用回执中的 `undoCommand` 触发反向指令）。
  - 对外广播 `pathmind:graph-command-result` 事件。
- `FloatingAgent` 联动：
  - 监听 `pathmind:graph-command-result`。
  - 对 `ignored/error` 命令弹出 warning toast（成功命令不打扰）。

### Files Modified
- `src/components/KnowledgeGraph.tsx`
- `src/pages/GraphPage.tsx`
- `src/components/FloatingAgent.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 已完成“图谱执行回执可见化 + 撤销能力”。
- 下一步建议：新增后端 ACK ingest，让模型在下一轮推理感知执行结果。


## Update: 2026-02-21 (P6-Graph-P2 实施日志：后端 ACK ingest)

### Actions Taken
- Python Agent Service：
  - `shared_memory` 新增图谱回执存储与注入：
    - `append_graph_feedback`
    - `get_graph_feedback_context`
  - `agent_routes` 新增 `POST /agent/graph/feedback`。
  - `AgentService` 在 `graph-analyst` 场景将回执上下文并入 system prompt（stream/query 双路径）。
- Go Gateway：
  - `AgentProxyService` 新增 `ReportGraphCommandFeedback`。
  - `AgentHandler` 新增 `ReportGraphCommandFeedback`。
  - 路由新增：`POST /api/agent/graph/feedback`。
- Frontend：
  - `agentApi` 新增 `reportGraphFeedback`。
  - `GraphPage` 在每次命令执行回执后自动上报到后端（携带 agent/session/command/status/message）。

### Files Modified
- `server-py/app/services/shared_memory.py`
- `server-py/app/api/agent_routes.py`
- `server-py/app/services/__init__.py`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `src/services/api.ts`
- `src/pages/GraphPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 已完成“回执上报 + 下轮可读”的最小后端闭环。
- 下一步建议：补 ACK 查询接口（按 session）和时序可视化。


## Update: 2026-02-21 (P6-Graph-P3 实施日志：ACK 查询 + 时间线)

### Actions Taken
- Python:
  - `shared_memory` 新增 `list_graph_feedback` 查询函数。
  - `agent_routes` 新增 `GET /agent/graph/feedback`（支持 agent/session/limit）。
- Go:
  - `AgentProxyService` 新增 `ListGraphCommandFeedback`。
  - `AgentHandler` 新增 `GetGraphCommandFeedback`。
  - 路由新增 `GET /api/agent/graph/feedback`。
- Frontend:
  - `agentApi` 新增 `listGraphFeedback()`。
  - `GraphPage` 新增会话时间线数据源与 UI：
    - 首次加载
    - 刷新按钮
    - 20s 轮询
    - 时间线项展示（command/target/status/message）
  - 时间线和实时回执统一在图谱右上面板展示。

### Files Modified
- `server-py/app/services/shared_memory.py`
- `server-py/app/api/agent_routes.py`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `src/services/api.ts`
- `src/pages/GraphPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 已完成“ACK 可查询 + 时间线可视化”闭环。
- 下一步建议：ACK 时间线高级过滤与事务化命令执行。


## Update: 2026-02-21 (P6-Graph-P4 实施日志：筛选/导出/批次事务最小协议)

### Actions Taken
- 后端过滤能力扩展：
  - Python `GET /agent/graph/feedback` 新增 `status`、`command` 参数。
  - Redis 查询函数 `list_graph_feedback` 支持按状态与命令过滤。
  - Go proxy 与 handler 全链路透传过滤参数。
- 批次协议扩展：
  - 图谱工具新增 `emit_graph_batch`，事件载荷支持 `batch_id`、`mode`、`steps[]`。
  - 引擎前端事件映射新增 `graph_batch`，Claude fallback JSON 解析补齐。
  - `graph-analyst` 工具清单接入 `emit_graph_batch`。
- 前端执行闭环：
  - `useAgentStream` 新增 `GraphBatchEvent` 解析与回调。
  - `FloatingAgent` 广播 `pathmind:graph-command-batch` 并消费 `pathmind:graph-batch-result`。
  - `GraphPage` 新增批次状态机：
    - 串行执行 steps
    - `all_or_nothing` 失败即中止
    - `best_effort` 失败继续执行
    - 批次完成后派发统一结果事件
  - `GraphPage` 时间线新增状态/命令过滤 UI 与 JSON/CSV 导出。

### Files Modified
- `server-py/app/services/shared_memory.py`
- `server-py/app/api/agent_routes.py`
- `server-py/app/tools/builtin/graph/tools.py`
- `server-py/app/tools/builtin/graph/manifest.yaml`
- `server-py/app/engines/base.py`
- `server-py/app/engines/claude_engine.py`
- `server-py/app/agents/registry.py`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `src/services/api.ts`
- `src/hooks/useAgentStream.ts`
- `src/components/FloatingAgent.tsx`
- `src/pages/GraphPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `cd server-py && python -m compileall app` | Python 语法通过 | 通过 | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 本轮 P6-Graph-P4 已达成“可筛选 + 可导出 + 可批次执行”的最小协议目标。
- 下一步建议：补批次补偿回滚语义与批次级后端审计。


## Update: 2026-02-21 (P6-Graph-P5 实施日志：自动补偿回滚 + 批次审计接口)

### Actions Taken
- 前端批次状态机升级：
  - `GraphPage` 增加 `forward/rollback` 双阶段。
  - `all_or_nothing` 模式下，任一步失败后自动收集已成功步骤的 `undoCommand`，逆序执行补偿回滚。
  - 批次回执新增 `rolledBack/rollbackFailed` 指标，并在回执面板展示。
- 批次级后端审计（Python）：
  - `shared_memory` 新增 `append_graph_batch_feedback` / `list_graph_batch_feedback`。
  - Redis 新增批次回执池（student 维度，12h TTL）。
  - `agent_routes` 新增：
    - `POST /agent/graph/batch-feedback`
    - `GET /agent/graph/batch-feedback`
- Go 代理新增批次链路：
  - `AgentProxyService.ReportGraphBatchFeedback` / `ListGraphBatchFeedback`
  - `AgentHandler.ReportGraphBatchFeedback` / `GetGraphBatchFeedback`
  - 路由新增：
    - `POST /api/agent/graph/batch-feedback`
    - `GET /api/agent/graph/batch-feedback`
- 前端 API 新增：
  - `agentApi.reportGraphBatchFeedback()`
  - `agentApi.listGraphBatchFeedback()`
- 批次收口上报：
  - `GraphPage.finalizeBatch` 在批次完成/失败时自动写入批次审计（best effort）。

### Files Modified
- `server-py/app/services/shared_memory.py`
- `server-py/app/api/agent_routes.py`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `src/services/api.ts`
- `src/pages/GraphPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-py && python -m compileall app` | Python 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 已完成“失败自动补偿 + 批次级审计”的最小闭环。
- 下一步建议：将批次审计迁移到 Postgres，并补批次回放面板。


## Update: 2026-02-21 (P6-Graph-P6 实施日志：批次回放 + Postgres 审计桥接)

### Actions Taken
- 前端 `GraphPage`：
  - 新增批次时间线列表（读取 `listGraphBatchFeedback`）。
  - 新增“回放”按钮：按 `batch_id` 拉取命令 ACK、重建 forward 步骤、重新派发 `pathmind:graph-command-batch`。
  - 回放时剥离 `params.__batch`，避免回放继承旧批次元信息。
  - 刷新按钮改为同时刷新命令时间线和批次时间线。
- 前端 API：
  - 新增 `reportGraphBatchFeedback` / `listGraphBatchFeedback` 类型与调用。
- Python 审计桥接：
  - `ingest_graph_batch_feedback` 在写 Redis 后，新增调用 `audit_client.log_tool_action`。
  - 批次回执同步写入 Go `internal/agent/audit`，由 Go 落 `agent_action_audit`（Postgres）。
  - `audit_client.log_tool_action` 新增上下文覆盖参数，支持 API 场景显式注入 `student/session/agent/engine/mode`。

### Files Modified
- `src/pages/GraphPage.tsx`
- `src/services/api.ts`
- `server-py/app/services/audit_client.py`
- `server-py/app/api/agent_routes.py`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-py && python -m compileall app` | Python 语法通过 | 通过 | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 当前实现是“Postgres 审计桥接”：批次回执已写入统一审计表。
- 批次时间线查询仍走 Redis，下一步建议切换为 Postgres 查询并做分页。


## Update: 2026-02-22 (P6-Graph-P7 实施日志：批次时间线查询切换 Postgres)

### Actions Taken
- Go：
  - 新增 `GraphBatchTimelineService`（`server-go/internal/service/graph_batch_timeline_service.go`），从 `agent_action_audit` 查询 `tool=graph_batch` 记录。
  - 审计字段映射：
    - `args` 解析 `batch_id/mode/total/rolled_back/rollback_failed`
    - `result` 解析 `completed/message/started_at/finished_at`
  - `AgentHandler.GetGraphBatchFeedback` 改为：
    - 先查 Postgres（主路径）
    - 查询为空或异常时回退 Python/Redis 代理路径
    - 响应增加 `source=postgres|redis`
  - `GraphBatchFeedbackListResponse` 新增 `source` 字段。
- Frontend：
  - `api.ts` 批次历史响应类型新增 `source`。
  - `GraphPage` 批次时间线展示数据源标识（`postgres`/`redis`），便于迁移期验证。

### Files Modified
- `server-go/internal/service/graph_batch_timeline_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/cmd/server/main.go`
- `src/services/api.ts`
- `src/pages/GraphPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `cd server-py && python -m compileall app` | Python 语法通过 | 通过 | ✅ |
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 该版本已满足“批次查询主链路切 Postgres，Redis 保底回退”的迁移目标。
- 下一步建议直接进入批次详情视图（step 级回放与失败原因定位）。


## Update: 2026-02-22 (P6-Graph-P8 实施日志：批次详情 + 游标分页)

### Actions Taken
- Python：
  - `list_graph_batch_feedback` 新增 `before_ts` 参数（ms），支持按游标向后分页。
  - 返回值改为 `(items, next_before_ts)`，用于前端“加载更多”。
  - `GET /agent/graph/batch-feedback` 响应新增：
    - `source=redis`
    - `next_before_ts`
- Go：
  - `GraphBatchTimelineQuery` 新增 `BeforeTS`。
  - `GraphBatchTimelineService` 支持 `before_ts` 过滤与 `limit+1` 查询，响应新增 `next_before_ts`。
  - `AgentHandler.GetGraphBatchFeedback` 新增 `before_ts` 参数解析并透传到 PG/Redis 查询链路。
  - `AgentProxyService.ListGraphBatchFeedback` 新增 `before_ts` 透传给 Python fallback。
- Frontend：
  - `api.ts` 批次查询参数新增 `beforeTs`，响应类型新增 `next_before_ts`。
  - `GraphPage` 批次时间线新增游标分页状态：
    - `batchNextBeforeTs`
    - `batchHasMore`
    - “加载更多批次”按钮
  - 新增批次详情交互：
    - `详情/收起` 按钮
    - 展示 `forward/rollback` step 级轨迹（命令 + 状态）
  - 批次回放改为复用批次 ACK 明细提取逻辑。

### Files Modified
- `server-py/app/services/shared_memory.py`
- `server-py/app/api/agent_routes.py`
- `server-go/internal/service/graph_batch_timeline_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/internal/service/agent_proxy_service.go`
- `src/services/api.ts`
- `src/pages/GraphPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `cd server-py && python -m compileall app` | Python 语法通过 | 通过 | ✅ |
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 本轮已完成“批次时间线可分页 + 批次 step 详情可视化”的最小闭环。
- 下一步建议补“详情中的 message/params 展开 + 回放前确认策略”。


## Update: 2026-02-22 (P6-Graph-P9 实施日志：详情展开 + 单步复制导出 + 回放确认)

### Actions Taken
- Frontend (`GraphPage`)：
  - `GraphBatchStepDetail` 增加 `params` 字段，详情视图可展示 `message/params`。
  - 新增 step 级交互：
    - `展开/收起`（查看 message + params）
    - `复制`（复制单步 JSON 到剪贴板）
  - 新增批次级交互：
    - `导出`（导出当前批次 detail JSON）
  - 批次回放新增确认弹窗（`window.confirm`），避免误触发。
  - 增加复制状态短暂反馈（`已复制`）与失败提示。

### Files Modified
- `src/pages/GraphPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `cd server-py && python -m compileall app` | Python 语法通过 | 通过 | ✅ |

### Notes
- 本轮目标（详情展开/复制导出 + 回放确认）已完成，且未破坏现有批次协议。
- 下一步建议推进“部分回放（前 N 步/phase 选择）”控制策略。


## Update: 2026-02-22 (P6-Graph-P10 实施日志：回放范围控制)

### Actions Taken
- Frontend (`GraphPage`)：
  - 新增回放范围状态：
    - `replayPhaseFilter`：`forward|rollback|all`
    - `replayStepLimitInput`：前 N 步限制（1~50）
  - 批次时间线头部新增回放控制 UI：
    - phase 下拉框
    - N 步输入框（留空=全部）
  - `handleReplayBatch` 改造：
    - 按 phase 过滤 ACK 步骤
    - 按 N 步裁剪回放步骤
    - 确认弹窗展示“范围 + 实际命令数”
    - 保持与既有 `graph_batch` 事件协议兼容

### Files Modified
- `src/pages/GraphPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端编译通过 | 通过（含既有 chunk warning） | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |
| `cd server-go && go test ./...` | Go 构建通过 | 通过 | ✅ |
| `cd server-py && python -m compileall app` | Python 语法通过 | 通过 | ✅ |

### Notes
- 本轮已完成“回放 phase 控制 + 前 N 步限制”的最小可用实现。
- 下一步建议做“起止区间回放 + 仅失败步骤回放”。


## Update: 2026-02-22 (P7 启动日志：能力矩阵对齐 + 执行票据落地)

### Actions Taken
- 按 `planning-with-files` 流程完成 session catchup，确认本轮目标聚焦 WebAgent P7 启动，不处理 Zeabur 端口问题上下文。
- 对齐能力矩阵基线文档 `docs/webagent-capability-matrix-v1.md`，确认系统处于 `L3.5~L4.0`。
- 同步规划文件：
  - `task_plan.md` 当前阶段切换为 `P7-1`
  - 新增 P7 三波次执行路线与 P7-1A 首批实施票据
  - 在 `findings.md` 记录 P7 评估结论、决策与立即行动项
- 明确本轮输出目标：从“状态说明”转入“P7-1 可执行开发入口”。

### Files Modified
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 规划文件一致性检查 | P7 目标/阶段/动作保持一致 | 已一致（Phase=P7-1 + P7-1A ticket） | ✅ |

### Notes
- 本次更新为执行计划同步，不涉及业务代码改动。
- 下一步直接进入 `P7-1A`：AIAdvisor 任务模板启动器 + 统一回执协议前端骨架。


## Update: 2026-02-22 (P7-1A 实施日志：任务模板启动器 + 统一回执骨架)

### Actions Taken
- `src/services/api.ts`：
  - 新增 `AgentTaskTemplate*` 类型定义。
  - 新增 `agentApi.taskTemplates()` / `agentApi.startTaskTemplate()`。
  - 增加 fallback 模板与 fallback 启动返回，保证后端接口未就绪时前端可联调。
- `src/services/taskReceiptStore.ts`（new）：
  - 新增统一回执存储模型（`TaskReceiptRecord/TaskReceiptStep`）。
  - 支持 `load/save/upsert` 与跨页面广播事件 `pathmind:task-receipts-updated`。
- `src/hooks/useAgentStream.ts`：
  - 新增 `task_receipt` 事件解析与 `onTaskReceipt` callback。
- `src/pages/AIAdvisor.tsx`：
  - 新增跨板块任务模板启动器（模板选择、prompt 覆写、启动按钮、source 标识）。
  - 新增模板启动后回执写入与现有审批/工具/编排事件联动更新。
  - 新增内嵌 `TaskReceiptPanel` 显示跨板块回执。
- `src/components/agent/TaskReceiptPanel.tsx`（new）：
  - 新增统一回执展示组件（状态过滤 + 单条导出）。
- `src/pages/NotesPage.tsx` / `src/pages/DocumentsPage.tsx` / `src/pages/ExperimentsPage.tsx`：
  - 接入 `TaskReceiptPanel`，实现业务页回执可见（只读）。
- 规划文件同步：
  - `task_plan.md`、`findings.md`、`progress.md` 更新到 P7-1A 状态。

### Files Modified
- `src/services/api.ts`
- `src/services/taskReceiptStore.ts`
- `src/hooks/useAgentStream.ts`
- `src/components/agent/TaskReceiptPanel.tsx`
- `src/pages/AIAdvisor.tsx`
- `src/pages/NotesPage.tsx`
- `src/pages/DocumentsPage.tsx`
- `src/pages/ExperimentsPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm run build` | 前端类型/构建通过 | 通过 | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |

### Notes
- 当前为 P7-1A 前端闭环版本：后端任务模板接口仍可后续替换 fallback。
- 下一步优先项：补后端 `task-templates` 正式接口 + P7-1 E2E 验收链路。


## Update: 2026-02-22 (P7-1B 实施日志：后端 task-templates + 全栈启动)

### Actions Taken
- Python：
  - 新增 `server-py/app/services/task_templates.py`（内建 3 条任务模板目录）。
  - `server-py/app/api/agent_routes.py` 新增模型与接口：
    - `GET /agent/task-templates`
    - `POST /agent/task-templates/start`
  - 启动模板时接入 `log_tool_action`（`tool=task_template_start`）。
- Go：
  - `server-go/internal/service/agent_proxy_service.go` 新增 task template 类型与代理方法：
    - `ListTaskTemplates`
    - `StartTaskTemplate`
  - `server-go/internal/handler/agent_handler.go` 新增：
    - `ListTaskTemplates`
    - `StartTaskTemplate`
  - `server-go/cmd/server/main.go` 注册新路由：
    - `GET /api/agent/task-templates`
    - `POST /api/agent/task-templates/start`
- 本地运行环境：
  - 新增依赖容器：`pm-local-postgres` / `pm-local-redis` / `pm-local-neo4j`（映射 5432/6379/7687）。
  - 启动 Python Agent（19090）、Go 网关（18080）、Frontend Vite（5173）。
  - 执行基础 schema 初始化：
    - `server-go/migrations/001_init_schema.sql`
    - `ALTER TABLE users ADD COLUMN organization_id / is_active`
  - 创建演示账号：`demo / Demo123456!`（email: `demo@pathmind.local`）。

### Files Modified
- `server-py/app/services/task_templates.py` (new)
- `server-py/app/api/agent_routes.py`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 编译通过 | 通过 | ✅ |
| `cd server-py && python3 -m py_compile app/api/agent_routes.py app/services/task_templates.py` | Python 语法通过 | 通过 | ✅ |
| `npm run build` | 前端构建通过 | 通过 | ✅ |
| `npm run check:webagent` | WebAgent 快速门禁通过 | PASS | ✅ |
| `curl http://127.0.0.1:19090/agent/task-templates` | 返回模板目录 | `templates=3` | ✅ |
| `curl -X POST http://127.0.0.1:19090/agent/task-templates/start` | 返回 run_id | 返回 `task:...` | ✅ |
| `curl http://127.0.0.1:18080/api/agent/task-templates`(无 token) | 命中鉴权 | `401` | ✅ |
| `curl http://127.0.0.1:19090/health` / `:18080/health` / `:5173` | 三服务可访问 | 通过 | ✅ |
| `POST /api/auth/login` + `GET/POST /api/agent/task-templates*` | 登录态模板接口可用 | 通过 | ✅ |

### Notes
- 本轮已完成 P7-1B 核心目标，并按你的要求完成本地完整服务启动。
- 目前 Go 侧 `task-templates` 仍是受保护路由；前端在登录态下可直接体验完整链路。


## Update: 2026-02-22 (Hotfix 实施日志：PDF 索引卡住)

### Actions Taken
- 根因排查：
  - 复现到 `documents.is_indexed=false` 持续不变。
  - 定位 Go `triggerRAGIngest` 仅处理 `status=completed`，失败分支无状态更新。
  - 定位 Python `/rag/ingest` 返回 `db_unavailable`（pgvector 未就绪）。
  - 定位旧文档 `file_path` 为相对路径，存在跨服务路径解析风险。
- 代码修复：
  - `server-go/internal/handler/document_handler.go`
    - 上传路径改为绝对路径落库。
    - ingest 失败写回失败态（`page_count=-1`）并日志化。
  - `src/pages/DocumentsPage.tsx`
    - 增加索引中自动轮询刷新（5 秒）。
    - 增加“索引失败”状态展示。
  - `server-py/app/main.py`
    - `/health` 增加 `rag.pgvector_ready`。
  - `server-py/app/db/postgres.py`
    - 增加 pgvector 初始化失败日志。
  - 配置对齐：
    - `server-py/app/config.py` 默认 DB URL 改为 `postgres:postgres@localhost:5432/pathmind`。
    - `server-py/.env.example` 同步。
    - `server-go/docker-compose.yml` Postgres 镜像切换为 `pgvector/pgvector:pg16`。
- 运行补偿：
  - 对历史“卡住”文档执行一次补偿 ingest（含旧相对路径修正），成功回填索引状态。

### Files Modified
- `server-go/internal/handler/document_handler.go`
- `src/pages/DocumentsPage.tsx`
- `server-py/app/main.py`
- `server-py/app/db/postgres.py`
- `server-py/app/config.py`
- `server-py/.env.example`
- `server-go/docker-compose.yml`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `cd server-go && go test ./...` | Go 编译通过 | 通过 | ✅ |
| `cd server-py && python -m py_compile ...` | Python 语法通过 | 通过 | ✅ |
| `npm run build` | 前端构建通过 | 通过（含既有 chunk warning） | ✅ |
| `/health`（Python） | 返回 RAG 就绪状态 | `rag.pgvector_ready=true` | ✅ |
| 新 PDF 上传索引 | 由“索引中”收敛到“已索引” | `is_indexed=true,page_count=14` | ✅ |
| 历史卡住文档补偿 | 成功完成索引并回填 | `status=completed,chunks=19` | ✅ |

### Notes
- 这次 hotfix 解决了“永远索引中”的核心链路问题，并补了失败可见性。
- 下一步建议做显式 `reindex` 接口与结构化失败原因字段。


## Update: 2026-02-22 (Hotfix 实施日志：文档语义检索 500)

### Actions Taken
- 复现 `POST /api/documents/query` 返回 `500`（前端表现为“请求失败”）。
- 从 Python 实时日志定位到 `asyncpg.exceptions.UndefinedFunctionError: operator does not exist: text = uuid`。
- 修复 `server-py/app/services/rag_service.py` 的筛选 SQL：
  - `d.uploaded_by = $n::uuid` → `d.uploaded_by::text = $n`
  - `d.course_id = $n::uuid` → `d.course_id::text = $n`
- 重启 Python Agent 服务并回归接口。

### Files Modified
- `server-py/app/services/rag_service.py`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python -m py_compile app/services/rag_service.py` | 语法通过 | 通过 | ✅ |
| `POST /api/documents/query` | 200 + 结果列表 | 通过 | ✅ |


## Update: 2026-02-22 (重启后复核：模型链路与数据库质量)

### Actions Taken
- 检查重启后进程与端口：
  - 依赖容器（Postgres/Redis/Neo4j）存活。
  - 应用层服务（Go/Python/Frontend）未常驻，需手动拉起。
- 核对 RAG 模型配置与代码路径：
  - 文档嵌入：`nvidia/nv-embedqa-e5-v5`
  - OCR 解析：`nvidia/nemoretriever-parse`
  - rerank：未实现独立重排器。
- 直接读取 `documents` / `document_chunks` 抽样核查内容质量，确认 vision 分块文本存在明显乱码。
- 对同一 PDF 进行 `pypdf` 直接抽取对比，文本可读性显著优于当前入库 chunks。

### Files Modified
- `findings.md`
- `progress.md`

### Notes
- 本次为诊断性核查，无业务代码改动。
- 结论：当前“识别差”的首要优化点在 PDF 解析策略（vision/text 选择与质量门控），其次才是检索重排能力。


## Update: 2026-02-22 (实施日志：RAG 模型升级与重排接入)

### Actions Taken
- 配置层升级：
  - 文档 embedding 默认改为 `baai/bge-m3`
  - 视觉抽取默认改为 `meta/llama-3.2-90b-vision-instruct`
  - 新增 rerank 模型配置 `nvidia/llama-3.2-nemoretriever-300m-embed-v2`
  - 新增 `text-first` / structured parser / rerank 相关开关参数
- 检索链路升级：
  - `RAGService.ingest` 改为 `text-first + vision-fallback`
  - `RAGService.query` 新增 second-pass rerank（候选重排）
  - `CacheService` 的 rag query key 增加 query/rerank model 维度
  - `EmbeddingClient` 支持按模型设置截断长度（用于 rerank 阶段）
- 数据修复：
  - 对现有两份文档执行重建索引，入库 `extraction_method` 变为 `text`
  - 抽样检查 chunk 文本质量与 query 结果相关性

### Files Modified
- `server-py/app/config.py`
- `server-py/.env.example`
- `server-py/app/rag/embedding.py`
- `server-py/app/rag/vision_extractor.py`
- `server-py/app/services/cache_service.py`
- `server-py/app/services/rag_service.py`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 模型可用性探测 | bge-m3 / llama-3.2-90b-vision / nemoretriever-300m 可用 | `/v1/models` + `/v1/embeddings` 验证通过 | ✅ |
| `py_compile` | 修改文件语法通过 | 通过 | ✅ |
| 重建索引 | 文档重新入库并可检索 | 2 份文档均 `status=completed` | ✅ |
| 抽样分块质量 | 中文可读性提升 | `extraction_method=text`，片段可读 | ✅ |
| 查询抽样 | 返回相关片段 | “回归模型是什么”返回相关内容 | ✅ |

## Update: 2026-02-22 (复核执行：重启后状态 + 模型链路验收)

### Actions Taken
- 复核重启后运行态：确认 infra 容器存活，应用层服务默认不常驻。
- 二次确认模型可用性与维度（NVIDIA OpenAI-compatible `/models`、`/embeddings`）。
- 临时启动 Python 服务并验证：
  - `GET /health`
  - `POST /rag/query`
- 数据库复查 `documents + document_chunks`，确认当前索引文档为 `extraction_method=text`。
- 补充计划文档，记录“当前可用状态 + 后续 reindex 产品化建议”。

### Files Modified
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `GET /health` | RAG 就绪 | `rag.pgvector_ready=true` | ✅ |
| `POST /rag/query` | 返回相关结果 | Top 命中与“回归模型”语义一致 | ✅ |
| 模型存在性 | 目标模型均可用 | 4/4 可用 | ✅ |
| 维度校验 | 维度符合预期 | bge=1024, code=4096, rerank=2048 | ✅ |
| `py_compile`（RAG 相关文件） | 语法通过 | 通过 | ✅ |

## Update: 2026-02-22 (Hotfix：前端登录失败/端口错配)

### Actions Taken
- 复现登录失败并定位到 API 目标端口错配（前端请求未稳定指向 `18080`）。
- 将前端 API 默认基址改为相对路径 `'/api'`，避免硬编码端口导致错路由。
- 在 Vite 配置增加开发代理：`/api -> http://127.0.0.1:18080`（启用 `ws`）。
- 重启前端并通过 `5173/api/auth/login` 真实请求验收。

### Files Modified
- `src/services/client.ts`
- `vite.config.ts`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `POST /api/auth/login` via 5173 | 登录成功 | 返回 token + user | ✅ |
| 前端端口 | 5173 可访问 | `0.0.0.0:5173` 监听 | ✅ |
| 网关端口 | 18080 可用 | `GET /health` 正常 | ✅ |

## Update: 2026-02-22 (运行恢复：登录报 internal error)

### Actions Taken
- 复现登录失败：`/api/auth/login` 返回 `401 {"error":"internal error"}`。
- 检查容器状态，确认 `pm-local-postgres` / `pm-local-redis` / `pm-local-neo4j` 被停掉。
- 启动本地依赖容器并回归登录接口。

### Files Modified
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `POST /api/auth/login` (18080) | 登录成功 | 返回 token | ✅ |
| `POST /api/auth/login` (5173 proxy) | 登录成功 | 返回 token | ✅ |

## Update: 2026-02-22 (P7-Delegate 实施：Agent 间委托链路)

### Actions Taken
- 新增委托运行时护栏：`server-py/app/services/delegation_runtime.py`。
  - 白名单 allowlist（按 source agent）
  - 最大深度限制（默认 2）
  - 环路检测（A->B->A 拒绝）
- 新增 builtin 工具包：`server-py/app/tools/builtin/delegation/`。
  - `delegate_to_agent` 支持目标 agent 委托、runtime/context 补丁、返回截断
  - 委托前后写入 run scratchpad（handoff start/done）
- 关键 agent 接入 `delegate_to_agent`：
  - `career-advisor / graph-analyst / learning-coach / document-reader / quick-qa / mbti-analyst / note-assistant`
- 前端事件链路补齐：
  - 引擎层新增 `agent_handoff` 事件
  - `useAgentStream` 转换为 `onToolCall`
  - `AIAdvisor` 时间线新增“Agent 委托”可视化条目
- 配置补齐：
  - `PATHMIND_AGENT_DELEGATION_ENABLED`
  - `PATHMIND_AGENT_DELEGATION_MAX_DEPTH`

### Files Modified
- `server-py/app/config.py`
- `server-py/.env.example`
- `server-py/app/services/delegation_runtime.py` (new)
- `server-py/app/tools/builtin/delegation/__init__.py` (new)
- `server-py/app/tools/builtin/delegation/manifest.yaml` (new)
- `server-py/app/tools/builtin/delegation/tools.py` (new)
- `server-py/app/agents/registry.py`
- `server-py/app/engines/base.py`
- `src/hooks/useAgentStream.ts`
- `src/pages/AIAdvisor.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `py_compile`（delegation 相关文件） | 语法通过 | 通过 | ✅ |
| ToolRegistry 扫描 | `delegate_to_agent` 成功注册 | `delegate_to_agent in registry: True` | ✅ |
| Agent tool 完整性 | 所有 agent tool 可解析 | `missing_count 0` | ✅ |
| 委托环路保护 | `document-reader -> quick-qa` 在 `quick->doc` 链中被拒绝 | 检测到 cycle 并拒绝 | ✅ |
| 前端构建 | TS + Vite 构建通过 | `npm run build` 通过 | ✅ |

### Errors
| Error | Resolution |
|------|------------|
| 直接调用 `delegate_to_agent(...)` 触发 `SdkMcpTool object is not callable` | 改为调用 `delegate_to_agent.handler(args)` 并通过自委托拒绝路径验证 |

## Update: 2026-02-22 (P7-Delegate-2 实施：完成态事件 + 批次协议)

### Actions Taken
- 引擎事件层升级：
  - `server-py/app/engines/base.py` 新增 `build_frontend_events_from_result(...)`
  - 为 `delegate_to_agent` 输出 `agent_handoff(stage=done/failed)` 结果事件
  - 为 `delegate_batch_agents` 输出 `agent_handoff_batch(stage=done)` 汇总事件
- OpenAI 流式执行链路接入结果事件分发：
  - `server-py/app/engines/openai_engine.py` 在工具执行后追加 result-based event 推送
- 委托工具升级：
  - 新增 `delegate_batch_agents`（`best_effort`/`all_or_nothing`）
  - 协议回执 `delegation.batch.v1`（含 `transaction` + `summary` + `items`）
  - manifest 同步注册新工具
- Agent 能力接入：
  - 多个核心 agent 增加 `delegate_batch_agents` 工具可用性
- 前端消费升级：
  - `useAgentStream` 解析 `agent_handoff_batch`
  - `AIAdvisor` 复用 `handoff*` 状态展示委托/批次进度

### Files Modified
- `server-py/app/engines/base.py`
- `server-py/app/engines/openai_engine.py`
- `server-py/app/tools/builtin/delegation/manifest.yaml`
- `server-py/app/tools/builtin/delegation/tools.py`
- `server-py/app/agents/registry.py`
- `src/hooks/useAgentStream.ts`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `py_compile`（engine/delegation/registry） | 语法通过 | 通过 | ✅ |
| ToolRegistry 扫描 | `delegate_batch_agents` 注册成功 | True | ✅ |
| Agent tool 完整性 | 所有 agent tools 可解析 | `missing_count 0` | ✅ |
| 批次协议验证（all_or_nothing） | 首失败后后续跳过 | summary: failed=1, skipped=1 | ✅ |
| 结果事件编码 | `agent_handoff` / `agent_handoff_batch` 正常生成 | 本地函数测试通过 | ✅ |
| 前端构建 | TS + Vite 构建通过 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-22 (P7-UX-2 实施：用户端感知强化)

### Actions Taken
- 在 `AIAdvisor` 新增“用户可感知工作台”模块卡片区（笔记/文档/PDF/实验/图谱/RAG/Coding）。
- 基于 task receipt 快照计算各模块运行态，展示 total/running/success/failed 与最近更新时间。
- 每个模块增加快捷动作：
  - `打开板块`（路由跳转）
  - `让 Agent 执行`（标准化 prompt + 目标 agent）
- Hooks 事件流新增二级筛选：
  - `status`（info/success/warning）
  - `command`（按事件命令名过滤）
- 扩展时间线事件字段：
  - 新增 `status`、`command`
  - 补齐普通工具调用可见事件（不仅 retry/fallback/handoff）
  - 事件卡片新增 level/command/status 标签
- 回执导出改为复用内存快照 `receiptSnapshot`，与页面展示保持一致。

### Files Modified
- `src/pages/AIAdvisor.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | TS + Vite 构建成功 | `npm run -s build` 通过 | ✅ |
| 工作台模块卡片 | 可展示多板块状态 + 快捷动作 | 编译通过，UI 已接入 | ✅ |
| 时间线筛选 | 支持类别+状态+命令+搜索 | 编译通过，筛选逻辑已接入 | ✅ |

## Update: 2026-02-22 (P7-UX-3 实施：页面偶发不显示修复)

### Actions Taken
- `ErrorBoundary` 增加 `resetKey`，在路由切换时自动清理错误态。
- `ErrorBoundary` 增加 chunk 加载异常识别与专用提示（资源刷新按钮）。
- `App` 新增 `lazyWithRetry`：
  - 对懒加载 chunk 失败场景自动刷新一次（sessionStorage 防止刷新循环）。
  - 全部页面 lazy import 改用 retry wrapper。
- `DocumentsPage` / `NotesPage` / `ExperimentsPage` 增加局部错误隔离：
  - `AgentClusterBoard` 与 `TaskReceiptPanel` 改为局部 `ErrorBoundary` 包裹。
  - 小组件异常时页面主流程继续可用。

### Files Modified
- `src/components/ErrorBoundary.tsx`
- `src/App.tsx`
- `src/pages/DocumentsPage.tsx`
- `src/pages/NotesPage.tsx`
- `src/pages/ExperimentsPage.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建回归 | TS + Vite 构建成功 | `npm run -s build` 通过 | ✅ |
| ErrorBoundary 重置能力 | 路由切换后可清理错误态 | 代码路径已接入 `resetKey` | ✅ |
| chunk 失败恢复能力 | 首次 chunk 失败自动刷新一次 | `lazyWithRetry` 已接入全部 lazy 页面 | ✅ |

## Update: 2026-02-22 (P7-Hotfix-DocAgent：文档助手失败修复)

### Actions Taken
- 复现 `document-reader` 调用失败：默认模型 `deepseek-ai/deepseek-v3.2` 返回通用错误兜底。
- 对照验证：运行时覆盖为 `qwen/qwen3-next-80b-a3b-instruct` 后同请求可成功返回。
- 修改 agent registry：
  - `server-py/app/agents/registry.py` 中 `document-reader.engine_model` 切换为 `qwen/qwen3-next-80b-a3b-instruct`。
- 重启 Python Agent 服务并回归验证 `document-reader`。

### Files Modified
- `server-py/app/agents/registry.py`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `py_compile` | registry 语法正常 | 通过 | ✅ |
| `POST /agent/query` (9090, document-reader) | 正常返回 | 通过（qwen） | ✅ |
| `POST /api/agent/query` (18080, auth) | 通过网关可返回文档内容 | 通过 | ✅ |

## Update: 2026-02-22 (P7-Perf-4：卡顿治理实施)

### Actions Taken
- 诊断并确认三类主因：
  - 端口错配（前端代理 `18080` vs Go/Python 默认 `8080`）。
  - Python debug reload 默认开启。
  - 前端重依赖 chunk 过大导致切页卡顿。
- 配置与默认值修复：
  - `server-go/.env` / `server-go/.env.example`：`SERVER_PORT` 统一为 `18080`。
  - `server-py/.env` / `server-py/.env.example`：`PATHMIND_GO_BACKEND_URL` 改为 `http://127.0.0.1:18080/api`。
  - `server-py/.env` / `server-py/.env.example`：`PATHMIND_DEBUG=false`。
  - `server-py/app/config.py`：`go_backend_url` 默认值同步为 `http://127.0.0.1:18080/api`。
- 前端构建优化：
  - `vite.config.ts` 增加 `optimizeDeps.include` 预构建重依赖。
  - 新增 `manualChunks` 分包策略，按依赖域拆分 vendor chunk。
  - `/api` 代理改为可配置 `VITE_API_PROXY_TARGET`，默认 `http://127.0.0.1:18080`。
- 文档/注释对齐：
  - `docs/webagent-coding-quickstart-v1.md` 默认端口更新到 `18080/9090`。
  - `src/services/api.ts` 注释改为“通过 `/api` 代理”。

### Files Modified
- `vite.config.ts`
- `server-go/.env`
- `server-go/.env.example`
- `server-py/.env`
- `server-py/.env.example`
- `server-py/app/config.py`
- `docs/webagent-coding-quickstart-v1.md`
- `src/services/api.ts`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建回归 | TS + Vite 构建成功 | `npm run -s build` 通过 | ✅ |
| Python 语法检查 | 配置改动无语法回归 | `python -m py_compile ...` 通过 | ✅ |
| Go 编译检查 | 可编译通过 | `go test ./...` 通过 | ✅ |

## Update: 2026-02-22 (P7-UI-Minimal：极简布局改造)

### Actions Taken
- AIAdvisor 完成“主内容优先”改造：
  - 新增大标题 Hero 区、简化顶部控制区。
  - 新增 `detailsOpen`，将集群/事件/会话/回执等系统信息默认收起。
  - 保留全部高级能力，改为按需展开查看。
- Notes/Documents/Experiments 默认隐藏系统观测面板：
  - Notes：`showCluster=false`。
  - Documents/Experiments：新增 `showSystemPanels` 开关，默认关闭。
- 继续做前端压缩：
  - `NoteEditor` 去掉全语言包 `@codemirror/language-data` 的 `codeLanguages` 接入。
  - Markdown 编辑保留核心能力，显著降低 codemirror chunk 体积。
- 输出前端规划文档：
  - 新增 `docs/frontend-minimal-ux-plan-v1.md`，定义统一信息架构与后续 P7-UI 路线。

### Files Modified
- `src/pages/AIAdvisor.tsx`
- `src/pages/DocumentsPage.tsx`
- `src/pages/ExperimentsPage.tsx`
- `src/pages/NotesPage.tsx`
- `src/components/notes/NoteEditor.tsx`
- `docs/frontend-minimal-ux-plan-v1.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | UI 调整后构建成功 | `npm run -s build` 通过 | ✅ |
| 包体优化 | codemirror 包体下降 | `vendor-codemirror` ≈ `500KB`（原约 `1.55MB`） | ✅ |

## Update: 2026-02-22 (P7-UI-Minimal-2：Claude 观感细化)

### Actions Taken
- `AIAdvisor` Hero 区新增可配置媒体位：
  - 支持 `gif/image/webm/mp4` URL；
  - 通过 `localStorage` 记忆用户配置。
- 系统面板抽屉化：
  - `Hooks 事件流` 面板在细节模式下改为右侧浮层抽屉；
  - `会话历史` 面板同样改为右侧浮层抽屉；
  - 两者互斥展示，并增加遮罩与关闭按钮。
- 细节层保持“按需可见”：
  - 默认仍是主内容优先布局；
  - 仅用户显式打开“系统细节”时显示调试能力。

### Files Modified
- `src/pages/AIAdvisor.tsx`
- `docs/frontend-minimal-ux-plan-v1.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | 抽屉化与媒体位改造后可构建 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-22 (P7-UI-Minimal-3：单一侧栏 + Notes 主任务)

### Actions Taken
- AIAdvisor：
  - 引入单一抽屉状态 `detailDrawerTab`，统一管理 `overview/events/sessions`。
  - 将系统总览区域移入右侧抽屉，不再占用主聊天流布局。
  - 保持遮罩、关闭按钮与互斥打开语义，维持简洁交互。
- Notes：
  - 顶栏加入“书写优先”文案层级。
  - 移除喧宾夺主的系统入口样式，改为次级 `系统` 按钮。
  - 系统面板（集群 + 回执）默认折叠，用户按需开启。

### Files Modified
- `src/pages/AIAdvisor.tsx`
- `src/pages/NotesPage.tsx`
- `docs/frontend-minimal-ux-plan-v1.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | 单一侧栏 + Notes 调整后构建成功 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-22 (P7-Notes-ObsidianLite：扩展与专注模式)

### Actions Taken
- Obsidian 目录接入：
  - 从 `obsidian-releases/community-plugins.json` 与 `community-plugin-stats.json` 生成精选目录。
  - 产物：`public/obsidian/community-plugins-top.json`（Top 300）。
- Notes 插件扩展入口：
  - 新增 `src/services/obsidianCatalog.ts`（目录加载 + 启用状态持久化）。
  - 新增 `src/components/notes/NotePluginCatalog.tsx`（搜索、启用入口、Repo 跳转）。
  - Notes 系统面板接入插件目录。
- Notes 专注写作模式：
  - 新增 `focusMode` 和快捷键 `Ctrl/Cmd + Shift + F`。
  - 专注模式下自动折叠非核心区域，并锁定编辑视图。
- 文档化：
  - 新增 `docs/obsidian-lite-compatibility-v1.md`，明确兼容边界与后续路线。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/components/notes/index.ts`
- `src/components/notes/NotePluginCatalog.tsx`
- `src/services/obsidianCatalog.ts`
- `public/obsidian/community-plugins-top.json`
- `docs/obsidian-lite-compatibility-v1.md`
- `docs/frontend-minimal-ux-plan-v1.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | Notes 专注模式 + 插件目录接入后构建成功 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-22 (P7-Notes-ObsidianLite-2：命令运行时与状态联动)

### Actions Taken
- 新增 Notes 插件运行时服务：
  - `src/services/notesPluginRuntime.ts`；
  - 提供 `buildNotesPluginCommands` 与 `buildNotesPluginStatusItems`。
- `obsidianCatalog` 增加状态广播事件：
  - 导出 `OBSIDIAN_ENABLED_CHANGED_EVENT` 与 `OBSIDIAN_ENABLED_KEY`；
  - 启用列表变化时触发窗口事件，供 Notes 页面实时同步。
- Notes 页顶栏接入“扩展命令”菜单：
  - 执行内建命令可直接改写当前 Markdown 内容；
  - 执行外部插件入口命令可跳转对应 GitHub 仓库；
  - 增加执行回执提示与点击外部关闭逻辑。
- Notes 顶栏增加轻量状态徽标：
  - 字数、双链数量、待办数量、启用扩展数量。
- 兼容文档更新：
  - `docs/obsidian-lite-compatibility-v1.md` 补充“目录 + 命令入口 + 内建运行时”现状。

### Files Modified
- `src/services/notesPluginRuntime.ts`
- `src/services/obsidianCatalog.ts`
- `src/pages/NotesPage.tsx`
- `src/components/notes/NotePluginCatalog.tsx`
- `docs/obsidian-lite-compatibility-v1.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | 命令运行时接入后正常构建 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-22 (P7-UX-Refine-NotesAI：单栏 WYSIWYG + AI 控制按需显示)

### Actions Taken
- Notes 页改为单栏编辑：
  - 移除分屏/预览切换逻辑，保留“图谱/AI/系统”次级面板；
  - 编辑主流程只保留一个所见即所得编辑区。
- Notes 编辑器内核替换：
  - `src/components/notes/NoteEditor.tsx` 切换到 `@mdxeditor/editor`；
  - Markdown 输入输出保持兼容；
  - 工具栏包含标题/强调/列表/链接/代码块等常用操作。
- 样式升级：
  - `src/index.css` 新增 `pm-note-mdx-*` 样式，维持液态玻璃视觉并适配深色模式。
- AIAdvisor 交互瘦身：
  - 去除常驻控制条；
  - 新增 `AI 提示` 气泡入口（快捷提示词）；
  - 新增 `能力卡片` 弹窗，承载全部高级控制项（模式/Agent/编排/策略/系统抽屉开关）。
- 自然语言触发能力卡片：
  - 在 `handleSend` 中加入关键词识别（如“能力卡片/控制面板/高级设置”）；
  - 用户未主动触发时不显示复杂控制项。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`
- `src/pages/AIAdvisor.tsx`
- `src/index.css`
- `package.json`
- `package-lock.json`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | Notes + AIAdvisor 改造后构建成功 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P7-Notes-Perf-1：语法支持 + 性能优化)

### Actions Taken
- Notes 编辑器能力增强：
  - 启用 `codeBlockPlugin` 支持 fenced code block；
  - 增加代码语言映射（Python/TS/JS/Go/SQL 等）；
  - CodeMirror 语法高亮改成“按需动态加载”。
- Notes 页面性能优化：
  - `NoteGraphView`、`NoteAIPanel`、`NotePluginCatalog`、`AgentClusterBoard`、`TaskReceiptPanel` 改为 `React.lazy + Suspense`；
  - 自动保存逻辑增加“变更去重 + 1200ms debounce”。
- 现场资源快照采样：
  - `node(vite)`、`go(main)`、`python(agent)`、`chrome renderer` 的 CPU/内存占用已记录到 findings。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`
- `src/hooks/useNotes.ts`
- `src/index.css`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | 编辑器插件 + 懒加载 + 自动保存改动后构建成功 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P7-Notes-Perf-2：输入链路降压但不减动画)

### Actions Taken
- Notes 页输入更新策略优化：
  - `requestAnimationFrame` 聚合编辑状态写入；
  - `startTransition` 降低非关键更新优先级；
  - `useDeferredValue` 用于状态徽标统计。
- Notes 侧栏性能优化：
  - `React.memo(NoteSidebar)`；
  - 搜索 debounce timer 改为 `ref`（避免定时器状态触发重渲染）。
- 动效策略：
  - 保留 `framer-motion` 动画配置，不做降级/删减。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/components/notes/NoteSidebar.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | 输入链路优化后构建成功 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P7-Nav-FirstPaint-1：实验/笔记/PDF 首次切页空白优化)

### Actions Taken
- `DocumentsPage`：
  - `AgentClusterBoard`、`TaskReceiptPanel` 由静态导入改为 `lazy + Suspense`。
  - 仅 `showSystemPanels=true` 时触发加载。
- `NotesPage`：
  - `NoteEditor` 改为 `lazy + Suspense`；
  - `NoteSidebar` 改为直连导入，避免 barrel 放大首屏依赖。
- `DashboardLayout`：
  - `<AnimatePresence mode="wait">` 改为 `mode="sync"`；
  - 新增空闲预取：`ExperimentsPage`、`DocumentsPage`、`NotesPage`。
- `vite.config.ts`：
  - 移除 `codemirror` 的 manual chunk 绑定，避免 `Experiments/Documents` 首次进入误拉编辑器大包。

### Files Modified
- `src/pages/DocumentsPage.tsx`
- `src/pages/NotesPage.tsx`
- `src/components/DashboardLayout.tsx`
- `vite.config.ts`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | 路由与懒加载改造后可正常构建 | `npm run -s build` 通过（19.68s） | ✅ |

## Update: 2026-02-23 (P7-Nav-FirstPaint-2：首屏隐藏态修复 + 入口包体瘦身)

### Actions Taken
- 入口链路瘦身：
  - `FloatingAgent` 改为 `lazyWithRetry` 异步加载；
  - 页面首屏后延迟 `280ms` 挂载，避免与主内容抢主线程。
- 开发态渲染降噪：
  - `main.tsx` 改为“仅生产启用 StrictMode”；
  - 开发模式不再双次触发副作用，减少重复网络请求与重渲染。
- 首帧可见性修复（空白页核心）：
  - `DashboardLayout` 路由容器移除 entering hidden 初始态（`initial={false}`）；
  - `NotesPage` / `DocumentsPage` / `ExperimentsPage` 关键容器移除 `opacity: 0` 首帧隐藏。
- 玻璃渲染开销优化：
  - `DashboardLayout` 固定层 `backdrop blur` 从 `20px` 下调到 `14px`，保留视觉同时降低合成压力。
- Vite dev 预构建减负：
  - `optimizeDeps.include` 收敛为 React 核心依赖；
  - 排除 `@mdxeditor/editor` / `@codemirror/language-data` / `three` / `react-force-graph-2d`。

### Files Modified
- `src/App.tsx`
- `src/main.tsx`
- `src/components/DashboardLayout.tsx`
- `src/pages/NotesPage.tsx`
- `src/pages/DocumentsPage.tsx`
- `src/pages/ExperimentsPage.tsx`
- `vite.config.ts`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建 | 首屏优化后可正常构建 | `npm run -s build` 通过（20.30s） | ✅ |
| 首屏 preload | 不再预加载 markdown vendor | `dist/index.html` 已移除 `vendor-markdown` preload | ✅ |
| 入口体积 | 入口 chunk 显著下降 | 由约 `113.51k` 降至约 `61.93k` | ✅ |

## Update: 2026-02-23 (P7-Notes-Perf-3：极速模式默认化 + 导航抖动修复)

### Actions Taken
- 新增 `src/components/notes/NoteEditorLite.tsx` 的页面级接入，默认作为 Notes 编辑器。
- `src/pages/NotesPage.tsx` 增加编辑器模式状态与本地持久化（`fast/advanced`）。
- 顶栏加入“极速 / 高级”模式切换；高级模式仍通过 lazy + Suspense 动态加载。
- 输入更新链路按模式分流：
  - `fast`：同步写入，优先键入流畅度；
  - `advanced`：保留并发优化策略。
- 插件命令结果写回改为复用 `handleContentChange`，保持单一状态入口。
- `src/components/DashboardLayout.tsx` 移除 path-keyed 路由动画容器，降低切页 remount 成本。
- `src/index.css` 将 `html` 滚动行为设为 `auto`，避免切页后平滑回滚导致的“空白/需滚轮触发”体感。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/components/DashboardLayout.tsx`
- `src/index.css`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（第 1 次） | 模式切换与路由容器调整后可构建 | `npm run -s build` 通过（22.91s） | ✅ |
| 前端构建（第 2 次） | 细节修正后稳定可构建 | `npm run -s build` 通过（23.23s） | ✅ |

## Update: 2026-02-23 (P7-Notes-AI-Simplify：实施记录)

### Actions Taken
- `NotesPage` 重构为简约主路径：移除极速模式与扩展命令等系统噪音，仅保留 AI 与专注写作控制。
- 新增 AI 内联修改流水：
  - 应用模式：追加 / 锚点后插入 / 锚点段替换 / 整篇替换；
  - 分段应用：按片段多次执行；
  - 可撤销：本地 undo 栈回退最近 AI 修改；
  - 可定位：关键词触发编辑器搜索定位与高亮链路。
- `NoteEditor` 增强：
  - 工具栏加入 `UndoRedo`、`InsertTable`、`InsertFrontmatter`、`InsertAdmonition`；
  - 接入 `searchPlugin` 与外部定位桥接；
  - 增加 Obsidian Callout 兼容转换（双向）。
- `note-assistant` 系统提示词更新：强调客观输出、权限边界、来源约束与结构化片段输出。
- 保留并延续 `vite optimizeDeps` 修复，确保高级编辑器加载稳定。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/components/notes/NoteAIPanel.tsx`
- `src/components/notes/NoteEditor.tsx`
- `server-py/app/agents/registry.py`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（简约改造后） | 可构建，且 Notes 主路径可加载 | `npm run -s build` 通过（19.99s） | ✅ |
| 前端构建（去除重型 source/diff 后） | 可构建且编辑器 chunk 回落 | `npm run -s build` 通过（19.99s） | ✅ |
| Python 语法检查 | note-assistant 提示词更新无语法错误 | `python3 -m py_compile app/agents/registry.py` 通过 | ✅ |

## Update: 2026-02-23 (P7-Notes-AI-Minimal：自然语言优先面板收敛)

### Actions Taken
- `NoteAIPanel` 移除复杂前端控制项（模式下拉、锚点输入、分段操作面板、检索输入）。
- 保留最小交互：自然语言输入、`应用建议`、`撤销`。
- 新增 `pathmind-edit` 控制块协议解析，由 agent 自主给出编辑动作（append/replace/anchor）。
- AI 回复仍以 Markdown 渲染，并保留用户确认写入的安全边界。

### Files Modified
- `src/components/notes/NoteAIPanel.tsx`
- `server-py/app/agents/registry.py`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（面板收敛后） | Notes AI 面板可构建运行 | `npm run -s build` 通过（20.52s） | ✅ |
| Python 语法检查 | 提示词修改不引入语法错误 | `python3 -m py_compile app/agents/registry.py` 通过 | ✅ |

## Update: 2026-02-23 (P7-Notes-AI-Minimal-2：低风险自动应用 + 能力可感知)

### Actions Taken
- AI 面板新增“低风险自动应用”策略：
  - `append / insert_after_anchor / replace_anchor` 自动执行；
  - `replace_all` 仍需用户显式确认。
- 锚点动作失败时自动降级为 `append`，减少用户手工干预。
- 新增轻量工具链状态条（最近工具调用），让用户感知 agent 在自主执行检索/协作。
- 保留最小交互：自然语言输入 + 应用确认（仅高风险）+ 撤销。

### Files Modified
- `src/components/notes/NoteAIPanel.tsx`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（自动应用策略后） | 可构建且无类型回归 | `npm run -s build` 通过（21.16s） | ✅ |

## Update: 2026-02-23 (P7-Notes-Perf-4：流式批处理 + 滚动稳定性)

### Actions Taken
- `src/hooks/useAgentStream.ts`
  - 新增流式文本缓冲与 `28ms` 批量 flush，避免 token 级 `setState` 风暴。
  - `stop/clear/send/finally` 全链路补齐 pending chunk 清理与落盘，防止残留状态。
- `src/components/notes/NoteAIPanel.tsx`
  - 消息渲染拆分为 `MarkdownMessage` + `MessageBubble` memo 组件，降低历史消息重渲染。
  - 自动滚动改为 RAF 调度：流式 `auto`、完成态 `smooth`。
  - 流式阶段暂停编辑计划解析，减少无效计算。
- `src/pages/NotesPage.tsx`
  - AI 面板上下文内容改为 `useDeferredValue(editContent)`，减轻打字时侧栏同步渲染。
- `src/components/DashboardLayout.tsx`
  - 路由切换滚动重置升级为“同步 + 双 RAF + 120ms 补偿”，提升首帧回位稳定性。

### Files Modified
- `src/hooks/useAgentStream.ts`
- `src/components/notes/NoteAIPanel.tsx`
- `src/pages/NotesPage.tsx`
- `src/components/DashboardLayout.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P7-Notes-Perf-4） | 流式与滚动优化后可正常构建 | `npm run -s build` 通过（19.99s） | ✅ |

## Update: 2026-02-23 (P7-Notes-Layout-Fix：笔记页仅上半屏渲染)

### Actions Taken
- 修复 `NotesPage` 根容器高度语义：`h-full min-h-0` 调整为 `h-full min-h-screen`，确保页面在布局中至少占满一屏。
- 修复 `DashboardLayout` 主内容承载层：`Outlet` 容器改为 `min-h-screen h-full flex flex-col`，为子页面提供稳定高度上下文。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/components/DashboardLayout.tsx`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（布局高度修复后） | Notes 页面编译无回归 | `npm run -s build` 通过（25.96s） | ✅ |

## Update: 2026-02-23 (P7-Notes-Stream-Smooth：防整页位移 + 丝滑流式)

### Actions Taken
- `NoteAIPanel` 滚动策略改造：
  - 移除 `scrollIntoView`，改为消息容器内 `scrollTop` 控制；
  - 仅在“贴底”状态自动滚动，避免拉动整页；
  - 流式阶段 `auto`，完成后 `smooth`，减少滚动动画抖动。
- `NoteAIPanel` 消息渲染优化：
  - Markdown 容器补齐 `break-words` 与 `pre` 横向滚动约束；
  - bubble 容器 `overflow-hidden`，防止长文本撑破布局。
- `useAgentStream` 流式刷新优化：
  - 文本刷帧从 `setTimeout` 批处理改为 `requestAnimationFrame` 批处理；
  - 降低“卡一卡”字符感并保持主线程负载可控。
- 布局高度链路加固：
  - `DashboardLayout` 改为 `h-screen/min-h-0` 体系；
  - `NotesPage` 回归 `h-full/min-h-0`，并补齐中间层 `min-h-0`。

### Files Modified
- `src/components/notes/NoteAIPanel.tsx`
- `src/hooks/useAgentStream.ts`
- `src/components/DashboardLayout.tsx`
- `src/pages/NotesPage.tsx`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（流式与布局修复后） | Notes/AI 面板可正常构建运行 | `npm run -s build` 通过（26.72s） | ✅ |

## Update: 2026-02-23 (P7-Notes-UX-5：折叠分析 + 自动建笔记 + RAG 兜底)

### Actions Taken
- `src/components/notes/NoteAIPanel.tsx`
  - 助手消息渲染新增 `renderAssistantContent`：
    - 自动移除 `pathmind-edit` 控制块正文显示；
    - 将 action/anchor 以小提示条展示；
    - “## 分析”段默认折叠，点击展开查看；
    - 可应用正文保持 Markdown 渲染。
  - 写入动作改为支持异步 `onApplyEdit`，并接入 `onEnsureNoteTarget`。
  - 发送消息前若无目标笔记，先确保创建/选中目标笔记。
- `src/pages/NotesPage.tsx`
  - 新增 `ensureNoteTarget`：未选中笔记时自动创建并切换。
  - `handleApplyEdit` 改为异步：先确保目标笔记，再执行编辑并落库更新。
  - 将 `ensureNoteTargetReady` 传给 AI 面板。
- `server-py/app/services/rag_service.py`
  - 新增 `_keyword_fallback_query` 关键词兜底检索。
  - `query()` 在以下场景自动回退：
    - embedding key 缺失；
    - query embedding 请求异常；
    - 向量召回为空。

### Files Modified
- `src/components/notes/NoteAIPanel.tsx`
- `src/pages/NotesPage.tsx`
- `server-py/app/services/rag_service.py`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P7-Notes-UX-5） | Notes AI 交互改造后可正常构建 | `npm run -s build` 通过（27.60s） | ✅ |
| Python 语法检查（RAG 兜底） | 无语法错误 | `python3 -m py_compile app/services/rag_service.py` 通过 | ✅ |

## Update: 2026-02-23 (P7-Notes-UX-6：误写保护 + 面板溢出治理)

### Actions Taken
- `NoteAIPanel.parseEditPlan` 增加自动应用前置条件：
  - 仅当存在 `pathmind-edit` 控制块，或存在 `## 可应用片段` 区段时才会解析写入计划；
  - 防止普通解释性回复被误判为 `append` 并自动写入。
- `MarkdownMessage` 增强侧栏渲染边界：
  - `overflow-wrap:anywhere`、`break-words`；
  - `pre/table` 添加 `max-w-full + overflow` 限制；
  - `th/td` 断词，避免宽内容撑破 AI 面板。

### Files Modified
- `src/components/notes/NoteAIPanel.tsx`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（UX-6 收尾） | Notes AI 面板可正常编译 | `npm run -s build` 通过（21.35s） | ✅ |
| Python 语法检查（关键后端） | 关键服务文件无语法错误 | `python3 -m py_compile app/services/rag_service.py app/tools/builtin/note/tools.py` 通过 | ✅ |

## Update: 2026-02-23 (P7-Notes-UX-7：笔记切换一致性 + 分析展开丝滑 + 写入可见性)

### Actions Taken
- `NotesPage`：`NoteEditorAdvanced` 增加 `key={activeNoteId}`，切换笔记时强制重挂载编辑器，避免显示旧内容。
- `NoteAIPanel`：分析区从原生 `details` 改为轻量折叠块，按需渲染 Markdown 并使用过渡动画，降低展开卡顿。
- `NoteAIPanel`：工具轨迹新增“内联写入：成功/失败”状态，提升写入可观测性。
- 日志核验：
  - `POST /api/agent/stream` 后存在 `PUT /api/notes/{id}` 200；
  - 笔记切换请求命中不同 ID 且 200；
  - 数据库两条笔记内容确实不同，问题定位为前端展示层。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/components/notes/NoteAIPanel.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Validation
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（UX-7） | 笔记切换与 AI 折叠改造后可正常构建 | `npm run -s build` 通过（21.16s） | ✅ |

## Update: 2026-02-23 (P1-1 CM6 Transaction 流式写入)

### Actions Taken
- `NoteEditor` 暴露 `NoteEditorHandle`，新增 `applyAIChange/getContent/focus` 命令式接口。
- AI 写入改为 CM6 原生事务：`Transaction.userEvent('ai.output') + EditorView.scrollIntoView`。
- 流式写入改为 `requestAnimationFrame` 分帧批量插入，避免 React 每 token 重渲染。
- 新增外部同步锁（`lockExternalSyncRef`），避免 AI 流式期间被旧 `content` prop 反向覆盖。
- `NotesPage.handleApplyEdit` 改为走 editor ref 的事务写入，不再走 React `setState` 动画拼接。
- 撤销 AI 修改也走 CM6 replace transaction，保持一致的编辑器行为。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P1-1） | 事务流式写入改造后可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P1-2 关键词定位高亮)

### Actions Taken
- 在 `NoteEditor` 增加 `revealRange(from, to)` 命令式 API。
- 使用 `StateEffect + StateField + Decoration.mark` 管理 AI 定位高亮（可随文档变更自动映射）。
- 定位时执行 `EditorSelection.range + EditorView.scrollIntoView(y:center)`，视口自动居中到命中位置。
- 加入 2.2s 高亮自动清理效果，避免长期污染阅读视图。
- Notes 页面 `handleLocateQuery` 改为优先调用编辑器原生定位，而非仅提示文本行号。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P1-2） | 定位高亮改造后可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P2 Obsidian 语法增强)

### Actions Taken
- `NoteEditor` 新增 wikilink click handler：`Cmd/Ctrl + Click` 触发 `onOpenWikilink`。
- 双链 token 增加 `cm-wikilink` 类，保留 CM6 原生装饰，不走 React 渲染。
- 新增 callout 块级插件：扫描可视区 `> [!TYPE]` 开头段落，并对后续连续 `>` 行做统一继承样式。
- callout 首行注入轻量 SVG `Decoration.widget` 图标，避免引入重型图标组件。
- NotesPage 接入 wikilink 路由策略：优先本地命中，其次后端检索，未命中自动创建并跳转。
- 补齐液态玻璃风格样式：wikilink hover、callout 渐变背景、边框和暗色主题映射。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`
- `src/index.css`
- `task_plan.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P2） | 双链与 callout 增强后可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P2.3 Wikilink Hover 预览)

### Actions Taken
- `NoteEditor` 增加 `onHoverWikilink` 事件通道，基于 CM6 `domEventHandlers.mousemove/mouseleave` 实现悬浮检测。
- 对 `cm-wikilink` 加入 500ms 防抖，避免鼠标划过时频繁触发。
- 预览采用页面单例卡片，不为每个双链挂 React 组件，保持渲染轻量。
- `NotesPage` 接入预览缓存（Map）：本地命中优先，远程检索次之，未命中给出“可自动创建”提示。
- 新增 glassmorphism 预览卡样式与入场动画，保持液态玻璃风格一致。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`
- `src/index.css`
- `task_plan.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P2.3） | 双链悬浮预览改造后可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P2.4 Agent Summary 轻入口)

### Actions Taken
- 在 `[[wikilink]]` 预览卡加入 `Agent Summary` 按钮与流式摘要展示区域。
- 摘要请求走 `agentApi.stream`，并注入 runtime 路由：`mode=fast` + `engine=openai`。
- 预览卡增加摘要状态：loading bar、stream text、error state、engine chip。
- 维持单例架构：不挂多个卡片组件，保留防抖与缓存策略。
- 新增摘要缓存（按双链 target），二次打开同一双链可秒开摘要。
- 优化预览交互：编辑器离开后短延时关闭，支持鼠标移动到预览卡内点击按钮。
- Prompt 中注入局部上下文：当前笔记节选 + 目标双链摘要 + 相关双链摘要（局部 context）。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/index.css`
- `task_plan.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P2.4） | Agent Summary + 流式预览可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P2.4-C 后端显式分流)

### Actions Taken
- Python 新增 `AIDispatcher`（任务类型分流 + summary 缓存 + openai→claude fallback）。
- Python 新增路由 `POST /api/ai/dispatch/stream`，统一 AI 分发入口。
- Go 网关新增代理接口 `POST /api/ai/dispatch/stream`，接入鉴权、限流与 telemetry。
- Go `AgentProxyService` 增加 `StreamDispatch`，显式转发到 Python `/ai/dispatch/stream`。
- 前端 Notes 预览摘要切换到 `aiDispatchApi.stream`，携带 `taskType/priority/cacheKey/contextSnapshot`。
- 增加服务端 summary 缓存 API（`CacheService.get_ai_summary/set_ai_summary`）。

### Files Modified
- `server-py/app/services/ai_dispatcher.py`
- `server-py/app/api/ai_dispatch_routes.py`
- `server-py/app/api/__init__.py`
- `server-py/app/services/cache_service.py`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `src/services/api.ts`
- `src/pages/NotesPage.tsx`
- `task_plan.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查 | Dispatcher 与新路由可编译 | `python -m py_compile ...` 通过 | ✅ |
| Go 编译检查 | 新网关路由与代理可编译 | `go test ./...` 通过 | ✅ |
| 前端构建 | 新 dispatch API 接入可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P3-Metrics-Prework：内存指标 + 降级提示)

### Actions Taken
- Python 新增内存指标收集器 `DispatchMetricsCollector`：统计 requests/cache hit/fallback、60s QPS、60s fallback rate、bucket 维度 p95 TTFT 与 p95 duration。
- `AIDispatcher` 流程埋点：路由选择、cache hit、首包 TTFT、fallback 触发、请求成功/失败与总耗时。
- Python 新增接口 `GET /api/ai/dispatch/metrics`，输出 dispatcher 指标快照。
- Go 网关新增代理与处理器：`GET /api/ai/dispatch/metrics`（统一鉴权/限流域内可见）。
- 前端 `NotesPage` 摘要流新增 `dispatch_meta` 解析：动态展示实际引擎，并在 `openai -> claude` 时显示“已切换至备用引擎”微提示。

### Files Modified
- `server-py/app/services/ai_dispatch_metrics.py`
- `server-py/app/services/ai_dispatcher.py`
- `server-py/app/api/ai_dispatch_routes.py`
- `server-go/internal/service/agent_proxy_service.go`
- `server-go/internal/handler/agent_handler.go`
- `server-go/cmd/server/main.go`
- `src/pages/NotesPage.tsx`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查 | 指标收集器与分发埋点可编译 | `python3 -m py_compile ...` 通过 | ✅ |
| Go 编译检查 | 新 metrics 代理路由可编译 | `go test ./...` 通过 | ✅ |
| 前端构建 | `dispatch_meta` 解析与提示可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P3-Invisible + P4.1 Inline Copilot)

### Actions Taken
- 后端 `AIDispatcher` 新增静默自适应：当 `summary|openai` 的 p95 TTFT >= 2000ms 时，自动改走 `claude`，无需前端显式切换。
- 后端增加 ContextSnapshot 自适应缩放：高负载场景自动收缩 `referenced_summaries`，优先保证首字延迟。
- `DispatchMetricsCollector` 新增 `runtime_hints()`，给分发层提供低开销实时信号（QPS/fallback rate/openai TTFT p95）。
- 编辑器新增 CM6 内联补全基建：灰色幽灵文本（Decoration Widget）+ `Tab` 接受 + 文档变更自动清理。
- Notes 页新增 500ms 停顿触发的流式补全请求（`taskType=inline_complete`），含防抖、并发序号、Abort 中断，避免请求堆积。

### Files Modified
- `server-py/app/services/ai_dispatch_metrics.py`
- `server-py/app/services/ai_dispatcher.py`
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`
- `src/index.css`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查 | 自适应分发逻辑可编译 | `python3 -m py_compile ...` 通过 | ✅ |
| Go 编译检查 | 未引入网关回归 | `go test ./...` 通过 | ✅ |
| 前端构建 | CM6 内联补全链路可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P4.2 连续补全 + 三栏液态布局)

### Actions Taken
- `NoteEditor` 新增补全快捷键增强：`Escape` 立即清理幽灵补全，`Tab` 接受后触发回调用于下一轮联想。
- `NotesPage` 增加补全调度器：默认 520ms 防抖，`Tab` 接受后 240ms 快速续写，保持连续补全体验。
- 用户输入时立即 `AbortController.abort()` 取消进行中的补全请求，并清理旧补全，避免错位回填。
- 页面布局升级为三栏液态结构：左侧资源栏（支持 `Cmd/Ctrl+B`）、中间限宽编辑区（`max-w-[920px]`）、右侧 AI 上下文栏。
- 顶栏新增健康状态指示点（healthy/fallback），右侧栏新增共享记忆预留区（读取 `agentMemoryBridge` 最近记录）。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`
- `src/index.css`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查 | 后端自适应策略无回归 | `python3 -m py_compile ...` 通过 | ✅ |
| Go 编译检查 | 网关层保持可用 | `go test ./...` 通过 | ✅ |
| 前端构建 | P4.2 布局与补全无语法回归 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P4.3 上下文记忆与回溯)

### Actions Taken
- `agentMemoryBridge` 升级为轻量 CAS：按 `content_hash` 存储快照，避免重复文本冗余写入。
- 新增相关记忆检索 `getRelevantMemories`：基于当前笔记上下文标签 + Jaccard 相似度打分，优先返回同笔记 revision 记录。
- 新增回溯应用 `applyRevision`：应用前自动保存当前内容快照，支持快速反悔链路。
- `NotesPage` 写入后自动沉淀 revision 记忆（before/after hash、anchor、summary）。
- 右侧 Shared Memory 升级：支持预览 diff、应用回溯、关闭预览。
- `NoteEditor` 新增 revision diff 预览层（非覆盖）：红色删除标记 + 绿色新增标记，点击“回溯”后才真正写入文档。

### Files Modified
- `src/services/agentMemoryBridge.ts`
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`
- `src/index.css`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查 | 后端自适应逻辑保持通过 | `python3 -m py_compile ...` 通过 | ✅ |
| Go 编译检查 | Go 服务无回归 | `go test ./...` 通过 | ✅ |
| 前端构建 | P4.3 记忆/回溯/差异预览可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-23 (P5 交互抛光：Fluid Motion)

### Actions Taken
- CM6 增加 AI 输出流式入场动画层：`ai.output` 事务在 `ViewUpdate` 中通过 `requestAnimationFrame` 批量标注 `cm-ai-output`，并在短延时后清理，减少同步抖动。
- 编辑器补全与输出动效统一：`pm-note-inline-suggestion` 与 `cm-ai-output` 使用 150~160ms 的 `transform + opacity` 动画。
- 三栏切换改为弹性过渡：侧栏与右栏增加 spring 曲线与 `pm-elastic-panel` 惯性过渡，中间区启用 `layout` 动画平滑扩展。
- Shared Memory 卡片升级为层叠玻璃动效：使用 `AnimatePresence + motion.div(layout)`，支持预览按钮出现/消失的平滑过渡。
- 顶栏健康指示增加环境状态动画：`thinking` 呼吸态、`cache hit` 闪烁态，降低等待期间“静止卡住”的体感。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/pages/NotesPage.tsx`
- `src/index.css`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法检查 | 后端无回归 | `python3 -m py_compile ...` 通过 | ✅ |
| Go 编译检查 | Go 侧无回归 | `go test ./...` 通过 | ✅ |
| 前端构建 | P5 动效与布局改造可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-24 (Notes 输入异常热修)

### Actions Taken
- 定位输入异常根因：`NoteEditor` 在 `content` 变化时被反复销毁重建，导致焦点/IME 连续输入中断。
- 修复 `src/components/notes/NoteEditor.tsx` 初始化 effect 依赖，避免按键级 EditorView 重建。
- 保留外部同步 effect 处理内容更新，确保受控状态与 CM6 实例解耦。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（输入热修后） | 可编译、无类型回归 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-24 (CM6 官方调研与实施规划)

### Actions Taken
- 调研 CodeMirror 官方文档（Decorations / Autocomplete / Tab）与 `lang-markdown` 官方仓库。
- 调研 Obsidian 官方帮助与开发文档（Live Preview、Internal links、Callouts、Decorations）。
- 对照当前 `NotesPage + NoteEditor` 实现，确认“无实时内联渲染/补全弱感知”的根因是扩展策略和触发门槛，而非 CM6 本身能力缺失。

### Output
- 形成 P0/P1/P2 分阶段改造建议：先补全可见性与可用性，再做内联 Live Preview。

## Update: 2026-02-24 (P0 补全触发释放 + 状态可见)

### Actions Taken
- Notes 页内联补全门槛从保守策略调整为低延迟策略（280ms 静默、5 字符触发）。
- 删除侧栏 AI 与内联补全互斥条件，允许并发体验。
- 增加本地补全缓存（noteId + 上下文哈希）并设置 TTL，减少重复请求。
- 增加补全进行中微状态指示（顶栏与编辑器工具条）。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/components/notes/NoteEditor.tsx`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P0 后） | 补全链路改造可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-24 (Markdown 预览可见性修复)

### Actions Taken
- Notes 编辑区在开启预览时改为双区固定布局，确保预览可见。
- ReactMarkdown 改为直接使用 `editContent` 实时渲染。

### Files Modified
- `src/pages/NotesPage.tsx`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（预览修复后） | 可编译、预览布局无回归 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-24 (P1 首版 CM6 内联 Live Preview)

### Actions Taken
- 在 `NoteEditor` 接入视口裁剪版 `livePreviewPlugin`，实现 markdown 符号“非当前行消隐”。
- 新增标题/粗体/行内代码/双链对应样式规则，保持编辑态可读性。
- 增强双链目标提取逻辑，兼容隐藏 `[[ ]]` 后的点击与悬浮。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/index.css`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（P1 首版后） | 内联渲染扩展可编译 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-24 (移除分屏预览 + 斜体内联补齐)

### Actions Taken
- 移除 Notes 页分屏 Markdown 预览入口（按钮+面板），避免与内联渲染并存造成认知冲突。
- CM6 Live Preview 补齐斜体渲染与标题前导空格兼容。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/components/notes/NoteEditor.tsx`
- `src/index.css`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（分屏预览移除后） | 可编译、Notes 页面无回归 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-24 (半高修复 + token级避让)

### Actions Taken
- `NotesPage` 编辑器容器补 `h-full`，修复“编辑区只占半边”体感问题。
- `NoteEditor livePreviewPlugin` 从整行跳过改为 token 级光标避让，解决双反引号后整行渲染失效。
- 清理 `NotesPage` 未使用的 `useDeferredValue/deferredAIContextContent` 残留。

### Files Modified
- `src/pages/NotesPage.tsx`
- `src/components/notes/NoteEditor.tsx`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（本轮修复后） | 可编译、无类型错误 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-24 (标题时机与代码渲染规则修正)

### Actions Taken
- `NoteEditor livePreviewPlugin` 增加 heading 提交条件（避免 `## ` 后立即消隐）。
- inline code 规则升级为多反引号配对（` + ``）。
- 新增 fenced code block（```/~~~）内联样式与 fence 行处理。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `src/index.css`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（规则修正后） | 可编译、编辑器逻辑可运行 | `npm run -s build` 通过 | ✅ |

## Update: 2026-02-24 (token内样式保留 + 全角反引号兼容)

### Actions Taken
- 调整 live preview：光标在 token 内时仍保留内容样式，仅保留可编辑标记。
- inline/fence code regex 扩展支持全角反引号 `｀`。
- 活动行计算改为仅在 editor focus 时生效。

### Files Modified
- `src/components/notes/NoteEditor.tsx`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端构建（本轮热修） | 可编译、无类型回归 | `npm run -s build` 通过 | ✅ |

## 2026-02-24 14:xx Live Preview hotfix
- 定位并修复 `src/components/notes/NoteEditor.tsx` 中 live preview 装饰顺序问题。
- 添加 pending decoration 队列与统一排序提交，避免 RangeSetBuilder 顺序异常。
- 运行 `npm run -s build` 验证通过。

## 2026-02-24 代码块增强 P1.2
- `NoteEditor` 新增 `codeBlockToolbarPlugin`：识别 fenced code block，注入“语言标签+复制”工具条。
- 启用 `syntaxHighlighting(defaultHighlightStyle, { fallback: true })`，补全亮色主题代码 token 着色。
- `index.css` 新增代码块工具条样式与 hover 显示逻辑。
- `npm run -s build` 通过。

## 2026-02-24 高亮崩溃修复
- 简化 `lightCodeHighlightStyle` 标签集合，去除高风险组合标签，保留稳定子集。
- 将高亮扩展固定到 `baseExtensions`，不再随主题 reconfigure 反复切换。
- 保留 fenced code 的语言信息隐藏策略，避免前导 `python` 残留。
- `npm run -s build` 通过。

## 2026-02-24 语法高亮稳定化（避开 TreeHighlighter 崩溃）
- 移除 `NoteEditor` 中 `syntaxHighlighting` 与 `@lezer/highlight` 依赖路径。
- 在 `livePreviewPlugin` 里为 fenced code 增加基于语言的正则高亮标记。
- 为新增 token class 增补亮/暗色样式。
- `npm run -s build` 通过。

## 2026-02-24 崩溃兜底 + markdown 扩展稳态配置
- `markdown` 配置改为 `base: markdownLanguage` + `codeLanguages: languages`，并禁用 `addKeymap/completeHTMLTags/pasteURLAsLink` 以规避 `Language.isActiveAt` 崩溃路径。
- `content` 同步 dispatch 增加 try/catch；异常时自动重建 editor state，避免编辑器彻底卡死。
- 当前代码高亮走自定义 fenced-code 装饰链路，已与 TreeHighlighter 解耦。
- `npm run -s build` 通过。

## 2026-02-24 编辑体验修复（代码块/语法）
- 修复代码块光标行背景冲突：`cm-activeLine` 改为透明，并在 CSS 中仅对非代码块行高亮。
- 代码块灰底加入小圆角（起始/结束行 6px）。
- 新增 `==highlight==` 行内渲染。
- 新增表格行弱样式（含分隔线）。
- 新增 Enter 续写列表：`-`、`1.`、`- [ ]` 自动续写；空项回车退出列表。
- `npm run -s build` 通过。

## 2026-02-25 Notes Obsidian 化实施记录

### 后端
- 重写 `server-go/internal/service/note_service.go`：
  - 新增 `NoteTreeSnapshot`、`NoteReorderPayload`。
  - 新增 folder CRUD / reorder / tree 查询。
  - 增加 legacy backfill（folder 字符串映射 folder_id + sort_order 初始化）。
  - 新增业务错误常量并在 handler 映射状态码。
- 重写 `server-go/internal/handler/note_handler.go`：
  - 扩展 note create/update 入参（`folder_id`, `sort_order`）。
  - 新增 `GetTree/CreateFolder/UpdateFolder/DeleteFolder/Reorder`。
- 更新 `server-go/cmd/server/main.go`：
  - `/api/notes` 与 `/api/internal/notes` 同步挂载 tree/folder/reorder 路由。
- 更新 `server-go/internal/database/database.go`：
  - `AutoMigrate` 增加 `models.NoteFolder`。
- 验证：`cd server-go && go test ./...` 通过。

### 前端
- 更新 `src/services/api.ts`：
  - 新增 `NoteFolder/NoteTreeResponse/NoteReorderPayload`。
  - 新增 `notesApi.getTree/createFolder/updateFolder/deleteFolder/reorder`。
  - 兼容扩展 note `folder_id/sort_order`。
- 新增 `src/hooks/useNotesTree.ts`：
  - 统一管理 tree 数据、搜索过滤、乐观标题更新、重排回滚。
- 重构 `src/components/notes/NoteSidebar.tsx`：
  - 单栏树结构（文件夹+笔记同栏）。
  - 支持展开/折叠、同级拖拽、拖入文件夹、文件夹重命名、删除入口。
- 更新 `src/pages/NotesPage.tsx`：
  - 接入 `useNotesTree`。
  - 顶栏极简化（左开关 + 标题 + 右 Agent）。
  - 标题 400ms debounce 自动保存 + 左栏乐观同步。
  - 左栏宽度拖拽持久化（220-420）。
  - 右侧 Agent 标题改为 `editTitle` 实时态。
- 新增全局右键系统：
  - `src/contexts/ContextMenuContext.tsx`。
  - `src/App.tsx` 挂载 `ContextMenuProvider`。
  - Notes 树节点/空白区/编辑区接入自定义菜单。
- 扩展 `src/components/notes/NoteEditor.tsx`：
  - `NoteEditorHandle.runEditorAction` 支持 Undo/Redo/Cut/Copy/Paste/Select All。
- 验证：
  - `npm run -s build` 通过。
  - `npm run -s test` 通过（inlineCompletionCore 8/8）。

## 2026-02-25 未完成项补齐（测试与解析模块）

### 新增前端测试/模块
- `src/components/notes/treeDnd.ts`
  - 抽离拖拽落点解析与 reorder payload 生成。
- `src/components/notes/treeDnd.test.ts`
  - 覆盖 `before/after/inside` 判定与 note/folder payload 解析。
- `src/hooks/useDebouncedNoteTitleSave.ts`
  - 抽离标题 400ms 防抖保存逻辑。
- `src/hooks/useDebouncedNoteTitleSave.test.ts`
  - 验证：乐观更新即时触发、400ms 后保存、同标题不重复保存。
- `src/pages/notesContextMenus.ts`
  - 抽离 Notes 菜单 resolver（node/editor/blank）。
- `src/pages/notesContextMenus.test.ts`
  - 覆盖 node/editor/blank 菜单 action id 解析。
- `src/contexts/ContextMenuContext.test.ts`
  - 覆盖 global fallback 菜单动作构造。
- `src/components/notes/NoteSidebar.test.tsx`
  - 覆盖单栏树渲染与展开/折叠交互。

### 后端测试补齐
- `server-go/internal/service/note_service_helpers_test.go`
  - 覆盖：folder path 归一化、folder name 校验、uuid 解析、排序插入与指针比较逻辑。

### 验证
- `npm run -s test`：6 个测试文件，22 个测试，全通过。
- `npm run -s build`：通过。
- `cd server-go && go test ./...`：通过。

## 2026-02-25 后端 API 合约测试补齐

- 重构 `server-go/internal/handler/note_handler.go`：
  - handler 依赖从具体 `*NoteService` 改为 `noteHandlerService` 接口，便于单测注入。
- 新增 `server-go/internal/handler/note_handler_test.go`：
  - `CreateFolder` 非法 `parent_id` 返回 400。
  - `Reorder` 请求体到服务层 payload 映射正确。
  - `GetTree` 返回结构与 tags 序列化正确。
- 验证：`cd server-go && go test ./...` 通过（含 handler 测试）。

## 2026-02-25 剩余两项收尾（Playwright + Go 集成测试）

### Actions Taken
- 为 Notes 页补齐 E2E 稳定选择器：
  - `src/pages/NotesPage.tsx` 增加 `data-testid`（标题输入、左栏容器、左栏拖拽柄、编辑区右键区域、左右栏开关）。
- 新增 Playwright 基础设施与用例：
  - `playwright.config.ts`
  - `tests/e2e/notes.spec.ts`
  - `package.json` 新增 `test:e2e/test:e2e:headed`
  - `.gitignore` 增加 Playwright 报告产物目录
- 新增 Go 端 sqlite 集成测试：
  - `server-go/internal/service/note_service_integration_test.go`
  - 覆盖 `Reorder` 事务回滚（trigger 注入故障）与并发一致性（`sort_order` 连续唯一）。
- Go 端新增 `gorm.io/driver/sqlite` 测试依赖，保持 `gorm.io/gorm` 版本不升级（回退到 `v1.25.5`）。

### Files Modified
- `src/pages/NotesPage.tsx`
- `tests/e2e/notes.spec.ts`
- `playwright.config.ts`
- `.gitignore`
- `package.json`
- `package-lock.json`
- `server-go/internal/service/note_service_integration_test.go`
- `server-go/go.mod`
- `server-go/go.sum`
- `task_plan.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| 前端单测 | 现有单测无回归 | `npm run -s test` 通过（6 files / 22 tests） | ✅ |
| 前端构建 | E2E/testid 变更后可编译 | `npm run -s build` 通过 | ✅ |
| Playwright E2E | Notes 交互用例通过 | `npm run -s test:e2e` 通过（4 tests） | ✅ |
| Go 全量测试 | sqlite 集成测试 + 现有测试通过 | `cd server-go && go test ./...` 通过 | ✅ |

## Update: 2026-02-26（Anthropic 工具链路 + 灵动岛轨迹修复）

### Actions Taken
- 后端工具适配层：`server-py/app/engines/tool_converter.py`
  - 新增工具参数兜底注入：当工具 schema 含 `student_id` 且模型未提供时，自动从 `AgentRequestContext` 注入。
  - `build_tool_defs(...)` 改为包装 handler，统一执行参数标准化。
- Anthropic 引擎：`server-py/app/engines/anthropic_engine.py`
  - 新增 `tool_result` 规范构造函数：将 `content` 与顶层 `is_error` 正确回传给 Anthropic。
  - 工具执行完成事件支持 `status=error` 与 `reason`，并补发 `build_frontend_events_from_result(...)`。
- 前端流事件解析：`src/hooks/useAgentStream.ts`
  - `tool_call` 事件解析补齐 `reason/stage` 字段透传。
- 灵动岛 UI：`src/components/FloatingAgent.tsx`
  - 轨迹展示从“顶部全局块”改为“每个 assistant 气泡内联、可折叠、流式更新”。
  - 新增 message-scoped trace 状态持久化（`traceByMessage` / `traceExpandedByMessage`）。
  - 发送消息时补齐 `studentId + tenant` 透传，降低工具缺参失败概率。

### Files Modified
- `server-py/app/engines/tool_converter.py`
- `server-py/app/engines/anthropic_engine.py`
- `src/hooks/useAgentStream.ts`
- `src/components/FloatingAgent.tsx`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法校验 | 新增后端改动可解析 | `cd server-py && python -m py_compile app/engines/tool_converter.py app/engines/anthropic_engine.py` 通过 | ✅ |
| TS 类型校验 | 前端改动类型安全 | `npx tsc -p tsconfig.app.json --noEmit --pretty false --noUnusedLocals false` 通过 | ✅ |
| 前端全量构建 | 验证无回归 | `npm run -s build` 命中既有无关错误：`NoteAIPanel.tsx(418,10) TS6133` | ⚠️ |

## Update: 2026-02-27（委托白名单 + update_note 通路）

### Actions Taken
- 修改 `server-py/app/services/delegation_runtime.py`：为 `command-center` 添加可委托目标集。
- 修改 `server-py/app/services/webagent_core/data_adapter.py`：新增 `put_json` 接口与实现。
- 修改 `server-py/app/tools/builtin/note/tools.py`：新增 `update_note` 工具（调用 `PUT /internal/notes/:id`，并校验至少一个更新字段）。
- 修改 `server-py/app/tools/builtin/note/manifest.yaml`：注册 `update_note`。
- 修改 `server-py/app/agents/registry.py`：
  - `note-assistant` 工具列表加入 `update_note`；
  - `command-center` 工具列表加入 `update_note`；
  - “修改笔记”路由提示词更新为 `update_note/get_note_content/search_notes` 组合。

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Python 语法校验 | 新改动文件可解析 | `cd server-py && ./.venv/bin/python -m py_compile app/services/delegation_runtime.py app/services/webagent_core/data_adapter.py app/tools/builtin/note/tools.py app/agents/registry.py` 通过 | ✅ |
| ToolRegistry 扫描 | `update_note` 被加载 | `has_update_note=True` | ✅ |
| 委托白名单读取 | `command-center` 允许 `note-assistant` | `allowed_targets_for('command-center')` 含 `note-assistant` | ✅ |

## Update: 2026-02-27 (Remote Armbian proxy diagnosis kickoff)

### Actions Taken
- 按 `planning-with-files` 流程完成 session catchup。
- 读取并确认现有 `task_plan.md / findings.md / progress.md`。
- 新增远程诊断任务阶段（R1~R4），准备进入 SSH 实操检查。

### Files Modified
- `task_plan.md`
- `findings.md`
- `progress.md`

## Update: 2026-03-01（创业计划书：脑机模板迁移 + MCP 数据基线）

### Actions Taken
- 按 `planning-with-files` 执行会话恢复并读取当前 `task_plan.md / findings.md / progress.md`。
- 扫描仓库文档，确认模板来源：
  - `docs/脑机与应急机器人算法应用赛 武汉商学院 AIC-2025-20852298 Smart Brain技术报告.docx`
  - `docs/PathMind-AI创业计划书.md`
  - `docs/PathMind-AI创业计划书-技术版.md`
- 用 `pandoc` 将脑机报告转为 markdown，抽取章节骨架（摘要、关键词、引言分节）用于新计划书叙事框架。
- 通过联网检索收集官方数据与政策来源，形成“不可编造”的市场基线。

### Files Modified
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test/Verification
| Check | Expected | Actual | Status |
|------|----------|--------|--------|
| 模板定位 | 找到可复用“脑机接口”模板 | 已定位并完成结构抽取 | ✅ |
| 市场数据来源 | 使用官方/权威公开来源 | 已整理教育部、国家统计局、国务院、CNNIC、网信办来源 | ✅ |

## Update: 2026-03-01（计划书文档交付）

### Actions Taken
- 新增文档：`docs/PathMind-AI创业计划书-MCP主动编排版.md`。
- 采用“脑机接口技术报告”结构风格（摘要、关键词、引言分节）重构为创业计划书语境。
- 明确突出项目差异：`Agent-native`、`主动工具编排`、`MCP 标准化`、`本地工具链 Web 化`。
- 移除未经验证的收入规模预测，保留 B2B2C + SaaS 方向与阶段化实施计划。

### Files Modified
- `docs/PathMind-AI创业计划书-MCP主动编排版.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Test/Verification
| Check | Expected | Actual | Status |
|------|----------|--------|--------|
| 文档生成 | 新计划书可读且结构完整 | 已生成并完成人工校对 | ✅ |
| 数据声明 | 避免编造，附公开来源 | 已在附录 A 列出来源链接与检索日期 | ✅ |
