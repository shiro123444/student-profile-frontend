import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileCheck2, SlidersHorizontal } from 'lucide-react'
import {
  TASK_RECEIPTS_UPDATED_EVENT,
  loadTaskReceipts,
  type TaskReceiptModule,
  type TaskReceiptRecord,
  type TaskReceiptStatus,
} from '../../services/taskReceiptStore'

interface TaskReceiptPanelProps {
  title?: string
  modules?: TaskReceiptModule[]
  maxItems?: number
  emptyText?: string
  className?: string
}

const STATUS_OPTIONS: Array<{ value: 'all' | TaskReceiptStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'success', label: '成功' },
  { value: 'partial', label: '部分成功' },
  { value: 'failed', label: '失败' },
  { value: 'queued', label: '排队中' },
]

function formatTimestamp(ts?: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusClass(status: TaskReceiptStatus): string {
  if (status === 'success') return 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600'
  if (status === 'partial') return 'bg-amber-500/10 border-amber-500/40 text-amber-600'
  if (status === 'failed') return 'bg-rose-500/10 border-rose-500/40 text-rose-600'
  if (status === 'running') return 'bg-sky-500/10 border-sky-500/40 text-sky-600'
  return 'bg-slate-500/10 border-slate-500/40 text-slate-600'
}

function exportReceipt(receipt: TaskReceiptRecord): void {
  const payload = JSON.stringify(receipt, null, 2)
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `task-receipt-${receipt.runId}.json`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function matchesModules(receipt: TaskReceiptRecord, modules: Set<TaskReceiptModule>): boolean {
  if (modules.size === 0) return true
  if (!Array.isArray(receipt.steps) || receipt.steps.length === 0) return false
  return receipt.steps.some((step) => modules.has(step.module))
}

export default function TaskReceiptPanel({
  title = '统一任务回执',
  modules,
  maxItems = 6,
  emptyText = '暂无任务回执记录',
  className,
}: TaskReceiptPanelProps) {
  const [receipts, setReceipts] = useState<TaskReceiptRecord[]>(() => loadTaskReceipts(80))
  const [statusFilter, setStatusFilter] = useState<'all' | TaskReceiptStatus>('all')
  const moduleSet = useMemo(() => new Set(modules || []), [modules])

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const custom = event as CustomEvent<TaskReceiptRecord[] | undefined>
      if (Array.isArray(custom.detail)) {
        setReceipts(custom.detail)
        return
      }
      setReceipts(loadTaskReceipts(80))
    }
    window.addEventListener(TASK_RECEIPTS_UPDATED_EVENT, onUpdate as EventListener)
    return () => {
      window.removeEventListener(TASK_RECEIPTS_UPDATED_EVENT, onUpdate as EventListener)
    }
  }, [])

  const filtered = useMemo(() => {
    return receipts
      .filter((item) => matchesModules(item, moduleSet))
      .filter((item) => statusFilter === 'all' || item.status === statusFilter)
      .slice(0, Math.max(1, maxItems))
  }, [receipts, moduleSet, statusFilter, maxItems])

  const totalRunning = useMemo(
    () => receipts.filter((item) => item.status === 'running').length,
    [receipts],
  )

  const handleExport = useCallback((receipt: TaskReceiptRecord) => {
    exportReceipt(receipt)
  }, [])

  return (
    <div
      className={[
        'rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:border-white/20 dark:bg-white/10 p-4',
        className || '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileCheck2 size={15} className="text-primary-500" />
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-border-primary bg-bg-primary text-text-muted">
            运行中 {totalRunning}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-text-muted" />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | TaskReceiptStatus)}
            className="text-xs rounded-lg border border-border-primary bg-bg-primary text-text-primary px-2 py-1 outline-none"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-text-muted">{emptyText}</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {filtered.map((receipt) => {
            const successSteps = receipt.steps.filter((item) => item.status === 'success').length
            return (
              <div
                key={receipt.runId}
                className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{receipt.label}</p>
                    <p className="text-[11px] text-text-muted">
                      {receipt.taskType} · {receipt.runId.slice(0, 12)}... · {formatTimestamp(receipt.updatedAt)}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusClass(receipt.status)}`}>
                    {receipt.status}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-text-muted">
                    steps {successSteps}/{receipt.steps.length} · approvals {receipt.approvals?.approved || 0}/{receipt.approvals?.requested || 0} · tools {receipt.toolCalls || 0}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleExport(receipt)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border-primary text-[11px] text-text-secondary hover:border-primary-300 hover:text-primary-600 transition-colors"
                  >
                    <Download size={12} />
                    导出
                  </button>
                </div>

                {receipt.message && (
                  <p className="mt-1 text-[11px] text-text-muted line-clamp-2">{receipt.message}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
