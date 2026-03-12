export type TaskReceiptStatus = 'running' | 'success' | 'failed' | 'partial' | 'queued'
export type TaskReceiptStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'
export type TaskReceiptModule =
  | 'advisor'
  | 'notes'
  | 'documents'
  | 'experiments'
  | 'graph'
  | 'pdf'
  | 'coding'
  | 'rag'
  | 'unknown'

export interface TaskReceiptStep {
  id: string
  label: string
  module: TaskReceiptModule
  status: TaskReceiptStepStatus
  tool?: string
  message?: string
  updatedAt: number
}

export interface TaskReceiptRecord {
  runId: string
  taskType: string
  label: string
  status: TaskReceiptStatus
  riskLevel?: 'low' | 'medium' | 'high'
  source?: 'api' | 'fallback' | 'stream' | 'local'
  startedAt: number
  updatedAt: number
  approvals?: {
    requested: number
    approved: number
    rejected: number
    timeout: number
  }
  toolCalls?: number
  message?: string
  steps: TaskReceiptStep[]
}

const STORAGE_KEY = 'pathmind_task_receipts_v1'
export const TASK_RECEIPTS_UPDATED_EVENT = 'pathmind:task-receipts-updated'

function normalizeStep(step: TaskReceiptStep): TaskReceiptStep {
  return {
    ...step,
    module: step.module || 'unknown',
    status: step.status || 'pending',
    updatedAt: Number.isFinite(step.updatedAt) ? step.updatedAt : Math.floor(Date.now() / 1000),
  }
}

function mergeSteps(current: TaskReceiptStep[], incoming: TaskReceiptStep[]): TaskReceiptStep[] {
  const map = new Map<string, TaskReceiptStep>()
  for (const item of current) {
    map.set(item.id, normalizeStep(item))
  }
  for (const item of incoming) {
    const prev = map.get(item.id)
    const normalized = normalizeStep(item)
    if (!prev) {
      map.set(item.id, normalized)
      continue
    }
    map.set(item.id, {
      ...prev,
      ...normalized,
      updatedAt: Math.max(prev.updatedAt, normalized.updatedAt),
    })
  }
  return Array.from(map.values())
}

export function loadTaskReceipts(limit = 40): TaskReceiptRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is TaskReceiptRecord => Boolean(item && typeof item === 'object' && typeof item.runId === 'string'))
      .map((item) => ({
        ...item,
        status: item.status || 'queued',
        startedAt: Number.isFinite(item.startedAt) ? item.startedAt : Math.floor(Date.now() / 1000),
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Math.floor(Date.now() / 1000),
        steps: Array.isArray(item.steps) ? item.steps.map(normalizeStep) : [],
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, Math.floor(limit)))
  } catch {
    return []
  }
}

export function saveTaskReceipts(receipts: TaskReceiptRecord[]): void {
  if (typeof window === 'undefined') return
  try {
    const next = [...receipts]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 80)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

export function upsertTaskReceipt(
  incoming: TaskReceiptRecord,
  options: { maxItems?: number } = {},
): TaskReceiptRecord[] {
  const current = loadTaskReceipts(options.maxItems || 80)
  const idx = current.findIndex((item) => item.runId === incoming.runId)

  const normalizedIncoming: TaskReceiptRecord = {
    ...incoming,
    status: incoming.status || 'queued',
    startedAt: Number.isFinite(incoming.startedAt) ? incoming.startedAt : Math.floor(Date.now() / 1000),
    updatedAt: Number.isFinite(incoming.updatedAt) ? incoming.updatedAt : Math.floor(Date.now() / 1000),
    steps: Array.isArray(incoming.steps) ? incoming.steps.map(normalizeStep) : [],
  }

  let next: TaskReceiptRecord[]
  if (idx === -1) {
    next = [normalizedIncoming, ...current]
  } else {
    const prev = current[idx]
    const merged: TaskReceiptRecord = {
      ...prev,
      ...normalizedIncoming,
      approvals: {
        requested: normalizedIncoming.approvals?.requested ?? prev.approvals?.requested ?? 0,
        approved: normalizedIncoming.approvals?.approved ?? prev.approvals?.approved ?? 0,
        rejected: normalizedIncoming.approvals?.rejected ?? prev.approvals?.rejected ?? 0,
        timeout: normalizedIncoming.approvals?.timeout ?? prev.approvals?.timeout ?? 0,
      },
      toolCalls: normalizedIncoming.toolCalls ?? prev.toolCalls ?? 0,
      steps: mergeSteps(prev.steps || [], normalizedIncoming.steps || []),
      updatedAt: Math.max(prev.updatedAt, normalizedIncoming.updatedAt),
    }
    next = [...current]
    next[idx] = merged
  }

  next = next.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, options.maxItems || 80)
  saveTaskReceipts(next)
  emitTaskReceiptsUpdated(next)
  return next
}

export function emitTaskReceiptsUpdated(receipts?: TaskReceiptRecord[]): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(TASK_RECEIPTS_UPDATED_EVENT, {
      detail: Array.isArray(receipts) ? receipts : undefined,
    }),
  )
}

export function clearTaskReceipts(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
  emitTaskReceiptsUpdated([])
}
