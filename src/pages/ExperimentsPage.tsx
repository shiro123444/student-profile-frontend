import { useState, useEffect, lazy, Suspense } from 'react'
import { motion } from 'framer-motion'
import { GlassCard } from '../components/ui'
import { primary } from '../theme/colors'
import { useAuth } from '../contexts/AuthContext'
import { studentApi, experimentApi } from '../services/api'
import type { Experiment } from '../services/api'
import { FlaskConical, Clock, CheckCircle, Play, Loader2, AlertCircle, Award, Bot } from 'lucide-react'
import AIInsightButton from '../components/ui/AIInsightButton'
import { ErrorBoundary } from '../components/ErrorBoundary'

const AgentClusterBoard = lazy(() => import('../components/agent/AgentClusterBoard'))
const TaskReceiptPanel = lazy(() => import('../components/agent/TaskReceiptPanel'))

function getDifficultyStyle(difficulty: string) {
  switch (difficulty) {
    case 'easy': return { bg: 'var(--tag-success-bg)', color: 'var(--tag-success-text)', label: '简单' }
    case 'medium': return { bg: 'var(--tag-warning-bg)', color: 'var(--tag-warning-text)', label: '中等' }
    case 'hard': return { bg: 'var(--tag-danger-bg)', color: 'var(--tag-danger-text)', label: '困难' }
    default: return { bg: 'var(--tag-bg)', color: 'var(--tag-text)', label: difficulty }
  }
}

function getStatusStyle(status?: string) {
  switch (status) {
    case 'completed': return { icon: CheckCircle, color: '#10B981', label: '已完成' }
    case 'in_progress': return { icon: Clock, color: '#F59E0B', label: '进行中' }
    default: return { icon: Play, color: '#64748B', label: '未开始' }
  }
}

export default function ExperimentsPage() {
  const { user } = useAuth()
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [showSystemPanels, setShowSystemPanels] = useState(false)

  useEffect(() => {
    if (!user?.id) {
      setLoading(false)
      return
    }
    studentApi
      .getExperiments(user.id)
      .then((data) => setExperiments(data || []))
      .catch((err) => {
        // Fallback: try getting all experiments
        return experimentApi.getAll().then((data) => setExperiments(data || [])).catch(() => {
          setError(err.message || '获取实验列表失败')
        })
      })
      .finally(() => setLoading(false))
  }, [user?.id])

  const handleStart = async (experimentId: string) => {
    if (!user?.id || startingId) return
    setStartingId(experimentId)
    try {
      await experimentApi.start(experimentId, user.id)
      // Update status locally
      setExperiments((prev) =>
        prev.map((e) => e.id === experimentId ? { ...e, status: 'in_progress' } : e)
      )
    } catch {
      // silently fail
    } finally {
      setStartingId(null)
    }
  }

  const completedCount = experiments.filter((e) => e.status === 'completed').length
  const avgScore = experiments
    .filter((e) => e.score != null)
    .reduce((sum, e, _, arr) => sum + (e.score || 0) / arr.length, 0)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-text-muted" strokeWidth={1.5} />
          <p className="text-text-secondary">加载实验列表...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <GlassCard variant="standard" color="white" className="p-8 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" strokeWidth={1.5} />
          <h2 className="text-lg font-bold text-text-primary mb-2">加载失败</h2>
          <p className="text-text-muted mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 rounded-full text-white font-medium"
            style={{ background: primary[700] }}
          >
            重试
          </button>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_32px_rgba(15,23,42,0.08)] dark:border-white/20 dark:bg-white/10 px-5 py-4"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-text-primary mb-1">实验管理</h1>
            <p className="text-text-muted max-w-3xl">
              聚焦实验目标、进度和结果。系统日志与集群编排信息默认折叠，按需查看即可。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSystemPanels((prev) => !prev)}
            className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-border-primary bg-bg-primary text-text-muted hover:text-text-primary hover:border-primary-300 transition-all"
          >
            <Bot size={14} />
            {showSystemPanels ? '隐藏系统细节' : '显示系统细节'}
          </button>
        </div>
      </motion.div>

      {showSystemPanels && (
        <>
          <ErrorBoundary
            resetKey={`${user?.id || 'anonymous'}:${experiments.length}`}
            fallback={(
              <div className="mb-6 rounded-2xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-xs text-amber-700">
                Agent 看板暂时不可用，但实验列表功能不受影响。
              </div>
            )}
          >
            <Suspense fallback={(
              <div className="mb-6 rounded-2xl border border-border-primary bg-bg-secondary/70 px-4 py-3 text-xs text-text-muted">
                正在加载 Agent 看板...
              </div>
            )}
            >
              <AgentClusterBoard
                className="mb-6"
                defaultAgent="web-coder"
                studentId={user?.id}
                codingMode
                probePrompt="请针对实验管理场景，给出一个代码实验任务的执行链路与关键风险点。"
              />
            </Suspense>
          </ErrorBoundary>

          <ErrorBoundary
            resetKey={`${user?.id || 'anonymous'}:${experiments.length}`}
            fallback={(
              <div className="mb-6 rounded-2xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-xs text-amber-700">
                回执面板暂时不可用，请刷新后重试。
              </div>
            )}
          >
            <Suspense fallback={(
              <div className="mb-6 rounded-2xl border border-border-primary bg-bg-secondary/70 px-4 py-3 text-xs text-text-muted">
                正在加载任务回执...
              </div>
            )}
            >
              <TaskReceiptPanel
                className="mb-6"
                title="实验链路任务回执"
                modules={['experiments', 'coding', 'advisor']}
                maxItems={5}
                emptyText="暂无实验任务回执，先在 AIAdvisor 启动实验复盘模板。"
              />
            </Suspense>
          </ErrorBoundary>
        </>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <motion.div initial={false} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <GlassCard variant="standard" color="blue">
            <div className="text-center">
              <p className="text-3xl font-black text-text-primary">{experiments.length}</p>
              <p className="text-xs text-text-muted mt-1">总实验数</p>
            </div>
          </GlassCard>
        </motion.div>
        <motion.div initial={false} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <GlassCard variant="standard" color="green">
            <div className="text-center">
              <p className="text-3xl font-black text-text-primary">{completedCount}</p>
              <p className="text-xs text-text-muted mt-1">已完成</p>
            </div>
          </GlassCard>
        </motion.div>
        <motion.div initial={false} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <GlassCard variant="standard" color="yellow">
            <div className="text-center">
              <p className="text-3xl font-black text-text-primary">{avgScore > 0 ? Math.round(avgScore) : '--'}</p>
              <p className="text-xs text-text-muted mt-1">平均分</p>
            </div>
          </GlassCard>
        </motion.div>
      </div>

      {/* Experiment List */}
      {experiments.length === 0 ? (
        <GlassCard variant="standard" color="white" className="p-8 text-center">
          <FlaskConical className="w-12 h-12 mx-auto mb-4 text-text-muted" strokeWidth={1.5} />
          <h2 className="text-lg font-bold text-text-primary mb-2">暂无实验</h2>
          <p className="text-text-muted">当前没有可用的实验任务</p>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {experiments.map((experiment, index) => {
            const diffStyle = getDifficultyStyle(experiment.difficulty)
            const statusInfo = getStatusStyle(experiment.status)
            const StatusIcon = statusInfo.icon

            return (
              <motion.div
                key={experiment.id}
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.05 }}
              >
                <GlassCard variant="standard" color="white">
                  <div className="flex items-start gap-4">
                    {/* Status icon */}
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${statusInfo.color}15` }}
                    >
                      <StatusIcon className="w-6 h-6" style={{ color: statusInfo.color }} strokeWidth={1.5} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-bold text-text-primary">{experiment.title}</h3>
                          <p className="text-sm text-text-secondary mt-1">{experiment.description}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 mt-3">
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ background: diffStyle.bg, color: diffStyle.color }}
                        >
                          {diffStyle.label}
                        </span>
                        <span className="text-xs text-text-muted flex items-center gap-1">
                          <Clock className="w-3 h-3" strokeWidth={1.5} />
                          {experiment.duration} 分钟
                        </span>
                        <span className="text-xs text-text-muted flex items-center gap-1">
                          <Award className="w-3 h-3" strokeWidth={1.5} />
                          满分 {experiment.maxScore}
                        </span>
                        {experiment.score != null && (
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: 'var(--tag-info-bg)', color: 'var(--tag-info-text)' }}
                          >
                            得分: {experiment.score}/{experiment.maxScore}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action */}
                    <div className="flex-shrink-0 flex flex-col items-end gap-2">
                      {experiment.status === 'completed' ? (
                        <span
                          className="px-4 py-2 text-sm font-semibold rounded-xl"
                          style={{ background: 'var(--tag-info-bg)', color: 'var(--tag-info-text)' }}
                        >
                          已完成
                        </span>
                      ) : (
                        <button
                          onClick={() => handleStart(experiment.id)}
                          disabled={startingId === experiment.id}
                          className="px-4 py-2 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                          style={{ background: primary[700] }}
                        >
                          {startingId === experiment.id ? (
                            <Loader2 className="w-4 h-4 animate-spin inline-block" strokeWidth={1.5} />
                          ) : experiment.status === 'in_progress' ? '继续' : '开始'}
                        </button>
                      )}
                      <AIInsightButton
                        agentName="code-reviewer"
                        prompt={`给我实验「${experiment.title}」的指导提示，包括关键概念和实现思路`}
                        studentId={user?.id}
                        label="AI 指导"
                      />
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
