# OPC — Open Protocol for Agents (PathMind CLI Edition)

## 1. 背景与目标

PathMind 已实现 SSE 流式通道（Go → React），但缺少**本地 CLI 穿透通道**。

OPC 的核心目标：
- **统一协议**：同一套 JSON 事件格式，走 SSE / WebSocket / stdio 三种传输层
- **渲染指令解耦**：AI 输出内容 vs UI 渲染指令分离，让终端 Client 自行决定如何渲染
- **零依赖 CLI**：Go 写的 stdio bridge 可被任何 AI backend 调用，无需引入前端框架

```
Python Agent (AI Core)
  │ SSE line: {"type":"text","content":"..."}
  │ SSE line: {"type":"render","box":{...}}
  │
  ├─► Go Backend (SSE proxy) ──────────────► React Frontend (已有)
  │
  └─► Go stdio bridge (新增) ──────────────► Local CLI Client (TUI)
          │                                       │
          │  data: {"type":"text",...}\n           │  ANSI 渲染
          │  data: {"type":"render",...}\n         │
          └──────────────────────────────────────► 终端
```

## 2. 协议分层

```
┌─────────────────────────────────────────────────────────────┐
│  OPC Transport Layer (传输层)                                │
│  ├── SSE 通道   → Go HTTP Handler (已有)                    │
│  ├── WebSocket  → Go WS Handler (复用现有 SSE 逻辑)          │
│  └── stdio      → Go stdio bridge (新增)                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  OPC Message Layer (消息层) — 统一 JSON 行流                 │
│  data: {"type":"...","...":...}\n                           │
│  data: {"type":"...","...":...}\n                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  OPC Semantic Layer (语义层) — 事件类型分类                  │
│  ├── AI Content  (AI 产生的内容)                           │
│  ├── UI Directive (UI 渲染指令)                             │
│  ├── Control      (会话控制)                                │
│  └── Meta         (元信息)                                  │
└─────────────────────────────────────────────────────────────┘
```

## 3. 事件类型体系

### 3.1 AI Content 类（来自 AI 模型的内容）

```typescript
// 文本片段（流式）
{
  "type": "text",
  "id": "t_001",           // 可选，片段 ID
  "content": "这是 AI 输出的文本",
  "streaming": true,        // true = 流式中，false = 完整
  "markdown": true,         // 内容是否含 Markdown
}

// 工具调用开始
{
  "type": "tool_call",
  "tool": "search_documents",
  "status": "calling",      // calling | running | success | error | fallback
  "attempt": 1,
  "max_attempts": 3,
  "input": { "query": "..." },
}

// 工具调用结果
{
  "type": "tool_result",
  "tool": "search_documents",
  "status": "success",
  "result": { ... },
  "duration_ms": 234,
}

// 差量渲染（增量更新某区域内容）
{
  "type": "diff_patch",
  "region": "notes_preview",
  "patch": [ { "op": "replace", "path": "/title", "value": "新标题" } ],
}
```

### 3.2 UI Directive 类（渲染指令，终端自行决定如何呈现）

```typescript
// Flexbox 布局框
{
  "type": "render",
  "action": "box",          // box | text | clear | scroll | focus
  "id": "msg_001",          // 区域 ID（用于 diff_patch 定位）
  "layout": {
    "flex_direction": "column" | "row",
    "gap": 1,
    "padding": [1, 2],     // [上下, 左右]
    "margin": [0, 0, 0, 0], // [上, 右, 下, 左]
    "align_items": "flex_start" | "center" | "flex_end" | "stretch",
    "justify_content": "flex_start" | "center" | "flex_end" | "space_between",
    "width": 72,            // 字符宽度
    "min_height": 0,
    "flex_grow": 0,
  },
  "style": {
    "fg": "#36A4D9",        // 前景色 (hex 24bit)
    "bg": "#1A1A2E",        // 背景色
    "bold": false,
    "italic": false,
    "underline": false,
    "border": {
      "style": "round" | "single" | "double" | "none",
      "color": "#4A4A6A",
    },
  },
}

// 文本节点（挂在某个 box 下）
{
  "type": "render",
  "action": "text",
  "parent": "msg_001",      // 父 box ID
  "content": "Hello, 世界",
  "style": {
    "fg": "#E4E4E7",
    "bold": true,
  },
}

// 清屏
{
  "type": "render",
  "action": "clear",
  "region": "output",        // output | input | all
}

// 滚动到区域
{
  "type": "render",
  "action": "scroll",
  "target": "msg_001",
}

// 设置焦点到输入框
{
  "type": "render",
  "action": "focus",
  "target": "input",
}

// 终端标题
{
  "type": "render",
  "action": "title",
  "title": "PathMind AI — command-center",
}
```

### 3.3 UI Command 类（执行特定 UI 操作）

```typescript
// 导航到页面
{
  "type": "ui_command",
  "command": "navigate",
  "to": "/notes",
  "toast": "已跳转 → /notes",
}

// Toast 通知
{
  "type": "ui_command",
  "command": "toast",
  "message": "笔记已保存",
  "level": "success",       // info | success | warning | error
  "duration_ms": 3000,
}

// 设置主题
{
  "type": "ui_command",
  "command": "set_theme",
  "theme": "dark",          // dark | light
}

// 执行图谱命令
{
  "type": "ui_command",
  "command": "graph_command",
  "command": "expand",
  "target": "node_123",
  "params": { "depth": 2 },
}
```

### 3.4 Control 类（会话控制）

```typescript
// 会话结束
{
  "type": "done",
  "session_id": "sess_abc123",
  "cost": 0.0025,
  "input_tokens": 1200,
  "output_tokens": 340,
  "stop_reason": "end_turn",   // end_turn | max_tokens | idle_timeout | error
  "tool_call_count": 3,
}

// 优雅停止（用户中断）
{
  "type": "stop",
  "reason": "user_abort",
}

// 心跳保活（长时间空闲时）
{
  "type": "ping",
  "session_id": "sess_abc123",
}
```

### 3.5 Meta 类（元信息）

```typescript
// Agent 元信息
{
  "type": "meta",
  "agent": "command-center",
  "engine": "claude",
  "model": "sonnet-4-20250514",
  "mode": "deep",
  "runtime_profile": "webagent_v1",
}

// 模型降级
{
  "type": "model_fallback",
  "from_model": "sonnet-4-20250514",
  "to_model": "sonnet-4-20250508",
  "reason": "first_byte_timeout",
}

// Orchestrator 状态（任务规划）
{
  "type": "orchestrator",
  "stage": "planning",
  "profile": "webagent_v1",
  "strategy": "parallel",
  "max_workers": 4,
  "worker_timeout_sec": 30,
}

// 任务收据（子任务状态）
{
  "type": "task_receipt",
  "run_id": "run_001",
  "task_type": "delegate_to_agent",
  "label": "搜索笔记",
  "status": "running",
  "steps": [
    { "id": "step_1", "label": "调用 search_notes", "status": "running" },
    { "id": "step_2", "label": "总结结果", "status": "pending" },
  ],
}
```

## 4. stdio Bridge 实现设计

### 4.1 架构

```
CLI Client (Go stdio bridge)
    │
    │  stdin: JSON-RPC 请求
    │  stdout: SSE 格式 JSON 行
    │
    ▼
Python Agent Service (port 9090)
```

### 4.2 请求格式（stdin）

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "agent.stream",
  "params": {
    "agent_name": "command-center",
    "prompt": "帮我查一下最新的学习路径",
    "session_id": "sess_abc123",
    "runtime": {
      "mode": "deep",
      "engine": "claude",
      "orchestrator": {
        "enabled": true,
        "max_steps": 8,
      }
    },
    "context": {
      "student_id": "student_001",
    }
  }
}
```

### 4.3 响应格式（stdout）

```
data: {"type":"meta","agent":"command-center","engine":"claude","model":"sonnet-4-20250514","mode":"deep"}\n
data: {"type":"text","content":"正在为你查询学习路径","streaming":true}\n
data: {"type":"tool_call","tool":"get_learning_path","status":"calling"}\n
data: {"type":"render","action":"box","id":"tool_001","layout":{"flex_direction":"row","gap":1},"style":{"border":{"style":"round","color":"#36A4D9"}}}\n
data: {"type":"render","action":"text","parent":"tool_001","content":"🔍 正在查询...","style":{"fg":"#F5A623"}}\n
data: {"type":"tool_result","tool":"get_learning_path","status":"success","duration_ms":234}\n
data: {"type":"text","content":"找到了你的学习路径：React 进阶之路","streaming":false,"markdown":true}\n
data: {"type":"done","session_id":"sess_abc123","cost":0.0012,"input_tokens":450,"output_tokens":120,"stop_reason":"end_turn","tool_call_count":1}\n
```

### 4.4 核心 Go 代码结构

```go
// cmd/stdio-bridge/main.go
package main

import (
    "bufio"
    "encoding/json"
    "fmt"
    "io"
    "os"
    "strings"

    "github.com/gin-gonic/gin"
)

type RPCRequest struct {
    JSONRPC string          `json:"jsonrpc"`
    ID      any             `json:"id"`
    Method  string          `json:"method"`
    Params  json.RawMessage `json:"params"`
}

type RPCResponse struct {
    JSONRPC string `json:"jsonrpc"`
    ID      any    `json:"id"`
    Result  any    `json:"result,omitempty"`
    Error   any    `json:"error,omitempty"`
}

// StreamResponse 写入 SSE 格式到 stdout
func StreamResponse(event map[string]any) {
    data, _ := json.Marshal(event)
    fmt.Fprintf(os.Stdout, "data: %s\n\n", data)
}

func main() {
    // 读取 stdin 的 JSON-RPC 请求
    reader := bufio.NewReader(os.Stdin)

    for {
        line, err := reader.ReadString('\n')
        if err == io.EOF {
            break
        }
        line = strings.TrimSpace(line)
        if line == "" {
            continue
        }

        var req RPCRequest
        if err := json.Unmarshal([]byte(line), &req); err != nil {
            sendError(req.ID, -32700, "Parse error")
            continue
        }

        // 转发给 Python Agent 并流式转发响应
        go streamToPython(req)
    }
}

func streamToPython(req RPCRequest) {
    // 建立到 Python Agent 服务的连接
    // 解析响应并通过 StreamResponse 输出
    // ...
}
```

## 5. 终端渲染器设计

### 5.1 最小化 ANSI 渲染（无需第三方库）

```go
// Color 输出 helper
func FgColor(r, g, b int) string {
    return fmt.Sprintf("\x1b[38;2;%d;%d;%dm", r, g, b)
}

func BgColor(r, g, b int) string {
    return fmt.Sprintf("\x1b[48;2;%d;%d;%dm", r, g, b)
}

const (
    Reset   = "\x1b[0m"
    Bold    = "\x1b[1m"
    Dim     = "\x1b[2m"
    Italic  = "\x1b[3m"
    Underline = "\x1b[4m"
)

// 移动光标
func MoveTo(row, col int) string {
    return fmt.Sprintf("\x1b[%d;%dH", row, col)
}

func ClearLine() string {
    return "\x1b[2K"
}

func ClearScreen() string {
    return "\x1b[2J"
}
```

### 5.2 渲染器状态机

```
事件流                                    渲染器状态
─────────────────────────────────────────────────────────
{render: box, id:"a"}              →   创建/更新 region "a"
{render: text, parent:"a", ...}   →   在 region "a" 下追加文本
{text: "hello"}                     →   追加到默认输出区
{tool_call: ...}                    →   显示工具调用状态
{tool_result: ...}                  →   显示工具结果
{render: scroll, target:"a"}        →   滚动到 region "a"
```

### 5.3 diff_patch 差量更新机制

对于笔记预览等高频更新区域，使用 JSON Patch：

```json
{
  "type": "diff_patch",
  "region": "notes_preview",
  "patch": [
    { "op": "replace", "path": "/title", "value": "新标题" },
    { "op": "add", "path": "/tags/2", "value": "AI" },
    { "op": "remove", "path": "/content/0" }
  ]
}
```

终端渲染器维护每个 region 的状态树，收到 patch 时增量更新，只重绘变化部分。

## 6. 协议扩展点

### 6.1 双向通讯（CLI → Agent）

CLI 端可发送用户输入和工具授权结果：

```json
// 用户发送消息
{
  "type": "user_input",
  "content": "帮我创建一条笔记",
  "session_id": "sess_abc123",
}

// 工具授权结果
{
  "type": "tool_approval",
  "tool": "create_note",
  "approved": true,
  "reason": "用户确认",
  "request_id": "req_001",
}
```

### 6.2 文件传输（base64 embed）

大文件（图片、PDF）通过 base64 内嵌：

```json
{
  "type": "file",
  "name": "screenshot.png",
  "mime": "image/png",
  "data": "base64_encoded...",
  "thumbnail": "base64_small...",
}
```

### 6.3 流式二进制（音频/视频）

```json
{
  "type": "binary",
  "mime": "audio/webm",
  "channel": "tts_output",
  "data": "base64_or_ref",
}
```

## 7. 与现有 SSE 事件类型映射

| 现有 SSE type | OPC type | 变化 |
|--------------|----------|------|
| `text` | `text` | 基本一致 |
| `done` | `done` | 一致 |
| `tool_call` | `tool_call` | 一致 |
| `tool_retry` | `tool_call` + `status:retry` | 合并 |
| `tool_fallback` | `tool_call` + `status:fallback` | 合并 |
| `ui_command` | `ui_command` | 一致 |
| `navigate` | `ui_command` + `command:navigate` | 合并 |
| `toast` | `ui_command` + `command:toast` | 合并 |
| `orchestrator` | `orchestrator` | 一致 |
| `task_receipt` | `task_receipt` | 一致 |
| `meta` | `meta` | 基本一致 |
| `model_fallback` | `model_fallback` | 一致 |
| *(新增)* | `render` | 新增 UI 渲染指令 |
| *(新增)* | `diff_patch` | 新增差量更新 |

## 8. 实施路线图

### Phase 1: stdio Bridge（1-2天）
- [ ] Go stdio bridge 入口 (`cmd/stdio-bridge/main.go`)
- [ ] JSON-RPC 请求解析
- [ ] SSE 行流式转发到 stdout
- [ ] Python Agent 端支持 stdio 模式（env flag 切换）

### Phase 2: Terminal TUI Renderer（2-3天）
- [ ] ANSI 颜色和布局基础库
- [ ] Flexbox 布局引擎（简化版）
- [ ] region 状态管理 + diff_patch 差量更新
- [ ] 键盘输入捕获（ANSI escape sequence 解析）

### Phase 3: 协议对齐（1-2天）
- [ ] 统一 SSE 和 stdio 的 event type
- [ ] 将现有 SSE 事件映射到 OPC 类型
- [ ] 确保 `useAgentStream` 和 CLI renderer 可共用同一套解析逻辑

### Phase 4: 高级功能（可选）
- [ ] WebSocket 传输层
- [ ] 文件/binary 类型支持
- [ ] 多会话管理（tab）

## 9. 技术选型理由

| 组件 | 选型 | 理由 |
|------|------|------|
| stdio bridge | Go | 跨平台编译、静态二进制、零依赖分发 |
| TUI 渲染 | 原生 ANSI | 无外部库依赖，最小化二进制体积 |
| 布局模型 | Flexbox | 与 Web/React 语义一致，简化跨端理解 |
| 颜色格式 | 24-bit hex | 与 CSS 一致，`#RRGGBB` 格式 |
| 差量更新 | JSON Patch | 成熟标准，rfc6902 |
| 会话协议 | JSON-RPC 2.0 | 简单、广泛支持 |
