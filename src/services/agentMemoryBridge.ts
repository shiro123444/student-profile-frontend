export type AgentMemoryScope = 'notes' | 'global'
export type AgentMemoryKind = 'summary' | 'revision'

export interface AgentMemoryEvent {
  id: string
  scope: AgentMemoryScope
  kind: AgentMemoryKind
  agent: string
  noteId?: string
  noteTitle?: string
  summary: string
  tools?: string[]
  createdAt: number
  beforeHash?: string
  afterHash?: string
  anchor?: string
  tags?: string[]
  score?: number
}

interface MemoryRevisionApplyResult {
  ok: boolean
  message: string
  nextContent?: string
  backupHash?: string
}

const EVENT_KEY = 'pathmind.agent.memory.v2'
const SNAPSHOT_KEY = 'pathmind.agent.memory.snapshots.v1'
const AUTO_BACKUP_KEY = 'pathmind.agent.memory.backups.v1'
const MAX_ITEMS = 120
const MAX_SNAPSHOTS = 240

function normalizeTags(input: string[]): string[] {
  return [...new Set(input.map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(0, 16)
}

function hashContent(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = (hash * 0x01000193) >>> 0
  }
  return `h${hash.toString(16)}_${text.length}`
}

function extractTagsFromText(source: string): string[] {
  const normalized = (source || '').toLowerCase()
  if (!normalized) return []
  const tokens = normalized
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 24)
  return normalizeTags(tokens.slice(0, 48))
}

function loadEvents(): AgentMemoryEvent[] {
  try {
    const raw = localStorage.getItem(EVENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AgentMemoryEvent => (
      item && typeof item === 'object'
      && typeof item.id === 'string'
      && typeof item.scope === 'string'
      && typeof item.agent === 'string'
      && typeof item.summary === 'string'
      && typeof item.createdAt === 'number'
    )).map((item) => ({
      ...item,
      kind: item.kind === 'revision' ? 'revision' : 'summary',
      tags: normalizeTags(Array.isArray(item.tags) ? item.tags : []),
    }))
  } catch {
    return []
  }
}

function saveEvents(events: AgentMemoryEvent[]) {
  try {
    localStorage.setItem(EVENT_KEY, JSON.stringify(events.slice(-MAX_ITEMS)))
  } catch {
    // ignore
  }
}

function loadSnapshots(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function saveSnapshots(snapshots: Record<string, string>) {
  try {
    const entries = Object.entries(snapshots)
    const trimmed = entries.length > MAX_SNAPSHOTS
      ? Object.fromEntries(entries.slice(entries.length - MAX_SNAPSHOTS))
      : snapshots
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(trimmed))
  } catch {
    // ignore
  }
}

function saveAutoBackup(noteId: string | undefined, hash: string) {
  if (!noteId) return
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    const next = {
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      [noteId]: hash,
    }
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

function jaccardScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let intersection = 0
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1
  }
  const union = new Set([...leftSet, ...rightSet]).size
  return union > 0 ? intersection / union : 0
}

export function storeContentSnapshot(content: string): string {
  const normalized = content || ''
  const hash = hashContent(normalized)
  const snapshots = loadSnapshots()
  if (!snapshots[hash]) {
    snapshots[hash] = normalized
    saveSnapshots(snapshots)
  }
  return hash
}

export function getSnapshotContent(hash: string): string | null {
  if (!hash) return null
  const snapshots = loadSnapshots()
  return snapshots[hash] ?? null
}

export function appendAgentMemory(event: Omit<AgentMemoryEvent, 'id' | 'createdAt' | 'kind'>) {
  const next: AgentMemoryEvent = {
    ...event,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    kind: 'summary',
    tags: normalizeTags(event.tags || extractTagsFromText(`${event.noteTitle || ''} ${event.summary || ''}`)),
  }
  const all = [...loadEvents(), next]
  saveEvents(all)
}

export function appendRevisionMemory(params: {
  scope?: AgentMemoryScope
  agent: string
  noteId?: string
  noteTitle?: string
  summary: string
  beforeContent: string
  afterContent: string
  anchor?: string
  tools?: string[]
  tags?: string[]
}) {
  const beforeHash = storeContentSnapshot(params.beforeContent || '')
  const afterHash = storeContentSnapshot(params.afterContent || '')
  if (beforeHash === afterHash) return
  const next: AgentMemoryEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    scope: params.scope || 'notes',
    kind: 'revision',
    agent: params.agent,
    noteId: params.noteId,
    noteTitle: params.noteTitle,
    summary: (params.summary || '执行了一次笔记改写').slice(0, 200),
    tools: params.tools || [],
    beforeHash,
    afterHash,
    anchor: params.anchor,
    tags: normalizeTags(params.tags || extractTagsFromText(`${params.noteTitle || ''} ${params.summary || ''}`)),
  }
  const all = [...loadEvents(), next]
  saveEvents(all)
}

export function getLatestAgentMemories(limit = 10, scope?: AgentMemoryScope) {
  const all = loadEvents()
  const filtered = scope ? all.filter((item) => item.scope === scope) : all
  return filtered.slice(-limit)
}

export function getRelevantMemories(options: {
  noteId?: string
  noteTitle?: string
  noteContent?: string
  limit?: number
}) {
  const all = loadEvents()
  const noteId = options.noteId || ''
  const currentTags = normalizeTags(extractTagsFromText(`${options.noteTitle || ''} ${options.noteContent || ''}`))
  const scored = all
    .map((item) => {
      let score = 0
      if (noteId && item.noteId === noteId) score += 2.8
      if (options.noteTitle && item.noteTitle && item.noteTitle.trim().toLowerCase() === options.noteTitle.trim().toLowerCase()) {
        score += 1.2
      }
      const similarity = jaccardScore(currentTags, item.tags || [])
      score += similarity * 2.5
      if (item.kind === 'revision') score += 0.35
      return { ...item, score }
    })
    .filter((item) => item.score > 0.12)
    .sort((left, right) => {
      if ((right.score || 0) !== (left.score || 0)) return (right.score || 0) - (left.score || 0)
      return right.createdAt - left.createdAt
    })

  return scored.slice(0, Math.max(1, Math.min(options.limit || 8, 20)))
}

export function applyRevision(revisionId: string, currentContent: string): MemoryRevisionApplyResult {
  const event = loadEvents().find((item) => item.id === revisionId && item.kind === 'revision')
  if (!event || !event.afterHash) {
    return { ok: false, message: '未找到可回溯版本。' }
  }
  const next = getSnapshotContent(event.afterHash)
  if (next == null) {
    return { ok: false, message: '回溯快照不存在。' }
  }
  const backupHash = storeContentSnapshot(currentContent || '')
  saveAutoBackup(event.noteId, backupHash)
  return {
    ok: true,
    message: '已准备回溯版本，可应用到当前笔记。',
    nextContent: next,
    backupHash,
  }
}
