import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, Loader2, Play, StopCircle } from 'lucide-react'
import {
  useAgentStream,
  type AgentMessage,
  type AgentStreamCallbacks,
  type OrchestratorEvent,
} from '../../hooks/useAgentStream'
import {
  agentApi,
  type AgentGatewayMetricsHistoryResponse,
  type AgentGatewayTrendPoint,
  type AgentGatewayMetricsResponse,
  type ApprovalMetricsResponse,
} from '../../services/api'

interface AgentClusterBoardProps {
  className?: string
  title?: string
  subtitle?: string
  defaultAgent: string
  studentId?: string
  probePrompt?: string
  codingMode?: boolean
}

type ClusterStage = 'planner' | 'gather' | 'act' | 'synthesize'
type StageState = 'idle' | 'running' | 'done'
const TELEMETRY_CACHE_KEY = 'pathmind:agent:telemetry:global:v1'
const DEFAULT_TREND_WINDOW_SEC = 900
const TREND_WINDOWS: Array<{ label: string; value: number }> = [
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '1h', value: 3600 },
]

function createInitialStages(): Record<ClusterStage, StageState> {
  return {
    planner: 'idle',
    gather: 'idle',
    act: 'idle',
    synthesize: 'idle',
  }
}

function stageClass(state: StageState): string {
  if (state === 'running') return 'border-blue-300 text-blue-700 bg-blue-50 dark:border-blue-400/50 dark:bg-blue-500/15 dark:text-blue-200'
  if (state === 'done') return 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-400/50 dark:bg-emerald-500/15 dark:text-emerald-200'
  return 'border-border-primary text-text-muted bg-bg-primary'
}

function toStageLabel(stage: ClusterStage): string {
  if (stage === 'planner') return 'Planner'
  if (stage === 'gather') return 'Gather'
  if (stage === 'act') return 'Act'
  return 'Synthesize'
}

interface GlobalTelemetrySnapshot {
  gateway?: AgentGatewayMetricsResponse
  history?: AgentGatewayMetricsHistoryResponse
  approvals?: ApprovalMetricsResponse
  updatedAt?: number
  selectedAgent?: string
  selectedWorkspace?: string
  windowSec?: number
}

interface TopDimensionItem {
  key: string
  requests: number
  status4xx: number
  status5xx: number
}

type TrendRiskLevel = 'healthy' | 'warning' | 'critical'

interface TrendSliceSummary {
  requestsTotal: number
  errorsTotal: number
  errorRate: number
  latencyAvgMs: number
}

interface TrendComparison {
  firstHalf: TrendSliceSummary
  secondHalf: TrendSliceSummary
  deltaRequests: number
  deltaRequestsPct: number
  deltaErrorRate: number
  deltaLatencyMs: number
}

function loadTelemetryCache(): GlobalTelemetrySnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(TELEMETRY_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GlobalTelemetrySnapshot
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function saveTelemetryCache(snapshot: GlobalTelemetrySnapshot) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TELEMETRY_CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // noop
  }
}

function formatTelemetryTime(ts?: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function topDimensions(
  source: Record<string, {
    requests_total: number
    status_counts: Record<string, number>
  }> | undefined,
  limit = 3,
): TopDimensionItem[] {
  if (!source) return []
  return Object.entries(source)
    .map(([key, value]) => ({
      key,
      requests: value?.requests_total || 0,
      status4xx: value?.status_counts?.['4xx'] || 0,
      status5xx: value?.status_counts?.['5xx'] || 0,
    }))
    .filter((item) => item.requests > 0)
    .sort((left, right) => right.requests - left.requests)
    .slice(0, limit)
}

function classifyTrendRisk(point: AgentGatewayTrendPoint): TrendRiskLevel {
  const requests = Math.max(point.requests_total || 0, 0)
  const errors = Math.max((point.status_4xx || 0) + (point.status_5xx || 0), 0)
  const errorRate = requests > 0 ? errors / requests : 0
  const latency = point.latency_avg_ms || 0

  if (
    (point.status_5xx || 0) > 0 ||
    (point.upstream_unavailable_503_total || 0) > 0 ||
    (requests >= 3 && errorRate >= 0.3) ||
    latency >= 2500
  ) {
    return 'critical'
  }

  if (
    errors > 0 ||
    (point.rate_limited_429_total || 0) > 0 ||
    latency >= 1200
  ) {
    return 'warning'
  }

  return 'healthy'
}

function trendRiskLabel(level: TrendRiskLevel): string {
  if (level === 'critical') return '高风险'
  if (level === 'warning') return '观察中'
  return '稳定'
}

function trendRiskTextClass(level: TrendRiskLevel): string {
  if (level === 'critical') return 'text-rose-500'
  if (level === 'warning') return 'text-amber-500'
  return 'text-emerald-500'
}

function trendRiskBarClass(level: TrendRiskLevel, isActive: boolean): string {
  if (level === 'critical') {
    return isActive ? 'bg-rose-400/90 ring-2 ring-rose-300/60' : 'bg-rose-400/80 hover:bg-rose-400/95'
  }
  if (level === 'warning') {
    return isActive ? 'bg-amber-400/90 ring-2 ring-amber-300/60' : 'bg-amber-400/80 hover:bg-amber-400/95'
  }
  return isActive ? 'bg-emerald-400/90 ring-2 ring-emerald-300/60' : 'bg-emerald-400/80 hover:bg-emerald-400/95'
}

function summarizeTrendSlice(points: AgentGatewayTrendPoint[]): TrendSliceSummary {
  if (!points.length) {
    return {
      requestsTotal: 0,
      errorsTotal: 0,
      errorRate: 0,
      latencyAvgMs: 0,
    }
  }

  let requestsTotal = 0
  let errorsTotal = 0
  let weightedLatency = 0

  for (const point of points) {
    const requests = point.requests_total || 0
    const errors = (point.status_4xx || 0) + (point.status_5xx || 0)
    requestsTotal += requests
    errorsTotal += errors
    weightedLatency += (point.latency_avg_ms || 0) * requests
  }

  const errorRate = requestsTotal > 0 ? errorsTotal / requestsTotal : 0
  const latencyAvgMs = requestsTotal > 0 ? weightedLatency / requestsTotal : 0

  return { requestsTotal, errorsTotal, errorRate, latencyAvgMs }
}

function buildTrendComparison(points: AgentGatewayTrendPoint[]): TrendComparison | null {
  if (points.length < 4) return null
  const split = Math.floor(points.length / 2)
  const firstHalf = summarizeTrendSlice(points.slice(0, split))
  const secondHalf = summarizeTrendSlice(points.slice(split))
  const deltaRequests = secondHalf.requestsTotal - firstHalf.requestsTotal
  const deltaRequestsPct = firstHalf.requestsTotal > 0
    ? (deltaRequests / firstHalf.requestsTotal) * 100
    : secondHalf.requestsTotal > 0 ? 100 : 0

  return {
    firstHalf,
    secondHalf,
    deltaRequests,
    deltaRequestsPct,
    deltaErrorRate: secondHalf.errorRate - firstHalf.errorRate,
    deltaLatencyMs: secondHalf.latencyAvgMs - firstHalf.latencyAvgMs,
  }
}

function formatSignedNumber(value: number, digits = 1, suffix = ''): string {
  if (!Number.isFinite(value)) return `0${suffix}`
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(digits)}${suffix}`
}

export default function AgentClusterBoard({
  className = '',
  title = 'Agent 集群实时看板',
  subtitle = '可视化观察 planner → gather → act → synthesize 执行链路',
  defaultAgent,
  studentId,
  probePrompt,
  codingMode = false,
}: AgentClusterBoardProps) {
  const cachedTelemetry = useMemo(() => loadTelemetryCache() || {}, [])

  const [stages, setStages] = useState<Record<ClusterStage, StageState>>(createInitialStages)
  const [runtimeMeta, setRuntimeMeta] = useState<{ engine?: string; model?: string; mode?: string } | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const [telemetry, setTelemetry] = useState<GlobalTelemetrySnapshot>(cachedTelemetry)
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>(cachedTelemetry.selectedAgent || '')
  const [selectedWorkspaceFilter, setSelectedWorkspaceFilter] = useState<string>(cachedTelemetry.selectedWorkspace || '')
  const [trendWindowSec, setTrendWindowSec] = useState<number>(cachedTelemetry.windowSec || DEFAULT_TREND_WINDOW_SEC)
  const [activeTrendTs, setActiveTrendTs] = useState<number | null>(null)
  const [telemetryLoading, setTelemetryLoading] = useState(false)
  const [telemetryError, setTelemetryError] = useState<string | null>(null)
  const historyBucketSec = useMemo(() => {
    const suggested = Math.floor(trendWindowSec / 24)
    return Math.max(15, Math.min(300, suggested || 60))
  }, [trendWindowSec])

  const pushEvent = useCallback((line: string) => {
    setEvents((prev) => [line, ...prev].slice(0, 8))
  }, [])

  const onOrchestrator = useCallback((event: OrchestratorEvent) => {
    if (event.stage === 'planned') {
      setStages({ planner: 'done', gather: 'running', act: 'idle', synthesize: 'idle' })
      pushEvent(`计划完成：${event.strategy || 'dag'} · ${event.selectedMode || 'balanced'}`)
      return
    }

    if (event.stage === 'layer_start' || event.stage === 'worker_start') {
      setStages((prev) => ({ ...prev, gather: 'done', act: 'running' }))
      pushEvent(`执行中：${event.title || event.nodeId || 'worker'}`)
      return
    }

    if (event.stage === 'critique_done' || event.stage === 'layer_done') {
      setStages((prev) => ({ ...prev, act: 'done', synthesize: 'running' }))
      pushEvent(`质量门：${event.critiquePass ? '通过' : '评估中'}`)
      return
    }

    if (event.stage === 'replan_start') {
      setStages((prev) => ({ ...prev, planner: 'running', gather: 'idle', act: 'idle', synthesize: 'idle' }))
      pushEvent('动态重规划启动')
      return
    }

    if (event.stage === 'replan_done') {
      setStages((prev) => ({ ...prev, planner: 'done', gather: 'running' }))
      pushEvent(`重规划${event.success ? '完成' : '失败'}`)
      return
    }
  }, [pushEvent])

  const refreshTelemetry = useCallback(async () => {
    setTelemetryLoading(true)
    setTelemetryError(null)
    try {
      const [gateway, approvals, history] = await Promise.all([
        agentApi.metrics({
          agent: selectedAgentFilter || undefined,
          workspace: selectedWorkspaceFilter || undefined,
          windowSec: trendWindowSec,
        }),
        agentApi.approvalMetrics(),
        agentApi.metricsHistory({
          scope: 'protected',
          agent: selectedAgentFilter || undefined,
          workspace: selectedWorkspaceFilter || undefined,
          windowSec: trendWindowSec,
          bucketSec: historyBucketSec,
        }),
      ])
      const snapshot: GlobalTelemetrySnapshot = {
        gateway,
        history,
        approvals,
        updatedAt: Math.floor(Date.now() / 1000),
        selectedAgent: selectedAgentFilter,
        selectedWorkspace: selectedWorkspaceFilter,
        windowSec: trendWindowSec,
      }
      setTelemetry(snapshot)
      if (
        !selectedAgentFilter &&
        !selectedWorkspaceFilter &&
        trendWindowSec === DEFAULT_TREND_WINDOW_SEC
      ) {
        saveTelemetryCache(snapshot)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'telemetry 获取失败'
      setTelemetryError(message)
    } finally {
      setTelemetryLoading(false)
    }
  }, [historyBucketSec, selectedAgentFilter, selectedWorkspaceFilter, trendWindowSec])

  useEffect(() => {
    void refreshTelemetry()
    const timer = window.setInterval(() => {
      void refreshTelemetry()
    }, 15000)
    return () => window.clearInterval(timer)
  }, [refreshTelemetry])

  const streamCallbacks = useMemo<AgentStreamCallbacks>(() => ({
    onMeta: (meta) => {
      setRuntimeMeta({ engine: meta.engine, model: meta.model, mode: meta.mode })
      setStages((prev) => ({ ...prev, planner: 'running' }))
      pushEvent(`路由：${meta.engine} · ${meta.model} · ${meta.mode}`)
    },
    onOrchestrator,
    onDone: () => {
      setStages({ planner: 'done', gather: 'done', act: 'done', synthesize: 'done' })
      pushEvent('任务完成')
      void refreshTelemetry()
    },
  }), [onOrchestrator, pushEvent, refreshTelemetry])

  const { messages, isStreaming, sendMessage, stop } = useAgentStream(streamCallbacks)

  const runProbe = useCallback(() => {
    const prompt = probePrompt || (codingMode
      ? '请快速规划并说明一个 coding 任务的执行链路，给出 3 步策略。'
      : '请快速规划并说明一个学习任务的执行链路，给出 3 步策略。')

    setStages(createInitialStages())
    setEvents([])
    setRuntimeMeta(null)

    sendMessage(prompt, {
      agentName: defaultAgent,
      studentId,
      runtime: {
        mode: codingMode ? 'balanced' : 'fast',
        orchestrator: {
          enabled: true,
          profile: codingMode ? 'coding_v1' : 'webagent_v1',
          plannerMode: 'balanced',
          executorMode: codingMode ? 'balanced' : 'fast',
          maxSteps: codingMode ? 6 : 4,
          maxWorkers: codingMode ? 2 : 3,
          workerTimeoutSec: 90,
          workerMaxRetries: 1,
          workerRetryBackoffMs: 500,
          critiqueEnabled: true,
          critiqueMode: 'balanced',
          dynamicReplanEnabled: true,
          maxReplans: 1,
        },
        ...(codingMode
          ? {
              coding: {
                enabled: true,
                workspaceId: 'default',
                approvalMode: 'per_call',
                allowNetwork: false,
                policyProfile: 'strict_v1',
              },
            }
          : {}),
      },
    })
  }, [codingMode, defaultAgent, probePrompt, sendMessage, studentId])

  const latestAssistant = useMemo(() => {
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      const message: AgentMessage | undefined = messages[idx]
      if (message?.role === 'assistant' && message.content?.trim()) {
        return message.content.trim().slice(0, 180)
      }
    }
    return ''
  }, [messages])

  const globalScope = telemetry.gateway?.global
  const protectedScope = telemetry.gateway?.scopes?.protected
  const filteredMetrics = telemetry.gateway?.filtered
  const statusCounts = filteredMetrics?.status_counts || globalScope?.status_counts || {}
  const status4xx = statusCounts['4xx'] || 0
  const status5xx = statusCounts['5xx'] || 0
  const requestsTotal = filteredMetrics?.requests_total ?? protectedScope?.requests_total ?? globalScope?.requests_total ?? 0
  const rateLimited429 = filteredMetrics?.rate_limited_429_total ?? protectedScope?.rate_limited_429_total ?? globalScope?.rate_limited_429_total ?? 0
  const upstream503 = filteredMetrics?.upstream_unavailable_503_total ?? protectedScope?.upstream_unavailable_503_total ?? globalScope?.upstream_unavailable_503_total ?? 0
  const circuitState = telemetry.gateway?.circuit?.current_state || '-'
  const approvalPending = telemetry.approvals?.pending ?? 0
  const approvalTimeout = telemetry.approvals?.timed_out ?? 0
  const approvalAvgWait = telemetry.approvals?.avg_wait_ms ?? 0
  const topAgents = topDimensions(protectedScope?.agents || globalScope?.agents, 3)
  const topWorkspaces = topDimensions(protectedScope?.workspaces || globalScope?.workspaces, 3)
  const trendData = (telemetry.gateway?.trend || []).slice(-24)
  const trendMax = trendData.reduce((max, point) => Math.max(max, point.requests_total || 0), 0) || 1
  const trendComparison = useMemo(
    () => buildTrendComparison(trendData),
    [trendData],
  )
  const trendRiskCounts = useMemo(() => {
    return trendData.reduce(
      (acc, point) => {
        const risk = classifyTrendRisk(point)
        acc[risk] += 1
        return acc
      },
      { healthy: 0, warning: 0, critical: 0 } as Record<TrendRiskLevel, number>,
    )
  }, [trendData])
  const activeTrendPoint = useMemo(() => {
    if (trendData.length === 0) return null
    if (activeTrendTs) {
      const matched = trendData.find((point) => point.ts === activeTrendTs)
      if (matched) return matched
    }
    return trendData[trendData.length - 1]
  }, [activeTrendTs, trendData])
  const activeTrendRisk = activeTrendPoint ? classifyTrendRisk(activeTrendPoint) : null
  const historySummary = telemetry.history?.summary
  const historyPoints = (telemetry.history?.points || []).slice(-24)
  const historyErrorTotal = (historySummary?.status_counts?.['4xx'] || 0) + (historySummary?.status_counts?.['5xx'] || 0)
  const historyErrorRate = (historySummary?.requests_total || 0) > 0
    ? (historyErrorTotal / (historySummary?.requests_total || 1)) * 100
    : 0
  const agentFilterOptions = useMemo(
    () => Object.keys(protectedScope?.agents || globalScope?.agents || {}).sort(),
    [protectedScope?.agents, globalScope?.agents],
  )
  const workspaceFilterOptions = useMemo(
    () => Object.keys(protectedScope?.workspaces || globalScope?.workspaces || {}).sort(),
    [protectedScope?.workspaces, globalScope?.workspaces],
  )

  useEffect(() => {
    if (trendData.length === 0) {
      setActiveTrendTs(null)
      return
    }

    if (activeTrendTs && trendData.some((point) => point.ts === activeTrendTs)) {
      return
    }

    setActiveTrendTs(trendData[trendData.length - 1].ts)
  }, [activeTrendTs, trendData])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_12px_40px_rgba(15,23,42,0.08)] dark:border-white/20 dark:bg-white/10 p-4 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Bot size={16} />
            {title}
          </p>
          <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {runtimeMeta && (
            <span className="px-2 py-1 rounded-lg text-[11px] border border-border-primary bg-bg-primary text-text-muted">
              {runtimeMeta.engine} · {runtimeMeta.model} · {runtimeMeta.mode}
            </span>
          )}

          <button
            onClick={isStreaming ? stop : runProbe}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-primary bg-bg-primary text-text-secondary hover:border-primary-300 transition-all"
          >
            {isStreaming ? (
              <>
                <StopCircle size={13} /> 停止
              </>
            ) : (
              <>
                <Play size={13} /> 启动探针
              </>
            )}
          </button>
          <button
            onClick={() => void refreshTelemetry()}
            disabled={telemetryLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-primary bg-bg-primary text-text-secondary hover:border-primary-300 transition-all disabled:opacity-50"
          >
            {telemetryLoading ? <Loader2 size={13} className="animate-spin" /> : null}
            刷新遥测
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border-primary bg-bg-primary p-3 mb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <p className="text-[11px] font-semibold text-text-primary">全局 Telemetry（跨页统一）</p>
          <p className="text-[10px] text-text-muted">
            更新于 {formatTelemetryTime(telemetry.updatedAt)}
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-2 mb-2">
          <label className="flex flex-col gap-1 text-[10px] text-text-muted">
            时间窗口
            <select
              value={trendWindowSec}
              onChange={(event) => setTrendWindowSec(Number(event.target.value))}
              className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1 text-xs text-text-primary outline-none"
            >
              {TREND_WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-text-muted">
            Agent 过滤
            <select
              value={selectedAgentFilter}
              onChange={(event) => setSelectedAgentFilter(event.target.value)}
              className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1 text-xs text-text-primary outline-none"
            >
              <option value="">全部</option>
              {agentFilterOptions.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-text-muted">
            Workspace 过滤
            <select
              value={selectedWorkspaceFilter}
              onChange={(event) => setSelectedWorkspaceFilter(event.target.value)}
              className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1 text-xs text-text-primary outline-none"
            >
              <option value="">全部</option>
              {workspaceFilterOptions.map((workspace) => (
                <option key={workspace} value={workspace}>
                  {workspace}
                </option>
              ))}
            </select>
          </label>
        </div>
        {telemetryError && (
          <p className="text-[10px] text-red-500 mb-2">{telemetryError}</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5">
            <p className="text-[10px] text-text-muted">Req(protected)</p>
            <p className="text-xs font-semibold text-text-primary">{requestsTotal}</p>
          </div>
          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5">
            <p className="text-[10px] text-text-muted">4xx / 5xx</p>
            <p className="text-xs font-semibold text-text-primary">{status4xx} / {status5xx}</p>
          </div>
          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5">
            <p className="text-[10px] text-text-muted">429 / 503</p>
            <p className="text-xs font-semibold text-text-primary">{rateLimited429} / {upstream503}</p>
          </div>
          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5">
            <p className="text-[10px] text-text-muted">Circuit</p>
            <p className="text-xs font-semibold text-text-primary">{circuitState}</p>
          </div>
          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5">
            <p className="text-[10px] text-text-muted">Approval Pending</p>
            <p className="text-xs font-semibold text-text-primary">{approvalPending}</p>
          </div>
          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5">
            <p className="text-[10px] text-text-muted">Approval Timeout</p>
            <p className="text-xs font-semibold text-text-primary">{approvalTimeout}</p>
          </div>
          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5 md:col-span-2">
            <p className="text-[10px] text-text-muted">Approval Avg Wait</p>
            <p className="text-xs font-semibold text-text-primary">{approvalAvgWait.toFixed(1)} ms</p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-2 mt-2">
          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5">
            <p className="text-[10px] text-text-muted mb-1">Top Agents</p>
            {topAgents.length === 0 ? (
              <p className="text-[11px] text-text-muted">暂无数据</p>
            ) : (
              topAgents.map((item) => (
                <p key={item.key} className="text-[11px] text-text-primary truncate">
                  {item.key}: {item.requests}
                </p>
              ))
            )}
          </div>

          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5">
            <p className="text-[10px] text-text-muted mb-1">Top Workspaces</p>
            {topWorkspaces.length === 0 ? (
              <p className="text-[11px] text-text-muted">暂无数据</p>
            ) : (
              topWorkspaces.map((item) => (
                <p key={item.key} className="text-[11px] text-text-primary truncate">
                  {item.key}: {item.requests}
                </p>
              ))
            )}
          </div>

          <div className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1.5">
            <p className="text-[10px] text-text-muted mb-1">
              Request Trend ({telemetry.gateway?.trend_bucket_sec || 15}s · 窗口 {telemetry.gateway?.window_sec || trendWindowSec}s)
            </p>
            {trendData.length === 0 ? (
              <p className="text-[11px] text-text-muted">暂无趋势数据</p>
            ) : (
              <>
                <div className="flex items-end gap-1 h-14">
                  {trendData.map((point) => {
                    const height = Math.max(4, Math.round((point.requests_total / trendMax) * 44))
                    const isActive = point.ts === activeTrendPoint?.ts
                    const risk = classifyTrendRisk(point)
                    const errorRate = point.requests_total > 0
                      ? (((point.status_4xx || 0) + (point.status_5xx || 0)) / point.requests_total) * 100
                      : 0
                    const tooltip = `${formatTelemetryTime(point.ts)} · req ${point.requests_total} · 4xx ${point.status_4xx || 0} · 5xx ${point.status_5xx || 0} · err ${errorRate.toFixed(1)}% · latency ${(point.latency_avg_ms || 0).toFixed(1)}ms`
                    return (
                      <button
                        key={point.ts}
                        type="button"
                        onMouseEnter={() => setActiveTrendTs(point.ts)}
                        onFocus={() => setActiveTrendTs(point.ts)}
                        onClick={() => setActiveTrendTs(point.ts)}
                        className={`w-2 rounded-sm transition-all ${trendRiskBarClass(risk, isActive)}`}
                        style={{ height: `${height}px` }}
                        title={tooltip}
                        aria-label={tooltip}
                      />
                    )
                  })}
                </div>
                {activeTrendPoint ? (
                  <div className="mt-2 rounded-lg border border-border-primary/70 bg-bg-primary px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] text-text-muted">{formatTelemetryTime(activeTrendPoint.ts)}</p>
                      {activeTrendRisk ? (
                        <p className={`text-[10px] font-medium ${trendRiskTextClass(activeTrendRisk)}`}>
                          风险：{trendRiskLabel(activeTrendRisk)}
                        </p>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1">
                      <p className="text-[10px] text-text-muted">Req: <span className="text-text-primary">{activeTrendPoint.requests_total}</span></p>
                      <p className="text-[10px] text-text-muted">Latency: <span className="text-text-primary">{(activeTrendPoint.latency_avg_ms || 0).toFixed(1)}ms</span></p>
                      <p className="text-[10px] text-text-muted">4xx/5xx: <span className="text-text-primary">{activeTrendPoint.status_4xx || 0}/{activeTrendPoint.status_5xx || 0}</span></p>
                      <p className="text-[10px] text-text-muted">429/503: <span className="text-text-primary">{activeTrendPoint.rate_limited_429_total || 0}/{activeTrendPoint.upstream_unavailable_503_total || 0}</span></p>
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-emerald-500">稳定 {trendRiskCounts.healthy}</span>
                  <span className="text-[10px] text-amber-500">观察中 {trendRiskCounts.warning}</span>
                  <span className="text-[10px] text-rose-500">高风险 {trendRiskCounts.critical}</span>
                </div>
                {trendComparison ? (
                  <div className="mt-1 text-[10px] text-text-muted leading-relaxed">
                    <p>
                      后半段 vs 前半段：Req
                      <span className={trendComparison.deltaRequests >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                        {' '}{formatSignedNumber(trendComparison.deltaRequestsPct, 1, '%')}
                      </span>
                      ，错误率
                      <span className={trendComparison.deltaErrorRate <= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                        {' '}{formatSignedNumber(trendComparison.deltaErrorRate * 100, 1, 'pp')}
                      </span>
                      ，延迟
                      <span className={trendComparison.deltaLatencyMs <= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                        {' '}{formatSignedNumber(trendComparison.deltaLatencyMs, 1, 'ms')}
                      </span>
                    </p>
                    <p className="text-[10px] text-text-muted/80">
                      前半段 {trendComparison.firstHalf.requestsTotal} req / 后半段 {trendComparison.secondHalf.requestsTotal} req
                      {trendComparison.deltaRequests !== 0 ? `（Δ${trendComparison.deltaRequests > 0 ? '+' : ''}${trendComparison.deltaRequests}）` : ''}
                    </p>
                  </div>
                ) : null}
                {telemetry.history?.enabled ? (
                  <div className="mt-1 rounded-lg border border-border-primary/70 bg-bg-primary px-2 py-1.5">
                    <p className="text-[10px] text-text-muted">
                      Persisted History ({telemetry.history.bucket_sec}s bucket)
                    </p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      Req {historySummary?.requests_total || 0} · Error {historyErrorRate.toFixed(1)}% · Latency {(historySummary?.latency_avg_ms || 0).toFixed(1)}ms · Points {historyPoints.length}
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] text-text-muted mt-1">
                    Persisted History 未启用
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {(['planner', 'gather', 'act', 'synthesize'] as ClusterStage[]).map((stage) => (
          <div
            key={stage}
            className={`rounded-xl border px-3 py-2 transition-all ${stageClass(stages[stage])}`}
          >
            <p className="text-[10px] uppercase tracking-wide">{toStageLabel(stage)}</p>
            <p className="text-sm font-semibold mt-1 flex items-center gap-1.5">
              {stages[stage] === 'running' ? <Loader2 size={13} className="animate-spin" /> : null}
              {stages[stage] === 'idle' ? 'idle' : stages[stage] === 'running' ? 'running' : 'done'}
            </p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border-primary bg-bg-primary p-3">
          <p className="text-[11px] font-semibold text-text-primary mb-2">执行事件</p>
          {events.length === 0 ? (
            <p className="text-xs text-text-muted">点击“启动探针”后会显示实时链路事件。</p>
          ) : (
            <div className="space-y-1.5">
              {events.map((line, idx) => (
                <motion.p
                  key={`${line}-${idx}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-text-muted"
                >
                  • {line}
                </motion.p>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border-primary bg-bg-primary p-3">
          <p className="text-[11px] font-semibold text-text-primary mb-2">最近输出</p>
          <p className="text-xs text-text-muted leading-relaxed">
            {latestAssistant || (isStreaming ? '模型思考中...' : '暂无输出')}
          </p>
        </div>
      </div>
    </motion.div>
  )
}
