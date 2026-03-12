# PathMind AI — Project Context

## Architecture

Three-tier system: React frontend → Go backend (port 8080) → Python Agent service (port 9090)

```
React 19 + Vite + Tailwind 4
    ↓ HTTP/SSE
Go (Gin) — JWT auth, CRUD, SSE proxy
    ↓ HTTP proxy
Python (FastAPI) — Claude Agent SDK, MCP tools, RAG
    ↓
PostgreSQL + pgvector | Redis | Neo4j
```

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS 4, Framer Motion, CodeMirror 6, react-force-graph-2d
- Go backend: Gin, GORM, PostgreSQL, Redis, JWT (HS256)
- Python service: FastAPI, Claude Agent SDK (`claude-agent-sdk`), MCP tools, NVIDIA NIM embeddings, pgvector
- Databases: PostgreSQL (primary + pgvector), Redis (cache), Neo4j (knowledge graph)

## Key Patterns

- Theme: `const { theme } = useTheme()` where theme is `'dark' | 'light'` (NOT `isDark`)
- API client: `src/services/client.ts` — `request<T>()` with JWT auto-inject, 401 refresh
- Agent streaming: Go proxies POST `/api/agent/stream` → Python `/agent/stream`, SSE line-by-line via `bufio.Scanner`
- Auto-save: 800ms debounce via `useRef<setTimeout>` in `useNote()` hook
- Wiki-links: `[[title]]` → `wikilink://` protocol, `#tag` → `notetag://` protocol (NotePreview.tsx)

## Claude Agent SDK — Integration Status

### Python Agents (7 total)

| Agent | Model | Tools | Description |
|-------|-------|-------|-------------|
| command-center | Sonnet | 13 | 中枢指挥官：路由编排 + UI 控制 + 系统监控 |
| career-advisor | Sonnet | 9 | 职业规划建议 |
| learning-coach | Sonnet | 12 | 学习路径指导 |
| code-reviewer | Sonnet | 4 | 代码审查 |
| document-reader | Haiku | 6 | 文档阅读理解 |
| quick-qa | Haiku | 8 | 快速问答 |
| mbti-analyst | Haiku | 7 | MBTI 分析 |
| note-assistant | Haiku | 11 | 笔记智能助手 |

**优化说明**：
- command-center 工具数从 47 → 13（减少 72%），启动时间从 ~2-3s → ~0.5s
- 采用委托架构：中枢负责路由，专业 agent 负责业务
- 笔记任务通过 `focus_note_panel` UI 指令联动侧栏 AI 面板

Config: $0.50 max budget, 20 max turns per request.

### MCP Tools (23 total, 8 categories)

- Student (3): get_student_profile, get_learning_progress, get_student_experiments
- MBTI (3): get_mbti_result, get_mbti_analysis, get_personality_traits
- Career (2): get_career_recommendations, get_career_details
- Experiment (2): get_experiment_details, submit_experiment
- Document/RAG (3): search_documents, get_document_content, unified_search
- Knowledge Graph (3): get_knowledge_nodes, get_learning_path, get_related_concepts
- Gamification (3): get_points_balance, get_achievements, get_leaderboard
- Notes (4): search_notes, get_note, create_note, update_note

### Go Backend Agent Endpoints

- `POST /api/agent/stream` — SSE streaming (proxies to Python)
- `POST /api/agent/invoke` — Synchronous invoke
- `GET /api/agent/sessions` — List sessions
- `GET /api/agent/sessions/:id` — Get session
- `DELETE /api/agent/sessions/:id` — Delete session
- `POST /api/documents/query` — RAG query proxy

All endpoints require JWT auth. SSE proxy timeout: 120s.

### Frontend Integration (CRITICAL GAP)

Only 1 of 7 agents is connected to the frontend:

| Module | Page | Agent Integration |
|--------|------|-------------------|
| Dashboard | DashboardPage.tsx | None |
| MBTI 测试 | MBTITestPage.tsx | None (mbti-analyst unused) |
| 测试结果 | ResultsPage.tsx | None |
| 职业推荐 | CareerPage.tsx | None (career-advisor unused) |
| 学习路径 | LearningPathPage.tsx | None (learning-coach unused) |
| 学生画像 | StudentProfilePage.tsx | None |
| 实验管理 | ExperimentsPage.tsx | None (code-reviewer unused) |
| 笔记 | NotesPage.tsx | **note-assistant via NoteAIPanel** |
| AI 顾问 | AIAdvisor.tsx | Uses DeepSeek chatApi (`/chat`), NOT Claude Agent SDK |
| 知识图谱 | GraphPage.tsx | None |
| 管理后台 | AdminDashboard.tsx | None |

AIAdvisor.tsx imports `chatApi` from `services/api` and calls `/chat` endpoint — this is a separate DeepSeek integration, not Claude Agent SDK.

### Known Gaps

1. 6/7 backend agents have no frontend caller
2. AIAdvisor uses DeepSeek instead of Claude agents (quick-qa agent unused)
3. No rate limiting on agent endpoints
4. Agent sessions endpoint returns empty (stub implementation)
5. No frontend error boundary around agent streaming failures

### Agent Architecture (v2.0 - Optimized)

**Design Pattern**: Central Orchestration + Specialized Delegation

```
FloatingAgent (灵动岛)
    ↓ user input
command-center (13 tools)
    ↓ delegate_to_agent
note-assistant (11 tools) → NoteAIPanel (侧栏)
career-advisor (9 tools)
learning-coach (12 tools)
...
```

**Cross-Component Communication**:
- FloatingAgent 监听 `focus_note_panel` UI 指令
- 通过 `window.dispatchEvent('pathmind:focus-note-panel')` 通知 NotesPage
- NotesPage 监听事件并打开右侧 AI 面板（`setShowAI(true)`）

**Benefits**:
- 工具按需加载，减少启动开销
- 职责清晰：灵动岛路由，侧栏编辑
- 用户体验：在灵动岛发起 → 侧栏确认 diff preview

## Build & Run

```bash
# Frontend
npm install && npm run dev     # port 5173
npm run build                  # production build

# Go backend
cd server-go && go run cmd/server/main.go   # port 8080

# Python agent service
cd server-py && uvicorn app.main:app --port 9090

# Environment
# Go: DATABASE_URL, REDIS_URL, JWT_SECRET, AGENT_SERVICE_URL (default localhost:9090)
# Python: ANTHROPIC_API_KEY, NVIDIA_API_KEY, DATABASE_URL
```

## File Structure (key paths)

```
src/
  services/api.ts          — All API methods (chatApi, notesApi, mbtiApi, etc.)
  services/client.ts       — HTTP client with JWT
  hooks/useNotes.ts        — Notes CRUD + auto-save hooks
  components/notes/         — NoteEditor, NotePreview, NoteSidebar, NoteGraphView, NoteAIPanel
  components/DashboardLayout.tsx — Navigation (navItems array)
  pages/                   — All page components
  contexts/                — ThemeContext, AuthContext

server-go/
  cmd/server/main.go
  internal/handler/        — HTTP handlers (agent, document, auth, etc.)
  internal/service/        — Agent proxy service (SSE forwarding)
  internal/middleware/      — JWT auth middleware
  internal/config/          — App config

server-py/
  app/main.py              — FastAPI entry
  app/agents/registry.py   — 7 agent definitions + tool filtering
  app/mcp_tools/server.py  — 23 MCP tool implementations
```
