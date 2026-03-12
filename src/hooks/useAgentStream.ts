import { useState, useRef, useCallback } from 'react'
import { agentApi, type AgentRuntimeOptions, type AgentTenantContext } from '../services/api'
import { useAgentSession } from '../contexts/AgentSessionContext'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentName?: string
}

export interface UICommandEvent {
  command: string
  target: string
  params: Record<string, unknown>
}

export interface NavigateEvent {
  to: string
}

export interface ToastEvent {
  message: string
  level: 'info' | 'success' | 'warning'
}

export interface ScrollToEvent {
  target: string
}

export interface SetThemeEvent {
  theme: 'dark' | 'light'
}

export interface GraphCommandEvent {
  command: string
  target?: string
  params?: Record<string, unknown>
}

export interface GraphBatchEvent {
  batchId?: string
  mode?: 'best_effort' | 'all_or_nothing'
  steps: GraphCommandEvent[]
}

export interface TaskReceiptStepEvent {
  id: string
  label: string
  module?: string
  status?: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  tool?: string
  message?: string
}

export interface TaskReceiptEvent {
  runId?: string
  taskType?: string
  label?: string
  status?: 'queued' | 'running' | 'success' | 'failed' | 'partial'
  source?: string
  message?: string
  steps?: TaskReceiptStepEvent[]
}

export interface ToolCallEvent {
  tool: string
  status: string
  attempt?: number
  maxAttempts?: number
  reason?: string
  stage?: string
}

export interface AgentMetaEvent {
  agent: string
  engine: string
  model: string
  mode: string
  outputFormat?: string
  orchestratorProfile?: string
  tenant?: AgentTenantContext
}

export interface OrchestratorEvent {
  stage: string
  protocol?: string
  profile?: string
  strategy?: string
  complexity?: string
  selectedMode?: string
  maxWorkers?: number
  workerTimeoutSec?: number
  workerMaxRetries?: number
  workerRetryBackoffMs?: number
  maxBudgetUsd?: number
  spentBudgetUsd?: number
  critiqueEnabled?: boolean
  critiqueMode?: string
  dynamicReplanEnabled?: boolean
  maxReplans?: number
  replanCount?: number
  replanRound?: number
  critiquePass?: boolean
  critiqueScore?: number
  critiqueSummary?: string
  critiqueIssues?: string[]
  critiqueRecommendations?: string[]
  shouldReplan?: boolean
  success?: boolean
  critique?: {
    pass?: boolean
    score?: number
    issues?: string[]
    recommendations?: string[]
    summary?: string
  }
  workerCount?: number
  workerCostUsd?: number
  planner?: {
    engine?: string
    model?: string
    mode?: string
  }
  nodeId?: string
  title?: string
  kind?: string
  mode?: string
  status?: string
  attempts?: number
  maxAttempts?: number
  reason?: string
  nextBackoffMs?: number
  failureReason?: string
  layerIndex?: number
  nodeCount?: number
  dependsOn?: string[]
  tools?: string[]
  engine?: string
  model?: string
  cost?: number
  artifactType?: string
  artifactUri?: string
  workers?: Array<{
    id?: string
    title?: string
    kind?: string
    mode?: string
    status?: string
    dependsOn?: string[]
    summary?: string
    artifactType?: string
    artifactUri?: string
  }>
  tenant?: AgentTenantContext
  steps?: Array<{
    id?: string
    title?: string
    kind?: string
    mode?: string
    objective?: string
    depends_on?: string[]
  }>
}

export interface StructuredOutputEvent {
  data: unknown
}

export interface DoneEvent {
  sessionId?: string
  cost?: number
  inputTokens?: number
  outputTokens?: number
  stopReason?: string
  effectiveModel?: string
  fallbackApplied?: boolean
  retryCount?: number
  toolCallCount?: number
  requestId?: string
}

export interface ApprovalRequestEvent {
  id: string
  tool: string
  risk?: string
  argsPreview?: Record<string, unknown>
  timeoutSec?: number
}

export interface ApprovalResultEvent {
  id: string
  approved: boolean
  reason?: string
}

export interface HookEventBase {
  event: string
  category: 'permission' | 'subtask' | 'notification' | 'other'
  timestamp?: number
}

export interface PermissionRequestEvent extends HookEventBase {
  category: 'permission'
  tool?: string
  toolInput?: Record<string, unknown>
  permissionSuggestions?: unknown
}

export interface SubtaskEvent extends HookEventBase {
  category: 'subtask'
  stage?: 'start' | 'stop'
  agentId?: string
  agentType?: string
  agentName?: string
  transcriptPath?: string
}

export interface NotificationEvent extends HookEventBase {
  category: 'notification'
  level?: string
  title?: string
  message?: string
}

export type AgentHookEvent =
  | PermissionRequestEvent
  | SubtaskEvent
  | NotificationEvent
  | HookEventBase

interface SendOptions {
  agentName: string
  /** Optional session namespace key; defaults to agentName */
  sessionKey?: string
  buildPrompt?: (text: string) => string
  studentId?: string
  context?: Record<string, unknown>
  runtime?: AgentRuntimeOptions
  tenant?: AgentTenantContext
  /** default true; set false to force a fresh session */
  resume?: boolean
  /** Use the public (no-auth) endpoint */
  public?: boolean
  /** Force dispatch even if hook state still marks stream as active */
  force?: boolean
}

interface UseAgentStreamReturn {
  messages: AgentMessage[]
  isStreaming: boolean
  sendMessage: (text: string, opts: SendOptions) => void
  stop: () => void
  clearMessages: () => void
  setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>
}

export interface ModelFallbackEvent {
  fromModel: string
  toModel: string
  reason: string
}

export interface AgentStreamCallbacks {
  onMeta?: (meta: AgentMetaEvent) => void
  onStructuredOutput?: (event: StructuredOutputEvent) => void
  onDone?: (event: DoneEvent) => void
  onModelFallback?: (event: ModelFallbackEvent) => void
  onOrchestrator?: (event: OrchestratorEvent) => void
  onApprovalRequest?: (event: ApprovalRequestEvent) => void
  onApprovalResult?: (event: ApprovalResultEvent) => void
  onHookEvent?: (event: AgentHookEvent) => void
  onPermissionRequest?: (event: PermissionRequestEvent) => void
  onSubtask?: (event: SubtaskEvent) => void
  onNotification?: (event: NotificationEvent) => void
  onUICommand?: (cmd: UICommandEvent) => void
  onNavigate?: (nav: NavigateEvent) => void
  onToast?: (toast: ToastEvent) => void
  onScrollTo?: (scroll: ScrollToEvent) => void
  onSetTheme?: (theme: SetThemeEvent) => void
  onGraphCommand?: (event: GraphCommandEvent) => void
  onGraphBatch?: (event: GraphBatchEvent) => void
  onTaskReceipt?: (event: TaskReceiptEvent) => void
  onToolCall?: (call: ToolCallEvent) => void
}


function parseTenantPayload(value: unknown): AgentTenantContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const payload = value as Record<string, unknown>

  const normalized: AgentTenantContext = {
    ...(typeof payload.tenant_id === 'string' ? { tenantId: payload.tenant_id } : {}),
    ...(typeof payload.role === 'string' ? { role: payload.role } : {}),
    ...(typeof payload.student_id === 'string' ? { studentId: payload.student_id } : {}),
    ...(typeof payload.user_id === 'string' ? { userId: payload.user_id } : {}),
    ...(typeof payload.workspace_id === 'string' ? { workspaceId: payload.workspace_id } : {}),
    ...(typeof payload.locale === 'string' ? { locale: payload.locale } : {}),
    ...(payload.metadata && typeof payload.metadata === 'object'
      ? { metadata: payload.metadata as Record<string, unknown> }
      : {}),
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

export function useAgentStream(callbacks?: AgentStreamCallbacks): UseAgentStreamReturn {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const textFlushFrameRef = useRef<number | null>(null)
  const pendingTextRef = useRef('')
  const activeAssistantIdRef = useRef<string | null>(null)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const { getSession, setSession } = useAgentSession()

  const flushPendingText = useCallback(() => {
    if (textFlushFrameRef.current != null) {
      cancelAnimationFrame(textFlushFrameRef.current)
      textFlushFrameRef.current = null
    }

    const chunk = pendingTextRef.current
    if (!chunk) return
    pendingTextRef.current = ''

    const assistantId = activeAssistantIdRef.current
    if (!assistantId) return

    setMessages((prev) => {
      if (prev.length === 0) return prev
      let targetIndex = -1
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if (prev[i].id === assistantId) {
          targetIndex = i
          break
        }
      }
      if (targetIndex < 0) return prev

      const target = prev[targetIndex]
      if (target.role !== 'assistant') return prev

      const next = [...prev]
      next[targetIndex] = { ...target, content: target.content + chunk }
      return next
    })
  }, [])

  const scheduleTextFlush = useCallback(() => {
    if (textFlushFrameRef.current != null) return
    textFlushFrameRef.current = requestAnimationFrame(() => {
      textFlushFrameRef.current = null
      flushPendingText()
    })
  }, [flushPendingText])

  const stop = useCallback(() => {
    flushPendingText()
    abortRef.current?.abort()
    if (textFlushFrameRef.current != null) {
      cancelAnimationFrame(textFlushFrameRef.current)
      textFlushFrameRef.current = null
    }
    pendingTextRef.current = ''
    activeAssistantIdRef.current = null
    setIsStreaming(false)
  }, [flushPendingText])

  const clearMessages = useCallback(() => {
    if (textFlushFrameRef.current != null) {
      cancelAnimationFrame(textFlushFrameRef.current)
      textFlushFrameRef.current = null
    }
    pendingTextRef.current = ''
    activeAssistantIdRef.current = null
    setMessages([])
  }, [])

  const sendMessage = useCallback(async (text: string, opts: SendOptions) => {
    if (!text.trim() || (isStreaming && !opts.force)) return

    const prompt = opts.buildPrompt ? opts.buildPrompt(text) : text
    const sessionLookupKey = opts.sessionKey || opts.agentName

    const userMsg: AgentMessage = { id: Date.now().toString(), role: 'user', content: text }
    const assistantMsg: AgentMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      agentName: opts.agentName,
    }
    if (textFlushFrameRef.current != null) {
      cancelAnimationFrame(textFlushFrameRef.current)
      textFlushFrameRef.current = null
    }
    pendingTextRef.current = ''
    activeAssistantIdRef.current = assistantMsg.id
    setMessages(prev => [...prev, userMsg, assistantMsg])
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const streamFn = opts.public ? agentApi.publicStream : agentApi.stream
      const res = await streamFn({
        agentName: opts.agentName,
        prompt,
        studentId: opts.studentId,
        context: opts.context,
        runtime: opts.runtime,
        tenant: opts.tenant,
        signal: controller.signal,
        sessionId: opts.resume === false ? undefined : getSession(sessionLookupKey),
      })

      if (!res.ok || !res.body) {
        let detail = ''
        try {
          detail = (await res.text()).slice(0, 220)
        } catch {
          detail = ''
        }
        const suffix = detail ? `: ${detail}` : ''
        throw new Error(`Stream failed (${res.status})${suffix}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)

            if (parsed.type === 'meta') {
              callbacksRef.current?.onMeta?.({
                agent: parsed.agent || opts.agentName,
                engine: parsed.engine || 'claude',
                model: parsed.model || '',
                mode: parsed.mode || opts.runtime?.mode || 'balanced',
                outputFormat: parsed.output_format || undefined,
                orchestratorProfile: parsed.orchestrator_profile || undefined,
                tenant: parseTenantPayload(parsed.tenant),
              })
            } else if (parsed.type === 'orchestrator') {
              callbacksRef.current?.onOrchestrator?.({
                stage: parsed.stage || 'planned',
                protocol: parsed.protocol || undefined,
                profile: parsed.profile || undefined,
                strategy: parsed.strategy || undefined,
                complexity: parsed.complexity || undefined,
                selectedMode: parsed.selected_mode || undefined,
                maxWorkers: typeof parsed.max_workers === 'number' ? parsed.max_workers : undefined,
                workerTimeoutSec: typeof parsed.worker_timeout_s === 'number' ? parsed.worker_timeout_s : undefined,
                workerMaxRetries: typeof parsed.worker_max_retries === 'number' ? parsed.worker_max_retries : undefined,
                workerRetryBackoffMs: typeof parsed.worker_retry_backoff_ms === 'number' ? parsed.worker_retry_backoff_ms : undefined,
                maxBudgetUsd: typeof parsed.max_budget_usd === 'number' ? parsed.max_budget_usd : undefined,
                spentBudgetUsd: typeof parsed.spent_budget_usd === 'number' ? parsed.spent_budget_usd : undefined,
                critiqueEnabled: typeof parsed.critique_enabled === 'boolean' ? parsed.critique_enabled : undefined,
                critiqueMode: typeof parsed.critique_mode === 'string' ? parsed.critique_mode : undefined,
                dynamicReplanEnabled: typeof parsed.dynamic_replan_enabled === 'boolean'
                  ? parsed.dynamic_replan_enabled
                  : undefined,
                maxReplans: typeof parsed.max_replans === 'number' ? parsed.max_replans : undefined,
                replanCount: typeof parsed.replan_count === 'number' ? parsed.replan_count : undefined,
                replanRound: typeof parsed.replan_round === 'number' ? parsed.replan_round : undefined,
                critiquePass: typeof parsed.critique_pass === 'boolean' ? parsed.critique_pass : undefined,
                critiqueScore: typeof parsed.critique_score === 'number' ? parsed.critique_score : undefined,
                critiqueSummary: typeof parsed.critique_summary === 'string' ? parsed.critique_summary : undefined,
                critiqueIssues: Array.isArray(parsed.critique_issues)
                  ? parsed.critique_issues.filter((v: unknown): v is string => typeof v === 'string')
                  : undefined,
                critiqueRecommendations: Array.isArray(parsed.critique_recommendations)
                  ? parsed.critique_recommendations.filter((v: unknown): v is string => typeof v === 'string')
                  : undefined,
                shouldReplan: typeof parsed.should_replan === 'boolean' ? parsed.should_replan : undefined,
                success: typeof parsed.success === 'boolean' ? parsed.success : undefined,
                critique: parsed.critique && typeof parsed.critique === 'object'
                  ? {
                      pass: typeof parsed.critique.pass === 'boolean' ? parsed.critique.pass : undefined,
                      score: typeof parsed.critique.score === 'number' ? parsed.critique.score : undefined,
                      issues: Array.isArray(parsed.critique.issues)
                        ? parsed.critique.issues.filter((v: unknown): v is string => typeof v === 'string')
                        : undefined,
                      recommendations: Array.isArray(parsed.critique.recommendations)
                        ? parsed.critique.recommendations.filter((v: unknown): v is string => typeof v === 'string')
                        : undefined,
                      summary: typeof parsed.critique.summary === 'string' ? parsed.critique.summary : undefined,
                    }
                  : undefined,
                workerCount: typeof parsed.worker_count === 'number' ? parsed.worker_count : undefined,
                workerCostUsd: typeof parsed.worker_cost_usd === 'number' ? parsed.worker_cost_usd : undefined,
                planner: parsed.planner || undefined,
                nodeId: parsed.node_id || undefined,
                title: parsed.title || undefined,
                kind: parsed.kind || undefined,
                mode: parsed.mode || undefined,
                status: parsed.status || undefined,
                attempts: typeof parsed.attempts === 'number'
                  ? parsed.attempts
                  : (typeof parsed.attempt === 'number' ? parsed.attempt : undefined),
                maxAttempts: typeof parsed.max_attempts === 'number' ? parsed.max_attempts : undefined,
                reason: parsed.reason || undefined,
                nextBackoffMs: typeof parsed.next_backoff_ms === 'number' ? parsed.next_backoff_ms : undefined,
                failureReason: parsed.failure_reason || undefined,
                layerIndex: typeof parsed.layer_index === 'number' ? parsed.layer_index : undefined,
                nodeCount: typeof parsed.node_count === 'number' ? parsed.node_count : undefined,
                dependsOn: Array.isArray(parsed.depends_on) ? parsed.depends_on : undefined,
                tools: Array.isArray(parsed.tools) ? parsed.tools : undefined,
                engine: parsed.engine || undefined,
                model: parsed.model || undefined,
                cost: typeof parsed.cost === 'number' ? parsed.cost : undefined,
                artifactType: typeof parsed.artifact_type === 'string' ? parsed.artifact_type : undefined,
                artifactUri: typeof parsed.artifact_uri === 'string' ? parsed.artifact_uri : undefined,
                workers: Array.isArray(parsed.workers)
                  ? parsed.workers.map((item: Record<string, unknown>) => ({
                      id: typeof item.id === 'string' ? item.id : undefined,
                      title: typeof item.title === 'string' ? item.title : undefined,
                      kind: typeof item.kind === 'string' ? item.kind : undefined,
                      mode: typeof item.mode === 'string' ? item.mode : undefined,
                      status: typeof item.status === 'string' ? item.status : undefined,
                      dependsOn: Array.isArray(item.depends_on)
                        ? item.depends_on.filter((v): v is string => typeof v === 'string')
                        : undefined,
                      summary: typeof item.summary === 'string' ? item.summary : undefined,
                      artifactType: typeof item.artifact_type === 'string' ? item.artifact_type : undefined,
                      artifactUri: typeof item.artifact_uri === 'string' ? item.artifact_uri : undefined,
                    }))
                  : undefined,
                steps: Array.isArray(parsed.steps) ? parsed.steps : undefined,
                tenant: parseTenantPayload(parsed.tenant),
              })
            } else if (parsed.type === 'approval_request') {
              callbacksRef.current?.onApprovalRequest?.({
                id: String(parsed.id || ''),
                tool: String(parsed.tool || ''),
                risk: typeof parsed.risk === 'string' ? parsed.risk : undefined,
                argsPreview:
                  parsed.args_preview && typeof parsed.args_preview === 'object'
                    ? (parsed.args_preview as Record<string, unknown>)
                    : undefined,
                timeoutSec: typeof parsed.timeout_sec === 'number' ? parsed.timeout_sec : undefined,
              })
            } else if (parsed.type === 'approval_result') {
              callbacksRef.current?.onApprovalResult?.({
                id: String(parsed.id || ''),
                approved: Boolean(parsed.approved),
                reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
              })
            } else if (parsed.type === 'hook_event') {
              const baseEvent: HookEventBase = {
                event: parsed.event || 'unknown',
                category: parsed.category || 'other',
                timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : undefined,
              }

              callbacksRef.current?.onHookEvent?.(baseEvent)

              if (parsed.category === 'permission') {
                callbacksRef.current?.onPermissionRequest?.({
                  ...baseEvent,
                  category: 'permission',
                  tool: parsed.tool || undefined,
                  toolInput: parsed.tool_input || undefined,
                  permissionSuggestions: parsed.permission_suggestions,
                })
              } else if (parsed.category === 'subtask') {
                callbacksRef.current?.onSubtask?.({
                  ...baseEvent,
                  category: 'subtask',
                  stage: parsed.stage || undefined,
                  agentId: parsed.agent_id || undefined,
                  agentType: parsed.agent_type || undefined,
                  agentName: parsed.agent_name || undefined,
                  transcriptPath: parsed.agent_transcript_path || undefined,
                })
              } else if (parsed.category === 'notification') {
                callbacksRef.current?.onNotification?.({
                  ...baseEvent,
                  category: 'notification',
                  level: parsed.level || undefined,
                  title: parsed.title || undefined,
                  message: parsed.message || undefined,
                })
              }
            } else if (parsed.type === 'structured_output') {
              callbacksRef.current?.onStructuredOutput?.({
                data: parsed.data,
              })
            } else if (parsed.type === 'text' && parsed.content) {
              pendingTextRef.current += String(parsed.content)
              scheduleTextFlush()
            } else if (parsed.type === 'ui_command') {
              callbacksRef.current?.onUICommand?.({
                command: parsed.command,
                target: parsed.target,
                params: parsed.params || {},
              })
            } else if (parsed.type === 'navigate') {
              callbacksRef.current?.onNavigate?.({ to: parsed.to })
            } else if (parsed.type === 'toast') {
              callbacksRef.current?.onToast?.({
                message: parsed.message,
                level: parsed.level || 'info',
              })
            } else if (parsed.type === 'scroll_to') {
              callbacksRef.current?.onScrollTo?.({ target: parsed.target })
            } else if (parsed.type === 'set_theme') {
              callbacksRef.current?.onSetTheme?.({ theme: parsed.theme })
            } else if (parsed.type === 'graph_command') {
              callbacksRef.current?.onGraphCommand?.({
                command: String(parsed.command || ''),
                target: typeof parsed.target === 'string' ? parsed.target : undefined,
                params: parsed.params && typeof parsed.params === 'object'
                  ? (parsed.params as Record<string, unknown>)
                  : undefined,
              })
            } else if (parsed.type === 'graph_batch') {
              const rawSteps: unknown[] = Array.isArray(parsed.steps) ? parsed.steps : []
              const steps: GraphCommandEvent[] = rawSteps
                .map((item: unknown) => (item && typeof item === 'object'
                  ? (item as Record<string, unknown>)
                  : null))
                .filter((item): item is Record<string, unknown> => item !== null)
                .map((item) => ({
                  command: String(item.command || ''),
                  target: typeof item.target === 'string' ? item.target : undefined,
                  params: item.params && typeof item.params === 'object'
                    ? (item.params as Record<string, unknown>)
                    : undefined,
                }))
                .filter((item) => item.command.length > 0)
              callbacksRef.current?.onGraphBatch?.({
                batchId: typeof parsed.batch_id === 'string' ? parsed.batch_id : undefined,
                mode: parsed.mode === 'all_or_nothing' ? 'all_or_nothing' : 'best_effort',
                steps,
              })
            } else if (parsed.type === 'task_receipt') {
              const steps: TaskReceiptStepEvent[] = Array.isArray(parsed.steps)
                ? parsed.steps
                  .map((item: unknown) => (item && typeof item === 'object'
                    ? (item as Record<string, unknown>)
                    : null))
                  .filter((item: Record<string, unknown> | null): item is Record<string, unknown> => item !== null)
                  .map((item: Record<string, unknown>) => ({
                    id: typeof item.id === 'string' ? item.id : '',
                    label: typeof item.label === 'string' ? item.label : '',
                    module: typeof item.module === 'string' ? item.module : undefined,
                    status: ['pending', 'running', 'success', 'failed', 'skipped'].includes(String(item.status || ''))
                      ? (item.status as TaskReceiptStepEvent['status'])
                      : undefined,
                    tool: typeof item.tool === 'string' ? item.tool : undefined,
                    message: typeof item.message === 'string' ? item.message : undefined,
                  }))
                  .filter((item: TaskReceiptStepEvent) => item.id.length > 0 || item.label.length > 0)
                : []

              callbacksRef.current?.onTaskReceipt?.({
                runId: typeof parsed.run_id === 'string' ? parsed.run_id : undefined,
                taskType: typeof parsed.task_type === 'string' ? parsed.task_type : undefined,
                label: typeof parsed.label === 'string' ? parsed.label : undefined,
                status: ['queued', 'running', 'success', 'failed', 'partial'].includes(String(parsed.status || ''))
                  ? (parsed.status as TaskReceiptEvent['status'])
                  : undefined,
                source: typeof parsed.source === 'string' ? parsed.source : undefined,
                message: typeof parsed.message === 'string' ? parsed.message : undefined,
                steps,
              })
            } else if (parsed.type === 'tool_retry') {
              callbacksRef.current?.onToolCall?.({
                tool: String(parsed.tool || ''),
                status: 'retry',
                attempt: typeof parsed.attempt === 'number' ? parsed.attempt : undefined,
                maxAttempts: typeof parsed.max_attempts === 'number' ? parsed.max_attempts : undefined,
                reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
              })
            } else if (parsed.type === 'tool_fallback') {
              callbacksRef.current?.onToolCall?.({
                tool: String(parsed.tool || ''),
                status: 'fallback',
                stage: typeof parsed.stage === 'string' ? parsed.stage : undefined,
              })
            } else if (parsed.type === 'model_fallback') {
              callbacksRef.current?.onModelFallback?.({
                fromModel: String(parsed.from_model || ''),
                toModel: String(parsed.to_model || ''),
                reason: String(parsed.reason || 'timeout'),
              })
            } else if (parsed.type === 'tool_call') {
              callbacksRef.current?.onToolCall?.({
                tool: String(parsed.tool || ''),
                status: typeof parsed.status === 'string' ? parsed.status : 'calling',
                reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
                stage: typeof parsed.stage === 'string' ? parsed.stage : undefined,
              })
            } else if (parsed.type === 'agent_handoff') {
              const target = typeof parsed.target_agent === 'string' ? parsed.target_agent : 'unknown'
              const summary = typeof parsed.summary === 'string' ? parsed.summary : undefined
              const error = typeof parsed.error === 'string' ? parsed.error : undefined
              const preview = typeof parsed.task_preview === 'string' ? parsed.task_preview : undefined
              callbacksRef.current?.onToolCall?.({
                tool: `delegate_to_agent:${target}`,
                status: typeof parsed.stage === 'string' ? `handoff_${parsed.stage}` : 'handoff',
                reason: error || summary || preview,
              })
            } else if (parsed.type === 'agent_handoff_batch') {
              const successCount = typeof parsed.success_count === 'number' ? parsed.success_count : 0
              const failedCount = typeof parsed.failed_count === 'number' ? parsed.failed_count : 0
              const skippedCount = typeof parsed.skipped_count === 'number' ? parsed.skipped_count : 0
              const total = typeof parsed.total === 'number' ? parsed.total : 0
              const detail = `mode=${String(parsed.mode || 'best_effort')} total=${total} success=${successCount} failed=${failedCount} skipped=${skippedCount}`
              callbacksRef.current?.onToolCall?.({
                tool: 'delegate_batch_agents',
                status: typeof parsed.stage === 'string' ? `handoff_batch_${parsed.stage}` : 'handoff_batch',
                reason: detail,
              })
            } else if (parsed.type === 'done') {
              flushPendingText()
              if (parsed.session_id) {
                setSession(sessionLookupKey, parsed.session_id)
              }
              callbacksRef.current?.onDone?.({
                sessionId: parsed.session_id || undefined,
                cost: typeof parsed.cost === 'number' ? parsed.cost : undefined,
                inputTokens: typeof parsed.input_tokens === 'number' ? parsed.input_tokens : undefined,
                outputTokens: typeof parsed.output_tokens === 'number' ? parsed.output_tokens : undefined,
                stopReason: typeof parsed.stop_reason === 'string' ? parsed.stop_reason : undefined,
                effectiveModel: typeof parsed.effective_model === 'string' ? parsed.effective_model : undefined,
                fallbackApplied: typeof parsed.fallback_applied === 'boolean' ? parsed.fallback_applied : undefined,
                retryCount: typeof parsed.retry_count === 'number' ? parsed.retry_count : undefined,
                toolCallCount: typeof parsed.tool_call_count === 'number' ? parsed.tool_call_count : undefined,
                requestId: typeof parsed.request_id === 'string' ? parsed.request_id : undefined,
              })
            }
          } catch {
            // skip malformed JSON
          }
        }
      }

      flushPendingText()
    } catch (e) {
      flushPendingText()
      if ((e as Error).name !== 'AbortError') {
        const errorMessage = e instanceof Error ? e.message : 'unknown error'
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = {
              ...last,
              content: `AI 服务暂时不可用，请稍后再试。\n\n错误信息：${errorMessage}`,
            }
          }
          return updated
        })
      }
    } finally {
      flushPendingText()
      setIsStreaming(false)
      abortRef.current = null
      activeAssistantIdRef.current = null
    }
  }, [isStreaming, getSession, setSession, scheduleTextFlush, flushPendingText])

  return { messages, isStreaming, sendMessage, stop, clearMessages, setMessages }
}
