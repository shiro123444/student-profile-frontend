// API 服务层 - 对接 Go 后端（默认通过 Vite `/api` 代理）
// 所有路径已对齐 server-go 路由

import { request, API_BASE, ApiError, getToken, fetchWithAuthRetry } from './client'

// ==================== MBTI 相关 API ====================

export interface MBTIAnswer {
  questionId: number
  answer: 'A' | 'B'
}

export interface MBTISubmitData {
  studentName: string
  answers: MBTIAnswer[]
}

export interface MBTIResult {
  studentId: string
  mbtiCode: string
  dimensions: {
    E: number
    I: number
    S: number
    N: number
    T: number
    F: number
    J: number
    P: number
  }
}

export interface MBTIType {
  code: string
  name: string
  description: string
  strengths: string[] | null
  weaknesses: string[] | null
  careers: string[] | null
}

export const mbtiApi = {
  submit: (data: MBTISubmitData) =>
    request<MBTIResult>('/mbti/submit', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getType: (code: string) => request<MBTIType>(`/mbti/types/${code}`),

  getAllTypes: () => request<MBTIType[]>('/mbti/types'),

  getRecommendedCareers: (mbtiCode: string) =>
    request<Career[]>(`/mbti/types/${mbtiCode}/careers`),
}

// ==================== 职业相关 API ====================

export interface Skill {
  id: string
  name: string
  category: string
  description: string
}

export interface Career {
  id: string
  name: string
  description: string
  salaryRange: string
  demandLevel: string
  requiredSkills: Skill[]
  suitableMBTI: string[]
}

export const careerApi = {
  getById: (careerId: string) => request<Career>(`/careers/${careerId}`),

  getLearningPaths: (careerId: string) =>
    request<LearningPath[]>(`/careers/${careerId}/learning-paths`),
}

// ==================== 学习路径 API ====================

export interface Course {
  id: string
  name: string
  provider: string
  url: string
  duration: string
  level: string
  description: string
  rating: number
  skills: string[]
  completed?: boolean
}

export interface LearningPath {
  id: string
  name: string
  description: string
  estimatedDuration: string
  courses: Course[]
  targetCareer?: Career
}

export const learningPathApi = {
  getRecommended: (studentId?: string) =>
    request<LearningPath[]>(
      `/learning-paths/recommended${studentId ? `?studentId=${studentId}` : ''}`,
    ),
}

// ==================== Agent API ====================

export interface AgentOrchestratorRuntimeOptions {
  enabled?: boolean
  profile?: string
  plannerMode?: 'fast' | 'balanced' | 'deep'
  executorMode?: 'fast' | 'balanced' | 'deep'
  maxSteps?: number
  maxWorkers?: number
  workerTimeoutSec?: number
  workerMaxRetries?: number
  workerRetryBackoffMs?: number
  maxBudgetUsd?: number
  critiqueEnabled?: boolean
  critiqueMode?: 'fast' | 'balanced' | 'deep'
  dynamicReplanEnabled?: boolean
  maxReplans?: number
}

export interface AgentCodingRuntimeOptions {
  enabled?: boolean
  workspaceId?: string
  approvalMode?: 'per_call'
  allowNetwork?: boolean
  policyProfile?: string
}

export interface AgentRuntimeOptions {
  mode?: 'fast' | 'balanced' | 'deep'
  engine?: 'claude' | 'openai'
  modelTier?: 'haiku' | 'sonnet' | 'opus'
  engineModel?: string
  outputFormat?: string | Record<string, unknown>
  toolAllowlist?: string[]
  toolBlocklist?: string[]
  orchestrator?: AgentOrchestratorRuntimeOptions
  coding?: AgentCodingRuntimeOptions
}

export type AgentTaskRiskLevel = 'low' | 'medium' | 'high'
export type AgentTaskModule =
  | 'advisor'
  | 'notes'
  | 'documents'
  | 'experiments'
  | 'graph'
  | 'pdf'
  | 'coding'
  | 'rag'

export interface AgentTaskTemplateStep {
  id: string
  label: string
  module: AgentTaskModule
  action?: string
  risk?: AgentTaskRiskLevel
}

export interface AgentTaskTemplate {
  task_type: string
  label: string
  description?: string
  target_agent?: string
  default_prompt?: string
  risk_level: AgentTaskRiskLevel
  tags?: string[]
  steps: AgentTaskTemplateStep[]
  receipt_schema?: {
    version?: string
    fields?: string[]
  }
}

export interface AgentTaskTemplateListResponse {
  templates: AgentTaskTemplate[]
  source: 'api' | 'fallback'
}

export interface AgentTaskTemplateStartPayload {
  taskType: string
  label?: string
  prompt?: string
  studentId?: string
  workspaceId?: string
  metadata?: Record<string, unknown>
}

export interface AgentTaskTemplateStartResponse {
  ok: boolean
  run_id: string
  task_type: string
  label?: string
  started_at: number
  source: 'api' | 'fallback'
}

export interface AgentTenantContext {
  tenantId?: string
  role?: string
  studentId?: string
  userId?: string
  workspaceId?: string
  locale?: string
  metadata?: Record<string, unknown>
}

export interface AgentStreamOptions {
  agentName: string
  prompt: string
  studentId?: string
  context?: Record<string, unknown>
  runtime?: AgentRuntimeOptions
  tenant?: AgentTenantContext
  signal?: AbortSignal
  sessionId?: string
}

export interface AIDispatchStreamOptions {
  taskType: string
  prompt: string
  priority?: string
  cacheKey?: string
  agentName?: string
  studentId?: string
  context?: Record<string, unknown>
  contextSnapshot?: Record<string, unknown>
  runtime?: AgentRuntimeOptions
  tenant?: AgentTenantContext
  signal?: AbortSignal
  sessionId?: string
}


export interface AgentSessionItem {
  session_id: string
  agent_name?: string
  engine?: string
  model?: string
  mode?: string
  last_prompt?: string
  last_summary?: string
  total_cost_usd?: number
  total_input_tokens?: number
  total_output_tokens?: number
  updated_at?: number
}

export interface AgentCatalogItem {
  name: string
  description: string
  model: string
  engine: string
  engine_model?: string
  tool_count: number
}

export interface AgentCapability {
  name: string
  description: string
  model: string
  engine: string
  engine_model?: string
  tool_count: number
  tools: string[]
  runtime_modes: Array<'fast' | 'balanced' | 'deep' | string>
  supports_orchestrator: boolean
  supports_streaming: boolean
}


export interface AgentOrchestratorStepSummary {
  id?: string
  title?: string
  kind?: string
  mode?: string
  objective?: string
  depends_on?: string[]
}

export interface AgentOrchestratorWorkerSummary {
  id?: string
  title?: string
  kind?: string
  mode?: string
  status?: string
  depends_on?: string[]
  engine?: string
  model?: string
  cost?: number
  summary?: string
  artifact_type?: string
  artifact_uri?: string
}

export interface AgentOrchestratorSummary {
  protocol?: string
  profile?: string
  strategy?: string
  complexity?: string
  selected_mode?: string
  max_workers?: number
  worker_timeout_s?: number
  worker_max_retries?: number
  worker_retry_backoff_ms?: number
  max_budget_usd?: number
  critique_enabled?: boolean
  critique_mode?: string
  dynamic_replan_enabled?: boolean
  max_replans?: number
  replan_count?: number
  critique?: {
    pass?: boolean
    score?: number
    issues?: string[]
    recommendations?: string[]
    summary?: string
  }
  worker_count?: number
  worker_cost_usd?: number
  planner?: { engine?: string; model?: string; mode?: string }
  steps?: AgentOrchestratorStepSummary[]
  workers?: AgentOrchestratorWorkerSummary[]
  tenant?: {
    tenant_id?: string
    role?: string
    student_id?: string
    user_id?: string
    workspace_id?: string
    locale?: string
    metadata?: Record<string, unknown>
  }
}

export interface AgentQueryResponse {
  response: string
  structured_output?: unknown
  agent_used: string
  engine_used?: string
  model_used?: string
  mode_used?: string
  output_format_used?: string
  tenant?: {
    tenant_id?: string
    role?: string
    student_id?: string
    user_id?: string
    workspace_id?: string
    locale?: string
    metadata?: Record<string, unknown>
  }
  orchestrator?: AgentOrchestratorSummary
  cost_usd: number
}


export interface ApprovalDecisionPayload {
  reason?: string
}

export interface ApprovalDecisionResponse {
  ok: boolean
  request_id: string
  approved: boolean
  reason?: string
}

export interface ApprovalMetricsResponse {
  pending: number
  total_requests: number
  approved: number
  rejected: number
  timed_out: number
  avg_wait_ms: number
}

export interface GraphCommandFeedbackItem {
  command: string
  target?: string
  status?: 'success' | 'ignored' | 'error'
  success?: boolean
  message?: string
  issuedAt?: number
  executedAt?: number
  params?: Record<string, unknown>
}

export interface GraphCommandFeedbackPayload {
  agentName?: string
  sessionId?: string
  source?: string
  items: GraphCommandFeedbackItem[]
}

export interface GraphCommandFeedbackResponse {
  ok: boolean
  accepted: number
  student_id?: string
  agent_name?: string
  session_id?: string
}

export interface GraphCommandFeedbackHistoryQuery {
  agentName?: string
  sessionId?: string
  status?: 'success' | 'ignored' | 'error'
  command?: string
  limit?: number
}

export interface GraphCommandFeedbackHistoryItem {
  command: string
  target?: string
  status?: 'success' | 'ignored' | 'error'
  success?: boolean
  message?: string
  issued_at?: number
  executed_at?: number
  params?: Record<string, unknown>
}

export interface GraphCommandFeedbackHistoryResponse {
  ok: boolean
  total: number
  student_id?: string
  agent_name?: string
  session_id?: string
  items: GraphCommandFeedbackHistoryItem[]
}

export interface GraphBatchFeedbackItem {
  batchId: string
  mode?: 'best_effort' | 'all_or_nothing'
  status?: 'running' | 'success' | 'partial' | 'failed'
  completed?: number
  total?: number
  rolledBack?: number
  rollbackFailed?: number
  message?: string
  startedAt?: number
  finishedAt?: number
}

export interface GraphBatchFeedbackPayload {
  agentName?: string
  sessionId?: string
  source?: string
  item: GraphBatchFeedbackItem
}

export interface GraphBatchFeedbackResponse {
  ok: boolean
  accepted: number
  student_id?: string
  agent_name?: string
  session_id?: string
  batch_id?: string
}

export interface GraphBatchFeedbackHistoryQuery {
  agentName?: string
  sessionId?: string
  status?: 'running' | 'success' | 'partial' | 'failed'
  beforeTs?: number
  limit?: number
}

export interface GraphBatchFeedbackHistoryItem {
  batch_id: string
  mode?: 'best_effort' | 'all_or_nothing'
  status?: 'running' | 'success' | 'partial' | 'failed'
  completed?: number
  total?: number
  rolled_back?: number
  rollback_failed?: number
  message?: string
  started_at?: number
  finished_at?: number
}

export interface GraphBatchFeedbackHistoryResponse {
  ok: boolean
  total: number
  student_id?: string
  agent_name?: string
  session_id?: string
  status?: 'running' | 'success' | 'partial' | 'failed'
  source?: 'postgres' | 'redis'
  next_before_ts?: number
  items: GraphBatchFeedbackHistoryItem[]
}

export interface AgentGatewayRouteMetrics {
  count: number
  latency_avg_ms: number
  latency_max_ms: number
  latency_total_ms: number
}

export interface AgentGatewayDimensionMetrics {
  requests_total: number
  rate_limited_429_total: number
  upstream_unavailable_503_total: number
  status_counts: Record<string, number>
  latency_avg_ms: number
  latency_max_ms: number
  latency_total_ms: number
}

export interface AgentGatewayScopeMetrics {
  requests_total: number
  rate_limited_429_total: number
  upstream_unavailable_503_total: number
  status_counts: Record<string, number>
  routes: Record<string, AgentGatewayRouteMetrics>
  agents?: Record<string, AgentGatewayDimensionMetrics>
  workspaces?: Record<string, AgentGatewayDimensionMetrics>
}

export interface AgentGatewayCircuitMetrics {
  current_state: string
  updated_at: number
  transition_count: Record<string, number>
}

export interface AgentGatewayTrendPoint {
  ts: number
  requests_total: number
  rate_limited_429_total: number
  upstream_unavailable_503_total: number
  status_4xx: number
  status_5xx: number
  latency_avg_ms: number
}

export interface AgentGatewayMetricsResponse {
  generated_at: number
  global: AgentGatewayScopeMetrics
  scopes: Record<string, AgentGatewayScopeMetrics>
  circuit: AgentGatewayCircuitMetrics
  trend_bucket_sec?: number
  trend?: AgentGatewayTrendPoint[]
  window_sec?: number
  selected_agent?: string
  selected_workspace?: string
  filtered?: AgentGatewayDimensionMetrics
}

export interface AgentGatewayMetricsHistorySummary {
  requests_total: number
  rate_limited_429_total: number
  upstream_unavailable_503_total: number
  status_counts: Record<string, number>
  latency_avg_ms: number
}

export interface AgentGatewayMetricsHistoryResponse {
  enabled: boolean
  generated_at: number
  scope: string
  window_sec: number
  bucket_sec: number
  selected_agent?: string
  selected_workspace?: string
  summary: AgentGatewayMetricsHistorySummary
  points: AgentGatewayTrendPoint[]
}

export interface CodingPolicyProfilesResponse {
  enabled: boolean
  config_path: string
  default_profile: string
  source_version: string
  profiles: Record<string, unknown>
  errors: string[]
}

export interface ToolAnnotationHints {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolDetail {
  name: string
  description?: string
  annotations?: ToolAnnotationHints | null
  risk_level?: 'unknown' | 'read_only' | 'idempotent' | 'open_world' | 'destructive'
  mcp_name?: string
  mcp_server?: string
  engine_support?: string[]
}

export interface ToolPackageInfo {
  tools: string[]
  tool_details?: ToolDetail[]
  category: string
  source: string
  external?: Record<string, unknown> | null
}

export type ToolPackageCatalog = Record<string, ToolPackageInfo>

const FALLBACK_TASK_TEMPLATES: AgentTaskTemplate[] = [
  {
    task_type: 'documents_to_notes',
    label: '文档沉淀到笔记',
    description: '从 PDF 检索关键内容，生成结构化学习笔记草稿。',
    target_agent: 'document-reader',
    default_prompt: '请从当前 PDF 资料中提炼重点并输出可直接落地的学习笔记结构。',
    risk_level: 'low',
    tags: ['documents', 'notes', 'rag'],
    steps: [
      { id: 'retrieve', label: '检索文档片段', module: 'documents', action: 'retrieve', risk: 'low' },
      { id: 'summarize', label: '提炼关键信息', module: 'advisor', action: 'summarize', risk: 'low' },
      { id: 'write_note', label: '生成笔记草稿', module: 'notes', action: 'write_note', risk: 'medium' },
    ],
    receipt_schema: {
      version: 'v1',
      fields: ['run_id', 'task_type', 'status', 'steps', 'approvals', 'artifacts'],
    },
  },
  {
    task_type: 'notes_to_graph_analysis',
    label: '笔记提炼到图谱分析',
    description: '把笔记中的概念关系整理为图谱分析任务并生成回执。',
    target_agent: 'note-assistant',
    default_prompt: '请基于当前笔记内容抽取实体与关系，并给出图谱分析路径。',
    risk_level: 'medium',
    tags: ['notes', 'graph'],
    steps: [
      { id: 'extract', label: '抽取实体关系', module: 'notes', action: 'extract_entities', risk: 'low' },
      { id: 'graph', label: '执行图谱分析', module: 'graph', action: 'graph_analysis', risk: 'medium' },
      { id: 'receipt', label: '生成分析回执', module: 'advisor', action: 'receipt', risk: 'low' },
    ],
    receipt_schema: {
      version: 'v1',
      fields: ['run_id', 'task_type', 'status', 'steps', 'graph_batch_id', 'issues'],
    },
  },
  {
    task_type: 'experiment_retro_report',
    label: '实验复盘报告',
    description: '对实验执行过程进行复盘，输出问题清单与修复建议。',
    target_agent: 'web-coder',
    default_prompt: '请对实验执行过程做复盘，输出问题、根因、修复动作和下一步计划。',
    risk_level: 'medium',
    tags: ['experiments', 'coding'],
    steps: [
      { id: 'collect', label: '采集实验上下文', module: 'experiments', action: 'collect_context', risk: 'low' },
      { id: 'analyze', label: '代码与结果分析', module: 'coding', action: 'analyze', risk: 'medium' },
      { id: 'report', label: '产出复盘报告', module: 'advisor', action: 'report', risk: 'low' },
    ],
    receipt_schema: {
      version: 'v1',
      fields: ['run_id', 'task_type', 'status', 'steps', 'risk_level', 'next_actions'],
    },
  },
]

function buildAgentContext(opts: AgentStreamOptions): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = { ...(opts.context || {}) }

  if (opts.runtime) {
    merged._runtime = {
      ...(opts.runtime.mode ? { mode: opts.runtime.mode } : {}),
      ...(opts.runtime.engine ? { engine: opts.runtime.engine } : {}),
      ...(opts.runtime.modelTier ? { model_tier: opts.runtime.modelTier } : {}),
      ...(opts.runtime.engineModel ? { engine_model: opts.runtime.engineModel } : {}),
      ...(opts.runtime.outputFormat ? { output_format: opts.runtime.outputFormat } : {}),
      ...(Array.isArray(opts.runtime.toolAllowlist)
        ? { tool_allowlist: opts.runtime.toolAllowlist.filter((item) => typeof item === 'string' && item.trim().length > 0) }
        : {}),
      ...(Array.isArray(opts.runtime.toolBlocklist)
        ? { tool_blocklist: opts.runtime.toolBlocklist.filter((item) => typeof item === 'string' && item.trim().length > 0) }
        : {}),
      ...(opts.runtime.orchestrator
        ? {
            orchestrator: {
              ...(typeof opts.runtime.orchestrator.enabled === 'boolean'
                ? { enabled: opts.runtime.orchestrator.enabled }
                : {}),
              ...(opts.runtime.orchestrator.profile
                ? { profile: opts.runtime.orchestrator.profile }
                : {}),
              ...(opts.runtime.orchestrator.plannerMode
                ? { planner_mode: opts.runtime.orchestrator.plannerMode }
                : {}),
              ...(opts.runtime.orchestrator.executorMode
                ? { executor_mode: opts.runtime.orchestrator.executorMode }
                : {}),
              ...(typeof opts.runtime.orchestrator.maxSteps === 'number'
                ? { max_steps: opts.runtime.orchestrator.maxSteps }
                : {}),
              ...(typeof opts.runtime.orchestrator.maxWorkers === 'number'
                ? { max_workers: opts.runtime.orchestrator.maxWorkers }
                : {}),
              ...(typeof opts.runtime.orchestrator.workerTimeoutSec === 'number'
                ? { worker_timeout_s: opts.runtime.orchestrator.workerTimeoutSec }
                : {}),
              ...(typeof opts.runtime.orchestrator.workerMaxRetries === 'number'
                ? { worker_max_retries: opts.runtime.orchestrator.workerMaxRetries }
                : {}),
              ...(typeof opts.runtime.orchestrator.workerRetryBackoffMs === 'number'
                ? { worker_retry_backoff_ms: opts.runtime.orchestrator.workerRetryBackoffMs }
                : {}),
              ...(typeof opts.runtime.orchestrator.maxBudgetUsd === 'number'
                ? { max_budget_usd: opts.runtime.orchestrator.maxBudgetUsd }
                : {}),
              ...(typeof opts.runtime.orchestrator.critiqueEnabled === 'boolean'
                ? { critique_enabled: opts.runtime.orchestrator.critiqueEnabled }
                : {}),
              ...(opts.runtime.orchestrator.critiqueMode
                ? { critique_mode: opts.runtime.orchestrator.critiqueMode }
                : {}),
              ...(typeof opts.runtime.orchestrator.dynamicReplanEnabled === 'boolean'
                ? { dynamic_replan_enabled: opts.runtime.orchestrator.dynamicReplanEnabled }
                : {}),
              ...(typeof opts.runtime.orchestrator.maxReplans === 'number'
                ? { max_replans: opts.runtime.orchestrator.maxReplans }
                : {}),
            },
          }
        : {}),
      ...(opts.runtime.coding
        ? {
            coding: {
              ...(typeof opts.runtime.coding.enabled === 'boolean'
                ? { enabled: opts.runtime.coding.enabled }
                : {}),
              ...(opts.runtime.coding.workspaceId
                ? { workspace_id: opts.runtime.coding.workspaceId }
                : {}),
              ...(opts.runtime.coding.approvalMode
                ? { approval_mode: opts.runtime.coding.approvalMode }
                : {}),
              ...(typeof opts.runtime.coding.allowNetwork === 'boolean'
                ? { allow_network: opts.runtime.coding.allowNetwork }
                : {}),
              ...(opts.runtime.coding.policyProfile
                ? { policy_profile: opts.runtime.coding.policyProfile }
                : {}),
            },
          }
        : {}),
    }
  }

  if (opts.tenant) {
    merged._tenant = {
      ...(opts.tenant.tenantId ? { tenant_id: opts.tenant.tenantId } : {}),
      ...(opts.tenant.role ? { role: opts.tenant.role } : {}),
      ...(opts.tenant.studentId ? { student_id: opts.tenant.studentId } : {}),
      ...(opts.tenant.userId ? { user_id: opts.tenant.userId } : {}),
      ...(opts.tenant.workspaceId ? { workspace_id: opts.tenant.workspaceId } : {}),
      ...(opts.tenant.locale ? { locale: opts.tenant.locale } : {}),
      ...(opts.tenant.metadata ? { metadata: opts.tenant.metadata } : {}),
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

export const agentApi = {
  /** SSE 流式调用 — 返回 Response 供 useAgentStream 消费 */
  stream: (opts: AgentStreamOptions) => {
    return fetchWithAuthRetry('/agent/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_name: opts.agentName,
        prompt: opts.prompt,
        student_id: opts.studentId,
        context: buildAgentContext(opts),
        session_id: opts.sessionId,
      }),
      signal: opts.signal,
    })
  },

  /** 同步调用 — 等待完整响应 */
  query: (opts: Omit<AgentStreamOptions, 'signal'>) =>
    request<AgentQueryResponse>(
      '/agent/query', {
        method: 'POST',
        body: JSON.stringify({
          agent_name: opts.agentName,
          prompt: opts.prompt,
          student_id: opts.studentId,
          context: buildAgentContext(opts),
        }),
      }
    ),

  /** 获取可用 agent 列表 */
  list: () => request<AgentCatalogItem[]>('/agent/list'),

  /** 获取单个 agent 能力详情 */
  capabilities: (agentName: string) =>
    request<AgentCapability>(`/agent/${encodeURIComponent(agentName)}/capabilities`),

  /** 获取会话列表（用于恢复） */
  listSessions: (limit = 20) =>
    request<AgentSessionItem[]>(`/agent/sessions?limit=${limit}`),

  /** 清理会话（不传 sessionId 则清空全部） */
  clearSessions: (sessionId?: string) =>
    request<{ ok: boolean; cleared: number; session_id?: string }>(
      sessionId
        ? `/agent/sessions?session_id=${encodeURIComponent(sessionId)}`
        : '/agent/sessions',
      { method: 'DELETE' }
    ),

  /** 批准高风险工具调用 */
  approveAction: (requestId: string, payload: ApprovalDecisionPayload = {}) =>
    request<ApprovalDecisionResponse>(`/agent/approvals/${encodeURIComponent(requestId)}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 拒绝高风险工具调用 */
  rejectAction: (requestId: string, payload: ApprovalDecisionPayload = {}) =>
    request<ApprovalDecisionResponse>(`/agent/approvals/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** 审批队列与决策指标 */
  approvalMetrics: () =>
    request<ApprovalMetricsResponse>('/agent/approvals/metrics'),

  /** 图谱命令执行回执上报（用于后续推理上下文） */
  reportGraphFeedback: (payload: GraphCommandFeedbackPayload) =>
    request<GraphCommandFeedbackResponse>('/agent/graph/feedback', {
      method: 'POST',
      body: JSON.stringify({
        ...(payload.agentName ? { agent_name: payload.agentName } : {}),
        ...(payload.sessionId ? { session_id: payload.sessionId } : {}),
        ...(payload.source ? { source: payload.source } : {}),
        items: payload.items.map((item) => ({
          command: item.command,
          ...(item.target ? { target: item.target } : {}),
          ...(item.status ? { status: item.status } : {}),
          ...(typeof item.success === 'boolean' ? { success: item.success } : {}),
          ...(item.message ? { message: item.message } : {}),
          ...(typeof item.issuedAt === 'number' ? { issued_at: item.issuedAt } : {}),
          ...(typeof item.executedAt === 'number' ? { executed_at: item.executedAt } : {}),
          ...(item.params ? { params: item.params } : {}),
        })),
      }),
    }),

  /** 图谱命令执行回执查询（用于时间线） */
  listGraphFeedback: (params?: GraphCommandFeedbackHistoryQuery) => {
    const query = new URLSearchParams()
    if (params?.agentName) query.set('agent', params.agentName)
    if (params?.sessionId) query.set('session_id', params.sessionId)
    if (params?.status) query.set('status', params.status)
    if (params?.command) query.set('command', params.command)
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) {
      query.set('limit', String(Math.max(1, Math.floor(params.limit))))
    }
    const qs = query.toString()
    return request<GraphCommandFeedbackHistoryResponse>(`/agent/graph/feedback${qs ? `?${qs}` : ''}`)
  },

  /** 图谱批次执行回执上报（用于批次审计与复盘） */
  reportGraphBatchFeedback: (payload: GraphBatchFeedbackPayload) =>
    request<GraphBatchFeedbackResponse>('/agent/graph/batch-feedback', {
      method: 'POST',
      body: JSON.stringify({
        ...(payload.agentName ? { agent_name: payload.agentName } : {}),
        ...(payload.sessionId ? { session_id: payload.sessionId } : {}),
        ...(payload.source ? { source: payload.source } : {}),
        item: {
          batch_id: payload.item.batchId,
          ...(payload.item.mode ? { mode: payload.item.mode } : {}),
          ...(payload.item.status ? { status: payload.item.status } : {}),
          ...(typeof payload.item.completed === 'number' ? { completed: payload.item.completed } : {}),
          ...(typeof payload.item.total === 'number' ? { total: payload.item.total } : {}),
          ...(typeof payload.item.rolledBack === 'number' ? { rolled_back: payload.item.rolledBack } : {}),
          ...(typeof payload.item.rollbackFailed === 'number' ? { rollback_failed: payload.item.rollbackFailed } : {}),
          ...(payload.item.message ? { message: payload.item.message } : {}),
          ...(typeof payload.item.startedAt === 'number' ? { started_at: payload.item.startedAt } : {}),
          ...(typeof payload.item.finishedAt === 'number' ? { finished_at: payload.item.finishedAt } : {}),
        },
      }),
    }),

  /** 图谱批次执行回执查询（用于事务审计） */
  listGraphBatchFeedback: (params?: GraphBatchFeedbackHistoryQuery) => {
    const query = new URLSearchParams()
    if (params?.agentName) query.set('agent', params.agentName)
    if (params?.sessionId) query.set('session_id', params.sessionId)
    if (params?.status) query.set('status', params.status)
    if (typeof params?.beforeTs === 'number' && Number.isFinite(params.beforeTs) && params.beforeTs > 0) {
      query.set('before_ts', String(Math.floor(params.beforeTs)))
    }
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) {
      query.set('limit', String(Math.max(1, Math.floor(params.limit))))
    }
    const qs = query.toString()
    return request<GraphBatchFeedbackHistoryResponse>(`/agent/graph/batch-feedback${qs ? `?${qs}` : ''}`)
  },

  /** Agent 网关 telemetry 快照（支持过滤） */
  metrics: (params?: { agent?: string; workspace?: string; windowSec?: number }) => {
    const query = new URLSearchParams()
    if (params?.agent) query.set('agent', params.agent)
    if (params?.workspace) query.set('workspace', params.workspace)
    if (typeof params?.windowSec === 'number' && Number.isFinite(params.windowSec)) {
      query.set('window_sec', String(Math.max(0, Math.floor(params.windowSec))))
    }
    const qs = query.toString()
    return request<AgentGatewayMetricsResponse>(`/agent/metrics${qs ? `?${qs}` : ''}`)
  },

  /** Agent 网关 telemetry 持久化历史（Postgres） */
  metricsHistory: (params?: {
    scope?: string
    agent?: string
    workspace?: string
    windowSec?: number
    bucketSec?: number
  }) => {
    const query = new URLSearchParams()
    if (params?.scope) query.set('scope', params.scope)
    if (params?.agent) query.set('agent', params.agent)
    if (params?.workspace) query.set('workspace', params.workspace)
    if (typeof params?.windowSec === 'number' && Number.isFinite(params.windowSec)) {
      query.set('window_sec', String(Math.max(0, Math.floor(params.windowSec))))
    }
    if (typeof params?.bucketSec === 'number' && Number.isFinite(params.bucketSec)) {
      query.set('bucket_sec', String(Math.max(0, Math.floor(params.bucketSec))))
    }
    const qs = query.toString()
    return request<AgentGatewayMetricsHistoryResponse>(`/agent/metrics/history${qs ? `?${qs}` : ''}`)
  },

  /** coding 策略模板快照（热更新状态） */
  codingPolicies: () =>
    request<CodingPolicyProfilesResponse>('/agent/coding/policies'),

  /** 任务模板列表（P7-1：跨板块任务入口） */
  taskTemplates: async (): Promise<AgentTaskTemplateListResponse> => {
    try {
      const payload = await request<{
        templates?: AgentTaskTemplate[]
        items?: AgentTaskTemplate[]
      }>('/agent/task-templates')

      const templates = Array.isArray(payload?.templates)
        ? payload.templates
        : (Array.isArray(payload?.items) ? payload.items : [])

      if (templates.length > 0) {
        return { templates, source: 'api' }
      }
    } catch {
      // fall through to fallback templates
    }

    return {
      templates: FALLBACK_TASK_TEMPLATES,
      source: 'fallback',
    }
  },

  /** 启动任务模板（后端未就绪时自动 fallback，保证前端联调可继续） */
  startTaskTemplate: async (
    payload: AgentTaskTemplateStartPayload,
  ): Promise<AgentTaskTemplateStartResponse> => {
    try {
      const response = await request<Partial<AgentTaskTemplateStartResponse>>('/agent/task-templates/start', {
        method: 'POST',
        body: JSON.stringify({
          task_type: payload.taskType,
          ...(payload.label ? { label: payload.label } : {}),
          ...(payload.prompt ? { prompt: payload.prompt } : {}),
          ...(payload.studentId ? { student_id: payload.studentId } : {}),
          ...(payload.workspaceId ? { workspace_id: payload.workspaceId } : {}),
          ...(payload.metadata ? { metadata: payload.metadata } : {}),
        }),
      })

      const runId = typeof response.run_id === 'string' && response.run_id
        ? response.run_id
        : `task-${Date.now()}`

      const startedAt = typeof response.started_at === 'number'
        ? response.started_at
        : Math.floor(Date.now() / 1000)

      return {
        ok: response.ok !== false,
        run_id: runId,
        task_type: (typeof response.task_type === 'string' && response.task_type) || payload.taskType,
        label: typeof response.label === 'string' ? response.label : payload.label,
        started_at: startedAt,
        source: 'api',
      }
    } catch {
      return {
        ok: true,
        run_id: `task-local-${Date.now()}`,
        task_type: payload.taskType,
        label: payload.label,
        started_at: Math.floor(Date.now() / 1000),
        source: 'fallback',
      }
    }
  },

  /** 公开流式调用 — 首页聊天用，无需登录 */
  publicStream: (opts: AgentStreamOptions) => {
    return fetch(`${API_BASE}/agent/public/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: opts.agentName,
        prompt: opts.prompt,
        context: buildAgentContext(opts),
        session_id: opts.sessionId,
      }),
      signal: opts.signal,
    })
  },

  /** 获取所有可用工具 (按包分组) */
  tools: () => request<ToolPackageCatalog>('/agent/tools'),

  /** 获取所有可用技能工作流 */
  skills: () => request<{ name: string; description: string; category: string }[]>('/agent/skills'),

  /** 执行技能工作流 */
  executeSkill: (name: string, params?: Record<string, unknown>) =>
    request('/agent/skills/execute', {
      method: 'POST',
      body: JSON.stringify({ skill_name: name, params: params || {} }),
    }),

  /** 公开工具列表 (无需登录) */
  publicTools: async (): Promise<ToolPackageCatalog> => {
    const response = await fetch(`${API_BASE}/agent/public/tools`)
    if (!response.ok) throw new Error('failed to fetch public tools')
    return response.json()
  },

  /** 公开技能列表 (无需登录) */
  publicSkills: () => fetch(`${API_BASE}/agent/public/skills`).then(r => r.json()),
}

export const aiDispatchApi = {
  stream: (opts: AIDispatchStreamOptions) => {
    const mergedContext = {
      ...(opts.context || {}),
      dispatch: {
        task_type: opts.taskType,
        priority: opts.priority,
        cache_key: opts.cacheKey,
      },
      ...(opts.contextSnapshot ? { context_snapshot: opts.contextSnapshot } : {}),
    }

    return fetchWithAuthRetry('/agent/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_name: opts.agentName || 'note-assistant',
        prompt: opts.prompt,
        student_id: opts.studentId,
        context: buildAgentContext({
          agentName: opts.agentName || 'note-assistant',
          prompt: opts.prompt,
          studentId: opts.studentId,
          context: mergedContext,
          runtime: opts.runtime,
          tenant: opts.tenant,
          sessionId: opts.sessionId,
        }),
        runtime: opts.runtime,
        tenant: opts.tenant,
        session_id: opts.sessionId,
      }),
      signal: opts.signal,
    })
  },
}

// ==================== 知识图谱 API ====================

export interface GraphNode {
  id: string
  name: string
  type: 'student' | 'mbti' | 'career' | 'skill' | 'course' | 'learning_path'
  color: string
  size: number
  description?: string
}

export interface GraphEdge {
  source: string
  target: string
  type: string
  label: string
}

export interface KnowledgeGraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export const graphApi = {
  getFullGraph: () => request<KnowledgeGraphData>('/graph/full'),

  getStudentGraph: (studentId: string) =>
    request<KnowledgeGraphData>(`/graph/student/${studentId}`),

  getCareerGraph: (careerId: string) =>
    request<KnowledgeGraphData>(`/graph/career/${careerId}`),
}

// ==================== 学生相关 API ====================

export interface StudentProfile {
  student: {
    id: string
    name: string
    studentNumber: string
    mbtiCode?: string
    className?: string
  }
  experimentCompletionRate: number
  knowledgeMasteryRate: number
  learningActivity: number
  accuracyRate: number
  level: string
  totalExperiments: number
  completedExperiments: number
}

export const studentApi = {
  getProfile: (studentId: string) =>
    request<StudentProfile>(`/students/${studentId}/profile`),

  refreshProfile: (studentId: string) =>
    request<StudentProfile>(`/students/${studentId}/profile/refresh`, {
      method: 'POST',
    }),

  getExperiments: (studentId: string) =>
    request<Experiment[]>(`/students/${studentId}/experiments`),

  getLearningTrend: (studentId: string) =>
    request<LearningTrend[]>(`/students/${studentId}/learning-trend`),
}

// ==================== 实验管理 API ====================

export interface Experiment {
  id: string
  title: string
  description: string
  type: string
  difficulty: string
  duration: number
  maxScore: number
  status?: string
  score?: number
  submittedAt?: string
}

export interface LearningTrend {
  date: string
  score: number
  accuracy: number
}

export const experimentApi = {
  getAll: () => request<Experiment[]>('/experiments'),

  getById: (id: string) => request<Experiment>(`/experiments/${id}`),

  create: (data: Partial<Experiment>) =>
    request<Experiment>('/experiments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  start: (experimentId: string, studentId: string) =>
    request<{ message: string }>('/experiments/start', {
      method: 'POST',
      body: JSON.stringify({ experiment_id: experimentId, student_id: studentId }),
    }),

  submit: (id: string, data: { studentId: string; answers: Record<string, string>; score?: number }) =>
    request<{ message: string }>(`/experiments/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// ==================== 班级管理 API ====================

export interface ClassOverview {
  classId: string
  className: string
  totalStudents: number
  avgCompletionRate: number
  avgAccuracy: number
  topStudents: { id: string; name: string; level: string }[]
}

export interface StudentAlert {
  studentId: string
  studentName: string
  alertType: string
  message: string
  severity: 'low' | 'medium' | 'high'
}

export const classApi = {
  getOverview: (classId: string) =>
    request<ClassOverview>(`/classes/${classId}/overview`),

  getAlerts: (classId: string) =>
    request<StudentAlert[]>(`/classes/${classId}/alerts`),
}

// ==================== 笔记 API ====================

export interface Note {
  id: string
  title: string
  content: string
  folder_id?: string | null
  folder: string
  sort_order?: number
  tags: string[]
  is_public: boolean
  word_count: number
  created_at: string
  updated_at: string
}

export interface NoteFolder {
  id: string
  student_id: string
  name: string
  parent_id?: string | null
  path: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface NoteTreeResponse {
  folders: NoteFolder[]
  notes: Note[]
}

export interface NoteFolderCreatePayload {
  name: string
  parent_id?: string | null
  index?: number
}

export interface NoteFolderUpdatePayload {
  name?: string
  parent_id?: string | null
  index?: number
}

export interface NoteReorderPayload {
  kind: 'note' | 'folder'
  item_id: string
  parent_id?: string | null
  index: number
}

export interface NoteGraphNode {
  id: string
  title: string
  folder: string
  link_count: number
}

export interface NoteGraphEdge {
  source: string
  target: string
}

export interface NoteGraph {
  nodes: NoteGraphNode[]
  edges: NoteGraphEdge[]
}

export interface NoteInlineCompletionResponse {
  completion: string
}

const normalizeNote = (note: Note): Note => ({
  ...note,
  folder: typeof note.folder === 'string' && note.folder.trim().length > 0 ? note.folder : '/',
  folder_id: typeof note.folder_id === 'string' && note.folder_id.length > 0 ? note.folder_id : null,
  sort_order: Number.isFinite(Number(note.sort_order)) ? Number(note.sort_order) : 0,
  tags: Array.isArray(note.tags) ? note.tags : [],
})

export const notesApi = {
  list: (params?: { folder?: string; tags?: string; search?: string; page?: number; page_size?: number }) => {
    const query = new URLSearchParams()
    if (params?.folder) query.set('folder', params.folder)
    if (params?.tags) query.set('tags', params.tags)
    if (params?.search) query.set('search', params.search)
    if (params?.page) query.set('page', String(params.page))
    if (params?.page_size) query.set('page_size', String(params.page_size))
    const qs = query.toString()
    return request<{ notes: Note[]; total: number }>(`/notes${qs ? `?${qs}` : ''}`)
      .then((res) => ({
        ...res,
        notes: Array.isArray(res.notes) ? res.notes.map(normalizeNote) : [],
      }))
  },

  get: (id: string) => request<Note>(`/notes/${id}`).then(normalizeNote),

  getTree: () =>
    request<NoteTreeResponse>('/notes/tree').then((res) => ({
      folders: Array.isArray(res.folders) ? res.folders : [],
      notes: Array.isArray(res.notes) ? res.notes.map(normalizeNote) : [],
    })),

  createFolder: (data: NoteFolderCreatePayload) =>
    request<NoteFolder>('/notes/folders', { method: 'POST', body: JSON.stringify(data) }),

  updateFolder: (id: string, data: NoteFolderUpdatePayload) =>
    request<NoteFolder>(`/notes/folders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteFolder: (id: string, strategy: 'move_to_parent' | 'delete_recursive' = 'move_to_parent') =>
    request<void>(`/notes/folders/${id}?strategy=${encodeURIComponent(strategy)}`, { method: 'DELETE' }),

  reorder: (payload: NoteReorderPayload) =>
    request<{ ok: boolean }>('/notes/reorder', { method: 'POST', body: JSON.stringify(payload) }),

  create: (data: { title: string; content: string; folder?: string; folder_id?: string | null; sort_order?: number; tags?: string[] }) =>
    request<Note>('/notes', { method: 'POST', body: JSON.stringify(data) }).then(normalizeNote),

  update: (id: string, data: { title?: string; content?: string; folder?: string; folder_id?: string | null; sort_order?: number; tags?: string[] }) =>
    request<Note>(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(normalizeNote),

  delete: (id: string) =>
    request<void>(`/notes/${id}`, { method: 'DELETE' }),

  getBacklinks: (id: string) =>
    request<Note[]>(`/notes/${id}/backlinks`).then((items) =>
      (Array.isArray(items) ? items : []).map(normalizeNote),
    ),

  getGraph: () => request<NoteGraph>('/notes/graph'),

  getFolders: () =>
    request<string[]>('/notes/folders').then((items) =>
      (Array.isArray(items) ? items : []),
    ),

  getTags: () =>
    request<string[]>('/notes/tags').then((items) =>
      (Array.isArray(items) ? items : []),
    ),

  completeInline: async (
    payload: {
      prefix: string
      suffix: string
      contextSummary?: string
      mode?: 'code' | 'prose'
      language?: string
    },
    signal?: AbortSignal,
  ): Promise<NoteInlineCompletionResponse> => {
    const response = await fetchWithAuthRetry('/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix: payload.prefix,
        suffix: payload.suffix,
        context_summary: payload.contextSummary || '',
        mode: payload.mode || 'prose',
        language: payload.language || '',
      }),
      signal,
    })
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: '内联补全失败' }))
      throw new ApiError(response.status, errorBody.error || '内联补全失败')
    }

    const data = await response.json().catch(() => ({ completion: '' })) as NoteInlineCompletionResponse
    return {
      completion: typeof data.completion === 'string' ? data.completion : '',
    }
  },
}


// ==================== 文档/PDF 工作台 API ====================

export interface LearningDocument {
  id: string
  title: string
  description?: string
  file_path: string
  file_type: string
  file_size: number
  page_count?: number
  course_id?: string
  uploaded_by: string
  is_active: boolean
  is_indexed: boolean
  created_at: string
  updated_at: string
}

export interface DocumentUploadResponse {
  id: string
  title: string
  file_type: string
  file_size: number
  uploaded_by: string
  status: string
  message?: string
}

export interface DocumentQueryResult {
  content: string
  document_id: string
  document_title: string
  page_number?: number | null
  score: number
}

export interface DocumentFileResponse {
  blob: Blob
  filename?: string
  contentType?: string
}

function parseFilenameFromContentDisposition(disposition: string | null): string | undefined {
  if (!disposition) return undefined
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }
  const plainMatch = disposition.match(/filename="?([^\";]+)"?/i)
  return plainMatch?.[1]
}

export const documentsApi = {
  list: () => request<LearningDocument[]>('/documents'),

  get: (id: string) => request<LearningDocument>(`/documents/${id}`),

  query: (payload: { query: string; limit?: number; course_id?: string }) =>
    request<DocumentQueryResult[]>('/documents/query', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  upload: async (file: File, meta?: { title?: string; description?: string; course_id?: string }) => {
    const formData = new FormData()
    formData.append('file', file)
    if (meta?.title) formData.append('title', meta.title)
    if (meta?.description) formData.append('description', meta.description)
    if (meta?.course_id) formData.append('course_id', meta.course_id)

    const token = getToken()
    const res = await fetch(`${API_BASE}/documents/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '文档上传失败' }))
      throw new Error(err.error || '文档上传失败')
    }

    return res.json() as Promise<DocumentUploadResponse>
  },

  fetchFile: async (id: string, mode: 'preview' | 'download' = 'download') => {
    const token = getToken()
    const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}/${mode}`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '文档读取失败' }))
      throw new Error(err.error || '文档读取失败')
    }

    const blob = await res.blob()
    return {
      blob,
      filename: parseFilenameFromContentDisposition(res.headers.get('content-disposition')),
      contentType: res.headers.get('content-type') || undefined,
    } as DocumentFileResponse
  },

  delete: (id: string) => request<{ ok: boolean; id: string }>(`/documents/${id}`, { method: 'DELETE' }),
}

// ==================== 健康检查 ====================

export const healthApi = {
  check: () => request<{ status: string }>('/health', { skipAuth: true }),
}

// Re-export auth
export { authApi } from './auth'
export type { User, AuthResponse, LoginRequest, RegisterRequest } from './auth'

// Default export
export default {
  mbti: mbtiApi,
  career: careerApi,
  learningPath: learningPathApi,
  agent: agentApi,
  graph: graphApi,
  student: studentApi,
  experiment: experimentApi,
  class: classApi,
  notes: notesApi,
  documents: documentsApi,
  health: healthApi,
}
