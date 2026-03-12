/**
 * Graph Page - 专业液态玻璃设计
 * 
 * 特点：
 * - 与 Dashboard 统一的专业配色
 * - 液态玻璃效果
 * - 嵌入式设计，不跳转新页面
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import KnowledgeGraph from '../components/KnowledgeGraph'
import type { GraphCommandExecutionResult } from '../components/KnowledgeGraph'
import { useNavigate } from 'react-router-dom'
import { GlassCard } from '../components/ui'
import { useAgentSession } from '../contexts/AgentSessionContext'
import { agentApi, type GraphBatchFeedbackHistoryItem, type GraphCommandFeedbackHistoryItem } from '../services/api'
import { primary } from '../theme/colors'
import { Globe, User, Brain, Briefcase, Zap, BookOpen, Route, Undo2, CheckCircle2, AlertTriangle, RefreshCw, Download, Copy } from 'lucide-react'
import type { GraphCommandEvent, GraphBatchEvent } from '../hooks/useAgentStream'

type GraphMode = 'full' | 'student' | 'career'

interface GraphNode {
  id: string
  name: string
  type: string
  description?: string
  color?: string
}

interface ActiveGraphCommand extends GraphCommandEvent {
  issuedAt: number
}

interface GraphCommandHistoryItem extends GraphCommandExecutionResult {
  id: string
}

type TimelineStatusFilter = 'all' | 'success' | 'ignored' | 'error'
type GraphBatchMode = 'best_effort' | 'all_or_nothing'
type GraphBatchPhase = 'forward' | 'rollback'
type ReplayPhaseFilter = 'forward' | 'rollback' | 'all'
const BATCH_PAGE_SIZE = 8
const BATCH_DETAIL_ACK_LIMIT = 260

interface GraphBatchMeta {
  batch_id: string
  step_index: number
  total_steps: number
  mode: GraphBatchMode
  phase: GraphBatchPhase
}

interface GraphBatchState {
  batchId: string
  mode: GraphBatchMode
  steps: GraphCommandEvent[]
  phase: GraphBatchPhase
  startedAt: number
  index: number
  forwardResults: GraphCommandExecutionResult[]
  rollbackSteps: GraphCommandEvent[]
  rollbackResults: GraphCommandExecutionResult[]
  failureMessage?: string
}

interface GraphBatchReceipt {
  batchId: string
  mode: GraphBatchMode
  status: 'running' | 'success' | 'partial' | 'failed'
  completed: number
  total: number
  message: string
  rolledBack?: number
  rollbackFailed?: number
}

interface GraphBatchStepDetail {
  id: string
  phase: GraphBatchPhase
  stepIndex: number
  command: string
  target?: string
  status: 'success' | 'ignored' | 'error'
  message: string
  executedAt: number
  params?: Record<string, unknown>
}

interface GraphBatchAckEntry {
  item: GraphCommandHistoryItem
  meta: GraphBatchMeta
}

function escapeCsvValue(value: unknown): string {
  const normalized = String(value ?? '')
  if (normalized.includes(',') || normalized.includes('"') || normalized.includes('\n')) {
    return `"${normalized.replace(/"/g, '""')}"`
  }
  return normalized
}

function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value ?? '')
  }
}

async function copyToClipboard(content: string): Promise<boolean> {
  if (!content) return false
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(content)
      return true
    }
  } catch {
    // fallback below
  }

  try {
    const textArea = document.createElement('textarea')
    textArea.value = content
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textArea)
    return ok
  } catch {
    return false
  }
}

export default function GraphPage() {
  const navigate = useNavigate()
  const { getSession } = useAgentSession()
  const [mode, setMode] = useState<GraphMode>('full')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [activeCommand, setActiveCommand] = useState<ActiveGraphCommand | null>(null)
  const [commandHistory, setCommandHistory] = useState<GraphCommandHistoryItem[]>([])
  const [serverHistory, setServerHistory] = useState<GraphCommandHistoryItem[]>([])
  const [batchHistory, setBatchHistory] = useState<GraphBatchFeedbackHistoryItem[]>([])
  const [batchHistorySource, setBatchHistorySource] = useState<'postgres' | 'redis' | null>(null)
  const [batchNextBeforeTs, setBatchNextBeforeTs] = useState<number | null>(null)
  const [batchHasMore, setBatchHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [batchHistoryLoading, setBatchHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyStatusFilter, setHistoryStatusFilter] = useState<TimelineStatusFilter>('all')
  const [historyCommandFilter, setHistoryCommandFilter] = useState('')
  const [batchReplayLoadingId, setBatchReplayLoadingId] = useState<string | null>(null)
  const [batchDetailLoadingId, setBatchDetailLoadingId] = useState<string | null>(null)
  const [activeBatchDetailId, setActiveBatchDetailId] = useState<string | null>(null)
  const [batchDetailError, setBatchDetailError] = useState<string | null>(null)
  const [batchDetailForward, setBatchDetailForward] = useState<GraphBatchStepDetail[]>([])
  const [batchDetailRollback, setBatchDetailRollback] = useState<GraphBatchStepDetail[]>([])
  const [replayPhaseFilter, setReplayPhaseFilter] = useState<ReplayPhaseFilter>('forward')
  const [replayStepLimitInput, setReplayStepLimitInput] = useState('')
  const [expandedBatchStepId, setExpandedBatchStepId] = useState<string | null>(null)
  const [copiedBatchStepId, setCopiedBatchStepId] = useState<string | null>(null)
  const [batchReceipt, setBatchReceipt] = useState<GraphBatchReceipt | null>(null)
  const batchRef = useRef<GraphBatchState | null>(null)
  
  const studentId = localStorage.getItem('studentId') || undefined
  const studentName = localStorage.getItem('studentName') || '同学'
  const mbtiCode = localStorage.getItem('mbtiCode')

  const parseBatchMeta = useCallback((params: Record<string, unknown> | undefined): GraphBatchMeta | null => {
    if (!params || typeof params !== 'object') return null
    const raw = (params as Record<string, unknown>).__batch
    if (!raw || typeof raw !== 'object') return null
    const payload = raw as Record<string, unknown>
    const batchId = typeof payload.batch_id === 'string' ? payload.batch_id : ''
    const stepIndex = typeof payload.step_index === 'number' ? payload.step_index : -1
    const totalSteps = typeof payload.total_steps === 'number' ? payload.total_steps : -1
    const mode: GraphBatchMode = payload.mode === 'all_or_nothing' ? 'all_or_nothing' : 'best_effort'
    const phase: GraphBatchPhase = payload.phase === 'rollback' ? 'rollback' : 'forward'
    if (!batchId || stepIndex < 0 || totalSteps <= 0) return null
    return {
      batch_id: batchId,
      step_index: stepIndex,
      total_steps: totalSteps,
      mode,
      phase,
    }
  }, [])

  const dispatchBatchResult = useCallback((payload: {
    batchId: string
    status: 'success' | 'partial' | 'failed'
    completed: number
    total: number
    message: string
    rolledBack?: number
    rollbackFailed?: number
  }) => {
    window.dispatchEvent(new CustomEvent('pathmind:graph-batch-result', { detail: payload }))
  }, [])

  const issueBatchStep = useCallback((state: GraphBatchState, index: number) => {
    const sequence = state.phase === 'rollback' ? state.rollbackSteps : state.steps
    const step = sequence[index]
    if (!step) return

    const issuedAt = Date.now()
    const params: Record<string, unknown> = {
      ...(step.params || {}),
      __batch: {
        batch_id: state.batchId,
        step_index: index,
        total_steps: sequence.length,
        mode: state.mode,
        phase: state.phase,
      },
    }
    const runningMessage = state.phase === 'rollback'
      ? `补偿回滚：第 ${index + 1}/${sequence.length} 步 · ${step.command}`
      : `执行中：第 ${index + 1}/${sequence.length} 步 · ${step.command}`
    setBatchReceipt({
      batchId: state.batchId,
      mode: state.mode,
      status: 'running',
      completed: Math.min(state.forwardResults.length, state.steps.length),
      total: state.steps.length,
      message: runningMessage,
    })
    setActiveCommand({
      command: step.command,
      target: step.target,
      params,
      issuedAt,
    })
  }, [])

  const reportBatchReceipt = useCallback((payload: {
    batchId: string
    mode: GraphBatchMode
    status: 'success' | 'partial' | 'failed'
    completed: number
    total: number
    message: string
    rolledBack?: number
    rollbackFailed?: number
    startedAt: number
    finishedAt: number
  }) => {
    const sessionId = getSession('graph-analyst')
    void agentApi.reportGraphBatchFeedback({
      agentName: 'graph-analyst',
      sessionId,
      source: 'graph_page',
      item: {
        batchId: payload.batchId,
        mode: payload.mode,
        status: payload.status,
        completed: payload.completed,
        total: payload.total,
        message: payload.message,
        rolledBack: payload.rolledBack,
        rollbackFailed: payload.rollbackFailed,
        startedAt: payload.startedAt,
        finishedAt: payload.finishedAt,
      },
    }).catch(() => {})
  }, [getSession])

  const finalizeBatch = useCallback((state: GraphBatchState, status: 'success' | 'partial' | 'failed') => {
    const successCount = state.forwardResults.filter((item) => item.status === 'success').length
    const completed = state.forwardResults.length
    const rolledBack = state.rollbackResults.filter((item) => item.status === 'success').length
    const rollbackFailed = state.rollbackResults.length - rolledBack
    const message = status === 'success'
      ? `批次完成，成功 ${successCount}/${state.steps.length}`
      : status === 'partial'
        ? `批次部分完成，成功 ${successCount}/${state.steps.length}`
        : (
            state.rollbackSteps.length > 0
              ? `批次失败（${state.failureMessage || '执行出错'}），补偿回滚 ${rolledBack}/${state.rollbackSteps.length}`
              : `批次失败，停止于第 ${Math.max(1, completed)} 步`
          )

    const receipt: GraphBatchReceipt = {
      batchId: state.batchId,
      mode: state.mode,
      status,
      completed,
      total: state.steps.length,
      message,
      rolledBack: state.rollbackSteps.length > 0 ? rolledBack : undefined,
      rollbackFailed: state.rollbackSteps.length > 0 ? rollbackFailed : undefined,
    }
    const finishedAt = Date.now()

    setBatchReceipt(receipt)
    dispatchBatchResult({
      batchId: state.batchId,
      status,
      completed,
      total: state.steps.length,
      message,
      rolledBack: receipt.rolledBack,
      rollbackFailed: receipt.rollbackFailed,
    })
    reportBatchReceipt({
      batchId: state.batchId,
      mode: state.mode,
      status,
      completed,
      total: state.steps.length,
      message,
      rolledBack: receipt.rolledBack,
      rollbackFailed: receipt.rollbackFailed,
      startedAt: state.startedAt,
      finishedAt,
    })
    batchRef.current = null
  }, [dispatchBatchResult, reportBatchReceipt])

  const startBatchRollback = useCallback((state: GraphBatchState, failureResult: GraphCommandExecutionResult) => {
    const rollbackSteps = state.forwardResults
      .filter((item) => item.status === 'success' && item.undoCommand)
      .map((item) => item.undoCommand as GraphCommandEvent)
      .reverse()

    state.failureMessage = failureResult.message || `第 ${state.forwardResults.length} 步执行失败`
    if (rollbackSteps.length === 0) {
      finalizeBatch(state, 'failed')
      return
    }

    state.phase = 'rollback'
    state.rollbackSteps = rollbackSteps
    state.rollbackResults = []
    state.index = 0
    batchRef.current = state
    issueBatchStep(state, 0)
  }, [finalizeBatch, issueBatchStep])

  const startBatchExecution = useCallback((event: GraphBatchEvent) => {
    const normalizedSteps = (event.steps || []).filter((item) => typeof item.command === 'string' && item.command.length > 0)
    if (normalizedSteps.length === 0) return

    const running = batchRef.current
    if (running) {
      dispatchBatchResult({
        batchId: event.batchId || running.batchId,
        status: 'failed',
        completed: running.forwardResults.length,
        total: running.steps.length,
        message: `已有批次 ${running.batchId} 正在执行，当前请求已忽略`,
      })
      return
    }

    const nextState: GraphBatchState = {
      batchId: event.batchId || `batch-${Date.now()}`,
      mode: event.mode === 'all_or_nothing' ? 'all_or_nothing' : 'best_effort',
      steps: normalizedSteps,
      phase: 'forward',
      startedAt: Date.now(),
      index: 0,
      forwardResults: [],
      rollbackSteps: [],
      rollbackResults: [],
    }
    batchRef.current = nextState
    issueBatchStep(nextState, 0)
  }, [dispatchBatchResult, issueBatchStep])

  const exportReceiptJson = useCallback(() => {
    const payload = {
      exported_at: new Date().toISOString(),
      filters: {
        status: historyStatusFilter,
        command: historyCommandFilter.trim() || null,
      },
      items: serverHistory.map((item) => ({
        command: item.command,
        target: item.target,
        status: item.status,
        success: item.success,
        message: item.message,
        issued_at: item.issuedAt,
        executed_at: item.executedAt,
        params: item.params,
      })),
    }
    downloadFile(
      `graph-receipt-${Date.now()}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    )
  }, [historyCommandFilter, historyStatusFilter, serverHistory])

  const exportReceiptCsv = useCallback(() => {
    const header = ['executed_at', 'issued_at', 'status', 'command', 'target', 'message', 'success']
    const rows = serverHistory.map((item) => [
      item.executedAt ? new Date(item.executedAt).toISOString() : '',
      item.issuedAt ? new Date(item.issuedAt).toISOString() : '',
      item.status,
      item.command,
      item.target || '',
      item.message,
      item.success,
    ])
    const content = [
      header.join(','),
      ...rows.map((row) => row.map((value) => escapeCsvValue(value)).join(',')),
    ].join('\n')
    downloadFile(`graph-receipt-${Date.now()}.csv`, content, 'text/csv;charset=utf-8')
  }, [serverHistory])

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<GraphCommandEvent>
      const detail = customEvent.detail
      if (!detail || typeof detail.command !== 'string' || detail.command.length === 0) return
      setActiveCommand({ ...detail, issuedAt: Date.now() })
    }

    window.addEventListener('pathmind:graph-command', handler)
    return () => {
      window.removeEventListener('pathmind:graph-command', handler)
    }
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<GraphBatchEvent>).detail
      if (!detail || !Array.isArray(detail.steps) || detail.steps.length === 0) return
      startBatchExecution(detail)
    }
    window.addEventListener('pathmind:graph-command-batch', handler)
    return () => {
      window.removeEventListener('pathmind:graph-command-batch', handler)
    }
  }, [startBatchExecution])

  useEffect(() => {
    if (!activeCommand) return
    const timer = window.setTimeout(() => setActiveCommand(null), 6000)
    return () => window.clearTimeout(timer)
  }, [activeCommand?.issuedAt])

  useEffect(() => {
    if (!batchReceipt || batchReceipt.status === 'running') return
    const timer = window.setTimeout(() => setBatchReceipt(null), 8000)
    return () => window.clearTimeout(timer)
  }, [batchReceipt])

  const mapServerHistoryItem = useCallback((
    item: GraphCommandFeedbackHistoryItem,
    index: number,
  ): GraphCommandHistoryItem => {
    const executedAt = typeof item.executed_at === 'number' ? item.executed_at : Date.now() - index
    const issuedAt = typeof item.issued_at === 'number' ? item.issued_at : undefined
    const normalizedStatus: 'success' | 'ignored' | 'error' =
      item.status === 'success' || item.status === 'error' || item.status === 'ignored'
        ? item.status
        : (item.success ? 'success' : 'ignored')

    return {
      id: `remote:${executedAt}:${index}`,
      command: item.command,
      target: item.target,
      params: item.params,
      issuedAt,
      executedAt,
      status: normalizedStatus,
      success: typeof item.success === 'boolean' ? item.success : normalizedStatus === 'success',
      message: item.message || `${item.command} 执行完成`,
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const sessionId = getSession('graph-analyst')
      const response = await agentApi.listGraphFeedback({
        agentName: 'graph-analyst',
        sessionId,
        status: historyStatusFilter === 'all' ? undefined : historyStatusFilter,
        command: historyCommandFilter.trim() || undefined,
        limit: 30,
      })
      const mapped = (response.items || []).map((item, index) => mapServerHistoryItem(item, index))
      setServerHistory(mapped)
    } catch {
      setHistoryError('历史回执加载失败')
    } finally {
      setHistoryLoading(false)
    }
  }, [getSession, historyCommandFilter, historyStatusFilter, mapServerHistoryItem])

  const loadBatchHistory = useCallback(async (options?: { append?: boolean; beforeTs?: number | null }) => {
    const append = options?.append === true
    const cursor = append ? (options?.beforeTs || null) : null
    if (append && !cursor) return

    setBatchHistoryLoading(true)
    try {
      const sessionId = getSession('graph-analyst')
      const response = await agentApi.listGraphBatchFeedback({
        agentName: 'graph-analyst',
        sessionId,
        beforeTs: cursor || undefined,
        limit: BATCH_PAGE_SIZE,
      })

      const incoming = response.items || []
      if (append) {
        setBatchHistory((prev) => {
          const existed = new Set(prev.map((item) => `${item.batch_id}:${item.finished_at || item.started_at || 0}`))
          const merged = [...prev]
          incoming.forEach((item) => {
            const key = `${item.batch_id}:${item.finished_at || item.started_at || 0}`
            if (!existed.has(key)) {
              merged.push(item)
            }
          })
          return merged
        })
      } else {
        setBatchHistory(incoming)
      }

      setBatchHistorySource(
        response.source === 'postgres' || response.source === 'redis'
          ? response.source
          : null,
      )
      const nextCursor = typeof response.next_before_ts === 'number' && response.next_before_ts > 0
        ? response.next_before_ts
        : null
      setBatchNextBeforeTs(nextCursor)
      setBatchHasMore(Boolean(nextCursor))
    } catch {
      // keep existing historyError semantics unchanged
    } finally {
      setBatchHistoryLoading(false)
    }
  }, [getSession])

  const fetchBatchAckEntries = useCallback(async (batchId: string): Promise<GraphBatchAckEntry[]> => {
    const sessionId = getSession('graph-analyst')
    const response = await agentApi.listGraphFeedback({
      agentName: 'graph-analyst',
      sessionId,
      limit: BATCH_DETAIL_ACK_LIMIT,
    })
    const mapped = (response.items || []).map((item, index) => mapServerHistoryItem(item, index))
    const entries: GraphBatchAckEntry[] = mapped
      .map((item) => ({ item, meta: parseBatchMeta(item.params) }))
      .filter((entry): entry is GraphBatchAckEntry => Boolean(entry.meta && entry.meta.batch_id === batchId))
      .sort((left, right) => {
        const phaseOrder = (left.meta.phase === 'forward' ? 0 : 1) - (right.meta.phase === 'forward' ? 0 : 1)
        if (phaseOrder !== 0) return phaseOrder
        return left.meta.step_index - right.meta.step_index
      })
    return entries
  }, [getSession, mapServerHistoryItem, parseBatchMeta])

  const buildBatchStepGroups = useCallback(async (batchId: string) => {
    const entries = await fetchBatchAckEntries(batchId)

    const details = entries.map((entry, index): GraphBatchStepDetail => ({
      id: `${batchId}:${entry.meta.phase}:${entry.meta.step_index}:${entry.item.executedAt || index}`,
      phase: entry.meta.phase,
      stepIndex: entry.meta.step_index,
      command: entry.item.command,
      target: entry.item.target,
      status: entry.item.status,
      message: entry.item.message,
      executedAt: entry.item.executedAt || Date.now() - index,
      params: entry.item.params,
    }))

    return {
      forward: details.filter((item) => item.phase === 'forward'),
      rollback: details.filter((item) => item.phase === 'rollback'),
    }
  }, [fetchBatchAckEntries])

  const handleLoadBatchDetail = useCallback(async (batch: GraphBatchFeedbackHistoryItem) => {
    const batchId = batch.batch_id
    if (!batchId) return

    if (activeBatchDetailId === batchId) {
      setActiveBatchDetailId(null)
      setBatchDetailError(null)
      setBatchDetailForward([])
      setBatchDetailRollback([])
      setExpandedBatchStepId(null)
      return
    }

    setBatchDetailLoadingId(batchId)
    setBatchDetailError(null)
    try {
      const detail = await buildBatchStepGroups(batchId)
      setActiveBatchDetailId(batchId)
      setBatchDetailForward(detail.forward)
      setBatchDetailRollback(detail.rollback)
      setExpandedBatchStepId(null)
      if (detail.forward.length === 0 && detail.rollback.length === 0) {
        setBatchDetailError(`未找到批次 ${batchId} 的步骤明细`)
      }
    } catch {
      setBatchDetailError(`批次 ${batchId} 明细加载失败`)
    } finally {
      setBatchDetailLoadingId(null)
    }
  }, [activeBatchDetailId, buildBatchStepGroups])

  useEffect(() => {
    if (!copiedBatchStepId) return
    const timer = window.setTimeout(() => setCopiedBatchStepId(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copiedBatchStepId])

  useEffect(() => {
    if (!batchReceipt || batchReceipt.status === 'running') return
    void loadBatchHistory()
  }, [batchReceipt, loadBatchHistory])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    void loadBatchHistory()
  }, [loadBatchHistory])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadHistory()
      void loadBatchHistory()
    }, 20000)
    return () => window.clearInterval(timer)
  }, [loadBatchHistory, loadHistory])

  const handleCommandExecuted = useCallback((result: GraphCommandExecutionResult) => {
    const item: GraphCommandHistoryItem = {
      id: `${result.executedAt}:${Math.random().toString(16).slice(2, 8)}`,
      ...result,
    }
    setCommandHistory((prev) => [item, ...prev].slice(0, 16))
    window.dispatchEvent(new CustomEvent('pathmind:graph-command-result', { detail: item }))

    const batchMeta = parseBatchMeta(result.params)
    if (batchMeta && batchRef.current && batchRef.current.batchId === batchMeta.batch_id) {
      const current = batchRef.current
      if (batchMeta.phase === 'rollback') {
        current.rollbackResults = [...current.rollbackResults, result]
        current.index = batchMeta.step_index + 1
        if (current.index < current.rollbackSteps.length) {
          batchRef.current = current
          issueBatchStep(current, current.index)
        } else {
          finalizeBatch(current, 'failed')
        }
      } else {
        current.forwardResults = [...current.forwardResults, result]
        current.index = batchMeta.step_index + 1

        const isFailure = result.status !== 'success'
        if (isFailure && current.mode === 'all_or_nothing') {
          startBatchRollback(current, result)
        } else if (current.index < current.steps.length) {
          batchRef.current = current
          issueBatchStep(current, current.index)
        } else {
          const failedCount = current.forwardResults.filter((entry) => entry.status !== 'success').length
          finalizeBatch(current, failedCount > 0 ? 'partial' : 'success')
        }
      }
    }

    const sessionId = getSession('graph-analyst')
    void agentApi.reportGraphFeedback({
      agentName: 'graph-analyst',
      sessionId,
      source: 'graph_page',
      items: [{
        command: result.command,
        target: result.target,
        status: result.status,
        success: result.success,
        message: result.message,
        issuedAt: result.issuedAt,
        executedAt: result.executedAt,
        params: result.params,
      }],
    }).then(() => loadHistory()).catch(() => {})
  }, [finalizeBatch, getSession, issueBatchStep, loadHistory, parseBatchMeta, startBatchRollback])

  const latestUndoable = useMemo(
    () => commandHistory.find((item) => item.undoCommand),
    [commandHistory],
  )

  const handleUndoLast = useCallback(() => {
    if (!latestUndoable?.undoCommand) return
    setActiveCommand({
      ...latestUndoable.undoCommand,
      issuedAt: Date.now(),
    })
  }, [latestUndoable])

  const stripBatchMeta = useCallback((params?: Record<string, unknown>) => {
    if (!params || typeof params !== 'object') return undefined
    const next = { ...params }
    delete next.__batch
    return Object.keys(next).length > 0 ? next : undefined
  }, [])

  const handleReplayBatch = useCallback(async (batch: GraphBatchFeedbackHistoryItem) => {
    if (batchReplayLoadingId) return
    const batchId = batch.batch_id
    if (!batchId) return

    setBatchReplayLoadingId(batchId)
    setHistoryError(null)
    try {
      const entries = await fetchBatchAckEntries(batchId)
      const filteredEntries = entries
        .filter((entry) => {
          if (replayPhaseFilter === 'all') return true
          return entry.meta.phase === replayPhaseFilter
        })
      const parsedLimit = Number.parseInt(replayStepLimitInput.trim(), 10)
      const replayStepLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 50)
        : null
      const limitedEntries = replayStepLimit ? filteredEntries.slice(0, replayStepLimit) : filteredEntries
      const steps: GraphCommandEvent[] = limitedEntries.map((entry) => ({
        command: entry.item.command,
        target: entry.item.target,
        params: stripBatchMeta(entry.item.params),
      }))

      if (steps.length === 0) {
        setHistoryError(`回放失败：未找到批次 ${batchId} 的步骤记录`)
        return
      }

      const replayPhaseLabel = replayPhaseFilter === 'all'
        ? '全部'
        : replayPhaseFilter === 'forward'
          ? 'forward'
          : 'rollback'
      const replayLimitLabel = replayStepLimit ? `，前 ${replayStepLimit} 步` : ''
      const shouldReplay = window.confirm(
        `确认回放批次 ${batchId}（${replayPhaseLabel}${replayLimitLabel}）？将执行 ${steps.length} 条图谱命令。`,
      )
      if (!shouldReplay) {
        return
      }

      window.dispatchEvent(new CustomEvent('pathmind:graph-command-batch', {
        detail: {
          batchId: `replay-${batchId}-${Date.now()}`,
          mode: batch.mode === 'all_or_nothing' ? 'all_or_nothing' : 'best_effort',
          steps,
        } satisfies GraphBatchEvent,
      }))
    } catch {
      setHistoryError(`回放失败：批次 ${batchId} 记录拉取失败`)
    } finally {
      setBatchReplayLoadingId(null)
    }
  }, [batchReplayLoadingId, fetchBatchAckEntries, replayPhaseFilter, replayStepLimitInput, stripBatchMeta])

  const handleLoadMoreBatchHistory = useCallback(() => {
    if (!batchHasMore || batchHistoryLoading || !batchNextBeforeTs) return
    void loadBatchHistory({
      append: true,
      beforeTs: batchNextBeforeTs,
    })
  }, [batchHasMore, batchHistoryLoading, batchNextBeforeTs, loadBatchHistory])

  const handleCopyBatchStep = useCallback(async (step: GraphBatchStepDetail) => {
    const payload = {
      phase: step.phase,
      step_index: step.stepIndex,
      command: step.command,
      target: step.target,
      status: step.status,
      message: step.message,
      executed_at: step.executedAt,
      params: step.params || {},
    }
    const ok = await copyToClipboard(safeStringify(payload))
    if (ok) {
      setCopiedBatchStepId(step.id)
      return
    }
    setBatchDetailError('复制失败，请检查浏览器剪贴板权限')
  }, [])

  const handleExportBatchDetail = useCallback((batchId: string) => {
    if (activeBatchDetailId !== batchId) return
    const payload = {
      exported_at: new Date().toISOString(),
      batch_id: batchId,
      forward: batchDetailForward.map((step) => ({
        step_index: step.stepIndex,
        command: step.command,
        target: step.target,
        status: step.status,
        message: step.message,
        executed_at: step.executedAt,
        params: step.params || {},
      })),
      rollback: batchDetailRollback.map((step) => ({
        step_index: step.stepIndex,
        command: step.command,
        target: step.target,
        status: step.status,
        message: step.message,
        executed_at: step.executedAt,
        params: step.params || {},
      })),
    }
    const filename = `graph-batch-detail-${batchId}-${Date.now()}.json`
    downloadFile(filename, safeStringify(payload), 'application/json;charset=utf-8')
  }, [activeBatchDetailId, batchDetailForward, batchDetailRollback])

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node)
  }

  const handleNodeAction = () => {
    if (!selectedNode) return
    
    switch (selectedNode.type) {
      case 'career':
        navigate(`/careers?id=${selectedNode.id}`)
        break
      case 'mbti':
        navigate(`/results?type=${selectedNode.id.replace('mbti-', '').toUpperCase()}`)
        break
      default:
        break
    }
  }

  return (
    <div 
      className="min-h-screen p-4 md:p-6 lg:p-8 overflow-hidden flex flex-col"
      style={{ background: `linear-gradient(135deg, var(--bg-primary) 0%, #F8FAFC 50%, ${primary[50]}40 100%)` }}
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4"
      >
        <div>
          <p className="text-sm mb-1 font-medium" style={{ color: 'var(--accent-text)' }}>可视化</p>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-text-primary">
            知识图谱
          </h1>
        </div>
        
        {/* Mode Switcher */}
        <div 
          className="flex items-center gap-1 p-1 rounded-xl bg-bg-tertiary"
        >
          <button
            onClick={() => setMode('full')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={mode === 'full' ? {
              background: 'white',
              color: 'var(--text-primary)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            } : {
              background: 'transparent',
              color: 'var(--text-muted)',
            }}
          >
            <Globe className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />完整图谱
          </button>
          {studentId && (
            <button
              onClick={() => setMode('student')}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={mode === 'student' ? {
                background: 'white',
                color: 'var(--text-primary)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              } : {
                background: 'transparent',
                color: 'var(--text-muted)',
              }}
            >
              <User className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />我的画像
            </button>
          )}
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Graph Container */}
        <motion.div
          initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.1, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className={`flex-1 ${selectedNode ? 'hidden md:block' : ''}`}
        >
          <GlassCard variant="standard" color="white" className="h-full p-0 overflow-hidden">
            <div className="h-full relative">
              <KnowledgeGraph
                mode={mode}
                studentId={studentId}
                onNodeClick={handleNodeClick}
                graphCommand={activeCommand || undefined}
                onCommandExecuted={handleCommandExecuted}
              />

              {activeCommand && (
                <div
                  className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 rounded-full text-xs border border-border-primary"
                  style={{
                    background: 'rgba(255,255,255,0.92)',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  <span className="font-semibold text-text-primary">Agent 指令</span>
                  <span className="text-text-muted">{activeCommand.command}</span>
                  {activeCommand.target && (
                    <span className="px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">
                      {activeCommand.target}
                    </span>
                  )}
                </div>
              )}

              {(commandHistory.length > 0 || serverHistory.length > 0 || batchHistory.length > 0 || batchReceipt) && (
                <div
                  className="absolute top-16 right-4 w-72 rounded-2xl border border-border-primary p-3 space-y-2"
                  style={{
                    background: 'rgba(255,255,255,0.9)',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-primary">Agent 执行回执</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={exportReceiptJson}
                        disabled={serverHistory.length === 0}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
                        style={{
                          background: serverHistory.length > 0 ? 'rgba(15,23,42,0.06)' : 'rgba(15,23,42,0.03)',
                          color: serverHistory.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                          cursor: serverHistory.length > 0 ? 'pointer' : 'not-allowed',
                        }}
                        title="导出当前筛选结果为 JSON"
                      >
                        <Download className="w-3.5 h-3.5" strokeWidth={1.8} />
                        JSON
                      </button>
                      <button
                        onClick={exportReceiptCsv}
                        disabled={serverHistory.length === 0}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
                        style={{
                          background: serverHistory.length > 0 ? 'rgba(15,23,42,0.06)' : 'rgba(15,23,42,0.03)',
                          color: serverHistory.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                          cursor: serverHistory.length > 0 ? 'pointer' : 'not-allowed',
                        }}
                        title="导出当前筛选结果为 CSV"
                      >
                        <Download className="w-3.5 h-3.5" strokeWidth={1.8} />
                        CSV
                      </button>
                      <button
                        onClick={() => { void loadHistory(); void loadBatchHistory() }}
                        disabled={historyLoading || batchHistoryLoading}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
                        style={{
                          background: 'rgba(15,23,42,0.06)',
                          color: 'var(--text-primary)',
                          cursor: historyLoading || batchHistoryLoading ? 'wait' : 'pointer',
                        }}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${historyLoading || batchHistoryLoading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
                        刷新
                      </button>
                      <button
                        onClick={handleUndoLast}
                        disabled={!latestUndoable}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
                        style={{
                          background: latestUndoable ? 'rgba(15,23,42,0.06)' : 'rgba(15,23,42,0.03)',
                          color: latestUndoable ? 'var(--text-primary)' : 'var(--text-muted)',
                          cursor: latestUndoable ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <Undo2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                        撤销
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      {([
                        ['all', '全部'],
                        ['success', '成功'],
                        ['ignored', '忽略'],
                        ['error', '错误'],
                      ] as Array<[TimelineStatusFilter, string]>).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setHistoryStatusFilter(value)}
                          className="px-2 py-1 rounded-md text-[11px] transition-colors"
                          style={{
                            background: historyStatusFilter === value ? 'rgba(59,130,246,0.14)' : 'rgba(15,23,42,0.05)',
                            color: historyStatusFilter === value ? '#1d4ed8' : 'var(--text-muted)',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input
                      value={historyCommandFilter}
                      onChange={(event) => setHistoryCommandFilter(event.target.value)}
                      placeholder="按命令过滤，例如 focus_node"
                      className="w-full text-[11px] px-2 py-1.5 rounded-md border border-border-secondary bg-bg-primary text-text-primary outline-none"
                    />
                  </div>
                  {batchReceipt && (
                    <div
                      className="p-2 rounded-lg border border-border-secondary text-[11px]"
                      style={{
                        background: batchReceipt.status === 'running'
                          ? 'rgba(59,130,246,0.08)'
                          : batchReceipt.status === 'success'
                            ? 'rgba(16,185,129,0.08)'
                            : batchReceipt.status === 'partial'
                              ? 'rgba(245,158,11,0.1)'
                              : 'rgba(239,68,68,0.08)',
                      }}
                    >
                      <p className="font-semibold text-text-primary">
                        批次 {batchReceipt.batchId} · {batchReceipt.mode === 'all_or_nothing' ? '事务模式' : '尽力模式'}
                      </p>
                      <p className="text-text-muted mt-0.5">
                        {batchReceipt.status} · {batchReceipt.completed}/{batchReceipt.total}
                      </p>
                      {typeof batchReceipt.rolledBack === 'number' && (
                        <p className="text-text-muted mt-0.5">
                          rollback {batchReceipt.rolledBack}
                          {typeof batchReceipt.rollbackFailed === 'number' ? ` · fail ${batchReceipt.rollbackFailed}` : ''}
                        </p>
                      )}
                      <p className="text-text-secondary mt-1">{batchReceipt.message}</p>
                    </div>
                  )}
                  {historyError && (
                    <p className="text-[11px] text-amber-600">{historyError}</p>
                  )}
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {commandHistory.slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2 p-2 rounded-lg bg-bg-primary border border-border-secondary"
                      >
                        {item.status === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 flex-shrink-0" strokeWidth={1.8} />
                        ) : (
                          <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" strokeWidth={1.8} />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-text-primary truncate">
                            {item.command}
                            {item.target ? ` · ${item.target}` : ''}
                          </p>
                          <p className="text-[11px] text-text-muted leading-relaxed">{item.message}</p>
                        </div>
                      </div>
                    ))}
                    {serverHistory.length > 0 && (
                      <div className="pt-1">
                        <p className="text-[11px] text-text-muted px-1 mb-1">会话时间线</p>
                        <div className="space-y-1.5">
                          {serverHistory.slice(0, 5).map((item) => (
                            <div
                              key={item.id}
                              className="flex items-start gap-2 p-2 rounded-lg bg-bg-primary border border-border-secondary"
                            >
                              {item.status === 'success' ? (
                                <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 flex-shrink-0" strokeWidth={1.8} />
                              ) : (
                                <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" strokeWidth={1.8} />
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-text-primary truncate">
                                  {item.command}
                                  {item.target ? ` · ${item.target}` : ''}
                                </p>
                                <p className="text-[11px] text-text-muted leading-relaxed">{item.message}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {batchHistory.length > 0 && (
                      <div className="pt-1">
                        <div className="flex items-center justify-between gap-2 px-1 mb-1">
                          <p className="text-[11px] text-text-muted">批次时间线</p>
                          <div className="flex items-center gap-1">
                            {batchHistorySource && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted uppercase tracking-wide">
                                {batchHistorySource}
                              </span>
                            )}
                            <select
                              value={replayPhaseFilter}
                              onChange={(event) => setReplayPhaseFilter(event.target.value as ReplayPhaseFilter)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-border-secondary bg-bg-primary text-text-secondary"
                              title="回放 phase 筛选"
                            >
                              <option value="forward">forward</option>
                              <option value="rollback">rollback</option>
                              <option value="all">all</option>
                            </select>
                            <input
                              type="number"
                              min={1}
                              max={50}
                              value={replayStepLimitInput}
                              onChange={(event) => setReplayStepLimitInput(event.target.value)}
                              placeholder="N步"
                              className="w-14 text-[10px] px-1.5 py-0.5 rounded border border-border-secondary bg-bg-primary text-text-secondary"
                              title="回放前 N 步（留空=全部）"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {batchHistory.map((item, index) => {
                            const replayBusy = batchReplayLoadingId === item.batch_id
                            const detailBusy = batchDetailLoadingId === item.batch_id
                            const detailActive = activeBatchDetailId === item.batch_id
                            return (
                              <div
                                key={`${item.batch_id}:${item.finished_at || item.started_at || index}`}
                                className="p-2 rounded-lg bg-bg-primary border border-border-secondary space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-text-primary truncate">
                                    {item.batch_id}
                                  </p>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => { void handleLoadBatchDetail(item) }}
                                      disabled={Boolean(batchDetailLoadingId && batchDetailLoadingId !== item.batch_id)}
                                      className="px-2 py-0.5 rounded text-[10px] transition-colors"
                                      style={{
                                        background: detailActive ? 'rgba(37,99,235,0.12)' : 'rgba(15,23,42,0.06)',
                                        color: detailActive ? '#1d4ed8' : 'var(--text-primary)',
                                        cursor: batchDetailLoadingId && batchDetailLoadingId !== item.batch_id ? 'wait' : 'pointer',
                                      }}
                                    >
                                      {detailBusy ? '加载中' : detailActive ? '收起' : '详情'}
                                    </button>
                                    {detailActive && (
                                      <button
                                        onClick={() => handleExportBatchDetail(item.batch_id)}
                                        className="px-2 py-0.5 rounded text-[10px] transition-colors"
                                        style={{
                                          background: 'rgba(15,23,42,0.06)',
                                          color: 'var(--text-primary)',
                                        }}
                                      >
                                        导出
                                      </button>
                                    )}
                                    <button
                                      onClick={() => { void handleReplayBatch(item) }}
                                      disabled={!!batchReplayLoadingId}
                                      className="px-2 py-0.5 rounded text-[10px] transition-colors"
                                      style={{
                                        background: batchReplayLoadingId ? 'rgba(15,23,42,0.04)' : 'rgba(15,23,42,0.08)',
                                        color: batchReplayLoadingId ? 'var(--text-muted)' : 'var(--text-primary)',
                                        cursor: batchReplayLoadingId ? 'wait' : 'pointer',
                                      }}
                                    >
                                      {replayBusy ? '回放中' : '回放'}
                                    </button>
                                  </div>
                                </div>
                                <p className="text-[11px] text-text-muted">
                                  {item.status || 'failed'} · {item.mode || 'best_effort'} · {item.completed || 0}/{item.total || 0}
                                </p>
                                {typeof item.rolled_back === 'number' && (
                                  <p className="text-[11px] text-text-muted">
                                    rollback {item.rolled_back}
                                    {typeof item.rollback_failed === 'number' ? ` · fail ${item.rollback_failed}` : ''}
                                  </p>
                                )}
                                {detailActive && (
                                  <div className="mt-1.5 p-1.5 rounded border border-border-secondary bg-white/70 space-y-1">
                                    {batchDetailError && (
                                      <p className="text-[10px] text-amber-600">{batchDetailError}</p>
                                    )}
                                    {batchDetailForward.length > 0 && (
                                      <div>
                                        <p className="text-[10px] text-text-muted mb-1">forward</p>
                                        <div className="space-y-1">
                                          {batchDetailForward.map((step) => (
                                            <div key={step.id} className="rounded border border-border-secondary bg-white/80 p-1.5">
                                              <div className="flex items-start gap-1.5">
                                                {step.status === 'success' ? (
                                                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-600 flex-shrink-0" strokeWidth={1.8} />
                                                ) : (
                                                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-600 flex-shrink-0" strokeWidth={1.8} />
                                                )}
                                                <div className="min-w-0 flex-1">
                                                  <p className="text-[10px] text-text-secondary leading-snug">
                                                    [{step.stepIndex + 1}] {step.command}
                                                    {step.target ? ` · ${step.target}` : ''}
                                                  </p>
                                                  <p className="text-[10px] text-text-muted mt-0.5">
                                                    {step.status}
                                                  </p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                  <button
                                                    onClick={() => { void handleCopyBatchStep(step) }}
                                                    className="px-1.5 py-0.5 rounded text-[10px]"
                                                    style={{
                                                      background: copiedBatchStepId === step.id ? 'rgba(16,185,129,0.14)' : 'rgba(15,23,42,0.06)',
                                                      color: copiedBatchStepId === step.id ? '#047857' : 'var(--text-primary)',
                                                    }}
                                                  >
                                                    <span className="inline-flex items-center gap-1">
                                                      <Copy className="w-3 h-3" strokeWidth={1.8} />
                                                      {copiedBatchStepId === step.id ? '已复制' : '复制'}
                                                    </span>
                                                  </button>
                                                  <button
                                                    onClick={() => setExpandedBatchStepId((prev) => (prev === step.id ? null : step.id))}
                                                    className="px-1.5 py-0.5 rounded text-[10px]"
                                                    style={{
                                                      background: expandedBatchStepId === step.id ? 'rgba(37,99,235,0.12)' : 'rgba(15,23,42,0.06)',
                                                      color: expandedBatchStepId === step.id ? '#1d4ed8' : 'var(--text-primary)',
                                                    }}
                                                  >
                                                    {expandedBatchStepId === step.id ? '收起' : '展开'}
                                                  </button>
                                                </div>
                                              </div>
                                              {expandedBatchStepId === step.id && (
                                                <div className="mt-1.5 space-y-1">
                                                  <p className="text-[10px] text-text-secondary">
                                                    {step.message || '无 message'}
                                                  </p>
                                                  <pre className="text-[10px] leading-snug p-1 rounded bg-bg-tertiary text-text-muted overflow-x-auto">
                                                    {safeStringify(step.params || {})}
                                                  </pre>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {batchDetailRollback.length > 0 && (
                                      <div>
                                        <p className="text-[10px] text-text-muted mb-1">rollback</p>
                                        <div className="space-y-1">
                                          {batchDetailRollback.map((step) => (
                                            <div key={step.id} className="rounded border border-border-secondary bg-white/80 p-1.5">
                                              <div className="flex items-start gap-1.5">
                                                {step.status === 'success' ? (
                                                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-600 flex-shrink-0" strokeWidth={1.8} />
                                                ) : (
                                                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-600 flex-shrink-0" strokeWidth={1.8} />
                                                )}
                                                <div className="min-w-0 flex-1">
                                                  <p className="text-[10px] text-text-secondary leading-snug">
                                                    [{step.stepIndex + 1}] {step.command}
                                                    {step.target ? ` · ${step.target}` : ''}
                                                  </p>
                                                  <p className="text-[10px] text-text-muted mt-0.5">
                                                    {step.status}
                                                  </p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                  <button
                                                    onClick={() => { void handleCopyBatchStep(step) }}
                                                    className="px-1.5 py-0.5 rounded text-[10px]"
                                                    style={{
                                                      background: copiedBatchStepId === step.id ? 'rgba(16,185,129,0.14)' : 'rgba(15,23,42,0.06)',
                                                      color: copiedBatchStepId === step.id ? '#047857' : 'var(--text-primary)',
                                                    }}
                                                  >
                                                    <span className="inline-flex items-center gap-1">
                                                      <Copy className="w-3 h-3" strokeWidth={1.8} />
                                                      {copiedBatchStepId === step.id ? '已复制' : '复制'}
                                                    </span>
                                                  </button>
                                                  <button
                                                    onClick={() => setExpandedBatchStepId((prev) => (prev === step.id ? null : step.id))}
                                                    className="px-1.5 py-0.5 rounded text-[10px]"
                                                    style={{
                                                      background: expandedBatchStepId === step.id ? 'rgba(37,99,235,0.12)' : 'rgba(15,23,42,0.06)',
                                                      color: expandedBatchStepId === step.id ? '#1d4ed8' : 'var(--text-primary)',
                                                    }}
                                                  >
                                                    {expandedBatchStepId === step.id ? '收起' : '展开'}
                                                  </button>
                                                </div>
                                              </div>
                                              {expandedBatchStepId === step.id && (
                                                <div className="mt-1.5 space-y-1">
                                                  <p className="text-[10px] text-text-secondary">
                                                    {step.message || '无 message'}
                                                  </p>
                                                  <pre className="text-[10px] leading-snug p-1 rounded bg-bg-tertiary text-text-muted overflow-x-auto">
                                                    {safeStringify(step.params || {})}
                                                  </pre>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {batchHasMore && (
                            <button
                              onClick={handleLoadMoreBatchHistory}
                              disabled={batchHistoryLoading}
                              className="w-full px-2 py-1 rounded-md text-[11px] transition-colors border border-border-secondary"
                              style={{
                                background: 'rgba(15,23,42,0.04)',
                                color: 'var(--text-primary)',
                                cursor: batchHistoryLoading ? 'wait' : 'pointer',
                              }}
                            >
                              {batchHistoryLoading ? '加载中…' : '加载更多批次'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {serverHistory.length === 0 && batchHistory.length === 0 && !historyLoading && !batchHistoryLoading && (
                      <p className="text-[11px] text-text-muted px-1 py-2">当前筛选条件下暂无回执</p>
                    )}
                  </div>
                </div>
              )}
              
              {/* Status Badge */}
              <div 
                className="absolute bottom-4 left-4 flex items-center gap-2 px-4 py-2 rounded-full text-sm border border-border-primary"
                style={{ 
                  background: 'rgba(255,255,255,0.9)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {studentId ? (
                  <>
                    <span className="flex items-center gap-1 text-text-secondary"><User className="w-4 h-4" strokeWidth={1.5} />{studentName}</span>
                    {mbtiCode && (
                      <span 
                        className="px-2 py-0.5 rounded-full font-medium text-xs"
                        style={{ background: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                      >
                        {mbtiCode}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-text-muted">完成 MBTI 测试查看个人画像</span>
                )}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Node Detail Panel */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ opacity: 0, x: 20, filter: 'blur(8px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, x: 20, filter: 'blur(8px)' }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="w-full md:w-80 flex-shrink-0"
            >
              <GlassCard variant="standard" color="white" className="h-full">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-text-primary">节点详情</h3>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-full transition-colors bg-bg-tertiary text-text-muted hover:bg-border-primary hover:text-text-secondary"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Node Icon and Name */}
                  <div 
                    className="flex items-center gap-3 p-4 rounded-xl bg-bg-primary"
                  >
                    <div 
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xl shadow-lg"
                      style={{ backgroundColor: selectedNode.color || primary[500] }}
                    >
                      {selectedNode.type === 'mbti' && <Brain className="w-6 h-6" strokeWidth={1.5} />}
                      {selectedNode.type === 'career' && <Briefcase className="w-6 h-6" strokeWidth={1.5} />}
                      {selectedNode.type === 'skill' && <Zap className="w-6 h-6" strokeWidth={1.5} />}
                      {selectedNode.type === 'course' && <BookOpen className="w-6 h-6" strokeWidth={1.5} />}
                      {selectedNode.type === 'student' && <User className="w-6 h-6" strokeWidth={1.5} />}
                      {selectedNode.type === 'learning_path' && <Route className="w-6 h-6" strokeWidth={1.5} />}
                    </div>
                    <div>
                      <p className="font-semibold text-lg text-text-primary">{selectedNode.name}</p>
                      <p className="text-sm text-text-muted">
                        {selectedNode.type === 'mbti' && 'MBTI 性格类型'}
                        {selectedNode.type === 'career' && '职业方向'}
                        {selectedNode.type === 'skill' && '技能'}
                        {selectedNode.type === 'course' && '课程'}
                        {selectedNode.type === 'student' && '学生'}
                        {selectedNode.type === 'learning_path' && '学习路径'}
                      </p>
                    </div>
                  </div>

                  {selectedNode.description && (
                    <div 
                      className="p-4 rounded-xl bg-bg-primary"
                    >
                      <span 
                        className="text-xs uppercase tracking-wider text-text-muted"
                      >
                        描述
                      </span>
                      <p 
                        className="text-sm mt-2 leading-relaxed text-text-secondary"
                      >
                        {selectedNode.description}
                      </p>
                    </div>
                  )}

                  {/* Action Button */}
                  {(selectedNode.type === 'career' || selectedNode.type === 'mbti') && (
                    <button
                      onClick={handleNodeAction}
                      className="w-full px-4 py-3 rounded-xl font-medium transition-all"
                      style={{ 
                        background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`,
                        color: 'white',
                      }}
                    >
                      查看详情 →
                    </button>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
