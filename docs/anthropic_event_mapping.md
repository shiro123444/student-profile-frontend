# Anthropic Messages API Stream Events Mapping

## 1. Anthropic Messages API Stream Events → Internal SSE Event Mapping

| Anthropic SDK Event | 内部 Event Type | 字段映射 | 说明 |
|---|---|---|---|
| `message_start` | `meta` (在 AgentService 层生成) | `model`, `usage.input_tokens` | 流开始，包含初始 token 统计 |
| `content_block_start` (type=text) | (无，等待 delta) | — | 文本块开始，等待内容片段 |
| `content_block_start` (type=tool_use) | `tool_call` (status=calling) | `name`, `id` | 工具调用开始 |
| `content_block_delta` (text_delta) | `text` | `content = delta.text` | 流式文本内容片段 |
| `content_block_delta` (input_json_delta) | (内部累积) | 拼接 `partial_json` | 工具参数 JSON 片段，内部拼接 |
| `content_block_stop` | `tool_call` (如有 pending_tool) | tool_use 完成 | 单个内容块结束 |
| `message_delta` | (内部更新) | `stop_reason`, `output_tokens` | 流结束前的 delta，包含 stop_reason |
| `message_stop` | (触发 result 产出) | — | 流完全结束 |
| — (AgentService 层) | `done` | `session_id, cost, tokens, stop_reason` | Python 服务层生成，标记流结束 |

## 2. stop_reason Enumeration

| 值 | 含义 | 来源 | 前端处理 |
|---|---|---|---|
| `end_turn` | 模型正常结束 | Anthropic API | 正常流结束 |
| `tool_use` | 需要执行工具 | Anthropic API (内部消费) | 内部消费，不应泄漏到前端 |
| `idle_timeout` | 流式空闲超时 | `httpx_sse.py` 超时捕获 | 显示超时警告 |
| `stream_closed` | 流意外关闭 | `AgentService.finally` | 异常关闭，显示错误 |
| `error` | 引擎/工具错误 | 异常捕获 | 显示错误信息 |
| `max_tool_rounds` | 工具循环达上限 | `_MAX_TOOL_TURNS` 限制 | 通知用户工具轮数已达上限 |
| `tool_use_pending` | 工具调用未闭合 | `AgentService.finally` | 异常状态，显示错误 |

## 3. SSE Event Types (Frontend-facing)

前端接收的所有 SSE 事件类型定义：

### 核心事件

- **`meta`**: Agent 元信息和请求初始化
  ```typescript
  {
    type: 'meta',
    request_id: string,
    session_id?: string,
    model: string,  // 'claude-opus-4.6' | 'claude-sonnet-4' | 'claude-haiku-3.5'
    mode: 'agentic' | 'api' | 'legacy',
    agent_name?: string,
    timestamp: ISO8601
  }
  ```

- **`text`**: 流式文本内容片段
  ```typescript
  {
    type: 'text',
    content: string,  // 单个文本片段
    index?: number    // 内容块顺序
  }
  ```

- **`tool_call`**: 工具调用事件
  ```typescript
  {
    type: 'tool_call',
    status: 'calling' | 'done',  // calling: 工具开始, done: 工具调用完成
    name: string,                 // 工具名称
    id: string,                   // 工具调用 ID
    input?: Record<string, any>,  // 工具参数（status=done 时）
    result?: string,              // 工具执行结果（status=done 时）
    error?: string                // 工具执行错误（status=done 时）
  }
  ```

### 级联和降级事件

- **`model_fallback`**: 模型级联/降级事件
  ```typescript
  {
    type: 'model_fallback',
    from: string,   // 原始模型
    to: string,     // 降级到的模型
    reason: string, // 降级原因 ('rate_limit' | 'overloaded' | 'error')
    retry_count?: number
  }
  ```

### UI 控制事件

- **`ui_event`/`ui_command`/`navigate`**: UI 导航和命令
  ```typescript
  {
    type: 'navigate' | 'ui_command' | 'ui_event',
    target?: string,   // 导航目标
    action?: string,   // 动作名称
    data?: any         // 附加数据
  }
  ```

- **`toast`**: 通知/提示信息
  ```typescript
  {
    type: 'toast',
    message: string,
    level: 'info' | 'success' | 'warning' | 'error',
    duration?: number
  }
  ```

- **`scroll_to`**: 页面滚动命令
  ```typescript
  {
    type: 'scroll_to',
    target: string,  // 目标元素选择器或 ID
    behavior?: 'smooth' | 'auto'
  }
  ```

- **`set_theme`**: 主题切换命令
  ```typescript
  {
    type: 'set_theme',
    theme: 'dark' | 'light'
  }
  ```

### 知识图谱事件

- **`graph_command`/`graph_batch`**: 知识图谱操作
  ```typescript
  {
    type: 'graph_command' | 'graph_batch',
    action: string,     // 操作类型
    nodes?: GraphNode[],
    edges?: GraphEdge[],
    data?: any
  }
  ```

### 高级功能事件

- **`orchestrator`**: 编排计划信息
  ```typescript
  {
    type: 'orchestrator',
    plan?: string,      // 执行计划
    status: 'planning' | 'executing' | 'done',
    steps?: Array<{
      name: string,
      status: 'pending' | 'running' | 'done' | 'failed'
    }>
  }
  ```

- **`structured_output`**: 结构化输出数据
  ```typescript
  {
    type: 'structured_output',
    format: 'json' | 'table' | 'list' | 'markdown',
    data: any
  }
  ```

### 流结束事件

- **`done`**: 流结束指标和总结
  ```typescript
  {
    type: 'done',
    session_id: string,
    request_id: string,
    cost: number,              // 美元成本
    input_tokens: number,
    output_tokens: number,
    total_tokens: number,
    stop_reason: string,       // 流结束原因
    effective_model: string,   // 实际使用的模型
    fallback_applied: boolean, // 是否进行了降级
    retry_count: number,       // 重试次数
    tool_call_count: number,   // 工具调用次数
    duration_ms: number,       // 总耗时
    timestamp: ISO8601
  }
  ```

## 4. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Frontend (React)                                                        │
│  ├─ AIAdvisor.tsx / AIInsightButton.tsx                               │
│  ├─ useAgentStream.ts (SSE 解析 + AbortController)                    │
│  └─ Event handlers (text / tool_call / done / etc.)                   │
└─────────────────┬───────────────────────────────────────────────────────┘
                  │ HTTP/SSE (Content-Type: text/event-stream)
                  │
┌─────────────────▼───────────────────────────────────────────────────────┐
│ Go Backend (Gin)                                                        │
│  ├─ handler/agent.go :: agentStream()                                  │
│  │   └─ 接收 POST /api/agent/stream JSON 请求                          │
│  ├─ service/agent.go :: ProxyStream()                                  │
│  │   └─ 转发 HTTP POST 到 Python + bufio.Scanner 逐行代理 SSE          │
│  └─ SSE Event 逐行转发给前端                                            │
└─────────────────┬───────────────────────────────────────────────────────┘
                  │ HTTP proxy (JSON POST + SSE 响应)
                  │
┌─────────────────▼───────────────────────────────────────────────────────┐
│ Python Backend (FastAPI)                                               │
│  ├─ agent_routes.py :: stream_agent()                                  │
│  │   └─ 接收 JSON 请求，调用 agent_registry 获取 Agent 实例            │
│  ├─ agents/registry.py :: get_agent()                                  │
│  │   └─ 返回对应 Agent 实例 (CareerAdvisor / LearningCoach / etc.)      │
│  ├─ agents/base.py :: AgentService.stream()                            │
│  │   ├─ 初始化 anthropic_engine (Haiku / Sonnet / Opus)              │
│  │   ├─ tools_filter: 按 agent_name + request 过滤 MCP 工具            │
│  │   ├─ 调用 anthropic_engine.stream()                                 │
│  │   └─ 消费并转换 Anthropic SDK Events → Internal SSE Events         │
│  ├─ engine/anthropic_engine.py :: AnthropicEngine.stream()             │
│  │   ├─ messages_client.stream() (Anthropic SDK)                      │
│  │   └─ yield Anthropic 原始事件                                       │
│  ├─ engine/httpx_sse.py :: SSEStream                                   │
│  │   ├─ 使用 httpx_sse.aiter_sse() 解析 Anthropic SSE 响应            │
│  │   └─ 超时捕获 (idle_timeout)                                        │
│  ├─ 工具执行: mcp_tools/executor.py                                    │
│  │   └─ 同步/异步工具执行 + 结果追加回 message_history                │
│  └─ SSE 编码: json.dumps() + f"data: {json}\n\n"                       │
└─────────────────┬───────────────────────────────────────────────────────┘
                  │ SSE: text/event-stream
                  │
┌─────────────────▼───────────────────────────────────────────────────────┐
│ Anthropic Messages API                                                  │
│  ├─ model: claude-opus-4.6 / claude-sonnet-4 / claude-haiku-3.5        │
│  ├─ stream: True                                                        │
│  ├─ temperature / max_tokens / tools / system_prompt                   │
│  └─ Events:                                                             │
│    ├─ message_start                                                     │
│    ├─ content_block_start                                              │
│    ├─ content_block_delta (text_delta / input_json_delta)             │
│    ├─ content_block_stop                                               │
│    ├─ message_delta                                                     │
│    └─ message_stop                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

## 5. Event Transformation Pipeline

### 步骤 1: Anthropic SDK → Python Internal Events

```python
# engine/anthropic_engine.py
event = await message_stream.aiter_events()

switch event.type:
  case "message_start":
    → 保存 message.id, model, usage
  case "content_block_start":
    → 初始化 content_block (检查 type: 'text' vs 'tool_use')
  case "content_block_delta":
    → 累积 text_delta 或 input_json_delta
  case "content_block_stop":
    → 完成当前 content_block
  case "message_delta":
    → 更新 stop_reason, output_tokens
  case "message_stop":
    → 流完成，触发 result 产出
```

### 步骤 2: Python Internal → Frontend SSE Events

```python
# agents/base.py :: AgentService.stream()

# 1. Yield meta 事件
yield_sse({
  'type': 'meta',
  'request_id': request_id,
  'model': engine.model,
  'mode': engine.mode,
  'agent_name': self.name
})

# 2. 遍历 Anthropic 事件
for event in anthropic_engine.stream():
  if event.type == 'text':
    yield_sse({
      'type': 'text',
      'content': event.content
    })
  elif event.type == 'tool_call' and event.status == 'calling':
    yield_sse({
      'type': 'tool_call',
      'status': 'calling',
      'name': event.name,
      'id': event.id
    })
  elif event.type == 'model_fallback':
    yield_sse({
      'type': 'model_fallback',
      'from': event.from_model,
      'to': event.to_model,
      'reason': event.reason
    })

# 3. 工具执行 (同步/异步)
result = await tool_executor.execute(tool_name, tool_input)

# 4. Yield tool_call 完成事件
yield_sse({
  'type': 'tool_call',
  'status': 'done',
  'name': tool_name,
  'id': tool_id,
  'input': tool_input,
  'result': result
})

# 5. 流结束：yield done 事件
yield_sse({
  'type': 'done',
  'session_id': session_id,
  'cost': cost,
  'input_tokens': usage.input_tokens,
  'output_tokens': usage.output_tokens,
  'stop_reason': stop_reason
})
```

### 步骤 3: Go Backend → Frontend

```go
// internal/service/agent.go :: ProxyStream()

resp, err := client.Post(agentServiceURL, headers, body)
// 使用 bufio.Scanner 逐行读取 SSE 流
scanner := bufio.NewScanner(resp.Body)
for scanner.Scan() {
  line := scanner.Text()
  if strings.HasPrefix(line, "data: ") {
    eventData := strings.TrimPrefix(line, "data: ")
    // 直接转发给前端
    w.Write([]byte(line + "\n"))
    w.Flush()
  }
}
```

### 步骤 4: 前端解析

```typescript
// src/hooks/useAgentStream.ts

const response = await agentApi.stream(request);
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const eventData = JSON.parse(line.slice(6));

      switch (eventData.type) {
        case 'meta':
          onMeta?.(eventData);
          break;
        case 'text':
          onText?.(eventData.content);
          break;
        case 'tool_call':
          onToolCall?.(eventData);
          break;
        case 'done':
          onDone?.(eventData);
          break;
      }
    }
  }
}
```

## 6. 关键设计原则

1. **单向流式**: 前端接收的所有信息都通过 SSE 一次性推送，不支持请求-响应模式
2. **Stop Reason 消费**: `tool_use` 类型的 stop_reason 在 Python 层内部消费，不应泄漏到前端
3. **Tool Call 生命周期**:
   - `calling` 事件: 开始调用某个工具
   - `done` 事件: 工具执行完成，包含 result/error
4. **错误处理**: 所有异常都转换为 `done` 事件，设置 `stop_reason='error'` 和 `error` 字段
5. **成本追踪**: 每个 `done` 事件都包含成本、token 数量等计费指标
6. **会话管理**: 每个流对应一个 `session_id`，用于后续查询历史

## 7. 前端集成示例

### 使用 useAgentStream Hook

```typescript
const { stream, cancel } = useAgentStream();

stream({
  request_type: 'text',
  query: 'Help me choose a career',
  agent: 'career-advisor'
}, {
  onMeta: (meta) => {
    console.log('Agent:', meta.agent_name, 'Model:', meta.model);
  },
  onText: (text) => {
    setResponse(prev => prev + text);
  },
  onToolCall: (call) => {
    if (call.status === 'calling') {
      console.log('Tool calling:', call.name);
    } else {
      console.log('Tool result:', call.result);
    }
  },
  onDone: (done) => {
    console.log('Cost:', done.cost, 'Tokens:', done.total_tokens);
  }
});
```

### 使用 AIInsightButton 组件

```typescript
<AIInsightButton
  prompt="Analyze my MBTI results"
  agent="mbti-analyst"
  onComplete={(response) => {
    setInsights(response);
  }}
/>
```

