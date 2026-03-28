/**
 * FloatingAgent — Dynamic Island style global floating AI agent
 * Three-state machine: Pill (胶囊) → Bar (底栏) → Float (浮动面板)
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, Send, Sparkles, StopCircle,
  Wrench, Zap, ChevronUp, ChevronDown, Compass,
  Target, Brain, BarChart3, Rocket, Minimize2, X,
  ListTree, LoaderCircle, type LucideIcon,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAgentStream, type AgentStreamCallbacks } from '../hooks/useAgentStream'
import { useAgentSession } from '../contexts/AgentSessionContext'
import { useUICommands } from '../hooks/useUICommands'
import type { UICommand } from '../hooks/useUICommands'
import UIEffectLayer from './ui/UIEffectLayer'
import { useTheme } from '../theme/ThemeContext'
import { agentApi, type ToolAnnotationHints, type ToolPackageCatalog } from '../services/api'
import { getLatestAgentMemories } from '../services/agentMemoryBridge'

// ── Types ──

type AgentMode = 'pill' | 'bar' | 'float'
type RuntimeMode = 'fast' | 'balanced' | 'deep'

const MODE_OPTIONS: { value: RuntimeMode; label: string }[] = [
  { value: 'fast', label: '快速' },
  { value: 'balanced', label: '平衡' },
  { value: 'deep', label: '深度' },
]

type ToolMetaMap = Record<string, {
  annotations?: ToolAnnotationHints | null
  riskLevel?: string
}>

function buildToolMetaMap(catalog: ToolPackageCatalog): ToolMetaMap {
  const map: ToolMetaMap = {}
  for (const pkg of Object.values(catalog)) {
    for (const detail of pkg.tool_details || []) {
      map[detail.name] = {
        annotations: detail.annotations || null,
        riskLevel: detail.risk_level || 'unknown',
      }
    }
  }
  return map
}

function getToolRiskLabel(meta?: { annotations?: ToolAnnotationHints | null; riskLevel?: string }): string {
  const ann = meta?.annotations
  const riskLevel = meta?.riskLevel || 'unknown'

  if (ann?.destructiveHint || riskLevel === 'destructive') return '高风险'
  if (ann?.readOnlyHint || riskLevel === 'read_only') return '只读'
  if (ann?.openWorldHint || riskLevel === 'open_world') return '外部'
  if (ann?.idempotentHint || riskLevel === 'idempotent') return '幂等'
  return '未标注'
}

// ── Data ──

const QUICK_PROMPTS: { icon: LucideIcon; label: string; text: string }[] = [
  { icon: Compass, label: '导览', text: '简要介绍一下这个平台的核心功能' },
  { icon: Target, label: '职业', text: '目前 AI 领域有哪些值得关注的职业方向' },
  { icon: Brain, label: 'MBTI', text: '简单说明 MBTI 性格测试的原理和用途' },
  { icon: BarChart3, label: '概览', text: '展示平台的整体数据概览' },
]

const SKILLS: { name: string; desc: string; icon: LucideIcon }[] = [
  { name: 'career-exploration', desc: '画像 → MBTI → 职业匹配', icon: Target },
  { name: 'learning-diagnosis', desc: '进度分析 → 个性化建议', icon: BarChart3 },
  { name: 'homepage-tour', desc: '平台功能互动展示', icon: Rocket },
]

const MCP_TOOLS = [
  { category: '学生', tools: ['get_student_profile', 'get_learning_history'] },
  { category: 'MBTI', tools: ['get_mbti_type_info', 'get_quick_mbti_insight'] },
  { category: '职业', tools: ['search_careers', 'get_trending_careers'] },
  { category: '文档', tools: ['search_documents', 'unified_search'] },
  { category: '图谱', tools: ['query_knowledge_graph', 'emit_graph_command', 'emit_graph_batch', 'get_learning_path'] },
  { category: '笔记', tools: ['search_notes', 'create_note', 'get_note_graph'] },
  { category: '主页', tools: ['get_platform_stats', 'get_featured_experiments', 'emit_ui_command', 'navigate_page', 'show_toast', 'scroll_to_section', 'set_theme'] },
]

const HIDDEN_ROUTES = ['/login', '/mbti-test']

const COMMAND_CENTER_CORE_TOOLS = [
  'delegate_to_agent',
  'delegate_batch_agents',
  'navigate_page',
  'show_toast',
  'emit_ui_command',
  'scroll_to_section',
  'set_theme',
  'list_registered_agents',
  'list_registered_tool_packages',
  'get_runtime_observability',
]

// ── Helpers ──

function glass(isDark: boolean, level: 'light' | 'medium' | 'strong' = 'medium') {
  const blurMap = { light: 'blur(12px)', medium: 'blur(20px)', strong: 'blur(30px)' }
  const bgDark = { light: 'rgba(15,15,25,0.6)', medium: 'rgba(15,15,25,0.75)', strong: 'rgba(15,15,25,0.85)' }
  const bgLight = { light: 'rgba(255,255,255,0.55)', medium: 'rgba(255,255,255,0.7)', strong: 'rgba(255,255,255,0.82)' }
  return {
    background: isDark ? bgDark[level] : bgLight[level],
    backdropFilter: blurMap[level],
    WebkitBackdropFilter: blurMap[level],
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.6)'}`,
    boxShadow: isDark
      ? '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)'
      : '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
  }
}

function getAgentForRoute(pathname: string): string {
  if (pathname === '/') return 'homepage-guide'
  return 'command-center'
}

function cleanContent(text: string) {
  return text.replace(/\{[^{}]*"ui_command"\s*:\s*true[^{}]*\}/g, '').trim()
}

const ACCENT = '#c9a87c'

const springTransition = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 28,
  mass: 0.8,
}

interface ToastItem {
  id: number
  message: string
  level: 'info' | 'success' | 'warning'
}

interface GraphCommandResultPayload {
  command?: string
  target?: string
  status?: 'success' | 'ignored' | 'error'
  message?: string
}

interface GraphBatchResultPayload {
  batchId?: string
  status?: 'success' | 'partial' | 'failed'
  completed?: number
  total?: number
  message?: string
}

type TraceLevel = 'info' | 'success' | 'warning'

interface LiveTraceItem {
  id: number
  title: string
  detail?: string
  level: TraceLevel
}

function summarizeOrchestratorStage(stage: string): string {
  if (stage === 'planned') return '已完成任务规划'
  if (stage === 'worker_start') return '执行子任务中'
  if (stage === 'worker_done') return '子任务已返回结果'
  if (stage === 'worker_retry') return '子任务重试中'
  if (stage === 'worker_failed') return '子任务失败'
  if (stage === 'critique') return '正在自检答案质量'
  if (stage === 'replan') return '正在重规划执行路径'
  if (stage === 'completed') return '编排执行完成'
  return `编排阶段: ${stage}`
}

function shouldUseLiteRuntime(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  if (!normalized) return false
  const greetingOnly = /^(hi|hello|hey|你好|您好|在吗|在不在|早上好|中午好|下午好|晚上好|嗨)$/i
  const shortSmallTalk = /^(介绍下|介绍一下|你是谁|你能做什么|help|帮助|怎么用|使用说明)$/i
  return (
    (normalized.length <= 12 && greetingOnly.test(normalized))
    || (normalized.length <= 20 && shortSmallTalk.test(normalized))
  )
}

function looksLikeNoteEditIntent(message: string): boolean {
  const text = (message || '').trim().toLowerCase()
  if (!text) return false
  return /(笔记|note|notes?|biji).*(新建|创建|新增|写一篇|写个|补充|修改|改写|重写|替换|更新|润色|扩写|续写|完善)|\b(create|new|add|edit|revise|rewrite|update|append|replace)\b.*\b(note|notes|biji)\b/i.test(text)
}

// Page label patterns that are distinctive enough to imply navigation without a verb
const PAGE_LABELS: [RegExp, string][] = [
  [/(pdf工作台|文档实验区|文档实验)/i, '/documents'],
  [/(学习路径|learning\s*-?\s*path)/i, '/learning-path'],
  [/(知识图谱)/i, '/graph'],
  [/(ai顾问|ai advisor)/i, '/ai-advisor'],
]

function resolveNavigationIntentRoute(message: string): string | null {
  const text = (message || '').trim()
  if (!text) return null

  // Distinctive page-label match works without any navigation verb
  for (const [pattern, route] of PAGE_LABELS) {
    if (pattern.test(text)) return route
  }

  // Broader verb list: includes common Chinese navigation + query verbs
  const hasNavigateVerb = /(跳转|带我去|带我到|带我看|去看|去到|想去|要去|进去|进入|打开|前往|查看|去|进|到|帮我看|帮我去|show me|go to|open|navigate|take me)/i.test(text)
  if (!hasNavigateVerb) return null

  if (/(pdf|文档|documents?)/i.test(text)) return '/documents'
  if (/(实验管理|实验页|experiments?)/i.test(text)) return '/experiments'
  if (/(职业推荐|职业页|careers?)/i.test(text)) return '/careers'
  if (/(学习路径|learning\s*-?\s*path)/i.test(text)) return '/learning-path'
  if (/(知识图谱|graph)/i.test(text)) return '/graph'
  if (/(笔记|notes\s*页?)/i.test(text)) return '/notes'
  if (/(学生画像|个人画像|profile)/i.test(text)) return '/profile'
  if (/(mbti|性格测试)/i.test(text)) return '/mbti-test'
  if (/(ai顾问|advisor)/i.test(text)) return '/ai-advisor'
  if (/(首页|仪表盘|home|dashboard)/i.test(text)) return '/dashboard'

  return null
}

// ── Component ──

export default function FloatingAgent() {
  const [mode, setMode] = useState<AgentMode>('pill')
  const [input, setInput] = useState('')
  const [showOutput, setShowOutput] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [toolTab, setToolTab] = useState<'skills' | 'mcp'>('skills')
  const [floatSize, setFloatSize] = useState({ w: 400, h: 500 })
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [currentTool, setCurrentTool] = useState<string | null>(null)
  const [toolMetaMap, setToolMetaMap] = useState<ToolMetaMap>({})
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('balanced')
  const [runtimeMeta, setRuntimeMeta] = useState<{ engine: string; model: string; mode: string } | null>(null)
  const [liveTrace, setLiveTrace] = useState<LiveTraceItem[]>([])
  const [traceByMessage, setTraceByMessage] = useState<Record<string, LiveTraceItem[]>>({})
  const [traceExpandedByMessage, setTraceExpandedByMessage] = useState<Record<string, boolean>>({})

  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const navigate = useNavigate()
  const location = useLocation()
  const shouldHide = HIDDEN_ROUTES.some(
    (route) => location.pathname === route || location.pathname.startsWith(`${route}/`)
  )
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null)
  const streamStartedAtRef = useRef<number | null>(null)
  const activeTraceMessageIdRef = useRef<string | null>(null)
  const wasStreamingRef = useRef(false)

  const { effects, addEffect, clearAll } = useUICommands()

  const pushTrace = useCallback((item: Omit<LiveTraceItem, 'id'>) => {
    setLiveTrace((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.title === item.title && last.detail === item.detail && last.level === item.level) {
        return prev
      }
      const next = [...prev, { ...item, id: Date.now() + Math.floor(Math.random() * 1000) }]
      if (next.length > 14) return next.slice(next.length - 14)
      return next
    })
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<GraphCommandResultPayload>).detail
      if (!detail) return
      if (detail.status === 'success') return

      const id = Date.now()
      const title = detail.status === 'error' ? '图谱命令失败' : '图谱命令未执行'
      const message = detail.message || `${detail.command || 'graph_command'} 未产生有效结果`
      setToasts(prev => [...prev, { id, message: `${title}: ${message}`, level: 'warning' }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500)
    }

    window.addEventListener('pathmind:graph-command-result', handler)
    return () => window.removeEventListener('pathmind:graph-command-result', handler)
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<GraphBatchResultPayload>).detail
      if (!detail) return
      const id = Date.now()
      const status = detail.status || 'partial'
      const level = status === 'failed' ? 'warning' : 'info'
      const message = detail.message
        || `批次 ${detail.batchId || '-'}：${detail.completed || 0}/${detail.total || 0}`
      setToasts(prev => [...prev, { id, message: `图谱批次 ${status}: ${message}`, level }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500)
    }

    window.addEventListener('pathmind:graph-batch-result', handler)
    return () => window.removeEventListener('pathmind:graph-batch-result', handler)
  }, [])

  const streamCallbacks = useMemo<AgentStreamCallbacks>(() => ({
    onMeta: (meta) => {
      setRuntimeMeta({ engine: meta.engine, model: meta.model, mode: meta.mode })
      pushTrace({ title: `模型已连接: ${meta.model || 'default'}`, detail: `${meta.engine} · ${meta.mode}`, level: 'info' })
    },
    onUICommand: (cmd) => {
      // Handle focus_note_panel command
      if (cmd.command === 'focus_note_panel') {
        window.dispatchEvent(new CustomEvent('pathmind:focus-note-panel', { detail: cmd }))
        return
      }

      addEffect({
        ui_command: true,
        command: cmd.command as UICommand['command'],
        target: cmd.target,
        params: cmd.params,
      })
    },
    onNavigate: (nav) => { navigate(nav.to) },
    onToast: (toast) => {
      const id = Date.now()
      setToasts(prev => [...prev, { id, message: toast.message, level: toast.level }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
    },
    onScrollTo: (scroll) => {
      document.querySelector(`[data-section-id="${scroll.target}"]`)
        ?.scrollIntoView({ behavior: 'smooth' })
    },
    onSetTheme: (t) => {
      if (t.theme !== theme) toggleTheme()
    },
    onGraphCommand: (event) => {
      if (!event.command) return
      window.dispatchEvent(new CustomEvent('pathmind:graph-command', { detail: event }))
    },
    onGraphBatch: (event) => {
      if (!event.steps || event.steps.length === 0) return
      window.dispatchEvent(new CustomEvent('pathmind:graph-command-batch', { detail: event }))
    },
    onToolCall: (call) => {
      setCurrentTool(call.tool)
      setTimeout(() => setCurrentTool(null), 3000)
      pushTrace({
        title: `工具 ${call.status}: ${call.tool}`,
        detail: call.reason || call.stage,
        level: call.status === 'error' ? 'warning' : 'info',
      })
    },
    onOrchestrator: (event) => {
      const base = summarizeOrchestratorStage(event.stage)
      const detail = event.title || event.reason || event.model
      pushTrace({
        title: base,
        detail,
        level: event.success === false || event.status === 'failed' ? 'warning' : 'info',
      })
    },
    onModelFallback: (event) => {
      // Cascade to next model — show a brief non-intrusive indicator
      setCurrentTool(`切换至 ${event.toModel.replace('claude-', '')}`)
      setTimeout(() => setCurrentTool(null), 2500)
      pushTrace({ title: '模型降级已触发', detail: `${event.fromModel} -> ${event.toModel}`, level: 'warning' })
    },
    onDone: (event) => {
      const elapsedMs = streamStartedAtRef.current ? Date.now() - streamStartedAtRef.current : null
      const elapsed = elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : undefined
      pushTrace({
        title: '响应已完成',
        detail: [event.stopReason, elapsed].filter(Boolean).join(' · ') || 'done',
        level: event.stopReason === 'end_turn' ? 'success' : 'info',
      })

      if (event.stopReason === 'idle_timeout') {
        const id = Date.now()
        setToasts(prev => [...prev, {
          id,
          message: 'Claude 流式响应空闲超时，可能停在 tool_use 分支。',
          level: 'warning',
        }])
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
        return
      }

      if (event.stopReason === 'tool_use_pending') {
        const id = Date.now()
        setToasts(prev => [...prev, {
          id,
          message: '当前回合进入 tool_use，尚未形成 tool_result 闭环。',
          level: 'warning',
        }])
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
      }
    },
  }), [addEffect, navigate, pushTrace, theme, toggleTheme])

  const { messages, isStreaming, sendMessage, stop, clearMessages } = useAgentStream(streamCallbacks)
  const { removeSession } = useAgentSession()

  const agentName = getAgentForRoute(location.pathname)
  const agentSessionKey = `${agentName}:nav-v2`
  const isPublic = location.pathname === '/'
  const studentId = localStorage.getItem('studentId') || undefined

  const dispatchAgentMessage = useCallback((
    msg: string,
    handoffContext: Record<string, unknown> | undefined,
    useLiteRuntime = false,
  ) => {
    const shouldUseFastRuntime = useLiteRuntime || isPublic
    const shouldEnableOrchestrator = !shouldUseFastRuntime && runtimeMode === 'deep'
    sendMessage(msg, {
      agentName,
      sessionKey: agentSessionKey,
      public: isPublic,
      studentId,
      tenant: studentId
        ? {
            tenantId: `student:${studentId}`,
            studentId,
          }
        : undefined,
      runtime: shouldUseFastRuntime
        ? {
            mode: 'fast',
            engine: 'claude',
            modelTier: 'sonnet',
            toolAllowlist: COMMAND_CENTER_CORE_TOOLS,
            orchestrator: { enabled: false },
          }
        : {
            mode: runtimeMode,
            engine: 'claude',
            modelTier: 'sonnet',
            toolAllowlist: COMMAND_CENTER_CORE_TOOLS,
            orchestrator: {
              enabled: shouldEnableOrchestrator,
              profile: 'webagent_v1',
              plannerMode: shouldEnableOrchestrator ? 'deep' : 'balanced',
              executorMode: runtimeMode,
              maxSteps: shouldEnableOrchestrator ? 8 : 3,
              maxWorkers: shouldEnableOrchestrator ? 4 : 1,
            },
          },
      context: handoffContext,
    })
  }, [agentName, agentSessionKey, isPublic, runtimeMode, sendMessage, studentId])


  useEffect(() => {
    if (shouldHide) {
      setToolMetaMap({})
      return
    }

    let cancelled = false

    const loadToolMetadata = async () => {
      try {
        const catalog = isPublic ? await agentApi.publicTools() : await agentApi.tools()
        if (!cancelled) setToolMetaMap(buildToolMetaMap(catalog))
      } catch {
        if (!cancelled) setToolMetaMap({})
      }
    }

    void loadToolMetadata()
    return () => {
      cancelled = true
    }
  }, [isPublic, shouldHide])

  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      streamStartedAtRef.current = Date.now()

      const latestAssistant = [...messages].reverse().find((item) => item.role === 'assistant')
      const messageId = latestAssistant?.id || null
      activeTraceMessageIdRef.current = messageId

      if (messageId) {
        setTraceByMessage((prev) => ({ ...prev, [messageId]: [] }))
        setTraceExpandedByMessage((prev) => ({ ...prev, [messageId]: false }))
      }

      setLiveTrace([])
      pushTrace({ title: '已建立流式连接', detail: '正在生成回答', level: 'info' })
    }

    if (!isStreaming && wasStreamingRef.current) {
      const messageId = activeTraceMessageIdRef.current
      if (messageId) {
        setTraceExpandedByMessage((prev) => ({ ...prev, [messageId]: false }))
      }
    }

    wasStreamingRef.current = isStreaming
  }, [isStreaming, messages, pushTrace])

  useEffect(() => {
    const messageId = activeTraceMessageIdRef.current
    if (!messageId) return
    setTraceByMessage((prev) => ({ ...prev, [messageId]: liveTrace }))
  }, [liveTrace])

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (messages.length > 0) setShowOutput(true)
  }, [messages])

  // Focus input when switching to bar or float
  useEffect(() => {
    if (mode === 'bar' || mode === 'float') setTimeout(() => inputRef.current?.focus(), 100)
  }, [mode])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setMode(prev => prev === 'pill' ? 'float' : 'pill')
      }
      if (e.key === 'Escape') {
        setMode('pill')
        setShowTools(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Resize handlers for float mode
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: floatSize.w, startH: floatSize.h }

    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return
      const dw = ev.clientX - resizeRef.current.startX
      const dh = ev.clientY - resizeRef.current.startY
      setFloatSize({
        w: Math.min(600, Math.max(320, resizeRef.current.startW + dw)),
        h: Math.min(700, Math.max(400, resizeRef.current.startH + dh)),
      })
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [floatSize])

  const handleSend = useCallback((text?: string) => {
    const msg = text || input.trim()
    if (!msg) return
    setInput('')
    setShowTools(false)

    const directRoute = resolveNavigationIntentRoute(msg)
    if (directRoute && location.pathname !== directRoute) {
      navigate(directRoute)
      const navId = Date.now()
      setToasts(prev => [...prev, { id: navId, message: `已跳转 → ${directRoute}`, level: 'success' }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== navId)), 3000)
    }

    const isNoteIntent = looksLikeNoteEditIntent(msg)
    const willBeOnNotes = location.pathname.startsWith('/notes') || directRoute?.startsWith('/notes')
    if (isNoteIntent && willBeOnNotes) {
      const dispatchNoteRequest = () => {
        window.dispatchEvent(new CustomEvent('pathmind:notes-agent-request', {
          detail: {
            prompt: msg,
            source: 'floating-agent',
            ts: Date.now(),
          },
        }))
      }

      if (directRoute?.startsWith('/notes') && !location.pathname.startsWith('/notes')) {
        // Allow Notes page listener to mount after route change.
        window.setTimeout(dispatchNoteRequest, 180)
      } else {
        dispatchNoteRequest()
      }

      pushTrace({ title: '已转交笔记侧栏 Agent', detail: '将在右侧面板生成可确认的差异预览', level: 'success' })
      const id = Date.now()
      setToasts(prev => [...prev, {
        id,
        message: '已转交到笔记侧栏 Agent：请在右侧确认红绿差异后应用。',
        level: 'info',
      }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500)
      return
    }

    const noteMemories = location.pathname.startsWith('/notes')
      ? getLatestAgentMemories(3, 'notes')
      : []
    const handoffContext = noteMemories.length > 0
      ? {
          recent_note_agent_memory: noteMemories.map((item) => ({
            note_id: item.noteId,
            note_title: item.noteTitle,
            summary: item.summary,
            tools: item.tools || [],
            created_at: item.createdAt,
          })),
        }
      : undefined

    const lite = shouldUseLiteRuntime(msg)
    if (lite) {
      pushTrace({ title: '快速直答路径', detail: '跳过重编排以降低首字延迟', level: 'info' })
    }

    dispatchAgentMessage(
      msg,
      handoffContext as Record<string, unknown> | undefined,
      lite,
    )
  }, [dispatchAgentMessage, input, location.pathname, navigate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  const handleClear = useCallback(() => {
    removeSession(agentSessionKey)
    clearMessages()
    clearAll()
    setShowOutput(false)
    setRuntimeMeta(null)
    setLiveTrace([])
    setTraceByMessage({})
    setTraceExpandedByMessage({})
    activeTraceMessageIdRef.current = null
  }, [agentSessionKey, clearMessages, clearAll, removeSession])

  // Hide on certain routes
  if (shouldHide) return null

  const textMuted = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'
  const textPrimary = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)'
  const g = glass(isDark, 'medium')
  const gStrong = glass(isDark, 'strong')
  const activeMode = runtimeMeta?.mode || runtimeMode
  const runtimeBadge = runtimeMeta
    ? `${runtimeMeta.engine} · ${runtimeMeta.model || 'default'}`
    : '等待路由'

  const renderTraceForMessage = (messageId: string) => {
    const traceItems = traceByMessage[messageId] || []
    if (traceItems.length === 0) return null

    const traceExpanded = Boolean(traceExpandedByMessage[messageId])
    const latest = traceItems[traceItems.length - 1]
    const collapsedItems = traceItems.slice(-2)

    return (
      <div className="mt-2 rounded-lg px-2.5 py-2"
        style={{
          background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}`,
        }}
      >
        <div
          className="text-sm"
          style={{ color: textPrimary }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <motion.div
                animate={isStreaming ? { rotate: 360 } : { rotate: 0 }}
                transition={isStreaming ? { duration: 1.2, repeat: Infinity, ease: 'linear' } : { duration: 0.2 }}
              >
                <LoaderCircle size={13} style={{ color: ACCENT }} />
              </motion.div>
              <span className="text-[11px] font-medium" style={{ color: textPrimary }}>思考与工具轨迹</span>
            </div>
            <button
              onClick={() => {
                setTraceExpandedByMessage((prev) => ({
                  ...prev,
                  [messageId]: !traceExpanded,
                }))
              }}
              className="p-1 rounded-md transition-colors hover:bg-white/10 cursor-pointer"
              style={{ color: textMuted }}
              title={traceExpanded ? '收起明细' : '展开明细'}
            >
              {traceExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {traceExpanded ? (
              <motion.div
                key="trace-expanded"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-2 space-y-1.5"
              >
                {traceItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 text-[11px]">
                    <ListTree size={12} style={{ color: item.level === 'warning' ? '#f59e0b' : ACCENT, marginTop: 2, flexShrink: 0 }} />
                    <div className="min-w-0">
                      <div style={{ color: textPrimary }}>{item.title}</div>
                      {item.detail && <div className="truncate" style={{ color: textMuted }}>{item.detail}</div>}
                    </div>
                  </div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="trace-collapsed"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="mt-2 space-y-1 text-[11px]"
                style={{ color: textMuted }}
              >
                {collapsedItems.map((item) => (
                  <div key={item.id} className="truncate">
                    {item.title}{item.detail ? ` · ${item.detail}` : ''}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {!traceExpanded && collapsedItems.length === 0 && (
            <div className="mt-2 text-[11px]" style={{ color: textMuted }}>
              {latest.title}{latest.detail ? ` · ${latest.detail}` : ''}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Messages renderer (shared between bar output & float) ──
  const renderMessages = (maxH: string) => (
    <div className={`${maxH} overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin`}>
      {messages.map(msg => (
        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm"
            style={
              msg.role === 'user'
                ? { background: `linear-gradient(135deg, ${ACCENT}, #a68a5b)`, color: 'white', borderBottomRightRadius: 4 }
                : {
                    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                    color: textPrimary,
                    borderBottomLeftRadius: 4,
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}`,
                  }
            }
          >
            {msg.role === 'assistant' ? (
              <>
                {renderTraceForMessage(msg.id)}
                <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:m-0 [&>p+p]:mt-1.5">
                  <ReactMarkdown>{cleanContent(msg.content) || (isStreaming ? '' : '')}</ReactMarkdown>
                </div>
              </>
            ) : msg.content}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  )

  // ── Input bar (shared between bar & float) ──
  const renderInput = () => (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {MODE_OPTIONS.map(option => (
            <button
              key={option.value}
              onClick={() => setRuntimeMode(option.value)}
              disabled={isStreaming}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all disabled:opacity-50"
              style={{
                color: activeMode === option.value ? 'white' : textMuted,
                background: activeMode === option.value
                  ? `linear-gradient(135deg, ${ACCENT}, #a68a5b)`
                  : 'transparent',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-[10px]" style={{ color: textMuted }}>
          {runtimeBadge}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Bot size={18} style={{ color: ACCENT, flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题..."
          disabled={isStreaming}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: textPrimary }}
        />
        <div className="flex items-center gap-1.5">
          {isStreaming ? (
            <button onClick={stop} className="p-1.5 rounded-lg transition-colors cursor-pointer" style={{ color: '#ef4444' }}>
              <StopCircle size={18} />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="p-1.5 rounded-lg transition-all disabled:opacity-30 cursor-pointer"
              style={{ color: ACCENT }}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )

  // ── Tool panel (shared) ──
  const renderToolPanel = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 10 }}
      transition={{ type: 'spring', damping: 25, stiffness: 350 }}
      className="w-72 rounded-2xl overflow-hidden"
      style={gStrong}
    >
      <div className="flex" style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
        {(['skills', 'mcp'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setToolTab(tab)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors cursor-pointer"
            style={{ color: toolTab === tab ? ACCENT : textMuted, borderBottom: toolTab === tab ? `2px solid ${ACCENT}` : '2px solid transparent' }}
          >
            {tab === 'skills' ? <Zap size={12} /> : <Wrench size={12} />}
            {tab === 'skills' ? 'Skills' : 'MCP Tools'}
          </button>
        ))}
      </div>
      <div className="p-3 max-h-64 overflow-y-auto scrollbar-thin">
        {toolTab === 'skills' ? (
          <div className="space-y-1.5">
            {SKILLS.map(s => (
              <button
                key={s.name}
                onClick={() => { handleSend(`运行 ${s.name} skill`); setShowTools(false) }}
                className="w-full text-left rounded-xl px-3 py-2.5 transition-all hover:scale-[1.02] cursor-pointer"
                style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}` }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: isDark ? 'rgba(201,168,124,0.15)' : 'rgba(201,168,124,0.1)' }}>
                    <s.icon size={16} style={{ color: ACCENT }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold tracking-wide" style={{ color: textPrimary }}>{s.name}</div>
                    <div className="text-[11px] mt-0.5 opacity-60" style={{ color: textPrimary }}>{s.desc}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {MCP_TOOLS.map(group => (
              <div key={group.category}>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-2 px-1" style={{ color: ACCENT }}>{group.category}</div>
                <div className="flex flex-wrap gap-1.5">
                  {group.tools.map(tool => {
                    const meta = toolMetaMap[tool]
                    const riskLabel = getToolRiskLabel(meta)
                    const isDanger = riskLabel === '高风险'
                    const isSafe = riskLabel === '只读'
                    const isExternal = riskLabel === '外部'
                    const isIdempotent = riskLabel === '幂等'

                    return (
                      <div key={tool} className="px-2 py-1 rounded-lg text-[10px] border flex items-center gap-1.5"
                        style={{ background: isDark ? 'rgba(201,168,124,0.1)' : 'rgba(201,168,124,0.06)', color: isDark ? 'rgba(201,168,124,0.9)' : ACCENT, borderColor: isDark ? 'rgba(201,168,124,0.15)' : 'rgba(201,168,124,0.12)' }}
                      >
                        <span className="font-mono leading-none">{tool}</span>
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] leading-none"
                          style={{
                            color: isDanger
                              ? '#ef4444'
                              : isSafe
                                ? '#22c55e'
                                : isExternal
                                  ? '#f59e0b'
                                  : isIdempotent
                                    ? '#3b82f6'
                                    : textMuted,
                            background: isDanger
                              ? 'rgba(239,68,68,0.14)'
                              : isSafe
                                ? 'rgba(34,197,94,0.14)'
                                : isExternal
                                  ? 'rgba(245,158,11,0.14)'
                                  : isIdempotent
                                    ? 'rgba(59,130,246,0.14)'
                                    : isDark
                                      ? 'rgba(255,255,255,0.08)'
                                      : 'rgba(0,0,0,0.06)',
                          }}
                        >
                          {riskLabel}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )

  return (
    <>
      <UIEffectLayer effects={effects} />

      <AnimatePresence mode="wait">
        {/* ── Pill Mode ── */}
        {mode === 'pill' && (
          <motion.div
            key="pill"
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={springTransition}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => setMode('bar')}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 cursor-pointer z-[9990] select-none"
            style={{
              background: isDark ? 'rgba(20,20,20,0.9)' : 'rgba(0,0,0,0.85)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderRadius: 24,
              padding: '10px 20px',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <motion.div
                animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: isStreaming ? 1 : 2, repeat: Infinity }}
                className="w-2 h-2 rounded-full"
                style={{ background: isStreaming ? '#f59e0b' : ACCENT }}
              />
              <span className="text-xs text-white/80 font-medium whitespace-nowrap">
                {isStreaming ? (currentTool ? `calling ${currentTool}` : 'thinking') : 'PathMind'}
              </span>
              {messages.length > 0 && (
                <span className="text-[10px] text-white/40 ml-1">
                  {messages.length} msgs
                </span>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Bar Mode ── */}
        {mode === 'bar' && (
          <motion.div
            key="bar"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={springTransition}
            className="fixed bottom-0 left-0 right-0 z-[9990] flex justify-center pointer-events-none pb-5 px-4"
          >
            <div className="w-full max-w-2xl pointer-events-auto flex gap-3 items-end">
              <div className="flex-1 flex flex-col gap-2">
                {/* Output panel */}
                <AnimatePresence>
                  {showOutput && messages.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: 'auto' }}
                      exit={{ opacity: 0, y: 20, height: 0 }}
                      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                      className="rounded-2xl overflow-hidden"
                      style={gStrong}
                    >
                      <div className="flex items-center justify-between px-4 py-2.5"
                        style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: ACCENT }} />
                          <span className="text-xs font-medium" style={{ color: textMuted }}>{agentName}</span>
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                            style={{
                              color: textPrimary,
                              background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                            }}
                          >
                            {activeMode} · {runtimeBadge}
                          </span>
                          {isStreaming && (
                            <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }}
                              className="text-xs" style={{ color: ACCENT }}>thinking</motion.span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={handleClear} className="text-xs px-2 py-0.5 rounded-md transition-colors hover:bg-white/10 cursor-pointer" style={{ color: textMuted }}>清空</button>
                          <button onClick={() => setMode('float')} className="p-1 rounded-md transition-colors hover:bg-white/10 cursor-pointer" style={{ color: textMuted }} title="浮动面板">
                            <ChevronUp size={14} />
                          </button>
                          <button onClick={() => setShowOutput(false)} className="p-1 rounded-md transition-colors hover:bg-white/10 cursor-pointer" style={{ color: textMuted }}>
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      </div>
                      {renderMessages('max-h-80')}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Quick prompts */}
                <AnimatePresence>
                  {messages.length === 0 && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                      className="flex gap-2 justify-center flex-wrap">
                      {QUICK_PROMPTS.map(p => (
                        <button key={p.label} onClick={() => handleSend(p.text)}
                          className="px-3 py-1.5 rounded-full text-xs transition-all hover:scale-105 flex items-center gap-1.5 cursor-pointer"
                          style={{ ...glass(isDark, 'light'), color: textPrimary }}>
                          <p.icon size={12} style={{ color: ACCENT }} />
                          {p.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Input bar */}
                <motion.div layout className="rounded-2xl" style={g}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMode('pill')}
                      className="ml-3 p-1.5 rounded-lg transition-colors hover:bg-white/10 cursor-pointer"
                      style={{ color: textMuted }} title="收起 (Esc)">
                      <Minimize2 size={14} />
                    </button>
                    <div className="flex-1">{renderInput()}</div>
                  </div>
                </motion.div>
              </div>

              {/* Side tool button + panel */}
              <div className="flex flex-col items-center gap-2 mb-1">
                <AnimatePresence>{showTools && renderToolPanel()}</AnimatePresence>
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}
                  onClick={() => setShowTools(!showTools)}
                  className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors cursor-pointer"
                  style={{ ...glass(isDark, 'medium'), color: showTools ? ACCENT : textMuted }}>
                  <Sparkles size={18} />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Float Mode ── */}
        {mode === 'float' && (
          <motion.div
            key="float"
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            transition={springTransition}
            drag
            dragMomentum={false}
            dragElastic={0.1}
            className="fixed z-[9990] rounded-2xl overflow-hidden flex flex-col"
            style={{
              ...gStrong,
              width: floatSize.w,
              height: floatSize.h,
              right: 24,
              bottom: 24,
            }}
          >
            {/* Title bar (drag handle) */}
            <div className="flex items-center justify-between px-4 py-2.5 cursor-grab active:cursor-grabbing shrink-0"
              style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: ACCENT }} />
                <span className="text-xs font-medium" style={{ color: textMuted }}>{agentName}</span>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={{
                    color: textPrimary,
                    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  }}
                >
                  {activeMode} · {runtimeBadge}
                </span>
                {isStreaming && (
                  <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }}
                    className="text-xs" style={{ color: ACCENT }}>streaming...</motion.span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={handleClear} className="text-xs px-2 py-0.5 rounded-md transition-colors hover:bg-white/10 cursor-pointer" style={{ color: textMuted }}>清空</button>
                <button onClick={() => setMode('bar')} className="p-1 rounded-md transition-colors hover:bg-white/10 cursor-pointer" style={{ color: textMuted }} title="收回底栏">
                  <Minimize2 size={14} />
                </button>
                <button onClick={() => setMode('pill')} className="p-1 rounded-md transition-colors hover:bg-white/10 cursor-pointer" style={{ color: textMuted }} title="收为胶囊">
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-hidden">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
                  <Bot size={32} style={{ color: textMuted, opacity: 0.5 }} />
                  <p className="text-sm text-center" style={{ color: textMuted }}>有什么可以帮你的</p>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {QUICK_PROMPTS.map(p => (
                      <button key={p.label} onClick={() => handleSend(p.text)}
                        className="px-3 py-1.5 rounded-full text-xs transition-all hover:scale-105 flex items-center gap-1.5 cursor-pointer"
                        style={{ ...glass(isDark, 'light'), color: textPrimary }}>
                        <p.icon size={12} style={{ color: ACCENT }} />
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : renderMessages('h-full')}
            </div>

            {/* Bottom input */}
            <div className="shrink-0" style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
              {renderInput()}
            </div>

            {/* Resize handle */}
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-30 hover:opacity-60 transition-opacity"
              onPointerDown={handleResizeStart}
              style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(128,128,128,0.5) 50%)' }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Toast Stack ── */}
      <AnimatePresence>
        {toasts.map((toast, i) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="fixed left-1/2 z-[9999] px-4 py-2.5 rounded-xl text-sm font-medium pointer-events-none"
            style={{
              top: 24 + i * 52,
              ...glass(isDark, 'strong'),
              color: toast.level === 'warning' ? '#f59e0b' : toast.level === 'success' ? '#22c55e' : textPrimary,
              borderLeft: `3px solid ${toast.level === 'warning' ? '#f59e0b' : toast.level === 'success' ? '#22c55e' : ACCENT}`,
            }}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </>
  )
}
