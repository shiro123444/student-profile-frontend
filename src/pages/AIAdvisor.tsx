/**
 * AI Advisor Page - Claude/OpenAI 双链路 Agent UI
 */

import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import {
  useAgentStream,
  type AgentMessage,
  type AgentStreamCallbacks,
  type ApprovalRequestEvent,
  type ApprovalResultEvent,
  type NotificationEvent,
  type OrchestratorEvent,
  type PermissionRequestEvent,
  type SubtaskEvent,
  type TaskReceiptEvent,
  type ToolCallEvent,
} from '../hooks/useAgentStream'
import { useAgentSession } from '../contexts/AgentSessionContext'
import { GlassCard } from '../components/ui'
import AgentClusterBoard from '../components/agent/AgentClusterBoard'
import TaskReceiptPanel from '../components/agent/TaskReceiptPanel'
import {
  agentApi,
  type AgentCatalogItem,
  type AgentCapability,
  type AgentTaskTemplate,
  type AgentSessionItem,
  type ApprovalMetricsResponse,
  type CodingPolicyProfilesResponse,
} from '../services/api'
import {
  loadTaskReceipts,
  TASK_RECEIPTS_UPDATED_EVENT,
  upsertTaskReceipt,
  type TaskReceiptModule,
  type TaskReceiptRecord,
  type TaskReceiptStep,
} from '../services/taskReceiptStore'
import { primary } from '../theme/colors'

type RuntimeMode = 'fast' | 'balanced' | 'deep'
type AdvisorRiskLevel = 'low' | 'medium' | 'high'
type OrchestratorPreset = 'fast' | 'balanced' | 'deep'
type AdvisorMode = 'learning' | 'coding'
type TimelineFilter = 'all' | 'handoff' | 'orchestrator' | 'permission' | 'tool' | 'subtask' | 'notification'
type TimelineLevelFilter = 'all' | 'info' | 'success' | 'warning'
type DetailDrawerTab = 'overview' | 'events' | 'sessions'

type TimelineKind = 'permission' | 'subtask' | 'notification' | 'orchestrator' | 'tool'
type WorkbenchModuleStatus = 'idle' | 'running' | 'success' | 'failed' | 'partial'

interface OrchestratorStats {
  plannedCount: number
  critiqueRuns: number
  critiquePasses: number
  critiqueFails: number
  critiqueScoreSum: number
  critiqueScoreCount: number
  replanStarts: number
  replanSuccesses: number
  replanFailures: number
  maxObservedRound: number
  finalReplanCount: number
  budgetExhausted: boolean
  lastCritiqueSummary: string
}

interface TimelineEvent {
  id: string
  kind: TimelineKind
  title: string
  detail: string
  category?: TimelineFilter
  level?: string
  status?: string
  command?: string
  timestamp: number
}

interface ModuleWorkbenchCard {
  module: TaskReceiptModule
  title: string
  description: string
  route: string
  quickPrompt: string
  defaultAgent: string
}

interface ModuleWorkbenchState {
  module: TaskReceiptModule
  status: WorkbenchModuleStatus
  total: number
  running: number
  success: number
  failed: number
  updatedAt?: number
}

interface PendingApproval {
  id: string
  tool: string
  risk?: string
  argsPreview?: Record<string, unknown>
  timeoutSec?: number
}

interface AdvisorCardData {
  title: string
  summary: string
  analysis: string[]
  next_steps: string[]
  risk_level: AdvisorRiskLevel
}

interface CodingRunMetrics {
  toolCalls: number
  toolRetries: number
  toolFallbacks: number
  approvalRequests: number
  approvalApproved: number
  approvalRejected: number
  approvalTimeouts: number
}

interface DelegationStats {
  started: number
  done: number
  failed: number
  inFlight: number
  batchRuns: number
  batchCommitted: number
  batchFailed: number
}

interface HandoffActivity {
  id: string
  targetAgent: string
  status: 'running' | 'done' | 'failed'
  detail: string
  updatedAt: number
}

function isVideoAsset(url: string): boolean {
  return /\.(mp4|webm|ogg)(\?|#|$)/i.test(url)
}

const MODE_OPTIONS: { value: RuntimeMode; label: string }[] = [
  { value: 'fast', label: '快速' },
  { value: 'balanced', label: '平衡' },
  { value: 'deep', label: '深度' },
]

const ORCHESTRATOR_PRESET_OPTIONS: { value: OrchestratorPreset; label: string; hint: string }[] = [
  { value: 'fast', label: 'Fast', hint: '低延迟优先，最少重规划' },
  { value: 'balanced', label: 'Balanced', hint: '质量与速度平衡' },
  { value: 'deep', label: 'Deep', hint: '质量优先，多轮校验' },
]

const ORCHESTRATOR_PRESET_CONFIG: Record<OrchestratorPreset, {
  plannerMode: RuntimeMode
  maxSteps: number
  maxWorkers: number
  workerTimeoutSec: number
  workerMaxRetries: number
  workerRetryBackoffMs: number
  critiqueEnabled: boolean
  critiqueMode: RuntimeMode
  dynamicReplanEnabled: boolean
  maxReplans: number
}> = {
  fast: {
    plannerMode: 'fast',
    maxSteps: 4,
    maxWorkers: 4,
    workerTimeoutSec: 60,
    workerMaxRetries: 0,
    workerRetryBackoffMs: 300,
    critiqueEnabled: true,
    critiqueMode: 'fast',
    dynamicReplanEnabled: false,
    maxReplans: 0,
  },
  balanced: {
    plannerMode: 'fast',
    maxSteps: 6,
    maxWorkers: 3,
    workerTimeoutSec: 90,
    workerMaxRetries: 1,
    workerRetryBackoffMs: 600,
    critiqueEnabled: true,
    critiqueMode: 'balanced',
    dynamicReplanEnabled: true,
    maxReplans: 1,
  },
  deep: {
    plannerMode: 'balanced',
    maxSteps: 8,
    maxWorkers: 2,
    workerTimeoutSec: 120,
    workerMaxRetries: 2,
    workerRetryBackoffMs: 900,
    critiqueEnabled: true,
    critiqueMode: 'deep',
    dynamicReplanEnabled: true,
    maxReplans: 2,
  },
}

const AGENT_LABELS: Record<string, string> = {
  'career-advisor': '职业顾问',
  'learning-coach': '学习教练',
  'code-reviewer': '代码审查',
  'web-coder': 'Web 编码',
  'mbti-analyst': 'MBTI 分析',
  'document-reader': '文档助手',
  'quick-qa': '快速问答',
  'note-assistant': '笔记助手',
  'homepage-guide': '首页导览',
}

const SUGGESTIONS = [
  { text: '推荐适合我的职业', agent: 'career-advisor' },
  { text: '制定学习计划', agent: 'learning-coach' },
  { text: '分析我的性格特点', agent: 'mbti-analyst' },
  { text: '查找教材内容', agent: 'document-reader' },
  { text: '帮我修复这个仓库里的 bug', agent: 'web-coder' },
]

const AI_HINT_BUBBLES: Array<{ label: string; text: string; agent?: string }> = [
  { label: '学习规划', text: '请根据我最近的目标，给我一个 7 天学习计划。', agent: 'learning-coach' },
  { label: '文档总结', text: '请读取我最近上传的资料，提炼 5 条核心结论。', agent: 'document-reader' },
  { label: 'Coding 协助', text: '请进入 coding 模式，分析仓库并给出最小可行改动方案。', agent: 'web-coder' },
]

function shouldOpenCapabilityCard(prompt: string): boolean {
  const text = prompt.toLowerCase()
  return (
    /能力卡片|控制面板|高级设置|系统设置|打开设置|显示设置/.test(prompt)
    || text.includes('open settings')
    || text.includes('show controls')
  )
}

function detectAdvisorModeHint(prompt: string): AdvisorMode | null {
  if (/coding|代码|修复|调试|bug|仓库|git|shell|工具链/i.test(prompt)) return 'coding'
  if (/学习|课程|知识点|复习|考试|阅读|总结|规划/i.test(prompt)) return 'learning'
  return null
}

const TASK_MODULE_LABELS: Record<TaskReceiptModule, string> = {
  advisor: '顾问',
  notes: '笔记',
  documents: '文档',
  experiments: '实验',
  graph: '图谱',
  pdf: 'PDF',
  coding: '编码',
  rag: 'RAG',
  unknown: '未知',
}

const MODULE_WORKBENCH_CARDS: ModuleWorkbenchCard[] = [
  {
    module: 'notes',
    title: '笔记区',
    description: '结构化整理学习笔记并持续沉淀',
    route: '/notes',
    quickPrompt: '请基于最近对话，整理一份结构化学习笔记并写入笔记区。',
    defaultAgent: 'note-assistant',
  },
  {
    module: 'documents',
    title: '文档区',
    description: '读取上传文档并提炼关键结论',
    route: '/documents',
    quickPrompt: '请读取我当前已上传的文档，并提炼 3 条关键结论与后续行动。',
    defaultAgent: 'document-reader',
  },
  {
    module: 'pdf',
    title: 'PDF 工作流',
    description: '从笔记/文档生成可导出的 PDF 内容',
    route: '/documents',
    quickPrompt: '请基于当前学习内容，生成一份可导出的 PDF 提纲与执行步骤。',
    defaultAgent: 'document-reader',
  },
  {
    module: 'experiments',
    title: '实验区',
    description: '运行实验与代码任务验证',
    route: '/experiments',
    quickPrompt: '请在实验区规划一个最小可验证实验，并给出执行步骤和验收标准。',
    defaultAgent: 'web-coder',
  },
  {
    module: 'graph',
    title: '知识图谱',
    description: '图谱节点、边与查询建议',
    route: '/graph',
    quickPrompt: '请基于当前主题生成知识图谱节点与关系，并给出图谱查询建议。',
    defaultAgent: 'quick-qa',
  },
  {
    module: 'rag',
    title: 'RAG 检索',
    description: '跨知识源召回与证据汇总',
    route: '/documents',
    quickPrompt: '请进行一次 RAG 检索，返回最相关证据和引用片段。',
    defaultAgent: 'document-reader',
  },
  {
    module: 'coding',
    title: 'Coding Agent',
    description: '仓库分析、工具链执行、审批回执',
    route: '/experiments',
    quickPrompt: '请分析当前仓库并给出可执行的最小修改计划与风险提示。',
    defaultAgent: 'web-coder',
  },
]

function normalizeTaskModule(value?: string): TaskReceiptModule {
  if (!value) return 'unknown'
  if (value === 'advisor') return 'advisor'
  if (value === 'notes') return 'notes'
  if (value === 'documents') return 'documents'
  if (value === 'experiments') return 'experiments'
  if (value === 'graph') return 'graph'
  if (value === 'pdf') return 'pdf'
  if (value === 'coding') return 'coding'
  if (value === 'rag') return 'rag'
  return 'unknown'
}

function createReceiptFromTemplate(
  template: AgentTaskTemplate,
  runId: string,
  source: TaskReceiptRecord['source'],
): TaskReceiptRecord {
  const now = Math.floor(Date.now() / 1000)
  const steps: TaskReceiptStep[] = template.steps.map((step, index) => ({
    id: step.id || `${template.task_type}-${index + 1}`,
    label: step.label || step.id || `step-${index + 1}`,
    module: normalizeTaskModule(step.module),
    status: 'pending',
    updatedAt: now,
  }))

  return {
    runId,
    taskType: template.task_type,
    label: template.label,
    status: 'queued',
    riskLevel: template.risk_level,
    source,
    startedAt: now,
    updatedAt: now,
    approvals: {
      requested: 0,
      approved: 0,
      rejected: 0,
      timeout: 0,
    },
    toolCalls: 0,
    message: '任务模板已启动，等待 Agent 执行',
    steps,
  }
}

function detectAgent(text: string): string {
  if (/职业|就业|薪资|岗位|面试|招聘|行业/.test(text)) return 'career-advisor'
  if (/学习|课程|路径|进度|计划|复习|备考/.test(text)) return 'learning-coach'
  if (/代码|编程|bug|调试|review|算法|实现/.test(text)) return 'code-reviewer'
  if (/MBTI|性格|人格|测试|维度|内向|外向/.test(text)) return 'mbti-analyst'
  if (/教材|文档|PDF|课件|论文|阅读/.test(text)) return 'document-reader'
  if (/笔记|总结|整理|记录/.test(text)) return 'note-assistant'
  if (/平台|参观|首页|功能|介绍|展示/.test(text)) return 'homepage-guide'
  return 'quick-qa'
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function normalizeAdvisorCard(data: unknown): AdvisorCardData | null {
  if (!data || typeof data !== 'object') return null

  const source = data as Record<string, unknown>
  const title = typeof source.title === 'string' ? source.title.trim() : ''
  const summary = typeof source.summary === 'string' ? source.summary.trim() : ''
  const analysis = toStringList(source.analysis)
  const nextSteps = toStringList(source.next_steps)

  const risk = source.risk_level
  const riskLevel: AdvisorRiskLevel =
    risk === 'low' || risk === 'medium' || risk === 'high' ? risk : 'medium'

  if (!title && !summary && analysis.length === 0 && nextSteps.length === 0) {
    return null
  }

  return {
    title: title || '学习建议',
    summary,
    analysis,
    next_steps: nextSteps,
    risk_level: riskLevel,
  }
}

function riskLabel(level: AdvisorRiskLevel): string {
  if (level === 'low') return '低风险'
  if (level === 'high') return '高风险'
  return '中风险'
}

function formatSessionTime(updatedAt?: number): string {
  if (!updatedAt) return '-'
  return new Date(updatedAt * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTimelineTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function sessionPreview(item: AgentSessionItem): string {
  if (item.last_summary && item.last_summary.trim()) return item.last_summary
  if (item.last_prompt && item.last_prompt.trim()) return item.last_prompt
  return '暂无摘要'
}

function eventBadgeClass(kind: TimelineKind): string {
  if (kind === 'permission') return 'bg-amber-50 text-amber-600 border-amber-200'
  if (kind === 'subtask') return 'bg-blue-50 text-blue-600 border-blue-200'
  if (kind === 'orchestrator') return 'bg-purple-50 text-purple-600 border-purple-200'
  if (kind === 'tool') return 'bg-slate-50 text-slate-600 border-slate-200'
  return 'bg-emerald-50 text-emerald-600 border-emerald-200'
}

function normalizeTimelineLevel(level?: string): Exclude<TimelineLevelFilter, 'all'> {
  if (level === 'success') return 'success'
  if (level === 'warning') return 'warning'
  return 'info'
}

function timelineLevelClass(level?: string): string {
  const normalized = normalizeTimelineLevel(level)
  if (normalized === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (normalized === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function moduleStatusLabel(status: WorkbenchModuleStatus): string {
  if (status === 'running') return '执行中'
  if (status === 'success') return '稳定'
  if (status === 'failed') return '异常'
  if (status === 'partial') return '部分完成'
  return '待触发'
}

function moduleStatusClass(status: WorkbenchModuleStatus): string {
  if (status === 'running') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'partial') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function inferTaskModuleFromTool(tool: string): TaskReceiptModule {
  if (tool.startsWith('code_')) return 'coding'
  if (tool.includes('note')) return 'notes'
  if (tool.includes('document') || tool.includes('pdf')) return 'documents'
  if (tool.includes('graph')) return 'graph'
  if (tool.includes('experiment')) return 'experiments'
  if (tool.includes('rag') || tool.includes('search')) return 'rag'
  return 'advisor'
}

function agentLabel(name: string | undefined, catalog: AgentCatalogItem[]): string {
  if (!name) return 'unknown'
  const fromPreset = AGENT_LABELS[name]
  if (fromPreset) return fromPreset
  const fromCatalog = catalog.find((item) => item.name === name)
  return fromCatalog?.name || name
}

function createEmptyOrchestratorStats(): OrchestratorStats {
  return {
    plannedCount: 0,
    critiqueRuns: 0,
    critiquePasses: 0,
    critiqueFails: 0,
    critiqueScoreSum: 0,
    critiqueScoreCount: 0,
    replanStarts: 0,
    replanSuccesses: 0,
    replanFailures: 0,
    maxObservedRound: 1,
    finalReplanCount: 0,
    budgetExhausted: false,
    lastCritiqueSummary: '',
  }
}

function createEmptyCodingRunMetrics(): CodingRunMetrics {
  return {
    toolCalls: 0,
    toolRetries: 0,
    toolFallbacks: 0,
    approvalRequests: 0,
    approvalApproved: 0,
    approvalRejected: 0,
    approvalTimeouts: 0,
  }
}

function createEmptyDelegationStats(): DelegationStats {
  return {
    started: 0,
    done: 0,
    failed: 0,
    inFlight: 0,
    batchRuns: 0,
    batchCommitted: 0,
    batchFailed: 0,
  }
}

function parseHandoffTarget(tool: string): string {
  if (tool.startsWith('delegate_to_agent:')) {
    return tool.slice('delegate_to_agent:'.length) || 'unknown'
  }
  return 'batch'
}

function isHandoffEvent(event: TimelineEvent): boolean {
  const text = `${event.title} ${event.detail}`.toLowerCase()
  return event.category === 'handoff' || text.includes('委托') || text.includes('handoff') || text.includes('delegate')
}

function parseBatchResult(detail: string | undefined): {
  total: number
  success: number
  failed: number
  skipped: number
  mode: string
} {
  const text = String(detail || '')
  const mode = /mode=([a-z_]+)/i.exec(text)?.[1] || 'best_effort'
  const total = Number(/total=(\d+)/i.exec(text)?.[1] || 0)
  const success = Number(/success=(\d+)/i.exec(text)?.[1] || 0)
  const failed = Number(/failed=(\d+)/i.exec(text)?.[1] || 0)
  const skipped = Number(/skipped=(\d+)/i.exec(text)?.[1] || 0)
  return { total, success, failed, skipped, mode }
}

export default function AIAdvisor() {
  const studentId = localStorage.getItem('studentId') || undefined
  const studentName = localStorage.getItem('studentName') || '同学'

  const { setSession, removeSession, clearSessions: clearLocalSessions } = useAgentSession()

  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('balanced')
  const [orchestratorPreset, setOrchestratorPreset] = useState<OrchestratorPreset>('balanced')
  const [advisorMode, setAdvisorMode] = useState<AdvisorMode>('learning')
  const [codingWorkspace, setCodingWorkspace] = useState('default')
  const [codingPolicyProfile, setCodingPolicyProfile] = useState('strict_v1')
  const [codingPolicyOptions, setCodingPolicyOptions] = useState<string[]>(['strict_v1'])
  const [codingPolicyVersion, setCodingPolicyVersion] = useState<string>('settings')
  const [codingPolicyLoading, setCodingPolicyLoading] = useState(false)
  const [codingPolicyError, setCodingPolicyError] = useState<string | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [approvalBusy, setApprovalBusy] = useState<Record<string, boolean>>({})
  const [approvalMetrics, setApprovalMetrics] = useState<ApprovalMetricsResponse | null>(null)
  const [approvalMetricsLoading, setApprovalMetricsLoading] = useState(false)
  const [approvalMetricsError, setApprovalMetricsError] = useState<string | null>(null)
  const [codingRunMetrics, setCodingRunMetrics] = useState<CodingRunMetrics>(createEmptyCodingRunMetrics)
  const [runtimeMeta, setRuntimeMeta] = useState<{ engine: string; model: string; mode: string; tenantId?: string } | null>(null)
  const [outputFormatUsed, setOutputFormatUsed] = useState<string | null>(null)
  const [advisorCard, setAdvisorCard] = useState<AdvisorCardData | null>(null)
  const [orchestratorStats, setOrchestratorStats] = useState<OrchestratorStats>(createEmptyOrchestratorStats)

  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionItems, setSessionItems] = useState<AgentSessionItem[]>([])
  const [resumeSession, setResumeSession] = useState<AgentSessionItem | null>(null)

  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogItem[]>([])
  const [agentCatalogLoading, setAgentCatalogLoading] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string>('auto')
  const [selectedCapability, setSelectedCapability] = useState<AgentCapability | null>(null)

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all')
  const [timelineLevelFilter, setTimelineLevelFilter] = useState<TimelineLevelFilter>('all')
  const [timelineCommandFilter, setTimelineCommandFilter] = useState<string>('all')
  const [timelineSearch, setTimelineSearch] = useState('')
  const [delegationStats, setDelegationStats] = useState<DelegationStats>(createEmptyDelegationStats)
  const [handoffActivities, setHandoffActivities] = useState<HandoffActivity[]>([])
  const [clusterOpen, setClusterOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailDrawerTab, setDetailDrawerTab] = useState<DetailDrawerTab | null>(null)
  const [showHintBubbles, setShowHintBubbles] = useState(false)
  const [showCapabilityCard, setShowCapabilityCard] = useState(false)
  const [heroMediaUrl, setHeroMediaUrl] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem('aiadvisor.hero_media_url') || ''
  })
  const [taskTemplates, setTaskTemplates] = useState<AgentTaskTemplate[]>([])
  const [taskTemplateSource, setTaskTemplateSource] = useState<'api' | 'fallback'>('fallback')
  const [taskTemplateLoading, setTaskTemplateLoading] = useState(false)
  const [taskTemplateError, setTaskTemplateError] = useState<string | null>(null)
  const [selectedTaskType, setSelectedTaskType] = useState<string>('')
  const [taskPromptOverride, setTaskPromptOverride] = useState('')
  const [activeTaskRunId, setActiveTaskRunId] = useState<string | null>(null)
  const [taskLaunchBusy, setTaskLaunchBusy] = useState(false)
  const [receiptSnapshot, setReceiptSnapshot] = useState<TaskReceiptRecord[]>(() => loadTaskReceipts(40))

  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const overviewOpen = detailDrawerTab === 'overview'
  const eventsOpen = detailDrawerTab === 'events'
  const sessionsOpen = detailDrawerTab === 'sessions'

  const pushTimeline = useCallback((event: Omit<TimelineEvent, 'id' | 'timestamp'> & { timestamp?: number }) => {
    const category: TimelineFilter = event.category || (
      event.kind === 'orchestrator'
        ? 'orchestrator'
        : event.kind === 'permission'
          ? 'permission'
          : event.kind === 'tool'
            ? 'tool'
            : event.kind === 'subtask'
              ? 'subtask'
              : event.kind === 'notification'
                ? 'notification'
            : 'all'
    )

    setTimelineEvents(prev => {
      const nextItem: TimelineEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: event.timestamp || Math.floor(Date.now() / 1000),
        kind: event.kind,
        title: event.title,
        detail: event.detail,
        category,
        level: event.level || 'info',
        status: event.status,
        command: event.command,
      }
      const merged = [nextItem, ...prev]
      return merged.slice(0, 40)
    })
  }, [])

  const selectedTaskTemplate = useMemo(
    () => taskTemplates.find((item) => item.task_type === selectedTaskType) || null,
    [taskTemplates, selectedTaskType],
  )

  const patchTaskReceipt = useCallback(
    (
      runId: string | null | undefined,
      updater: (current: TaskReceiptRecord) => TaskReceiptRecord,
    ) => {
      if (!runId) return
      const current = loadTaskReceipts(80).find((item) => item.runId === runId)
      if (!current) return
      const next = updater(current)
      upsertTaskReceipt({
        ...next,
        updatedAt: Math.floor(Date.now() / 1000),
      })
    },
    [],
  )

  const patchActiveTaskReceipt = useCallback(
    (updater: (current: TaskReceiptRecord) => TaskReceiptRecord) => {
      patchTaskReceipt(activeTaskRunId, updater)
    },
    [activeTaskRunId, patchTaskReceipt],
  )

  const loadSessions = useCallback(async () => {
    setSessionLoading(true)
    setSessionError(null)
    try {
      const items = await agentApi.listSessions(30)
      setSessionItems(items || [])
    } catch {
      setSessionError('加载会话失败')
      setSessionItems([])
    } finally {
      setSessionLoading(false)
    }
  }, [])

  const loadAgentCatalog = useCallback(async () => {
    setAgentCatalogLoading(true)
    try {
      const items = await agentApi.list()
      setAgentCatalog(items || [])
    } catch {
      setAgentCatalog([])
    } finally {
      setAgentCatalogLoading(false)
    }
  }, [])

  const loadTaskTemplates = useCallback(async (silent = false) => {
    if (!silent) setTaskTemplateLoading(true)
    try {
      const snapshot = await agentApi.taskTemplates()
      const templates = Array.isArray(snapshot.templates) ? snapshot.templates : []
      setTaskTemplates(templates)
      setTaskTemplateSource(snapshot.source)
      setTaskTemplateError(null)
      setSelectedTaskType((prev) => {
        if (prev && templates.some((item) => item.task_type === prev)) return prev
        return templates[0]?.task_type || ''
      })
      setTaskPromptOverride((prev) => {
        if (prev.trim().length > 0) return prev
        return templates[0]?.default_prompt || ''
      })
    } catch {
      setTaskTemplates([])
      setTaskTemplateSource('fallback')
      setTaskTemplateError('任务模板加载失败')
    } finally {
      if (!silent) setTaskTemplateLoading(false)
    }
  }, [])

  const loadCodingPolicies = useCallback(async (silent = false) => {
    if (!silent) setCodingPolicyLoading(true)
    try {
      const snapshot: CodingPolicyProfilesResponse = await agentApi.codingPolicies()

      const declaredDefault = (snapshot.default_profile || 'strict_v1').trim() || 'strict_v1'
      const rawNames = Object.keys(snapshot.profiles || {})
      const mergedNames = [declaredDefault, ...rawNames]
      const profileNames = Array.from(new Set(mergedNames.filter((item) => item && item.trim().length > 0)))

      setCodingPolicyOptions(profileNames.length > 0 ? profileNames : ['strict_v1'])
      setCodingPolicyVersion(snapshot.source_version || 'settings')
      setCodingPolicyProfile((prev) => {
        if (profileNames.includes(prev)) return prev
        if (profileNames.includes(declaredDefault)) return declaredDefault
        return profileNames[0] || 'strict_v1'
      })

      if (Array.isArray(snapshot.errors) && snapshot.errors.length > 0) {
        setCodingPolicyError(snapshot.errors[0])
      } else {
        setCodingPolicyError(null)
      }
    } catch {
      setCodingPolicyOptions((prev) => (prev.length > 0 ? prev : ['strict_v1']))
      setCodingPolicyError('策略模板加载失败，已使用本地默认策略')
    } finally {
      if (!silent) setCodingPolicyLoading(false)
    }
  }, [])

  const loadApprovalMetrics = useCallback(async (silent = false) => {
    if (!silent) setApprovalMetricsLoading(true)
    try {
      const snapshot = await agentApi.approvalMetrics()
      setApprovalMetrics(snapshot)
      setApprovalMetricsError(null)
    } catch {
      setApprovalMetricsError('审批指标拉取失败')
    } finally {
      if (!silent) setApprovalMetricsLoading(false)
    }
  }, [])

  const streamCallbacks = useMemo<AgentStreamCallbacks>(() => {
    const handleApprovalRequest = (event: ApprovalRequestEvent) => {
      setPendingApprovals((prev) => {
        if (prev.some((item) => item.id === event.id)) return prev
        return [
          {
            id: event.id,
            tool: event.tool,
            risk: event.risk,
            argsPreview: event.argsPreview,
            timeoutSec: event.timeoutSec,
          },
          ...prev,
        ]
      })
      setCodingRunMetrics((prev) => ({
        ...prev,
        approvalRequests: prev.approvalRequests + 1,
      }))

      patchActiveTaskReceipt((current) => ({
        ...current,
        status: 'running',
        message: `审批等待：${event.tool}`,
        approvals: {
          requested: (current.approvals?.requested || 0) + 1,
          approved: current.approvals?.approved || 0,
          rejected: current.approvals?.rejected || 0,
          timeout: current.approvals?.timeout || 0,
        },
      }))

      pushTimeline({
        kind: 'permission',
        title: '审批请求',
        detail: `工具 ${event.tool} 请求执行（${event.risk || 'unknown'}）`,
        status: 'requested',
        command: event.tool,
      })
    }

    const handleApprovalResult = (event: ApprovalResultEvent) => {
      setPendingApprovals((prev) => prev.filter((item) => item.id !== event.id))
      setApprovalBusy((prev) => {
        const next = { ...prev }
        delete next[event.id]
        return next
      })

      const reasonText = (event.reason || '').toLowerCase()
      const timedOut = reasonText.includes('timeout') || reasonText.includes('超时')
      setCodingRunMetrics((prev) => ({
        ...prev,
        approvalApproved: prev.approvalApproved + (event.approved ? 1 : 0),
        approvalRejected: prev.approvalRejected + (event.approved ? 0 : 1),
        approvalTimeouts: prev.approvalTimeouts + (timedOut ? 1 : 0),
      }))

      patchActiveTaskReceipt((current) => ({
        ...current,
        message: event.reason || (event.approved ? '审批已通过' : '审批被拒绝'),
        approvals: {
          requested: current.approvals?.requested || 0,
          approved: (current.approvals?.approved || 0) + (event.approved ? 1 : 0),
          rejected: (current.approvals?.rejected || 0) + (event.approved ? 0 : 1),
          timeout: (current.approvals?.timeout || 0) + (timedOut ? 1 : 0),
        },
      }))

      void loadApprovalMetrics(true)

      pushTimeline({
        kind: 'permission',
        title: event.approved ? '审批通过' : '审批拒绝',
        detail: event.reason || '-',
        level: event.approved ? 'success' : 'warning',
        status: event.approved ? 'approved' : 'rejected',
      })
    }

    const handlePermission = (event: PermissionRequestEvent) => {
      const tool = event.tool || 'unknown_tool'
      pushTimeline({
        kind: 'permission',
        title: '权限请求',
        detail: `工具 ${tool} 请求执行`,
        timestamp: event.timestamp,
        status: 'permission_request',
        command: tool,
      })
    }

    const handleSubtask = (event: SubtaskEvent) => {
      const stage = event.stage === 'stop' ? '结束' : '启动'
      const name = event.agentName || event.agentType || event.agentId || 'subagent'
      pushTimeline({
        kind: 'subtask',
        title: `子任务${stage}`,
        detail: `${name}`,
        timestamp: event.timestamp,
      })
    }

    const handleNotification = (event: NotificationEvent) => {
      pushTimeline({
        kind: 'notification',
        title: event.title || '通知',
        detail: event.message || '收到系统通知',
        level: event.level,
        timestamp: event.timestamp,
      })
    }

    const handleToolCall = (event: ToolCallEvent) => {
      const tool = event.tool || 'unknown_tool'
      const module = inferTaskModuleFromTool(tool)

      if (event.status.startsWith('handoff')) {
        const targetAgent = parseHandoffTarget(tool)
        const now = Math.floor(Date.now() / 1000)
        const detail = event.reason || '-'

        if (event.status === 'handoff_start') {
          setDelegationStats((prev) => ({
            ...prev,
            started: prev.started + 1,
            inFlight: prev.inFlight + 1,
          }))

          setHandoffActivities((prev) => {
            const next = [
              {
                id: `${targetAgent}-${now}-${Math.random().toString(36).slice(2, 6)}`,
                targetAgent,
                status: 'running' as const,
                detail: detail.length > 120 ? `${detail.slice(0, 120)}...` : detail,
                updatedAt: now,
              },
              ...prev.filter((item) => item.targetAgent !== targetAgent || item.status !== 'running'),
            ]
            return next.slice(0, 8)
          })

          patchActiveTaskReceipt((current) => ({
            ...current,
            status: 'running',
            message: `Agent 委托中：${targetAgent}`,
          }))

          pushTimeline({
            kind: 'tool',
            category: 'handoff',
            title: 'Agent 委托发起',
            detail: `${tool}${detail ? ` · ${detail}` : ''}`,
            level: 'info',
            status: event.status,
            command: tool,
          })
          return
        }

        if (event.status === 'handoff_done') {
          setDelegationStats((prev) => ({
            ...prev,
            done: prev.done + 1,
            inFlight: Math.max(0, prev.inFlight - 1),
          }))

          setHandoffActivities((prev) => {
            const next = prev.map((item) => (
              item.targetAgent === targetAgent && item.status === 'running'
                ? {
                    ...item,
                    status: 'done' as const,
                    detail: detail.length > 120 ? `${detail.slice(0, 120)}...` : detail,
                    updatedAt: now,
                  }
                : item
            ))
            return next.slice(0, 8)
          })

          patchActiveTaskReceipt((current) => ({
            ...current,
            status: current.status === 'failed' ? 'failed' : 'running',
            message: `Agent 委托完成：${targetAgent}`,
          }))

          pushTimeline({
            kind: 'tool',
            category: 'handoff',
            title: 'Agent 委托完成',
            detail: `${tool}${detail ? ` · ${detail}` : ''}`,
            level: 'success',
            status: event.status,
            command: tool,
          })
          return
        }

        if (event.status === 'handoff_failed') {
          setDelegationStats((prev) => ({
            ...prev,
            failed: prev.failed + 1,
            inFlight: Math.max(0, prev.inFlight - 1),
          }))

          setHandoffActivities((prev) => {
            const next = prev.map((item) => (
              item.targetAgent === targetAgent && item.status === 'running'
                ? {
                    ...item,
                    status: 'failed' as const,
                    detail: detail.length > 120 ? `${detail.slice(0, 120)}...` : detail,
                    updatedAt: now,
                  }
                : item
            ))
            return next.slice(0, 8)
          })

          patchActiveTaskReceipt((current) => ({
            ...current,
            status: 'partial',
            message: `Agent 委托失败：${targetAgent}`,
          }))

          pushTimeline({
            kind: 'tool',
            category: 'handoff',
            title: 'Agent 委托失败',
            detail: `${tool}${detail ? ` · ${detail}` : ''}`,
            level: 'warning',
            status: event.status,
            command: tool,
          })
          return
        }

        if (event.status === 'handoff_batch_done') {
          const parsed = parseBatchResult(event.reason)
          const committed = parsed.failed === 0
          setDelegationStats((prev) => ({
            ...prev,
            batchRuns: prev.batchRuns + 1,
            batchCommitted: prev.batchCommitted + (committed ? 1 : 0),
            batchFailed: prev.batchFailed + (committed ? 0 : 1),
          }))

          patchActiveTaskReceipt((current) => ({
            ...current,
            status: committed ? 'running' : 'partial',
            message: `批次委托完成：success ${parsed.success} / failed ${parsed.failed}`,
          }))

          pushTimeline({
            kind: 'tool',
            category: 'handoff',
            title: '批次委托完成',
            detail: `${parsed.mode} · total ${parsed.total} · success ${parsed.success} · failed ${parsed.failed} · skipped ${parsed.skipped}`,
            level: committed ? 'success' : 'warning',
            status: event.status,
            command: tool,
          })
          return
        }

        pushTimeline({
          kind: 'tool',
          category: 'handoff',
          title: 'Agent 委托',
          detail: `${tool}${detail ? ` · ${detail}` : ''}`,
          level: 'info',
          status: event.status,
          command: tool,
        })
        return
      }

      if (event.status === 'retry') {
        setCodingRunMetrics((prev) => ({
          ...prev,
          toolRetries: prev.toolRetries + 1,
        }))

        patchActiveTaskReceipt((current) => ({
          ...current,
          status: 'running',
          message: `工具重试：${tool}`,
          steps: current.steps.map((step) => (
            step.module === module && (step.status === 'pending' || step.status === 'running')
              ? { ...step, status: 'running', tool, message: event.reason || 'retry', updatedAt: Math.floor(Date.now() / 1000) }
              : step
          )),
        }))

        const attempt = typeof event.attempt === 'number' ? event.attempt : 0
        const maxAttempts = typeof event.maxAttempts === 'number' ? event.maxAttempts : 0
        const retryLabel = attempt > 0 && maxAttempts > 0
          ? `重试 ${attempt}/${maxAttempts}`
          : '重试'
        pushTimeline({
          kind: 'tool',
          title: `工具${retryLabel}`,
          detail: `${tool}${event.reason ? ` · ${event.reason}` : ''}`,
          level: 'warning',
          status: event.status,
          command: tool,
        })
        return
      }

      if (event.status === 'fallback') {
        setCodingRunMetrics((prev) => ({
          ...prev,
          toolFallbacks: prev.toolFallbacks + 1,
        }))

        patchActiveTaskReceipt((current) => ({
          ...current,
          status: 'running',
          message: `工具回退：${tool}`,
          steps: current.steps.map((step) => (
            step.module === module && step.status !== 'success'
              ? { ...step, status: 'running', tool, message: 'fallback', updatedAt: Math.floor(Date.now() / 1000) }
              : step
          )),
        }))

        const stage = event.stage === 'external_failed_builtin_used'
          ? '外部失败后回退内建工具'
          : event.stage === 'builtin_preferred'
            ? '命中内建优先策略'
            : '策略回退'

        pushTimeline({
          kind: 'tool',
          title: '工具回退',
          detail: `${tool} · ${stage}`,
          level: 'warning',
          status: event.status,
          command: tool,
        })
        return
      }

      const normalizedStatus: TaskReceiptStep['status'] =
        event.status === 'done' || event.status === 'success'
          ? 'success'
          : event.status === 'failed' || event.status === 'error'
            ? 'failed'
            : 'running'

      setCodingRunMetrics((prev) => ({
        ...prev,
        toolCalls: prev.toolCalls + 1,
      }))

      patchActiveTaskReceipt((current) => ({
        ...current,
        status: normalizedStatus === 'failed'
          ? 'partial'
          : current.status === 'failed'
            ? 'failed'
            : 'running',
        message: normalizedStatus === 'success'
          ? `工具完成：${tool}`
          : normalizedStatus === 'failed'
            ? `工具失败：${tool}`
            : `工具执行：${tool}`,
        toolCalls: (current.toolCalls || 0) + 1,
        steps: current.steps.map((step) => {
          if (step.module !== module) return step
          if (step.status === 'success' && normalizedStatus !== 'failed') return step
          return {
            ...step,
            status: normalizedStatus,
            tool,
            message: normalizedStatus === 'success'
              ? 'tool done'
              : normalizedStatus === 'failed'
                ? 'tool failed'
                : 'tool executing',
            updatedAt: Math.floor(Date.now() / 1000),
          }
        }),
      }))

      pushTimeline({
        kind: 'tool',
        title: normalizedStatus === 'success'
          ? '工具完成'
          : normalizedStatus === 'failed'
            ? '工具失败'
            : '工具执行',
        detail: `${tool}${event.reason ? ` · ${event.reason}` : ''}`,
        level: normalizedStatus === 'failed' ? 'warning' : normalizedStatus === 'success' ? 'success' : 'info',
        status: event.status,
        command: tool,
      })
    }

    const handleOrchestrator = (event: OrchestratorEvent) => {
      if (event.stage === 'planned') {
        const stepCount = Array.isArray(event.steps) ? event.steps.length : 0
        const strategy = event.strategy || 'dag-orchestrated-execution'
        const complexity = event.complexity || 'medium'
        const mode = event.selectedMode || 'balanced'
        const workers = event.maxWorkers || 1
        const retries = typeof event.workerMaxRetries === 'number' ? event.workerMaxRetries : 0
        const timeout = typeof event.workerTimeoutSec === 'number' ? `${event.workerTimeoutSec}s` : '-'
        const budget = typeof event.maxBudgetUsd === 'number' && event.maxBudgetUsd > 0
          ? `${event.maxBudgetUsd.toFixed(2)} USD`
          : 'unlimited'
        const critiqueMode = event.critiqueMode || 'deep'
        const replanLimit = typeof event.maxReplans === 'number' ? event.maxReplans : 0
        const critiqueInfo = event.critiqueEnabled
          ? ` · critique ${critiqueMode} · replan<=${replanLimit}`
          : ' · critique off'

        setOrchestratorStats((prev) => ({
          ...createEmptyOrchestratorStats(),
          plannedCount: prev.plannedCount + 1,
          maxObservedRound: 1,
        }))

        patchActiveTaskReceipt((current) => ({
          ...current,
          status: 'running',
          message: `任务编排完成：${stepCount} steps`,
        }))

        pushTimeline({
          kind: 'orchestrator',
          title: '任务编排',
          detail: `策略 ${strategy} · 复杂度 ${complexity} · 模式 ${mode} · ${stepCount} 节点 · 并发 ${workers} · retry ${retries} · timeout ${timeout} · budget ${budget}${critiqueInfo}`,
        })
        return
      }

      if (event.stage === 'layer_start') {
        const idx = event.layerIndex || 0
        const count = event.nodeCount || 0
        pushTimeline({
          kind: 'orchestrator',
          title: `并行层 ${idx} 启动`,
          detail: `本层节点数 ${count}` ,
        })
        return
      }

      if (event.stage === 'worker_start') {
        const toolInfo = Array.isArray(event.tools) && event.tools.length > 0
          ? ` · tools ${event.tools.join(',')}`
          : ' · tools auto'
        pushTimeline({
          kind: 'orchestrator',
          title: `Worker 启动 · ${event.title || event.nodeId || 'node'}`,
          detail: `${event.kind || 'worker'} · ${event.mode || 'balanced'}${toolInfo}`,
        })
        return
      }

      if (event.stage === 'worker_retry') {
        const attempt = event.attempts || event.maxAttempts || 0
        const backoff = typeof event.nextBackoffMs === 'number' ? `${event.nextBackoffMs}ms` : '-'
        pushTimeline({
          kind: 'orchestrator',
          title: `Worker 重试 · ${event.title || event.nodeId || 'node'}`,
          detail: `第 ${attempt} 次失败，backoff ${backoff} · ${event.reason || 'unknown reason'}`,
        })
        return
      }

      if (event.stage === 'worker_done') {
        const attempts = event.attempts && event.attempts > 1 ? ` · attempts ${event.attempts}` : ''
        const failure = event.failureReason ? ` · ${event.failureReason}` : ''
        const artifactInfo = event.artifactType ? ` · artifact ${event.artifactType}` : ''
        pushTimeline({
          kind: 'orchestrator',
          title: `Worker 完成 · ${event.title || event.nodeId || 'node'}`,
          detail: `${event.status || 'done'} · ${event.engine || 'engine'} · ${(event.cost || 0).toFixed(4)} USD${attempts}${artifactInfo}${failure}`,
        })
        return
      }

      if (event.stage === 'layer_done') {
        const idx = event.layerIndex || 0
        const spent = typeof event.spentBudgetUsd === 'number'
          ? ` · 已花费 ${event.spentBudgetUsd.toFixed(4)} USD`
          : ''
        pushTimeline({
          kind: 'orchestrator',
          title: `并行层 ${idx} 完成`,
          detail: `进入下一阶段${spent}`,
        })
        return
      }

      if (event.stage === 'critique_done') {
        const score = typeof event.critiqueScore === 'number' ? event.critiqueScore.toFixed(2) : '-'
        const verdict = event.critiquePass ? '通过' : '未通过'
        const next = event.shouldReplan ? '将进入 replan' : '进入最终汇总'

        setOrchestratorStats((prev) => {
          const numericScore = typeof event.critiqueScore === 'number' ? event.critiqueScore : null
          const round = event.replanRound || prev.maxObservedRound || 1
          return {
            ...prev,
            critiqueRuns: prev.critiqueRuns + 1,
            critiquePasses: prev.critiquePasses + (event.critiquePass ? 1 : 0),
            critiqueFails: prev.critiqueFails + (event.critiquePass ? 0 : 1),
            critiqueScoreSum: prev.critiqueScoreSum + (numericScore ?? 0),
            critiqueScoreCount: prev.critiqueScoreCount + (numericScore !== null ? 1 : 0),
            maxObservedRound: Math.max(prev.maxObservedRound, round),
            finalReplanCount: Math.max(prev.finalReplanCount, Math.max(round - 1, 0)),
            lastCritiqueSummary: event.critiqueSummary || prev.lastCritiqueSummary,
          }
        })

        pushTimeline({
          kind: 'orchestrator',
          title: `Critique 完成 · Round ${event.replanRound || 1}`,
          detail: `${verdict} · score ${score} · ${event.critiqueSummary || '-'} · ${next}`,
          level: event.critiquePass ? 'success' : 'warning',
        })
        return
      }

      if (event.stage === 'replan_start') {
        setOrchestratorStats((prev) => {
          const round = event.replanRound || prev.maxObservedRound || 1
          return {
            ...prev,
            replanStarts: prev.replanStarts + 1,
            maxObservedRound: Math.max(prev.maxObservedRound, round),
            finalReplanCount: Math.max(prev.finalReplanCount, Math.max(round - 1, 0)),
          }
        })

        pushTimeline({
          kind: 'orchestrator',
          title: `Replan 启动 · Round ${event.replanRound || 1}`,
          detail: event.reason || 'Critique 认为当前结果不足，开始重规划',
          level: 'warning',
        })
        return
      }

      if (event.stage === 'replan_done') {
        const status = event.success ? '成功' : '失败'
        const strategy = event.strategy ? ` · ${event.strategy}` : ''
        const complexity = event.complexity ? ` · ${event.complexity}` : ''

        setOrchestratorStats((prev) => {
          const round = event.replanRound || prev.maxObservedRound || 1
          return {
            ...prev,
            replanSuccesses: prev.replanSuccesses + (event.success ? 1 : 0),
            replanFailures: prev.replanFailures + (event.success ? 0 : 1),
            maxObservedRound: Math.max(prev.maxObservedRound, round),
            finalReplanCount: Math.max(prev.finalReplanCount, Math.max(round - 1, 0)),
          }
        })

        pushTimeline({
          kind: 'orchestrator',
          title: `Replan 结束 · Round ${event.replanRound || 1}`,
          detail: `${status}${strategy}${complexity}`,
          level: event.success ? 'success' : 'warning',
        })
        return
      }

      if (event.stage === 'budget_exhausted') {
        const spent = typeof event.spentBudgetUsd === 'number' ? event.spentBudgetUsd.toFixed(4) : '-'
        const budget = typeof event.maxBudgetUsd === 'number' ? event.maxBudgetUsd.toFixed(4) : '-'

        setOrchestratorStats((prev) => ({
          ...prev,
          budgetExhausted: true,
        }))

        patchActiveTaskReceipt((current) => ({
          ...current,
          status: 'partial',
          message: `预算耗尽：spent ${spent} / budget ${budget}`,
        }))

        pushTimeline({
          kind: 'orchestrator',
          title: '预算已耗尽',
          detail: `spent ${spent} / budget ${budget} USD，后续节点停止执行`,
          level: 'warning',
        })
      }
    }

    const handleTaskReceipt = (event: TaskReceiptEvent) => {
      const runId = event.runId || activeTaskRunId
      if (!runId) return
      const now = Math.floor(Date.now() / 1000)
      const normalizedSteps: TaskReceiptStep[] = Array.isArray(event.steps)
        ? event.steps.map((step, index) => ({
          id: step.id || `step-${index + 1}`,
          label: step.label || step.id || `step-${index + 1}`,
          module: normalizeTaskModule(step.module),
          status: step.status || 'pending',
          tool: step.tool,
          message: step.message,
          updatedAt: now,
        }))
        : []

      const existing = loadTaskReceipts(80).find((item) => item.runId === runId)
      if (!existing) {
        upsertTaskReceipt({
          runId,
          taskType: event.taskType || selectedTaskTemplate?.task_type || 'custom_task',
          label: event.label || selectedTaskTemplate?.label || '任务执行',
          status: event.status || 'running',
          source: event.source === 'api' || event.source === 'fallback' ? event.source : 'stream',
          startedAt: now,
          updatedAt: now,
          message: event.message,
          approvals: {
            requested: 0,
            approved: 0,
            rejected: 0,
            timeout: 0,
          },
          toolCalls: 0,
          steps: normalizedSteps,
        })
      } else {
        patchTaskReceipt(runId, (current) => ({
          ...current,
          status: event.status || current.status,
          message: event.message || current.message,
          steps: normalizedSteps.length > 0 ? normalizedSteps : current.steps,
        }))
      }

      setActiveTaskRunId(runId)

      pushTimeline({
        kind: 'tool',
        title: '任务回执',
        detail: `${event.taskType || selectedTaskTemplate?.task_type || 'task'} · ${event.status || 'running'}`,
        status: event.status || 'running',
        command: event.taskType || selectedTaskTemplate?.task_type || 'task',
      })
    }

    return {
      onMeta: (meta) => {
        setRuntimeMeta({
          engine: meta.engine,
          model: meta.model,
          mode: meta.mode,
          tenantId: meta.tenant?.tenantId,
        })
        setOutputFormatUsed(meta.outputFormat || null)
      },
      onStructuredOutput: (event) => {
        const card = normalizeAdvisorCard(event.data)
        if (card) setAdvisorCard(card)
      },
      onApprovalRequest: handleApprovalRequest,
      onApprovalResult: handleApprovalResult,
      onPermissionRequest: handlePermission,
      onSubtask: handleSubtask,
      onNotification: handleNotification,
      onOrchestrator: handleOrchestrator,
      onTaskReceipt: handleTaskReceipt,
      onToolCall: handleToolCall,
      onDone: () => {
        setPendingApprovals([])
        setApprovalBusy({})
        setDelegationStats((prev) => ({ ...prev, inFlight: 0 }))
        patchActiveTaskReceipt((current) => ({
          ...current,
          status: current.status === 'failed' ? 'failed' : 'success',
          message: current.message || '任务执行完成',
          steps: current.steps.map((step) => (
            step.status === 'running' || step.status === 'pending'
              ? { ...step, status: 'success', updatedAt: Math.floor(Date.now() / 1000) }
              : step
          )),
        }))
        setActiveTaskRunId(null)
        void loadSessions()
        void loadApprovalMetrics(true)
      },
    }
  }, [activeTaskRunId, loadApprovalMetrics, loadSessions, patchActiveTaskReceipt, patchTaskReceipt, pushTimeline, selectedTaskTemplate])

  const { messages, isStreaming, sendMessage, stop, setMessages, clearMessages } = useAgentStream(streamCallbacks)

  useEffect(() => {
    setMessages([{
      id: '1',
      role: 'assistant',
      content: `你好，**${studentName}**！我是你的 AI 学习顾问，支持 Claude 深度链路和 OpenAI 快速链路。

我可以帮助你：
- 🎯 **职业规划** — 基于 MBTI 性格的职业推荐
- 📚 **学习指导** — 个性化学习路径和进度分析
- 💻 **代码审查** — 实验代码反馈和改进建议
- 🧠 **性格分析** — PsyCOT 深度 MBTI 评估
- 📖 **教材检索** — 智能搜索课程文档

直接输入问题，我会自动匹配最合适的 Agent 为你服务；你也可以手动指定 Agent。`,
    }])
    void loadSessions()
    void loadAgentCatalog()
    void loadTaskTemplates(true)
    void loadCodingPolicies(true)
    void loadApprovalMetrics(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sync = () => {
      setReceiptSnapshot(loadTaskReceipts(40))
    }

    const handleUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<TaskReceiptRecord[] | undefined>
      if (Array.isArray(customEvent.detail)) {
        setReceiptSnapshot(customEvent.detail.slice(0, 40))
        return
      }
      sync()
    }

    sync()
    window.addEventListener(TASK_RECEIPTS_UPDATED_EVENT, handleUpdated as EventListener)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(TASK_RECEIPTS_UPDATED_EVENT, handleUpdated as EventListener)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, advisorCard, sessionsOpen, eventsOpen, timelineEvents])

  useEffect(() => {
    if (selectedAgent === 'auto') {
      setSelectedCapability(null)
      return
    }

    let active = true
    void agentApi.capabilities(selectedAgent)
      .then((cap) => {
        if (active) setSelectedCapability(cap)
      })
      .catch(() => {
        if (active) setSelectedCapability(null)
      })

    return () => {
      active = false
    }
  }, [selectedAgent])

  useEffect(() => {
    if (advisorMode !== 'coding') return
    void loadCodingPolicies(true)
  }, [advisorMode, loadCodingPolicies])

  useEffect(() => {
    if (!eventsOpen || advisorMode !== 'coding') return

    void loadApprovalMetrics(true)
    const timer = window.setInterval(() => {
      void loadApprovalMetrics(true)
    }, 15000)

    return () => {
      window.clearInterval(timer)
    }
  }, [advisorMode, eventsOpen, loadApprovalMetrics])

  useEffect(() => {
    if (timelineCommandFilter === 'all') return
    if (!timelineEvents.some((event) => event.command === timelineCommandFilter)) {
      setTimelineCommandFilter('all')
    }
  }, [timelineCommandFilter, timelineEvents])

  useEffect(() => {
    if (detailsOpen) return
    setClusterOpen(false)
    setDetailDrawerTab(null)
  }, [detailsOpen])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const normalized = heroMediaUrl.trim()
    if (!normalized) {
      window.localStorage.removeItem('aiadvisor.hero_media_url')
      return
    }
    window.localStorage.setItem('aiadvisor.hero_media_url', normalized)
  }, [heroMediaUrl])

  const handleSend = useCallback((text?: string, forceAgent?: string) => {
    const msg = text || inputRef.current?.value || ''
    if (!msg.trim()) return
    if (inputRef.current) inputRef.current.value = ''

    const requestedMode = detectAdvisorModeHint(msg)
    const nextAdvisorMode = requestedMode || advisorMode
    if (requestedMode && requestedMode !== advisorMode) {
      setAdvisorMode(requestedMode)
    }

    if (shouldOpenCapabilityCard(msg)) {
      setShowCapabilityCard(true)
      setShowHintBubbles(false)
    }

    const resumeAgent = resumeSession?.agent_name
    const detected = detectAgent(msg)
    const fallbackAgent = nextAdvisorMode === 'coding' ? 'web-coder' : detected
    const picked = forceAgent || (selectedAgent !== 'auto' ? selectedAgent : fallbackAgent)

    let agentName = resumeAgent || picked
    if (!resumeAgent && agentCatalog.length > 0) {
      const known = new Set(agentCatalog.map((item) => item.name))
      if (!known.has(agentName)) {
        agentName = known.has('quick-qa') ? 'quick-qa' : agentCatalog[0].name
      }
    }

    setAdvisorCard(null)
    setOrchestratorStats(createEmptyOrchestratorStats())
    setPendingApprovals([])
    setCodingRunMetrics(createEmptyCodingRunMetrics())
    setDelegationStats(createEmptyDelegationStats())
    setHandoffActivities([])

    const orchestrationPolicy = ORCHESTRATOR_PRESET_CONFIG[orchestratorPreset]
    setShowHintBubbles(false)

    sendMessage(msg, {
      agentName,
      studentId,
      tenant: studentId ? { tenantId: `student:${studentId}`, studentId } : undefined,
      resume: Boolean(resumeAgent),
      runtime: {
        mode: runtimeMode,
        ...(nextAdvisorMode === 'learning' ? { outputFormat: 'advisor_card_v1' } : {}),
        ...(nextAdvisorMode === 'coding'
          ? {
              coding: {
                enabled: true,
                workspaceId: codingWorkspace,
                approvalMode: 'per_call',
                allowNetwork: false,
                policyProfile: codingPolicyProfile,
              },
            }
          : {}),
        orchestrator: {
          enabled: true,
          profile: nextAdvisorMode === 'coding' ? 'coding_v1' : 'webagent_v1',
          plannerMode: orchestrationPolicy.plannerMode,
          executorMode: runtimeMode,
          maxSteps: orchestrationPolicy.maxSteps,
          maxWorkers: orchestrationPolicy.maxWorkers,
          workerTimeoutSec: orchestrationPolicy.workerTimeoutSec,
          workerMaxRetries: orchestrationPolicy.workerMaxRetries,
          workerRetryBackoffMs: orchestrationPolicy.workerRetryBackoffMs,
          critiqueEnabled: orchestrationPolicy.critiqueEnabled,
          critiqueMode: orchestrationPolicy.critiqueMode,
          dynamicReplanEnabled: orchestrationPolicy.dynamicReplanEnabled,
          maxReplans: orchestrationPolicy.maxReplans,
        },
      },
    })
  }, [advisorMode, codingWorkspace, codingPolicyProfile, runtimeMode, orchestratorPreset, sendMessage, studentId, resumeSession, selectedAgent, agentCatalog])

  const handleStartTaskTemplate = useCallback(async () => {
    if (!selectedTaskTemplate || isStreaming || taskLaunchBusy) return
    setTaskLaunchBusy(true)
    setTaskTemplateError(null)
    try {
      const launch = await agentApi.startTaskTemplate({
        taskType: selectedTaskTemplate.task_type,
        label: selectedTaskTemplate.label,
        prompt: taskPromptOverride.trim() || selectedTaskTemplate.default_prompt,
        studentId,
        workspaceId: codingWorkspace,
        metadata: {
          advisor_mode: advisorMode,
          runtime_mode: runtimeMode,
          orchestrator_preset: orchestratorPreset,
        },
      })

      const runId = launch.run_id
      setActiveTaskRunId(runId)
      const baseReceipt = createReceiptFromTemplate(
        selectedTaskTemplate,
        runId,
        launch.source === 'api' || launch.source === 'fallback' ? launch.source : 'local',
      )
      upsertTaskReceipt(baseReceipt)

      const launchAgent = selectedTaskTemplate.target_agent
        || (advisorMode === 'coding' ? 'web-coder' : 'quick-qa')
      const launchPrompt = taskPromptOverride.trim()
        || selectedTaskTemplate.default_prompt
        || `请执行任务模板 ${selectedTaskTemplate.label}，并以结构化步骤回执返回执行过程。`

      pushTimeline({
        kind: 'orchestrator',
        title: '模板任务启动',
        detail: `${selectedTaskTemplate.label} · run ${runId.slice(0, 10)}...`,
        level: 'success',
      })

      handleSend(launchPrompt, launchAgent)
    } catch {
      setTaskTemplateError('任务模板启动失败，请稍后重试')
    } finally {
      setTaskLaunchBusy(false)
    }
  }, [
    advisorMode,
    codingWorkspace,
    handleSend,
    isStreaming,
    orchestratorPreset,
    pushTimeline,
    runtimeMode,
    selectedTaskTemplate,
    studentId,
    taskLaunchBusy,
    taskPromptOverride,
  ])

  const handleResumeSession = useCallback((item: AgentSessionItem) => {
    if (!item.agent_name) return
    setSession(item.agent_name, item.session_id)
    setResumeSession(item)
    setSelectedAgent(item.agent_name)
    setDetailDrawerTab(null)
  }, [setSession])

  const handleClearOneSession = useCallback(async (item: AgentSessionItem) => {
    try {
      await agentApi.clearSessions(item.session_id)
      if (item.agent_name) removeSession(item.agent_name)
      if (resumeSession?.session_id === item.session_id) setResumeSession(null)
      await loadSessions()
    } catch {
      setSessionError('清理会话失败')
    }
  }, [loadSessions, removeSession, resumeSession])

  const handleClearAllSessions = useCallback(async () => {
    try {
      await agentApi.clearSessions()
      clearLocalSessions()
      setResumeSession(null)
      await loadSessions()
    } catch {
      setSessionError('清空会话失败')
    }
  }, [clearLocalSessions, loadSessions])

  const handleApprovalDecision = useCallback(async (requestId: string, approved: boolean) => {
    setApprovalBusy((prev) => ({ ...prev, [requestId]: true }))
    try {
      if (approved) {
        await agentApi.approveAction(requestId)
      } else {
        await agentApi.rejectAction(requestId)
      }
      void loadApprovalMetrics(true)
    } catch {
      setApprovalBusy((prev) => ({ ...prev, [requestId]: false }))
      pushTimeline({
        kind: 'permission',
        title: '审批提交失败',
        detail: `request ${requestId}`,
        level: 'warning',
      })
    }
  }, [loadApprovalMetrics, pushTimeline])

  const handleNewChat = useCallback(() => {
    clearMessages()
    setRuntimeMeta(null)
    setOutputFormatUsed(null)
    setAdvisorCard(null)
    setResumeSession(null)
    setTimelineEvents([])
    setTimelineFilter('all')
    setTimelineLevelFilter('all')
    setTimelineCommandFilter('all')
    setTimelineSearch('')
    setActiveTaskRunId(null)
    setPendingApprovals([])
    setApprovalBusy({})
    setOrchestratorStats(createEmptyOrchestratorStats())
    setCodingRunMetrics(createEmptyCodingRunMetrics())
    setDelegationStats(createEmptyDelegationStats())
    setHandoffActivities([])
    setMessages([{
      id: Date.now().toString(),
      role: 'assistant',
      content: `好的，**${studentName}**！让我们开始新的对话。你想聊些什么？`,
    }])
  }, [clearMessages, setMessages, studentName])

  const activeMode = runtimeMeta?.mode || runtimeMode
  const runtimeBadge = runtimeMeta
    ? `${runtimeMeta.engine} · ${runtimeMeta.model || 'default'}${runtimeMeta.tenantId ? ` · ${runtimeMeta.tenantId}` : ''}`
    : '等待路由'
  const selectedAgentBadge = selectedAgent === 'auto'
    ? '自动路由'
    : agentLabel(selectedAgent, agentCatalog)

  const presetLabel = ORCHESTRATOR_PRESET_OPTIONS.find((item) => item.value === orchestratorPreset)?.label || orchestratorPreset
  const presetHint = ORCHESTRATOR_PRESET_OPTIONS.find((item) => item.value === orchestratorPreset)?.hint || ''
  const codingPolicySource = codingPolicyVersion || 'settings'
  const codingPolicyStatus = codingPolicyLoading ? '策略同步中' : `source · ${codingPolicySource}`
  const critiquePassRate = orchestratorStats.critiqueRuns > 0
    ? Math.round((orchestratorStats.critiquePasses / orchestratorStats.critiqueRuns) * 100)
    : 0
  const critiqueAvgScore = orchestratorStats.critiqueScoreCount > 0
    ? orchestratorStats.critiqueScoreSum / orchestratorStats.critiqueScoreCount
    : null

  const approvalTotal = approvalMetrics?.total_requests || 0
  const approvalPassRate = approvalTotal > 0
    ? Math.round(((approvalMetrics?.approved || 0) / approvalTotal) * 100)
    : 0
  const approvalTimeoutRate = approvalTotal > 0
    ? Math.round(((approvalMetrics?.timed_out || 0) / approvalTotal) * 100)
    : 0
  const runApprovalDecisions = codingRunMetrics.approvalApproved + codingRunMetrics.approvalRejected
  const runApprovalPassRate = runApprovalDecisions > 0
    ? Math.round((codingRunMetrics.approvalApproved / runApprovalDecisions) * 100)
    : 0
  const runFallbackRate = codingRunMetrics.toolCalls > 0
    ? Math.round((codingRunMetrics.toolFallbacks / codingRunMetrics.toolCalls) * 100)
    : 0
  const selectedTaskModules = selectedTaskTemplate
    ? selectedTaskTemplate.steps.map((step) => TASK_MODULE_LABELS[normalizeTaskModule(step.module)])
    : []
  const timelineSearchText = timelineSearch.trim().toLowerCase()
  const timelineCommandOptions = useMemo(() => {
    const unique = new Set<string>()
    timelineEvents.forEach((event) => {
      if (event.command && event.command.trim().length > 0) unique.add(event.command)
    })
    return Array.from(unique).sort((left, right) => left.localeCompare(right))
  }, [timelineEvents])

  const filteredTimelineEvents = useMemo(() => {
    return timelineEvents.filter((event) => {
      if (timelineFilter === 'handoff' && !isHandoffEvent(event)) return false
      if (timelineFilter !== 'all' && timelineFilter !== 'handoff') {
        if ((event.category || event.kind) !== timelineFilter) return false
      }
      if (timelineLevelFilter !== 'all') {
        if (normalizeTimelineLevel(event.level) !== timelineLevelFilter) return false
      }
      if (timelineCommandFilter !== 'all') {
        if ((event.command || '') !== timelineCommandFilter) return false
      }
      if (timelineSearchText.length === 0) return true
      const haystack = `${event.title} ${event.detail} ${event.command || ''} ${event.status || ''}`.toLowerCase()
      return haystack.includes(timelineSearchText)
    })
  }, [timelineEvents, timelineFilter, timelineLevelFilter, timelineCommandFilter, timelineSearchText])

  const delegationResolved = delegationStats.done + delegationStats.failed
  const delegationSuccessRate = delegationResolved > 0
    ? Math.round((delegationStats.done / delegationResolved) * 100)
    : 0
  const clusterAgent = selectedAgent === 'auto'
    ? (advisorMode === 'coding' ? 'web-coder' : 'quick-qa')
    : selectedAgent
  const moduleWorkbenchState = useMemo(() => {
    const stateMap = new Map<TaskReceiptModule, ModuleWorkbenchState>()
    MODULE_WORKBENCH_CARDS.forEach((card) => {
      stateMap.set(card.module, {
        module: card.module,
        status: 'idle',
        total: 0,
        running: 0,
        success: 0,
        failed: 0,
      })
    })

    receiptSnapshot.forEach((receipt) => {
      const candidateSteps = receipt.steps?.length > 0
        ? receipt.steps
        : [{
          id: receipt.runId,
          label: receipt.label,
          module: normalizeTaskModule(receipt.taskType.split('_')[0]),
          status: receipt.status === 'failed' ? 'failed' : receipt.status === 'success' ? 'success' : 'running',
          updatedAt: receipt.updatedAt,
        }]

      candidateSteps.forEach((step) => {
        const module = normalizeTaskModule(step.module)
        const item = stateMap.get(module)
        if (!item) return
        item.total += 1
        if (step.status === 'running' || step.status === 'pending') item.running += 1
        if (step.status === 'success') item.success += 1
        if (step.status === 'failed') item.failed += 1
        item.updatedAt = Math.max(item.updatedAt || 0, step.updatedAt || receipt.updatedAt || 0)
      })
    })

    return MODULE_WORKBENCH_CARDS.map((card) => {
      const item = stateMap.get(card.module) || {
        module: card.module,
        status: 'idle',
        total: 0,
        running: 0,
        success: 0,
        failed: 0,
      }

      let status: WorkbenchModuleStatus = 'idle'
      if (item.running > 0) status = 'running'
      else if (item.failed > 0 && item.success > 0) status = 'partial'
      else if (item.failed > 0) status = 'failed'
      else if (item.success > 0) status = 'success'

      return { ...card, ...item, status }
    })
  }, [receiptSnapshot])

  const runModuleQuickAction = useCallback((card: ModuleWorkbenchCard) => {
    handleSend(card.quickPrompt, card.defaultAgent)
  }, [handleSend])

  const exportUserVisibleReceipt = useCallback(() => {
    const payload = {
      exported_at: new Date().toISOString(),
      advisor_mode: advisorMode,
      runtime_mode: runtimeMode,
      orchestrator_preset: orchestratorPreset,
      selected_agent: selectedAgent,
      runtime_meta: runtimeMeta,
      delegation_stats: delegationStats,
      handoff_activities: handoffActivities,
      timeline: filteredTimelineEvents,
      task_receipts: receiptSnapshot.slice(0, 20),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const datePart = new Date().toISOString().replace(/[:.]/g, '-')
    anchor.href = url
    anchor.download = `aiadvisor-receipt-${datePart}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [
    advisorMode,
    delegationStats,
    filteredTimelineEvents,
    handoffActivities,
    orchestratorPreset,
    receiptSnapshot,
    runtimeMeta,
    runtimeMode,
    selectedAgent,
  ])

  return (
    <div
      className="min-h-screen p-4 md:p-6 lg:p-8 overflow-hidden flex flex-col"
      style={{ background: `linear-gradient(135deg, var(--bg-primary) 0%, #F8FAFC 50%, ${primary[50]}40 100%)` }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-4 space-y-3"
      >
        <div className="rounded-3xl border border-white/45 bg-white/60 backdrop-blur-xl shadow-[0_12px_32px_rgba(15,23,42,0.08)] dark:border-white/20 dark:bg-white/10 px-5 py-6 md:px-6">
          <div className="grid lg:grid-cols-[1fr_280px] gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] font-semibold mb-2" style={{ color: 'var(--accent-text)' }}>
                AI Advisor
              </p>
              <h1 className="text-3xl md:text-5xl font-black tracking-tight text-text-primary leading-tight mb-2">
                把问题交给 Agent，专注你的结果
              </h1>
              <p className="text-sm md:text-base text-text-secondary max-w-3xl">
                {advisorMode === 'coding'
                  ? '描述你的开发目标，系统会在安全策略下自动完成分析、执行与回执。'
                  : '一句话描述学习目标，系统会自动路由最合适的 Agent 并给出结构化建议。'}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-md text-[11px] border border-border-primary bg-bg-secondary text-text-muted">
                  {selectedAgentBadge} · {activeMode}
                </span>
                <span className="px-2.5 py-1 rounded-md text-[11px] border border-border-primary bg-bg-secondary text-text-muted">
                  {runtimeBadge}
                </span>
                <span className="px-2.5 py-1 rounded-md text-[11px] border border-border-primary bg-bg-secondary text-text-muted">
                  编排 {presetLabel}
                </span>
              </div>
            </div>
            <div className="rounded-2xl border border-border-primary bg-bg-primary/80 px-4 py-4 flex flex-col justify-between min-h-[140px]">
              <p className="text-[11px] uppercase tracking-wide text-text-muted">Media Slot</p>
              {heroMediaUrl.trim() ? (
                <div className="rounded-xl overflow-hidden border border-border-primary bg-bg-secondary">
                  {isVideoAsset(heroMediaUrl) ? (
                    <video
                      src={heroMediaUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-[130px] object-cover"
                    />
                  ) : (
                    <img
                      src={heroMediaUrl}
                      alt="Hero visual"
                      className="w-full h-[130px] object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm font-semibold text-text-primary">
                    右侧可替换开源动图/短视频
                  </p>
                  <p className="text-xs text-text-muted leading-relaxed">
                    推荐用于展示当前任务链路或示例成果，主内容区保持简洁可读。
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded-md text-[11px] border border-border-primary bg-bg-secondary text-text-muted">
              {selectedAgentBadge}
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] border border-border-primary bg-bg-secondary text-text-muted">
              {runtimeBadge}
            </span>
            <span className="px-2.5 py-1 rounded-md text-[11px] border border-border-primary bg-bg-secondary text-text-muted">
              编排 {presetLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowHintBubbles((prev) => !prev)}
              className="px-3 py-2 rounded-xl font-medium text-xs border border-border-primary bg-bg-secondary text-text-secondary hover:border-primary-300 transition-all"
            >
              {showHintBubbles ? '关闭 AI 提示' : 'AI 提示'}
            </button>
            <button
              type="button"
              onClick={() => setShowCapabilityCard(true)}
              className="px-3 py-2 rounded-xl font-medium text-xs border border-border-primary bg-bg-secondary text-text-secondary hover:border-primary-300 transition-all"
            >
              能力卡片
            </button>
            {isStreaming && (
              <button
                onClick={stop}
                className="px-4 py-2 rounded-xl font-medium text-sm text-red-500 border border-red-300 hover:bg-red-50 transition-all"
              >
                停止生成
              </button>
            )}
            <button
              onClick={handleNewChat}
              className="px-4 py-2 rounded-xl font-medium text-sm transition-all"
              style={{
                background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`,
                color: 'white',
              }}
            >
              + 新对话
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showHintBubbles && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="rounded-2xl border border-border-primary bg-bg-secondary/90 px-3 py-3"
            >
              <p className="text-[11px] text-text-muted mb-2">像和 Agent 对话一样选择提示，未主动提问时不会展示系统控制项。</p>
              <div className="flex items-center gap-2 flex-wrap">
                {AI_HINT_BUBBLES.map((hint) => (
                  <button
                    key={hint.label}
                    type="button"
                    onClick={() => handleSend(hint.text, hint.agent)}
                    className="px-3 py-1.5 rounded-full text-xs border border-border-primary bg-bg-primary text-text-secondary hover:border-primary-300 hover:text-text-primary transition-all"
                  >
                    {hint.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setShowCapabilityCard(true)
                    setShowHintBubbles(false)
                  }}
                  className="px-3 py-1.5 rounded-full text-xs border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 transition-all"
                >
                  打开能力卡片
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showCapabilityCard && (
            <>
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowCapabilityCard(false)}
                className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-[2px]"
                aria-label="关闭能力卡片"
              />
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.98 }}
                className="fixed left-1/2 top-20 z-[60] w-[min(94vw,960px)] -translate-x-1/2 rounded-3xl border border-white/45 bg-white/70 backdrop-blur-xl shadow-[0_20px_50px_rgba(15,23,42,0.18)] dark:border-white/20 dark:bg-slate-950/70 p-4 md:p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">能力卡片（按需显示）</p>
                    <p className="text-xs text-text-muted">默认隐藏所有控制项；仅当你主动触发时才展示。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCapabilityCard(false)}
                    className="p-1.5 rounded-lg border border-border-primary text-text-muted hover:text-text-primary hover:border-primary-300"
                    aria-label="关闭能力卡片"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-bg-secondary border border-border-primary">
                    <button
                      onClick={() => setAdvisorMode('learning')}
                      disabled={isStreaming}
                      className="px-3 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                      style={{
                        color: advisorMode === 'learning' ? 'white' : 'var(--text-secondary)',
                        background: advisorMode === 'learning'
                          ? `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`
                          : 'transparent',
                      }}
                    >
                      Learning
                    </button>
                    <button
                      onClick={() => {
                        setAdvisorMode('coding')
                        if (selectedAgent === 'auto') setSelectedAgent('web-coder')
                      }}
                      disabled={isStreaming}
                      className="px-3 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                      style={{
                        color: advisorMode === 'coding' ? 'white' : 'var(--text-secondary)',
                        background: advisorMode === 'coding'
                          ? `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`
                          : 'transparent',
                      }}
                    >
                      Coding
                    </button>
                  </div>

                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-bg-secondary border border-border-primary">
                    <span className="text-[11px] text-text-muted">Agent</span>
                    <select
                      value={selectedAgent}
                      onChange={(e) => setSelectedAgent(e.target.value)}
                      disabled={isStreaming || agentCatalogLoading}
                      className="text-xs bg-transparent text-text-primary outline-none"
                    >
                      <option value="auto">自动路由</option>
                      {agentCatalog.map((agent) => (
                        <option key={agent.name} value={agent.name}>
                          {agentLabel(agent.name, agentCatalog)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1 p-1 rounded-xl bg-bg-secondary border border-border-primary">
                    {MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setRuntimeMode(option.value)}
                        disabled={isStreaming}
                        className="px-3 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                        style={{
                          color: activeMode === option.value ? 'white' : 'var(--text-secondary)',
                          background: activeMode === option.value
                            ? `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`
                            : 'transparent',
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-bg-secondary border border-border-primary">
                    <span className="text-[11px] text-text-muted">编排</span>
                    <select
                      value={orchestratorPreset}
                      onChange={(e) => setOrchestratorPreset(e.target.value as OrchestratorPreset)}
                      disabled={isStreaming}
                      className="text-xs bg-transparent text-text-primary outline-none"
                    >
                      {ORCHESTRATOR_PRESET_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {advisorMode === 'coding' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-bg-secondary border border-border-primary">
                      <label htmlFor="coding-workspace-input" className="text-[11px] text-text-muted">Workspace</label>
                      <input
                        id="coding-workspace-input"
                        value={codingWorkspace}
                        onChange={(e) => setCodingWorkspace(e.target.value)}
                        disabled={isStreaming}
                        className="w-32 text-xs bg-transparent text-text-primary outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-bg-secondary border border-border-primary">
                      <label htmlFor="coding-policy-select" className="text-[11px] text-text-muted">Policy</label>
                      <select
                        id="coding-policy-select"
                        value={codingPolicyProfile}
                        onChange={(e) => setCodingPolicyProfile(e.target.value)}
                        disabled={isStreaming || codingPolicyLoading}
                        className="max-w-36 text-xs bg-transparent text-text-primary outline-none cursor-pointer disabled:cursor-not-allowed"
                      >
                        {codingPolicyOptions.map((profile) => (
                          <option key={profile} value={profile}>
                            {profile}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          void loadCodingPolicies()
                        }}
                        disabled={isStreaming || codingPolicyLoading}
                        className="cursor-pointer px-2 py-0.5 rounded-lg text-[11px] border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        刷新
                      </button>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg text-[11px] border border-border-primary bg-bg-secondary text-text-muted" aria-live="polite">
                      {codingPolicyStatus}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-bg-secondary border border-border-primary">
                    <label htmlFor="hero-media-url" className="text-[11px] text-text-muted">Hero 媒体</label>
                    <input
                      id="hero-media-url"
                      value={heroMediaUrl}
                      onChange={(event) => setHeroMediaUrl(event.target.value)}
                      placeholder="https://...gif / .webm / .mp4"
                      className="w-56 text-xs bg-transparent text-text-primary outline-none"
                      disabled={isStreaming}
                    />
                  </div>
                  <button
                    onClick={() => setClusterOpen((prev) => !prev)}
                    className="px-3 py-1.5 rounded-lg font-medium text-xs border border-border-primary bg-bg-secondary text-text-secondary hover:border-primary-300 transition-all"
                  >
                    集群
                  </button>
                  <button
                    onClick={() => {
                      setDetailsOpen(true)
                      setDetailDrawerTab((prev) => (prev === 'events' ? null : 'events'))
                    }}
                    className="px-3 py-1.5 rounded-lg font-medium text-xs border border-border-primary bg-bg-secondary text-text-secondary hover:border-primary-300 transition-all"
                  >
                    事件
                  </button>
                  <button
                    onClick={() => {
                      setDetailsOpen(true)
                      setDetailDrawerTab((prev) => {
                        const next = prev === 'sessions' ? null : 'sessions'
                        if (next === 'sessions') void loadSessions()
                        return next
                      })
                    }}
                    className="px-3 py-1.5 rounded-lg font-medium text-xs border border-border-primary bg-bg-secondary text-text-secondary hover:border-primary-300 transition-all"
                  >
                    会话
                  </button>
                  <button
                    onClick={() => {
                      setDetailsOpen(true)
                      setDetailDrawerTab((prev) => (prev === 'overview' ? null : 'overview'))
                    }}
                    className="px-3 py-1.5 rounded-lg font-medium text-xs border border-border-primary bg-bg-secondary text-text-secondary hover:border-primary-300 transition-all"
                  >
                    总览
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-1 rounded-lg text-[11px] border border-border-primary bg-bg-secondary text-text-muted">
                    {selectedAgentBadge} · {activeMode} · {presetLabel} · {runtimeBadge}
                  </span>
                  {selectedCapability && selectedAgent !== 'auto' && (
                    <span className="px-2.5 py-1 rounded-lg text-[11px] border border-border-primary bg-bg-secondary text-text-muted">
                      {selectedCapability.engine} · {selectedCapability.tool_count} tools
                    </span>
                  )}
                  <span className="px-2.5 py-1 rounded-lg text-[11px] border border-border-primary bg-bg-secondary text-text-muted">
                    {presetHint}
                  </span>
                  {outputFormatUsed && (
                    <span className="px-2.5 py-1 rounded-lg text-[11px] border border-primary-200 bg-primary-50 text-primary-600">
                      schema · {outputFormatUsed}
                    </span>
                  )}
                </div>

                {codingPolicyError && advisorMode === 'coding' && (
                  <p className="text-[11px] text-amber-600">{codingPolicyError}</p>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {detailsOpen && detailDrawerTab && (
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setDetailDrawerTab(null)
            }}
            className="fixed inset-0 z-40 bg-slate-950/20 backdrop-blur-[1px]"
            aria-label="关闭系统抽屉"
          />
        )}
      </AnimatePresence>

      {resumeSession && (
        <div className="mb-3 px-4 py-2 rounded-xl border border-primary-200 bg-primary-50 text-sm text-primary-700 flex items-center justify-between gap-3">
          <span>
            已启用会话恢复：
            {agentLabel(resumeSession.agent_name, agentCatalog)}
            {' · '}
            {resumeSession.session_id.slice(0, 12)}...
          </span>
          <button
            className="text-xs px-2 py-1 rounded-md border border-primary-200 hover:bg-white"
            onClick={() => setResumeSession(null)}
          >
            退出恢复
          </button>
        </div>
      )}

      <AnimatePresence>
        {overviewOpen && (
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            className="fixed right-4 top-24 bottom-4 z-50 w-[min(92vw,560px)] rounded-2xl border border-border-primary bg-bg-secondary p-3 md:p-4 shadow-[0_18px_38px_rgba(15,23,42,0.18)] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-text-primary">系统总览</h3>
              <button
                type="button"
                className="p-1 rounded-md border border-border-primary text-text-muted hover:text-text-primary hover:border-primary-300"
                onClick={() => setDetailDrawerTab(null)}
                aria-label="关闭总览面板"
              >
                <X size={14} />
              </button>
            </div>

            {clusterOpen && (
              <AgentClusterBoard
                className="mb-3"
                defaultAgent={clusterAgent}
                studentId={studentId}
                codingMode={advisorMode === 'coding'}
                probePrompt={advisorMode === 'coding'
                  ? '请演示 coding 任务里 planner→gather→act→synthesize 的执行链路，并说明审批与委托节点。'
                  : '请演示学习任务里多 agent 协作链路，并突出委托与回执节点。'}
              />
            )}

            <div className="mb-3 rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:border-white/20 dark:bg-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-text-primary">用户可感知工作台</p>
            <p className="text-xs text-text-muted">统一展示笔记/实验/PDF/图谱/RAG/Coding 板块活跃状态与快捷入口</p>
          </div>
          <span className="text-[11px] px-2 py-1 rounded-md border border-border-primary bg-bg-primary text-text-muted">
            已跟踪回执 {receiptSnapshot.length}
          </span>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
          {moduleWorkbenchState.map((card) => (
            <div key={card.module} className="rounded-xl border border-border-primary bg-bg-primary px-3 py-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{card.title}</p>
                  <p className="text-[11px] text-text-muted">{card.description}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${moduleStatusClass(card.status)}`}>
                  {moduleStatusLabel(card.status)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-text-muted mb-2">
                <span>总计 {card.total}</span>
                <span>运行 {card.running}</span>
                <span>成功 {card.success}</span>
                <span>失败 {card.failed}</span>
              </div>
              <p className="text-[11px] text-text-muted mb-2">
                最近更新：{card.updatedAt ? formatSessionTime(card.updatedAt) : '-'}
              </p>
              <div className="flex items-center gap-2">
                <Link
                  to={card.route}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-border-primary text-text-muted hover:border-primary-300 hover:text-text-primary transition-all"
                >
                  打开板块
                </Link>
                <button
                  type="button"
                  onClick={() => runModuleQuickAction(card)}
                  disabled={isStreaming}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-primary-200 text-primary-600 hover:bg-primary-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  让 Agent 执行
                </button>
              </div>
            </div>
          ))}
        </div>
          </div>

          <div className="mb-3 rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:border-white/20 dark:bg-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-text-primary">跨板块任务模板（P7-1 Beta）</p>
            <p className="text-xs text-text-muted">
              单入口触发任务链，统一输出步骤/审批/结果回执
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] px-2 py-1 rounded-md border border-border-primary bg-bg-primary text-text-muted">
              source · {taskTemplateSource}
            </span>
            <button
              type="button"
              onClick={() => {
                void loadTaskTemplates()
              }}
              disabled={taskTemplateLoading || isStreaming}
              className="text-xs px-2 py-1 rounded-md border border-border-primary text-text-muted hover:border-primary-300 disabled:opacity-50"
            >
              {taskTemplateLoading ? '同步中...' : '刷新模板'}
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-[220px_1fr_auto] gap-2">
          <select
            value={selectedTaskType}
            onChange={(event) => {
              const next = event.target.value
              setSelectedTaskType(next)
              const nextTemplate = taskTemplates.find((item) => item.task_type === next)
              setTaskPromptOverride(nextTemplate?.default_prompt || '')
            }}
            disabled={taskTemplateLoading || isStreaming || taskTemplates.length === 0}
            className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none"
          >
            {taskTemplates.length === 0 ? (
              <option value="">暂无模板</option>
            ) : (
              taskTemplates.map((template) => (
                <option key={template.task_type} value={template.task_type}>
                  {template.label}
                </option>
              ))
            )}
          </select>

          <input
            value={taskPromptOverride}
            onChange={(event) => setTaskPromptOverride(event.target.value)}
            placeholder="任务提示词（可覆盖默认模板提示）"
            disabled={isStreaming || taskTemplates.length === 0}
            className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-primary-300"
          />

          <button
            type="button"
            onClick={() => {
              void handleStartTaskTemplate()
            }}
            disabled={isStreaming || taskTemplates.length === 0 || taskLaunchBusy || !selectedTaskTemplate}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)` }}
          >
            {taskLaunchBusy ? '启动中...' : '启动模板'}
          </button>
        </div>

        {selectedTaskTemplate && (
          <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <p className="text-xs font-semibold text-text-primary">{selectedTaskTemplate.description || selectedTaskTemplate.label}</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-border-primary text-text-muted">
                risk · {selectedTaskTemplate.risk_level}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedTaskModules.map((module, index) => (
                <span key={`${module}-${index}`} className="text-[10px] px-2 py-0.5 rounded-full border border-primary-200 text-primary-600 bg-primary-50">
                  {module}
                </span>
              ))}
            </div>
          </div>
        )}

        {taskTemplateError && (
          <p className="text-xs text-amber-600">{taskTemplateError}</p>
        )}

        <TaskReceiptPanel
          title="任务执行回执（跨板块）"
          maxItems={4}
          emptyText="尚未触发任务模板；启动后可在此查看统一回执。"
        />
            </div>

            <div className="mb-3 rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:border-white/20 dark:bg-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-text-primary">Agent 协作态势</p>
            <p className="text-xs text-text-muted">实时显示委托链路、批次执行与成功率</p>
          </div>
          <button
            type="button"
            onClick={exportUserVisibleReceipt}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-border-primary text-text-muted hover:border-primary-300 hover:text-text-primary transition-all"
          >
            导出用户侧回执
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">Delegation</p>
            <p className="text-sm font-semibold text-text-primary">{delegationStats.started}</p>
            <p className="text-[10px] text-text-muted">完成 {delegationStats.done} · 失败 {delegationStats.failed}</p>
          </div>
          <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">Success Rate</p>
            <p className="text-sm font-semibold text-text-primary">{delegationSuccessRate}%</p>
            <p className="text-[10px] text-text-muted">已结算 {delegationResolved}</p>
          </div>
          <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">In Flight</p>
            <p className="text-sm font-semibold text-text-primary">{delegationStats.inFlight}</p>
            <p className="text-[10px] text-text-muted">当前进行中的委托</p>
          </div>
          <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">Batch</p>
            <p className="text-sm font-semibold text-text-primary">{delegationStats.batchRuns}</p>
            <p className="text-[10px] text-text-muted">提交 {delegationStats.batchCommitted} · 未提交 {delegationStats.batchFailed}</p>
          </div>
        </div>

        {handoffActivities.length > 0 ? (
          <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
            <p className="text-xs font-semibold text-text-primary mb-2">最近委托轨迹</p>
            <div className="space-y-1.5 max-h-28 overflow-y-auto">
              {handoffActivities.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="text-text-primary truncate">{item.targetAgent}</p>
                    <p className="text-text-muted truncate">{item.detail}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full border text-[10px] ${
                      item.status === 'running'
                        ? 'border-blue-200 bg-blue-50 text-blue-600'
                        : item.status === 'done'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                          : 'border-rose-200 bg-rose-50 text-rose-600'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-muted">暂无委托记录。可提问复杂任务触发多 agent 协作。</p>
        )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {eventsOpen && (
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            className={`${
              detailsOpen
                ? 'fixed right-4 top-24 bottom-4 z-50 w-[min(92vw,460px)]'
                : 'mb-3'
            } rounded-2xl border border-border-primary bg-bg-secondary p-3 md:p-4 shadow-[0_18px_38px_rgba(15,23,42,0.18)]`}
          >
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-text-primary">Hooks 事件流</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {detailsOpen && (
                  <button
                    type="button"
                    className="p-1 rounded-md border border-border-primary text-text-muted hover:text-text-primary hover:border-primary-300"
                    onClick={() => setDetailDrawerTab(null)}
                    aria-label="关闭事件面板"
                  >
                    <X size={14} />
                  </button>
                )}
                <select
                  value={timelineFilter}
                  onChange={(event) => setTimelineFilter(event.target.value as TimelineFilter)}
                  className="text-xs px-2 py-1 rounded-md border border-border-primary bg-bg-primary text-text-muted outline-none"
                >
                  <option value="all">全部</option>
                  <option value="handoff">委托</option>
                  <option value="orchestrator">编排</option>
                  <option value="permission">审批/权限</option>
                  <option value="tool">工具</option>
                  <option value="subtask">子任务</option>
                  <option value="notification">通知</option>
                </select>
                <select
                  value={timelineLevelFilter}
                  onChange={(event) => setTimelineLevelFilter(event.target.value as TimelineLevelFilter)}
                  className="text-xs px-2 py-1 rounded-md border border-border-primary bg-bg-primary text-text-muted outline-none"
                >
                  <option value="all">状态:全部</option>
                  <option value="info">状态:进行中</option>
                  <option value="success">状态:成功</option>
                  <option value="warning">状态:告警</option>
                </select>
                <select
                  value={timelineCommandFilter}
                  onChange={(event) => setTimelineCommandFilter(event.target.value)}
                  className="text-xs px-2 py-1 rounded-md border border-border-primary bg-bg-primary text-text-muted outline-none max-w-44"
                >
                  <option value="all">命令:全部</option>
                  {timelineCommandOptions.map((command) => (
                    <option key={command} value={command}>
                      {command}
                    </option>
                  ))}
                </select>
                <input
                  value={timelineSearch}
                  onChange={(event) => setTimelineSearch(event.target.value)}
                  placeholder="搜索事件关键词"
                  className="text-xs px-2 py-1 rounded-md border border-border-primary bg-bg-primary text-text-primary outline-none"
                />
                {advisorMode === 'coding' && (
                  <span className="text-[11px] px-2 py-1 rounded-md border border-border-primary text-text-muted bg-bg-primary" aria-live="polite">
                    {approvalMetricsLoading ? '审批指标同步中' : '审批指标已同步'}
                  </span>
                )}
                {advisorMode === 'coding' && (
                  <button
                    className="text-xs px-2 py-1 rounded-md border border-border-primary text-text-muted hover:border-primary-300 disabled:opacity-50"
                    onClick={() => {
                      void loadApprovalMetrics()
                    }}
                    disabled={approvalMetricsLoading}
                  >
                    刷新指标
                  </button>
                )}
                <button
                  className="text-xs px-2 py-1 rounded-md border border-border-primary text-text-muted hover:border-primary-300"
                  onClick={exportUserVisibleReceipt}
                >
                  导出
                </button>
                <button
                  className="text-xs px-2 py-1 rounded-md border border-border-primary text-text-muted hover:border-primary-300"
                  onClick={() => {
                    setTimelineEvents([])
                    setTimelineFilter('all')
                    setTimelineLevelFilter('all')
                    setTimelineCommandFilter('all')
                    setTimelineSearch('')
                  }}
                >
                  清空事件
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">Critique</p>
                <p className="text-sm font-semibold text-text-primary">{orchestratorStats.critiqueRuns}</p>
                <p className="text-[10px] text-text-muted">通过 {orchestratorStats.critiquePasses} · 未过 {orchestratorStats.critiqueFails}</p>
              </div>
              <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">Pass Rate</p>
                <p className="text-sm font-semibold text-text-primary">{critiquePassRate}%</p>
                <p className="text-[10px] text-text-muted">平均分 {critiqueAvgScore === null ? '-' : critiqueAvgScore.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">Replan</p>
                <p className="text-sm font-semibold text-text-primary">{orchestratorStats.finalReplanCount}</p>
                <p className="text-[10px] text-text-muted">启动 {orchestratorStats.replanStarts} · 成功 {orchestratorStats.replanSuccesses} · 失败 {orchestratorStats.replanFailures}</p>
              </div>
              <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">Round</p>
                <p className="text-sm font-semibold text-text-primary">{orchestratorStats.maxObservedRound}</p>
                <p className="text-[10px] text-text-muted">预算 {orchestratorStats.budgetExhausted ? '耗尽' : '正常'}</p>
              </div>
            </div>

            {advisorMode === 'coding' && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">Approval</p>
                  <p className="text-sm font-semibold text-text-primary">{approvalPassRate}%</p>
                  <p className="text-[10px] text-text-muted">通过 {(approvalMetrics?.approved || 0)} / 总计 {approvalTotal}</p>
                </div>
                <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">Timeout</p>
                  <p className="text-sm font-semibold text-text-primary">{approvalTimeoutRate}%</p>
                  <p className="text-[10px] text-text-muted">超时 {(approvalMetrics?.timed_out || 0)} · 平均等待 {approvalMetrics?.avg_wait_ms ?? 0}ms</p>
                </div>
                <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">Fallback</p>
                  <p className="text-sm font-semibold text-text-primary">{runFallbackRate}%</p>
                  <p className="text-[10px] text-text-muted">回退 {codingRunMetrics.toolFallbacks} / 调用 {codingRunMetrics.toolCalls}</p>
                </div>
                <div className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">Run Approval</p>
                  <p className="text-sm font-semibold text-text-primary">{runApprovalPassRate}%</p>
                  <p className="text-[10px] text-text-muted">请求 {codingRunMetrics.approvalRequests} · 拒绝 {codingRunMetrics.approvalRejected} · 超时 {codingRunMetrics.approvalTimeouts}</p>
                </div>
              </div>
            )}

            {approvalMetricsError && advisorMode === 'coding' && (
              <p className="text-xs text-amber-600 mb-2">{approvalMetricsError}</p>
            )}

            {orchestratorStats.lastCritiqueSummary && (
              <p className="text-xs text-text-muted mb-2">
                最近 Critique：{orchestratorStats.lastCritiqueSummary}
              </p>
            )}

            <p className="text-[11px] text-text-muted mb-2">
              事件筛选：{filteredTimelineEvents.length} / {timelineEvents.length}
            </p>

            {filteredTimelineEvents.length === 0 ? (
              <p className="text-xs text-text-muted">暂无事件。开始一次对话后可看到权限/子任务/通知流。</p>
            ) : (
              <div className={`space-y-2 overflow-y-auto ${detailsOpen ? 'max-h-[calc(100vh-280px)]' : 'max-h-52'}`}>
                {filteredTimelineEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] border font-medium ${eventBadgeClass(event.kind)}`}>
                          {event.kind}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] border font-medium ${timelineLevelClass(event.level)}`}>
                          {normalizeTimelineLevel(event.level)}
                        </span>
                        {event.command && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] border font-medium border-primary-200 bg-primary-50 text-primary-700">
                            {event.command}
                          </span>
                        )}
                        {event.status && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] border font-medium border-border-primary bg-bg-secondary text-text-muted">
                            {event.status}
                          </span>
                        )}
                        <span className="text-xs font-semibold text-text-primary">{event.title}</span>
                      </div>
                      <span className="text-[10px] text-text-muted">{formatTimelineTime(event.timestamp)}</span>
                    </div>
                    <p className="text-xs text-text-muted">{event.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sessionsOpen && (
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            className={`${
              detailsOpen
                ? 'fixed right-4 top-24 bottom-4 z-50 w-[min(92vw,460px)]'
                : 'mb-3'
            } rounded-2xl border border-border-primary bg-bg-secondary p-3 md:p-4 shadow-[0_18px_38px_rgba(15,23,42,0.18)]`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-text-primary">会话历史</h3>
              <div className="flex items-center gap-2">
                {detailsOpen && (
                  <button
                    type="button"
                    className="p-1 rounded-md border border-border-primary text-text-muted hover:text-text-primary hover:border-primary-300"
                    onClick={() => setDetailDrawerTab(null)}
                    aria-label="关闭会话面板"
                  >
                    <X size={14} />
                  </button>
                )}
                <button
                  className="text-xs px-2 py-1 rounded-md border border-border-primary text-text-muted hover:border-red-300 hover:text-red-500"
                  onClick={handleClearAllSessions}
                >
                  清空全部
                </button>
              </div>
            </div>

            {sessionLoading && <p className="text-xs text-text-muted">正在加载...</p>}
            {sessionError && <p className="text-xs text-red-500">{sessionError}</p>}
            {!sessionLoading && !sessionError && sessionItems.length === 0 && (
              <p className="text-xs text-text-muted">暂无可恢复会话</p>
            )}

            <div className={`space-y-2 overflow-y-auto ${detailsOpen ? 'max-h-[calc(100vh-180px)]' : 'max-h-56'}`}>
              {sessionItems.map((item) => {
                const label = agentLabel(item.agent_name, agentCatalog)
                const isActive = resumeSession?.session_id === item.session_id
                return (
                  <div
                    key={item.session_id}
                    className={`rounded-xl border px-3 py-2 ${
                      isActive ? 'border-primary-300 bg-primary-50/70' : 'border-border-primary bg-bg-primary'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-text-primary">
                        {label} · {formatSessionTime(item.updated_at)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          className="text-[11px] px-2 py-1 rounded-md border border-primary-200 text-primary-600 hover:bg-primary-50"
                          onClick={() => handleResumeSession(item)}
                        >
                          恢复
                        </button>
                        <button
                          className="text-[11px] px-2 py-1 rounded-md border border-red-200 text-red-500 hover:bg-red-50"
                          onClick={() => handleClearOneSession(item)}
                        >
                          清理
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-text-muted line-clamp-2">
                      {sessionPreview(item)}
                    </p>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ delay: 0.1, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 flex flex-col min-h-0"
      >
        <GlassCard variant="standard" color="white" className="flex-1 flex flex-col p-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
            {pendingApprovals.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-amber-800">待审批操作</p>
                  <p className="text-xs text-amber-700">高风险操作需逐次确认</p>
                </div>
                {pendingApprovals.map((item) => (
                  <div key={item.id} className="rounded-xl border border-amber-200 bg-white/80 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-text-primary">{item.tool}</p>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                        {item.risk || 'high'}
                      </span>
                    </div>
                    {item.argsPreview && (
                      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap bg-bg-secondary rounded-lg p-2 text-text-secondary overflow-x-auto">
                        {JSON.stringify(item.argsPreview, null, 2)}
                      </pre>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleApprovalDecision(item.id, true)}
                        disabled={Boolean(approvalBusy[item.id])}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        批准
                      </button>
                      <button
                        onClick={() => void handleApprovalDecision(item.id, false)}
                        disabled={Boolean(approvalBusy[item.id])}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {advisorCard && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-primary-200 bg-primary-50/60 p-4 md:p-5"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="text-base md:text-lg font-semibold text-text-primary">
                    {advisorCard.title}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-white border border-primary-200 text-primary-700">
                    {riskLabel(advisorCard.risk_level)}
                  </span>
                </div>

                {advisorCard.summary && (
                  <p className="text-sm md:text-[15px] text-text-secondary leading-relaxed mb-3">
                    {advisorCard.summary}
                  </p>
                )}

                {advisorCard.analysis.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">核心分析</p>
                    <ul className="space-y-1.5">
                      {advisorCard.analysis.map((item) => (
                        <li key={item} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {advisorCard.next_steps.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">下一步建议</p>
                    <ul className="space-y-1.5">
                      {advisorCard.next_steps.map((step) => (
                        <li key={step} className="text-sm text-text-secondary flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-green-500" />
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}

            <AnimatePresence>
              {messages.map((message: AgentMessage, index: number) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ delay: index * 0.03, duration: 0.3 }}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] md:max-w-2xl rounded-2xl px-5 py-4 ${
                      message.role === 'user' ? 'rounded-tr-sm' : 'rounded-tl-sm'
                    }`}
                    style={message.role === 'user' ? {
                      background: `linear-gradient(135deg, ${primary[700]} 0%, ${primary[800]} 100%)`,
                      color: 'white',
                    } : {
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {message.role === 'assistant' && message.agentName && (
                      <span className="inline-block px-2 py-0.5 mb-2 text-[10px] font-medium rounded-full bg-primary-500/10 text-primary-500">
                        {agentLabel(message.agentName, agentCatalog)}
                      </span>
                    )}
                    {message.role === 'assistant' ? (
                      <div className="prose prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-li:text-text-secondary prose-strong:text-text-primary prose-code:bg-bg-tertiary prose-code:px-1 prose-code:rounded">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content || '思考中...'}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm md:text-base whitespace-pre-line leading-relaxed">
                        {message.content}
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {messages.length === 1 && !isStreaming && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-wrap gap-2 pt-2"
              >
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => handleSend(s.text, s.agent)}
                    className="px-4 py-2 rounded-full text-sm font-medium transition-all bg-bg-secondary border border-border-primary text-text-secondary hover:border-primary-300 hover:bg-primary-50"
                  >
                    {s.text}
                  </button>
                ))}
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 md:p-6 border-t border-border-primary">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSend() }}
              className="flex gap-3"
            >
              <input
                ref={inputRef}
                type="text"
                placeholder="输入你的问题..."
                className="flex-1 px-5 py-3 rounded-xl text-sm transition-all bg-bg-primary border border-border-primary text-text-primary outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                disabled={isStreaming}
              />
              <button
                type="submit"
                disabled={isStreaming}
                className="px-6 md:px-8 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`,
                  color: 'white',
                }}
              >
                发送
              </button>
            </form>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  )
}
