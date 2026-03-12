import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense, type MouseEvent as ReactMouseEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  ChevronDown,
} from 'lucide-react'
import { aiDispatchApi, notesApi, type Note, type NoteReorderPayload } from '../services/api'
import { useNote } from '../hooks/useNotes'
import { useNotesTree } from '../hooks/useNotesTree'
import { useDebouncedNoteTitleSave } from '../hooks/useDebouncedNoteTitleSave'
import {
  createBlankContextMenuItems,
  createEditorContextMenuItems,
  createFolderNodeContextMenuItems,
  createNoteNodeContextMenuItems,
} from './notesContextMenus'
import NoteSidebar from '../components/notes/NoteSidebar'
import NoteEditor from '../components/notes/NoteEditor'
import type { NoteEditorHandle, NoteEditorWikilinkHoverEvent } from '../components/notes/NoteEditor'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useContextMenu, type ContextMenuItem } from '../contexts/ContextMenuContext'
import {
  applyRevision,
  appendRevisionMemory,
  getRelevantMemories,
  getSnapshotContent,
  type AgentMemoryEvent,
} from '../services/agentMemoryBridge'
import {
  detectMarkdownCursorMode,
  hasBracketMismatch,
  isLikelyProseForCodeCompletion,
  type InlineCompletionMode,
} from '../services/inlineCompletionCore'
import type {
  NoteAIApplyResult,
  NoteAIEditPayload,
  NoteAIInlineReplacePatch,
  NoteWriteTransactionEvent,
} from '../components/notes/NoteAIPanel'

const NoteAIPanel = lazy(() => import('../components/notes/NoteAIPanel'))

function NoteEditorFallback({
  content,
  onChange,
  onRetry,
}: {
  content: string
  onChange: (value: string) => void
  onRetry?: () => void
}) {
  return (
    <div className="h-full rounded-2xl border border-amber-300/70 bg-amber-50/85 dark:bg-amber-900/20 px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          编辑器渲染异常，已自动切换稳定模式（持续自动保存）。
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 px-2.5 py-1 rounded-lg border border-amber-400/70 text-[11px] text-amber-700 dark:text-amber-300 hover:bg-amber-100/70 dark:hover:bg-amber-900/30 transition-colors"
          >
            重试编辑器
          </button>
        )}
      </div>
      <textarea
        value={content}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-0 flex-1 w-full resize-none rounded-xl border border-amber-300/70 bg-white/85 dark:bg-slate-900/45 p-3 text-sm leading-relaxed text-text-primary focus:outline-none focus:ring-2 focus:ring-amber-300/60"
        placeholder="在这里继续编辑笔记内容…"
      />
    </div>
  )
}

function unwrapMarkdownDocumentFence(source: string): string {
  const normalized = source.trim()
  if (!normalized) return normalized

  const wrapped = normalized.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  if (!wrapped) return normalized

  const inner = wrapped[1].trim()
  const looksLikeDocument = /(^|\n)\s{0,3}(#{1,6}\s+|- |\d+\.\s+|>\s+|\[\[.+\]\]|```)/.test(inner)
  return looksLikeDocument ? inner : normalized
}

function normalizeWikilinkTarget(raw: string): string {
  const normalized = raw.trim()
  if (!normalized) return ''
  const inner = normalized.replace(/^\[\[/, '').replace(/\]\]$/, '').trim()
  if (!inner) return ''
  return inner.split('|')[0].split('#')[0].trim()
}

function pickNoteByTitle(items: Note[], targetKey: string): Note | undefined {
  return items.find((item) => item.title.trim().toLowerCase() === targetKey)
    || items.find((item) => item.title.trim().toLowerCase().includes(targetKey))
}

function summarizeNotePreview(content: string): string {
  const normalized = (content || '')
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .trim()
  if (!normalized) return '空笔记，点击可自动创建内容。'
  const firstParagraph = normalized.split(/\n\s*\n/)[0] || normalized
  return firstParagraph.replace(/\s+/g, ' ').slice(0, 180)
}

function collectWikilinkTargets(markdown: string): string[] {
  const targets = new Set<string>()
  if (!markdown) return []
  const regex = /\[\[([^[\]]+)\]\]/g
  let match: RegExpExecArray | null = regex.exec(markdown)
  while (match) {
    const normalized = normalizeWikilinkTarget(match[1] || '')
    if (normalized) targets.add(normalized)
    match = regex.exec(markdown)
  }
  return [...targets]
}

function sanitizeInlineCandidateText(raw: string): string {
  const normalized = (raw || '')
    .replace(/\r/g, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^续写[:：]\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
    .slice(0, 220)
  if (!normalized) return ''
  if (/^[\[{(<]+$/.test(normalized)) return ''
  if (/^[}\])>]+$/.test(normalized)) return ''
  if (/^(candidates|candidate|suggestion)\s*[:：]?\s*$/i.test(normalized)) return ''
  return normalized
}

function isInlineSuggestionNoise(text: string): boolean {
  const normalized = (text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized) return true
  const noisePatterns = [
    'ai 服务出现错误',
    'ai服务出现错误',
    '请稍后再试',
    '暂时不可用',
    'service unavailable',
    'internal server error',
    'failed',
    'fallback',
    'error',
  ]
  return noisePatterns.some((pattern) => normalized.includes(pattern))
}

function parseInlineSuggestionCandidates(raw: string): string[] {
  if (!raw) return []

  // Clean model output: strip markdown fences and whitespace
  const cleaned = raw
    .replace(/^```[\w-]*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
  if (!cleaned) return []

  const dedup = new Set<string>()
  const push = (value: string) => {
    const normalized = sanitizeInlineCandidateText(value)
    if (!normalized) return
    if (isInlineSuggestionNoise(normalized)) return
    dedup.add(normalized)
  }

  // For chat-based completion, the raw output is usually clean text.
  // Only try structured parsing if output looks like JSON/XML.
  const looksStructured = /^\s*[{<\[]/.test(cleaned)

  if (looksStructured) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
        const candidates = parsed.candidates
        if (Array.isArray(candidates)) {
          candidates.forEach((item) => {
            if (typeof item === 'string') {
              push(item)
              return
            }
            if (item && typeof item === 'object') {
              const record = item as Record<string, unknown>
              if (typeof record.text === 'string') {
                push(record.text)
                return
              }
              if (typeof record.suggestion === 'string') {
                push(record.suggestion)
              }
            }
          })
        } else if (typeof parsed.suggestion === 'string') {
          push(parsed.suggestion)
        }
      } catch {
      }
    }
  }

  if (dedup.size === 0) {
    // Use raw output as-is (trim to reasonable length)
    const trimmed = cleaned.slice(0, 120).trim()
    if (trimmed) push(trimmed)
  }

  return [...dedup].slice(0, 3)
}

function validateInlineSuggestionCandidate(
  prefix: string,
  raw: string,
  mode: InlineCompletionMode,
): string | null {
  const normalized = sanitizeInlineCandidateText(raw)
  if (!normalized) return null
  if (isInlineSuggestionNoise(normalized)) return null
  if (mode === 'code' && isLikelyProseForCodeCompletion(normalized)) return null
  if (mode === 'code' && hasBracketMismatch(prefix + normalized)) return null
  return normalized
}

function hashInlineSuggestionSeed(seed: string): string {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return (hash >>> 0).toString(36)
}

function buildInlineSuggestionCacheKey(
  noteId: string,
  before: string,
  after = '',
  mode: InlineCompletionMode = 'prose',
  language = '',
): string {
  const seed = `${mode}:${language.toLowerCase()}|${before.replace(/\s+/g, ' ').trim().slice(-50)}|${after.replace(/\s+/g, ' ').trim().slice(0, 36)}`
  return `${noteId}:${hashInlineSuggestionSeed(seed)}`
}

function applyEditOperation(base: string, payload: NoteAIEditPayload): NoteAIApplyResult & { next: string; change: { from: number; to: number; insert: string } } {
  const incoming = unwrapMarkdownDocumentFence(payload.content)
  if (!incoming) {
    return { ok: false, message: 'AI 返回内容为空，未执行写入。', next: base, change: { from: 0, to: 0, insert: '' } }
  }

  if (payload.action === 'append') {
    const separator = base.trim().length > 0 ? '\n\n' : ''
    const insert = `${separator}${incoming}`
    return {
      ok: true,
      message: '已追加到笔记末尾。',
      next: `${base}${insert}`,
      change: { from: base.length, to: base.length, insert },
    }
  }

  if (payload.action === 'replace_all') {
    return {
      ok: true,
      message: '已用 AI 内容替换整篇笔记。',
      next: incoming,
      change: { from: 0, to: base.length, insert: incoming },
    }
  }

  const anchor = (payload.anchor || '').trim()
  if (!anchor) {
    return { ok: false, message: '该模式需要锚点文本。', next: base, change: { from: 0, to: 0, insert: '' } }
  }

  const anchorIndex = base.indexOf(anchor)
  if (anchorIndex < 0) {
    return { ok: false, message: `未找到锚点：${anchor}`, next: base, change: { from: 0, to: 0, insert: '' } }
  }

  if (payload.action === 'insert_after_anchor') {
    const insertAt = anchorIndex + anchor.length
    const insert = `\n\n${incoming}`
    return {
      ok: true,
      message: `已插入到锚点“${anchor}”后。`,
      next: `${base.slice(0, insertAt)}${insert}${base.slice(insertAt)}`,
      change: { from: insertAt, to: insertAt, insert },
    }
  }

  if (payload.action === 'replace_anchor') {
    const blockStartRaw = base.lastIndexOf('\n\n', anchorIndex)
    const blockEndRaw = base.indexOf('\n\n', anchorIndex + anchor.length)
    const blockStart = blockStartRaw === -1 ? 0 : blockStartRaw + 2
    const blockEnd = blockEndRaw === -1 ? base.length : blockEndRaw
    return {
      ok: true,
      message: `已替换锚点“${anchor}”所在段落。`,
      next: `${base.slice(0, blockStart)}${incoming}${base.slice(blockEnd)}`,
      change: { from: blockStart, to: blockEnd, insert: incoming },
    }
  }

  return { ok: false, message: '不支持的编辑动作。', next: base, change: { from: 0, to: 0, insert: '' } }
}

interface NoteAIHistoryState {
  undo: string[]
  redo: string[]
}

interface FolderNameDialogState {
  mode: 'create' | 'rename'
  title: string
  confirmLabel: string
  value: string
  parentID: string | null
  folderID: string | null
}

interface NoteTagsDialogState {
  noteID: string
  title: string
  value: string
}

interface NoteNameDialogState {
  noteID: string
  value: string
}

export default function NotesPage() {
  const { id: routeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { openContextMenu } = useContextMenu()

  const [activeNoteId, setActiveNoteId] = useState<string | null>(routeId || null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showAI, setShowAI] = useState(false)
  const [externalNotePrompt, setExternalNotePrompt] = useState<string | null>(null)
  const [editorComposing, setEditorComposing] = useState(false)
  const [inlineSuggestionPending, setInlineSuggestionPending] = useState(false)
  const autoInlineCompletionEnabled = true // Always enabled
  const [aiHealth, setAiHealth] = useState<'healthy' | 'degraded'>('healthy')
  const [aiAmbient, setAiAmbient] = useState<'idle' | 'thinking' | 'cache'>('idle')
  const [agentMemories, setAgentMemories] = useState<AgentMemoryEvent[]>([])
  const agentMemoriesRef = useRef(agentMemories)
  agentMemoriesRef.current = agentMemories
  const [memoryPreviewId, setMemoryPreviewId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [backlinks, setBacklinks] = useState<Note[]>([])
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const editContentRef = useRef(editContent)
  editContentRef.current = editContent
  const scheduleInlineSuggestionRef = useRef<((delayMs?: number) => void) | null>(null)
  const [editorNotice, setEditorNotice] = useState<string | null>(null)
  const [writeTxnNotice, setWriteTxnNotice] = useState<string | null>(null)
  const [editorFlashSignal, setEditorFlashSignal] = useState(0)
  const [editorSyncToken, setEditorSyncToken] = useState(0)
  const [folderNameDialog, setFolderNameDialog] = useState<FolderNameDialogState | null>(null)
  const [folderDialogError, setFolderDialogError] = useState<string | null>(null)
  const [folderDialogSaving, setFolderDialogSaving] = useState(false)
  const [noteTagsDialog, setNoteTagsDialog] = useState<NoteTagsDialogState | null>(null)
  const [noteTagsDialogError, setNoteTagsDialogError] = useState<string | null>(null)
  const [noteTagsDialogSaving, setNoteTagsDialogSaving] = useState(false)
  const [noteNameDialog, setNoteNameDialog] = useState<NoteNameDialogState | null>(null)
  const [noteNameDialogError, setNoteNameDialogError] = useState<string | null>(null)
  const [noteNameDialogSaving, setNoteNameDialogSaving] = useState(false)
  const [memoryExpanded, setMemoryExpanded] = useState(false)
  const [aiHistoryVersion, setAiHistoryVersion] = useState(0)
  const [wikilinkPreview, setWikilinkPreview] = useState<{
    target: string
    x: number
    y: number
    loading: boolean
    exists: boolean
    title?: string
    excerpt?: string
    summary?: string
    summaryLoading?: boolean
    summaryError?: string
    summaryReady?: boolean
    summaryEngine?: string
    summaryFallback?: boolean
  } | null>(null)
  const renderGuardRef = useRef<{ signature: string; retries: number }>({
    signature: '',
    retries: 0,
  })
  const userTypingSinceLoadRef = useRef(false)
  const lastInputAtRef = useRef(0)
  const noteEditorRef = useRef<NoteEditorHandle | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const folderDialogInputRef = useRef<HTMLInputElement | null>(null)
  const noteTagsDialogInputRef = useRef<HTMLInputElement | null>(null)
  const noteNameDialogInputRef = useRef<HTMLInputElement | null>(null)
  const wikilinkPreviewSeqRef = useRef(0)
  const wikilinkPreviewHideTimerRef = useRef<number | null>(null)
  const wikilinkSummaryAbortRef = useRef<AbortController | null>(null)
  const inlineSuggestAbortRef = useRef<AbortController | null>(null)
  const inlineSuggestTimerRef = useRef<number | null>(null)
  const inlineSuggestSeqRef = useRef(0)
  const lastAcceptedTextRef = useRef('')
  const currentInlineSuggestionRef = useRef('')
  const aiAmbientTimerRef = useRef<number | null>(null)
  const memoryAutoCollapseTimerRef = useRef<number | null>(null)
  const aiHistoryRef = useRef<Record<string, NoteAIHistoryState>>({})
  const pendingInlineReplaceRef = useRef<{
    noteId: string
    from: number
    to: number
    original: string
    replacement: string
  } | null>(null)
  const inlineSuggestionCacheRef = useRef(new Map<string, { text: string; candidates: string[]; ts: number }>())
  const wikilinkSummaryCacheRef = useRef(new Map<string, string>())
  const wikilinkPreviewCacheRef = useRef(new Map<string, {
    exists: boolean
    title: string
    excerpt: string
  }>())
  const [aiPanelWidth, setAiPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 380
    const raw = Number(window.localStorage.getItem('notes_ai_panel_width') || '')
    if (Number.isFinite(raw) && raw >= 320 && raw <= 620) return raw
    return 380
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return 268
    const raw = Number(window.localStorage.getItem('notes_sidebar_width') || '')
    if (Number.isFinite(raw) && raw >= 220 && raw <= 420) return raw
    return 268
  })

  const loadedNoteIdRef = useRef<string | null>(null)
  const studentId = localStorage.getItem('studentId') || undefined

  const {
    folders,
    notes: filteredTreeNotes,
    allNotes: notes,
    refresh: refreshTree,
    applyOptimisticTitle,
    upsertNote,
    removeNote,
    createFolder: createTreeFolder,
    updateFolder: updateTreeFolder,
    deleteFolder: deleteTreeFolder,
    reorder: reorderTree,
  } = useNotesTree({ search: searchQuery })
  const { note, saving, autoSave, save } = useNote(activeNoteId)
  const noteReady = Boolean(note && note.id === activeNoteId)
  const folderByID = useMemo(() => new Map(folders.map((item) => [item.id, item])), [folders])
  const noteByID = useMemo(() => new Map(notes.map((item) => [item.id, item])), [notes])

  const getAIHistoryForNote = useCallback((noteId: string | null | undefined): NoteAIHistoryState | null => {
    if (!noteId) return null
    if (!aiHistoryRef.current[noteId]) {
      aiHistoryRef.current[noteId] = { undo: [], redo: [] }
    }
    return aiHistoryRef.current[noteId]
  }, [])

  const pushAIUndoSnapshot = useCallback((noteId: string | null | undefined, snapshot: string) => {
    const history = getAIHistoryForNote(noteId)
    if (!history) return
    history.undo = [...history.undo.slice(-19), snapshot]
    history.redo = []
    setAiHistoryVersion((prev) => prev + 1)
  }, [getAIHistoryForNote])

  const clearAIHistoryForNote = useCallback((noteId: string | null | undefined) => {
    if (!noteId) return
    if (aiHistoryRef.current[noteId]) {
      delete aiHistoryRef.current[noteId]
      setAiHistoryVersion((prev) => prev + 1)
    }
  }, [])

  useEffect(() => {
    const next = routeId || null
    setActiveNoteId((prev) => (prev === next ? prev : next))
  }, [routeId])

  useEffect(() => {
    if (!folderNameDialog) return
    const timer = window.setTimeout(() => {
      folderDialogInputRef.current?.focus()
      folderDialogInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [folderNameDialog])

  useEffect(() => {
    if (!noteTagsDialog) return
    const timer = window.setTimeout(() => {
      noteTagsDialogInputRef.current?.focus()
      noteTagsDialogInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [noteTagsDialog])

  useEffect(() => {
    if (!noteNameDialog) return
    const timer = window.setTimeout(() => {
      noteNameDialogInputRef.current?.focus()
      noteNameDialogInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [noteNameDialog])

  useEffect(() => {
    noteEditorRef.current?.clearRevisionPreview()
    pendingInlineReplaceRef.current = null
    setMemoryPreviewId(null)
    setInlineSuggestionPending(false)
  }, [activeNoteId])

  // Listen for focus_note_panel command from FloatingAgent
  useEffect(() => {
    const handler = () => {
      setShowAI(true)
    }
    window.addEventListener('pathmind:focus-note-panel', handler)
    return () => window.removeEventListener('pathmind:focus-note-panel', handler)
  }, [])

  useEffect(() => {
    if (!note) {
      loadedNoteIdRef.current = null
      userTypingSinceLoadRef.current = false
      setEditTitle('')
      setEditContent('')
      return
    }

    if (loadedNoteIdRef.current !== note.id) {
      loadedNoteIdRef.current = note.id
      userTypingSinceLoadRef.current = false
      setEditTitle(note.title || '')
      setEditContent(note.content || '')
      setEditorSyncToken(0)
    }
  }, [note])

  useEffect(() => {
    if (!activeNoteId || !noteReady) return
    if (userTypingSinceLoadRef.current) return

    const baseContent = (note?.content || '').trim()
    if (!baseContent) return
    const signature = `${activeNoteId}:${baseContent.length}:${baseContent.slice(0, 40)}`
    if (renderGuardRef.current.signature !== signature) {
      renderGuardRef.current = { signature, retries: 0 }
    }

    const timer = window.setTimeout(() => {
      if (userTypingSinceLoadRef.current) return
      const host = document.querySelector<HTMLElement>('[data-note-editor-host="true"]')
      if (!host) return

      const editable =
        host.querySelector<HTMLElement>('.cm-content') ||
        host.querySelector<HTMLElement>('.cm-line') ||
        host.querySelector<HTMLElement>('[contenteditable="true"]')

      const visibleText = (editable?.innerText || '').trim()
      if (visibleText.length > 0) return
      if (renderGuardRef.current.retries < 1) {
        renderGuardRef.current.retries += 1
        setEditorSyncToken((prev) => prev + 1)
        setEditorNotice('检测到渲染未同步，已自动重试编辑器。')
      }
    }, 320)

    return () => window.clearTimeout(timer)
  }, [activeNoteId, noteReady, note?.content, editorSyncToken])

  useEffect(() => {
    if (!activeNoteId) {
      setBacklinks([])
      return
    }
    notesApi.getBacklinks(activeNoteId).then(setBacklinks).catch(() => setBacklinks([]))
  }, [activeNoteId])

  useEffect(() => {
    if (!editorNotice) return
    const timer = window.setTimeout(() => setEditorNotice(null), 2800)
    return () => window.clearTimeout(timer)
  }, [editorNotice])

  useEffect(() => {
    if (!writeTxnNotice) return
    const timer = window.setTimeout(() => setWriteTxnNotice(null), 2200)
    return () => window.clearTimeout(timer)
  }, [writeTxnNotice])

  useEffect(() => () => {
    if (wikilinkPreviewHideTimerRef.current != null) {
      window.clearTimeout(wikilinkPreviewHideTimerRef.current)
    }
    if (memoryAutoCollapseTimerRef.current != null) {
      window.clearTimeout(memoryAutoCollapseTimerRef.current)
      memoryAutoCollapseTimerRef.current = null
    }
    wikilinkSummaryAbortRef.current?.abort()
    inlineSuggestAbortRef.current?.abort()
    if (aiAmbientTimerRef.current != null) {
      window.clearTimeout(aiAmbientTimerRef.current)
      aiAmbientTimerRef.current = null
    }
    if (inlineSuggestTimerRef.current != null) {
      window.clearTimeout(inlineSuggestTimerRef.current)
      inlineSuggestTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!showAI) {
      setMemoryExpanded(false)
      if (memoryAutoCollapseTimerRef.current != null) {
        window.clearTimeout(memoryAutoCollapseTimerRef.current)
        memoryAutoCollapseTimerRef.current = null
      }
      return
    }
    if (memoryAutoCollapseTimerRef.current != null) {
      window.clearTimeout(memoryAutoCollapseTimerRef.current)
    }
    memoryAutoCollapseTimerRef.current = window.setTimeout(() => {
      setMemoryExpanded(false)
      memoryAutoCollapseTimerRef.current = null
    }, 1800)
  }, [activeNoteId, showAI])

  useEffect(() => {
    if (autoInlineCompletionEnabled) return
    inlineSuggestAbortRef.current?.abort()
    if (inlineSuggestTimerRef.current != null) {
      window.clearTimeout(inlineSuggestTimerRef.current)
      inlineSuggestTimerRef.current = null
    }
    noteEditorRef.current?.clearInlineSuggestion()
    setInlineSuggestionPending(false)
  }, [autoInlineCompletionEnabled])

  useEffect(() => {
    type NotesAgentRequestDetail = {
      prompt?: string
      source?: string
      ts?: number
    }

    const handler = (event: Event) => {
      const payload = (event as CustomEvent<NotesAgentRequestDetail>).detail
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : ''
      if (!prompt) return
      setShowAI(true)
      setExternalNotePrompt(prompt)
    }

    window.addEventListener('pathmind:notes-agent-request', handler)
    return () => window.removeEventListener('pathmind:notes-agent-request', handler)
  }, [])

  useEffect(() => {
    const preload = () => {
      void import('../components/notes/NoteAIPanel')
    }

    const runtimeWindow = globalThis as (Window & typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    })

    if (runtimeWindow.requestIdleCallback && runtimeWindow.cancelIdleCallback) {
      const idleId = runtimeWindow.requestIdleCallback(preload, { timeout: 1200 })
      return () => runtimeWindow.cancelIdleCallback?.(idleId)
    }

    const timer = setTimeout(preload, 280)
    return () => clearTimeout(timer)
  }, [])

  const handleSelectNote = useCallback((id: string) => {
    setActiveNoteId(id)
    navigate(`/notes/${id}`, { replace: true })
  }, [navigate])

  const handleNewNote = useCallback(async (folderID: string | null = null) => {
    try {
      const created = await notesApi.create({
        title: '无标题笔记',
        content: '',
        folder: '/',
        folder_id: folderID,
      })
      upsertNote(created)
      handleSelectNote(created.id)
    } catch {
    }
  }, [handleSelectNote, upsertNote])

  const handleDeleteNote = useCallback(async (id: string) => {
    try {
      await notesApi.delete(id)
      clearAIHistoryForNote(id)
      if (activeNoteId === id) {
        const fallback = notes.find((item) => item.id !== id)
        if (fallback) {
          handleSelectNote(fallback.id)
        } else {
          setActiveNoteId(null)
          setEditTitle('')
          setEditContent('')
          navigate('/notes', { replace: true })
        }
      }
      removeNote(id)
      setEditorNotice('已删除笔记。')
    } catch {
      setEditorNotice('删除失败，请稍后重试。')
    }
  }, [activeNoteId, clearAIHistoryForNote, handleSelectNote, navigate, notes, removeNote])

  const handleOpenWikilink = useCallback(async (rawTarget: string) => {
    setWikilinkPreview(null)
    const target = normalizeWikilinkTarget(rawTarget)
    if (!target) return
    const targetKey = target.toLowerCase()
    const localMatch = pickNoteByTitle(notes, targetKey)
    if (localMatch) {
      handleSelectNote(localMatch.id)
      setEditorNotice(`已打开双链：${localMatch.title}`)
      return
    }

    try {
      const listed = await notesApi.list({
        search: target,
        page: 1,
        page_size: 50,
      })
      const remoteMatch = pickNoteByTitle(listed.notes || [], targetKey)
      if (remoteMatch) {
        handleSelectNote(remoteMatch.id)
        setEditorNotice(`已打开双链：${remoteMatch.title}`)
        return
      }
    } catch {
    }

    try {
      const created = await notesApi.create({
        title: target,
        content: '',
        folder: note?.folder || '/',
      })
      upsertNote(created)
      handleSelectNote(created.id)
      setEditorNotice(`双链不存在，已自动创建：${target}`)
    } catch {
      setEditorNotice(`未找到双链且自动创建失败：${target}`)
    }
  }, [handleSelectNote, note?.folder, notes, upsertNote])

  const handleHoverWikilink = useCallback(async (hoverEvent: NoteEditorWikilinkHoverEvent | null) => {
    if (!hoverEvent) {
      if (wikilinkPreviewHideTimerRef.current != null) {
        window.clearTimeout(wikilinkPreviewHideTimerRef.current)
      }
      wikilinkPreviewHideTimerRef.current = window.setTimeout(() => {
        wikilinkPreviewSeqRef.current += 1
        wikilinkSummaryAbortRef.current?.abort()
        setWikilinkPreview(null)
      }, 180)
      return
    }
    if (wikilinkPreviewHideTimerRef.current != null) {
      window.clearTimeout(wikilinkPreviewHideTimerRef.current)
      wikilinkPreviewHideTimerRef.current = null
    }

    const target = normalizeWikilinkTarget(hoverEvent.target)
    if (!target) {
      wikilinkPreviewSeqRef.current += 1
      setWikilinkPreview(null)
      return
    }
    const targetKey = target.toLowerCase()
    const x = Math.max(12, Math.min(window.innerWidth - 372, hoverEvent.clientX + 16))
    const y = Math.max(12, Math.min(window.innerHeight - 192, hoverEvent.clientY + 14))

    const cached = wikilinkPreviewCacheRef.current.get(targetKey)
    if (cached) {
      setWikilinkPreview({
        target,
        x,
        y,
        loading: false,
        exists: cached.exists,
        title: cached.title,
        excerpt: cached.excerpt,
        summary: wikilinkSummaryCacheRef.current.get(targetKey),
        summaryReady: Boolean(wikilinkSummaryCacheRef.current.get(targetKey)),
        summaryLoading: false,
        summaryEngine: 'openai.fast',
      })
      return
    }

    setWikilinkPreview({
      target,
      x,
      y,
      loading: true,
      exists: false,
      title: target,
      excerpt: '正在加载双链预览…',
      summary: wikilinkSummaryCacheRef.current.get(targetKey),
      summaryReady: Boolean(wikilinkSummaryCacheRef.current.get(targetKey)),
      summaryLoading: false,
      summaryEngine: 'openai.fast',
    })

    const requestSeq = wikilinkPreviewSeqRef.current + 1
    wikilinkPreviewSeqRef.current = requestSeq

    const localMatch = pickNoteByTitle(notes, targetKey)
    if (localMatch) {
      const excerpt = summarizeNotePreview(localMatch.content || '')
      wikilinkPreviewCacheRef.current.set(targetKey, {
        exists: true,
        title: localMatch.title,
        excerpt,
      })
      if (wikilinkPreviewSeqRef.current !== requestSeq) return
      setWikilinkPreview({
        target,
        x,
        y,
        loading: false,
        exists: true,
        title: localMatch.title,
        excerpt,
        summary: wikilinkSummaryCacheRef.current.get(targetKey),
        summaryReady: Boolean(wikilinkSummaryCacheRef.current.get(targetKey)),
        summaryLoading: false,
        summaryEngine: 'openai.fast',
      })
      return
    }

    try {
      const listed = await notesApi.list({
        search: target,
        page: 1,
        page_size: 20,
      })
      const remoteMatch = pickNoteByTitle(listed.notes || [], targetKey)
      if (remoteMatch) {
        const loaded = remoteMatch.content
          ? remoteMatch
          : await notesApi.get(remoteMatch.id)
        const excerpt = summarizeNotePreview(loaded.content || '')
        wikilinkPreviewCacheRef.current.set(targetKey, {
          exists: true,
          title: loaded.title,
          excerpt,
        })
        if (wikilinkPreviewSeqRef.current !== requestSeq) return
        setWikilinkPreview({
          target,
          x,
          y,
          loading: false,
          exists: true,
          title: loaded.title,
          excerpt,
          summary: wikilinkSummaryCacheRef.current.get(targetKey),
          summaryReady: Boolean(wikilinkSummaryCacheRef.current.get(targetKey)),
          summaryLoading: false,
          summaryEngine: 'openai.fast',
        })
        return
      }
    } catch {
    }

    wikilinkPreviewCacheRef.current.set(targetKey, {
      exists: false,
      title: target,
      excerpt: '未找到对应笔记，Cmd/Ctrl + Click 可自动创建。',
    })
    if (wikilinkPreviewSeqRef.current !== requestSeq) return
    setWikilinkPreview({
      target,
      x,
      y,
      loading: false,
      exists: false,
      title: target,
      excerpt: '未找到对应笔记，Cmd/Ctrl + Click 可自动创建。',
      summary: undefined,
      summaryReady: false,
      summaryLoading: false,
      summaryEngine: 'openai.fast',
    })
  }, [notes])

  const handlePreviewMouseEnter = useCallback(() => {
    if (wikilinkPreviewHideTimerRef.current != null) {
      window.clearTimeout(wikilinkPreviewHideTimerRef.current)
      wikilinkPreviewHideTimerRef.current = null
    }
  }, [])

  const handlePreviewMouseLeave = useCallback(() => {
    if (wikilinkPreviewHideTimerRef.current != null) {
      window.clearTimeout(wikilinkPreviewHideTimerRef.current)
    }
    wikilinkPreviewHideTimerRef.current = window.setTimeout(() => {
      wikilinkPreviewSeqRef.current += 1
      wikilinkSummaryAbortRef.current?.abort()
      setWikilinkPreview(null)
    }, 120)
  }, [])

  const setAmbientCachePulse = useCallback(() => {
    if (aiAmbientTimerRef.current != null) {
      window.clearTimeout(aiAmbientTimerRef.current)
      aiAmbientTimerRef.current = null
    }
    setAiAmbient('cache')
    aiAmbientTimerRef.current = window.setTimeout(() => {
      setAiAmbient('idle')
      aiAmbientTimerRef.current = null
    }, 620)
  }, [])

  const setAmbientThinking = useCallback(() => {
    if (aiAmbientTimerRef.current != null) {
      window.clearTimeout(aiAmbientTimerRef.current)
      aiAmbientTimerRef.current = null
    }
    setAiAmbient('thinking')
  }, [])

  const setAmbientIdle = useCallback(() => {
    if (aiAmbientTimerRef.current != null) {
      window.clearTimeout(aiAmbientTimerRef.current)
      aiAmbientTimerRef.current = null
    }
    setAiAmbient('idle')
  }, [])

  const handleGeneratePreviewSummary = useCallback(async () => {
    if (!wikilinkPreview || wikilinkPreview.loading || !wikilinkPreview.exists) return
    const target = normalizeWikilinkTarget(wikilinkPreview.target)
    if (!target) return
    const targetKey = target.toLowerCase()
    const cachedSummary = wikilinkSummaryCacheRef.current.get(targetKey)
    if (cachedSummary) {
      setAmbientCachePulse()
      setWikilinkPreview((prev) => (prev && normalizeWikilinkTarget(prev.target).toLowerCase() === targetKey
        ? {
            ...prev,
            summary: cachedSummary,
            summaryReady: true,
            summaryLoading: false,
            summaryError: undefined,
            summaryEngine: 'openai.fast',
            summaryFallback: false,
          }
        : prev))
      return
    }

    const targetMeta = wikilinkPreviewCacheRef.current.get(targetKey)
    const linkedTargets = collectWikilinkTargets(editContent)
      .filter((item) => item.toLowerCase() !== targetKey)
      .slice(0, 4)
      .map((item) => {
        const meta = wikilinkPreviewCacheRef.current.get(item.toLowerCase())
        return meta ? `- ${meta.title}: ${meta.excerpt}` : `- ${item}`
      })
      .join('\n')

    const prompt = [
      `请为笔记《${targetMeta?.title || target}》生成一个简洁摘要。`,
      '输出要求：',
      '1) 3-5 条要点，使用 Markdown 列表；',
      '2) 最后给一行“关联建议”；',
      '3) 语气客观、简洁。',
      '',
      '当前笔记（可能触发请求的上下文）节选：',
      '---',
      (editContent || '').slice(0, 2200),
      '---',
      '',
      `目标笔记节选：${targetMeta?.excerpt || wikilinkPreview.excerpt || ''}`,
      linkedTargets ? `相关双链摘要：\n${linkedTargets}` : '相关双链摘要：暂无',
    ].join('\n')

    wikilinkSummaryAbortRef.current?.abort()
    const controller = new AbortController()
    wikilinkSummaryAbortRef.current = controller

    setWikilinkPreview((prev) => (prev && normalizeWikilinkTarget(prev.target).toLowerCase() === targetKey
      ? {
          ...prev,
          summaryLoading: true,
          summaryError: undefined,
          summary: '',
          summaryReady: false,
          summaryEngine: 'openai.fast',
          summaryFallback: false,
        }
      : prev))

    try {
      setAmbientThinking()
      const response = await aiDispatchApi.stream({
        taskType: 'summary',
        priority: 'low',
        cacheKey: targetKey,
        agentName: 'note-assistant',
        prompt,
        studentId,
        context: {
          source: 'wikilink_preview_summary',
          target_note_title: targetMeta?.title || target,
          target_note_excerpt: targetMeta?.excerpt || wikilinkPreview.excerpt || '',
          related_notes: linkedTargets,
        },
        contextSnapshot: {
          current_file: note?.title || '当前笔记',
          referenced_summaries: linkedTargets,
          cursor_pos: noteEditorRef.current?.getContent().length || editContent.length,
        },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`summary stream failed (${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let aggregated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (!data || data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>
            if (parsed.type === 'dispatch_meta') {
              const selectedEngine = typeof parsed.selected_engine === 'string' ? parsed.selected_engine.trim().toLowerCase() : ''
              const selectedMode = typeof parsed.selected_mode === 'string' ? parsed.selected_mode.trim().toLowerCase() : ''
              const reason = typeof parsed.reason === 'string' ? parsed.reason.toLowerCase() : ''
              setAiHealth(
                reason.includes('degraded') || reason.includes('failed') || reason.includes('fallback')
                  ? 'degraded'
                  : 'healthy',
              )
              const engineLabel = selectedEngine
                ? selectedMode ? `${selectedEngine}.${selectedMode}` : selectedEngine
                : undefined
              setWikilinkPreview((prev) => (prev && normalizeWikilinkTarget(prev.target).toLowerCase() === targetKey
                ? {
                    ...prev,
                    summaryEngine: engineLabel ?? prev.summaryEngine,
                    summaryFallback: Boolean(
                      (prev.summaryEngine || '').startsWith('openai') && selectedEngine === 'claude',
                    ),
                  }
                : prev))
              continue
            }
            if (parsed.type === 'meta' && parsed.engine === 'cache') {
              setAmbientCachePulse()
              continue
            }
            if (parsed.type === 'text' && typeof parsed.content === 'string') {
              if (aggregated.length === 0) setAmbientIdle()
              aggregated += parsed.content
              const snapshot = aggregated
              setWikilinkPreview((prev) => (prev && normalizeWikilinkTarget(prev.target).toLowerCase() === targetKey
                ? {
                    ...prev,
                    summary: snapshot,
                    summaryLoading: true,
                    summaryReady: false,
                  }
                : prev))
            }
            if (parsed.type === 'done') {
              break
            }
          } catch {
          }
        }
      }

      const finalSummary = aggregated.trim()
      if (!finalSummary) throw new Error('empty summary')
      wikilinkSummaryCacheRef.current.set(targetKey, finalSummary)
      setWikilinkPreview((prev) => (prev && normalizeWikilinkTarget(prev.target).toLowerCase() === targetKey
        ? {
            ...prev,
            summary: finalSummary,
            summaryLoading: false,
            summaryReady: true,
            summaryError: undefined,
          }
        : prev))
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      setAmbientIdle()
      setWikilinkPreview((prev) => (prev && normalizeWikilinkTarget(prev.target).toLowerCase() === targetKey
        ? {
            ...prev,
            summaryLoading: false,
            summaryReady: false,
            summaryError: '摘要生成失败，请重试。',
          }
        : prev))
    } finally {
      setAmbientIdle()
      if (wikilinkSummaryAbortRef.current === controller) {
        wikilinkSummaryAbortRef.current = null
      }
    }
  }, [editContent, note?.title, setAmbientCachePulse, setAmbientIdle, setAmbientThinking, studentId, wikilinkPreview])

  useEffect(() => {
    const markdown = editContent || ''
    if (!markdown) return
    const targets = new Set<string>()
    const regex = /\[\[([^[\]]+)\]\]/g
    let match: RegExpExecArray | null = regex.exec(markdown)
    while (match) {
      const normalized = normalizeWikilinkTarget(match[1] || '')
      if (normalized) targets.add(normalized)
      match = regex.exec(markdown)
    }
    if (targets.size === 0) return

    const byTitle = new Map(notes.map((item) => [item.title.trim().toLowerCase(), item]))
    for (const item of targets) {
      const key = item.toLowerCase()
      if (wikilinkPreviewCacheRef.current.has(key)) continue
      const found = byTitle.get(key)
      if (!found) continue
      wikilinkPreviewCacheRef.current.set(key, {
        exists: true,
        title: found.title,
        excerpt: summarizeNotePreview(found.content || ''),
      })
    }
  }, [editContent, notes])

  const ensureNoteTarget = useCallback(async (): Promise<string | null> => {
    if (activeNoteId) return activeNoteId
    try {
      const created = await notesApi.create({
        title: editTitle.trim() || '无标题笔记',
        content: '',
        folder: '/',
      })
      upsertNote(created)
      setActiveNoteId(created.id)
      navigate(`/notes/${created.id}`, { replace: true })
      setEditTitle(created.title || '无标题笔记')
      setEditContent(created.content || '')
      return created.id
    } catch {
      setEditorNotice('创建笔记失败，请稍后重试。')
      return null
    }
  }, [activeNoteId, editTitle, navigate, upsertNote])

  const ensureNoteTargetReady = useCallback(async (): Promise<boolean> => {
    const target = await ensureNoteTarget()
    return Boolean(target)
  }, [ensureNoteTarget])

  useDebouncedNoteTitleSave({
    noteID: noteReady ? activeNoteId : null,
    noteTitle: noteReady ? note?.title : null,
    editTitle,
    applyOptimisticTitle,
    saveTitle: (title) => {
      if (!noteReady) return
      save({ title })
    },
  })

  const handleContentChange = useCallback((value: string) => {
    inlineSuggestAbortRef.current?.abort()
    setInlineSuggestionPending(false)
    userTypingSinceLoadRef.current = true
    lastInputAtRef.current = Date.now()
    setEditContent(value)
    autoSave({ content: value })
    // Re-schedule inline suggestion after typing pause
    lastAcceptedTextRef.current = ''  // Clear dedup on new input
    scheduleInlineSuggestionRef.current?.(300)
  }, [autoSave])

  const handleSave = useCallback(() => {
    save({
      title: editTitle.trim() || '无标题笔记',
      content: editContent,
    })
  }, [save, editTitle, editContent])

  const handleApplyEdit = useCallback(async (payload: NoteAIEditPayload): Promise<NoteAIApplyResult> => {
    const expectedNoteId = payload.targetNoteId?.trim()
    if (expectedNoteId && activeNoteId && expectedNoteId !== activeNoteId) {
      return {
        ok: false,
        message: '检测到笔记已切换，已阻止跨笔记写入。请回到目标笔记后重试。',
      }
    }

    const targetNoteId = expectedNoteId || await ensureNoteTarget()
    if (!targetNoteId) return { ok: false, message: '当前无法写入：未选中笔记。' }

    const current = noteEditorRef.current?.getContent() ?? editContent ?? ''
    const result = applyEditOperation(current, payload)
    if (!result.ok) return result
    if (result.next === current) return { ok: false, message: '内容无变化，未写入。' }

    pushAIUndoSnapshot(targetNoteId, current)
    const canStream = result.change.insert.length >= 36 && result.next.length <= 32000
    const nextContent = noteEditorRef.current
      ? await noteEditorRef.current.applyAIChange(result.change, { stream: canStream })
      : result.next
    if (!noteEditorRef.current) {
      setEditContent(result.next)
      setEditorSyncToken((prev) => prev + 1)
    }
    try {
      await notesApi.update(targetNoteId, {
        title: editTitle.trim() || '无标题笔记',
        content: nextContent,
      })
    } catch {
      autoSave({ content: nextContent })
    }
    appendRevisionMemory({
      scope: 'notes',
      agent: 'note-assistant',
      noteId: targetNoteId,
      noteTitle: editTitle.trim() || note?.title || '无标题笔记',
      summary: `${result.message}（${payload.action}${payload.anchor ? `:${payload.anchor.slice(0, 24)}` : ''}）`,
      beforeContent: current,
      afterContent: nextContent,
      anchor: payload.anchor,
      tags: collectWikilinkTargets(nextContent).slice(0, 12),
    })
    setEditorFlashSignal((prev) => prev + 1)
    setEditorNotice(result.message)
    return { ok: true, message: result.message }
  }, [activeNoteId, autoSave, editContent, editTitle, ensureNoteTarget, note?.title, pushAIUndoSnapshot])

  const handleGetEditorCursorContext = useCallback(() => {
    return noteEditorRef.current?.getCursorContext(1800) || null
  }, [])

  const handlePreviewEdit = useCallback((payload: NoteAIEditPayload): NoteAIApplyResult => {
    if (!activeNoteId || !noteReady) {
      return { ok: false, message: '当前笔记尚未就绪，无法预览。' }
    }
    const editor = noteEditorRef.current
    if (!editor) {
      return { ok: false, message: '编辑器尚未就绪，无法预览。' }
    }
    const current = editor.getContent()
    const result = applyEditOperation(current, payload)
    if (!result.ok) return result
    if (result.next === current) return { ok: false, message: '内容无变化。' }

    const preview = editor.previewRevision(result.next)
    if (!preview || !preview.changed) return { ok: false, message: '无法生成差异预览。' }

    setMemoryPreviewId(null)
    setEditorFlashSignal((prev) => prev + 1)
    const lineNum = current.slice(0, preview.from).split('\n').length
    const message = `已生成修改预览（第 ${lineNum} 行附近），请确认是否应用。`
    setEditorNotice(message)
    return { ok: true, message }
  }, [activeNoteId, noteReady])

  const handleClearInlineReplacePreview = useCallback(() => {
    pendingInlineReplaceRef.current = null
    noteEditorRef.current?.clearRevisionPreview()
  }, [])

  const handlePreviewInlineReplace = useCallback((patch: NoteAIInlineReplacePatch): NoteAIApplyResult => {
    if (!activeNoteId || !noteReady) {
      return { ok: false, message: '当前笔记尚未就绪，无法预览行内替换。' }
    }
    const editor = noteEditorRef.current
    if (!editor) {
      return { ok: false, message: '编辑器尚未就绪，无法预览行内替换。' }
    }

    const preview = editor.previewInlineReplace(patch.original, patch.replacement)
    if (!preview) {
      pendingInlineReplaceRef.current = null
      return { ok: false, message: '未找到可替换原文，请让 Agent 输出更精确的 original。' }
    }

    pendingInlineReplaceRef.current = {
      noteId: activeNoteId,
      from: preview.from,
      to: preview.to,
      original: preview.original,
      replacement: patch.replacement,
    }
    setMemoryPreviewId(null)
    setEditorFlashSignal((prev) => prev + 1)
    const message = preview.changed
      ? `已定位行内替换（第 ${editor.getContent().slice(0, preview.from).split('\n').length} 行附近）。`
      : '定位成功：替换内容与当前文本一致。'
    setEditorNotice(message)
    return { ok: true, message }
  }, [activeNoteId, noteReady])

  const handleApplyInlineReplace = useCallback(async (patch: NoteAIInlineReplacePatch): Promise<NoteAIApplyResult> => {
    const targetNoteId = await ensureNoteTarget()
    if (!targetNoteId) {
      return { ok: false, message: '当前无法创建或选中笔记。' }
    }

    const editor = noteEditorRef.current
    if (!editor) {
      return { ok: false, message: '编辑器尚未就绪，无法执行行内替换。' }
    }

    const current = editor.getContent()
    let pending = pendingInlineReplaceRef.current
    const pendingMismatch = !pending
      || pending.noteId !== targetNoteId
      || pending.replacement !== patch.replacement
      || current.slice(pending.from, pending.to) !== pending.original

    if (pendingMismatch) {
      const relocated = editor.previewInlineReplace(patch.original, patch.replacement)
      if (!relocated) {
        pendingInlineReplaceRef.current = null
        return { ok: false, message: '应用前重新定位失败，请让 Agent 给出更精确 original。' }
      }
      pending = {
        noteId: targetNoteId,
        from: relocated.from,
        to: relocated.to,
        original: relocated.original,
        replacement: patch.replacement,
      }
      pendingInlineReplaceRef.current = pending
    }

    if (!pending) {
      return { ok: false, message: '未找到可应用的替换位置。' }
    }

    if (current.slice(pending.from, pending.to) === pending.replacement) {
      handleClearInlineReplacePreview()
      setEditorNotice('当前内容已是目标版本，无需再次替换。')
      return { ok: true, message: '当前内容已是目标版本。' }
    }

    pushAIUndoSnapshot(targetNoteId, current)
    const nextContent = await editor.applyAIChange(
      { from: pending.from, to: pending.to, insert: pending.replacement },
      { stream: false },
    )

    try {
      await notesApi.update(targetNoteId, {
        title: editTitle.trim() || '无标题笔记',
        content: nextContent,
      })
    } catch {
      autoSave({ content: nextContent })
    }

    appendRevisionMemory({
      scope: 'notes',
      agent: 'note-assistant',
      noteId: targetNoteId,
      noteTitle: editTitle.trim() || note?.title || '无标题笔记',
      summary: `已应用行内替换（${pending.original.replace(/\s+/g, ' ').slice(0, 30)}）`,
      beforeContent: current,
      afterContent: nextContent,
      anchor: pending.original.slice(0, 48),
      tags: collectWikilinkTargets(nextContent).slice(0, 12),
    })

    handleClearInlineReplacePreview()
    setEditorFlashSignal((prev) => prev + 1)
    const message = '已应用行内替换。'
    setEditorNotice(message)
    return { ok: true, message }
  }, [autoSave, editTitle, ensureNoteTarget, handleClearInlineReplacePreview, note?.title, pushAIUndoSnapshot])

  const handleUndoAIEdit = useCallback((): NoteAIApplyResult => {
    const history = getAIHistoryForNote(activeNoteId)
    if (!history || history.undo.length === 0) {
      return { ok: false, message: '当前笔记没有可撤销的 AI 修改。' }
    }

    const previousContent = history.undo[history.undo.length - 1]
    const currentContent = noteEditorRef.current?.getContent() ?? editContent
    history.undo = history.undo.slice(0, -1)
    history.redo = [...history.redo.slice(-19), currentContent]
    setAiHistoryVersion((prev) => prev + 1)

    if (noteEditorRef.current) {
      void noteEditorRef.current.applyAIChange(
        { from: 0, to: currentContent.length, insert: previousContent },
        { stream: false },
      )
    } else {
      setEditContent(previousContent)
      setEditorSyncToken((prev) => prev + 1)
    }
    autoSave({ content: previousContent })
    setEditorFlashSignal((prev) => prev + 1)
    const message = '已撤销当前笔记最近一次 AI 修改。'
    setEditorNotice(message)
    return { ok: true, message }
  }, [activeNoteId, autoSave, editContent, getAIHistoryForNote])

  const handleRedoAIEdit = useCallback((): NoteAIApplyResult => {
    const history = getAIHistoryForNote(activeNoteId)
    if (!history || history.redo.length === 0) {
      return { ok: false, message: '当前笔记没有可重做的 AI 修改。' }
    }

    const nextContent = history.redo[history.redo.length - 1]
    const currentContent = noteEditorRef.current?.getContent() ?? editContent
    history.redo = history.redo.slice(0, -1)
    history.undo = [...history.undo.slice(-19), currentContent]
    setAiHistoryVersion((prev) => prev + 1)

    if (noteEditorRef.current) {
      void noteEditorRef.current.applyAIChange(
        { from: 0, to: currentContent.length, insert: nextContent },
        { stream: false },
      )
    } else {
      setEditContent(nextContent)
      setEditorSyncToken((prev) => prev + 1)
    }
    autoSave({ content: nextContent })
    setEditorFlashSignal((prev) => prev + 1)
    const message = '已重做当前笔记最近一次 AI 撤销。'
    setEditorNotice(message)
    return { ok: true, message }
  }, [activeNoteId, autoSave, editContent, getAIHistoryForNote])

  const handleLocateQuery = useCallback((query: string): NoteAIApplyResult => {
    const target = query.trim()
    if (!target) return { ok: false, message: '请输入要定位的关键词。' }

    const current = noteEditorRef.current?.getContent() ?? editContent
    const lowerContent = current.toLowerCase()
    const lowerTarget = target.toLowerCase()
    const firstIndex = lowerContent.indexOf(lowerTarget)
    if (firstIndex < 0) {
      return { ok: false, message: `未找到关键词：${target}` }
    }

    const range = noteEditorRef.current?.revealRange(firstIndex, firstIndex + target.length)
    const line = range?.line ?? current.slice(0, firstIndex).split('\n').length
    setEditorFlashSignal((prev) => prev + 1)
    const message = `已定位“${target}”，首个命中在第 ${line} 行。`
    setEditorNotice(message)
    return { ok: true, message }
  }, [editContent])

  const handleNoteCreated = useCallback(() => {
    refreshTree()
  }, [refreshTree])

  const openFolderNameDialog = useCallback((payload: {
    mode: 'create' | 'rename'
    parentID?: string | null
    folderID?: string | null
    initialValue?: string
  }) => {
    const isCreate = payload.mode === 'create'
    setFolderDialogError(null)
    setFolderDialogSaving(false)
    setFolderNameDialog({
      mode: payload.mode,
      title: isCreate ? '新建文件夹' : '重命名文件夹',
      confirmLabel: isCreate ? '创建' : '保存',
      value: payload.initialValue || '',
      parentID: payload.parentID || null,
      folderID: payload.folderID || null,
    })
  }, [])

  const closeFolderNameDialog = useCallback(() => {
    if (folderDialogSaving) return
    setFolderDialogError(null)
    setFolderNameDialog(null)
  }, [folderDialogSaving])

  const submitFolderNameDialog = useCallback(async () => {
    if (!folderNameDialog || folderDialogSaving) return
    const name = folderNameDialog.value.trim()
    if (!name) {
      setFolderDialogError('请输入文件夹名称。')
      return
    }

    setFolderDialogSaving(true)
    setFolderDialogError(null)

    try {
      if (folderNameDialog.mode === 'create') {
        const created = await createTreeFolder({
          name,
          parent_id: folderNameDialog.parentID || null,
        })
        setEditorNotice(`已创建文件夹：${created.name}`)
      } else {
        if (!folderNameDialog.folderID) {
          setFolderDialogError('目标文件夹不存在。')
          return
        }
        await updateTreeFolder(folderNameDialog.folderID, { name })
        setEditorNotice('文件夹已重命名。')
      }

      setFolderNameDialog(null)
    } catch (error) {
      setFolderDialogError(error instanceof Error ? error.message : '操作失败，请稍后重试。')
    } finally {
      setFolderDialogSaving(false)
    }
  }, [createTreeFolder, folderDialogSaving, folderNameDialog, updateTreeFolder])

  const openNoteTagsDialog = useCallback((target: Note) => {
    setNoteTagsDialogError(null)
    setNoteTagsDialogSaving(false)
    setNoteTagsDialog({
      noteID: target.id,
      title: target.title || '无标题笔记',
      value: (target.tags || []).join(', '),
    })
  }, [])

  const closeNoteTagsDialog = useCallback(() => {
    if (noteTagsDialogSaving) return
    setNoteTagsDialogError(null)
    setNoteTagsDialog(null)
  }, [noteTagsDialogSaving])

  const submitNoteTagsDialog = useCallback(async () => {
    if (!noteTagsDialog || noteTagsDialogSaving) return

    const tags = noteTagsDialog.value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    setNoteTagsDialogSaving(true)
    setNoteTagsDialogError(null)
    try {
      const updated = await notesApi.update(noteTagsDialog.noteID, { tags })
      upsertNote(updated)
      if (activeNoteId === updated.id) {
        save({ tags })
      }
      setEditorNotice('标签已更新。')
      setNoteTagsDialog(null)
    } catch (error) {
      setNoteTagsDialogError(error instanceof Error ? error.message : '标签更新失败，请稍后重试。')
    } finally {
      setNoteTagsDialogSaving(false)
    }
  }, [activeNoteId, noteTagsDialog, noteTagsDialogSaving, save, upsertNote])

  const openNoteNameDialog = useCallback((target: Note) => {
    setNoteNameDialogError(null)
    setNoteNameDialogSaving(false)
    setNoteNameDialog({
      noteID: target.id,
      value: target.title || '无标题笔记',
    })
  }, [])

  const closeNoteNameDialog = useCallback(() => {
    if (noteNameDialogSaving) return
    setNoteNameDialogError(null)
    setNoteNameDialog(null)
  }, [noteNameDialogSaving])

  const submitNoteNameDialog = useCallback(async () => {
    if (!noteNameDialog || noteNameDialogSaving) return
    const title = noteNameDialog.value.trim() || '无标题笔记'
    setNoteNameDialogSaving(true)
    setNoteNameDialogError(null)
    try {
      const updated = await notesApi.update(noteNameDialog.noteID, { title })
      upsertNote(updated)
      if (activeNoteId === updated.id) {
        setEditTitle(updated.title || '无标题笔记')
      }
      setEditorNotice('笔记标题已更新。')
      setNoteNameDialog(null)
    } catch (error) {
      setNoteNameDialogError(error instanceof Error ? error.message : '重命名失败，请稍后重试。')
    } finally {
      setNoteNameDialogSaving(false)
    }
  }, [activeNoteId, noteNameDialog, noteNameDialogSaving, upsertNote])

  const handleRequestRenameNote = useCallback((noteID: string) => {
    const target = noteByID.get(noteID)
    if (!target) return
    openNoteNameDialog(target)
  }, [noteByID, openNoteNameDialog])

  const handleRenameNoteInline = useCallback(async (noteID: string, title: string) => {
    const nextTitle = title.trim() || '无标题笔记'
    try {
      const updated = await notesApi.update(noteID, { title: nextTitle })
      upsertNote(updated)
      if (activeNoteId === updated.id) {
        setEditTitle(updated.title || '无标题笔记')
      }
      setEditorNotice('笔记标题已更新。')
    } catch {
      setEditorNotice('重命名失败，请稍后重试。')
    }
  }, [activeNoteId, upsertNote])

  const handleCreateFolder = useCallback((parentID?: string | null) => {
    openFolderNameDialog({
      mode: 'create',
      parentID: parentID || null,
      initialValue: '',
    })
  }, [openFolderNameDialog])

  const handleRenameFolder = useCallback(async (folderID: string, name: string) => {
    try {
      await updateTreeFolder(folderID, { name })
      setEditorNotice('文件夹已重命名。')
    } catch (error) {
      setEditorNotice(error instanceof Error ? error.message : '重命名失败，请稍后重试。')
    }
  }, [updateTreeFolder])

  const handleDeleteFolder = useCallback(async (folderID: string) => {
    try {
      await deleteTreeFolder(folderID, 'move_to_parent')
      setEditorNotice('文件夹已删除，内容已移动到上级。')
    } catch (error) {
      setEditorNotice(error instanceof Error ? error.message : '删除文件夹失败，请稍后重试。')
    }
  }, [deleteTreeFolder])

  const handleTreeReorder = useCallback(async (payload: NoteReorderPayload) => {
    try {
      await reorderTree(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : '排序失败，请稍后重试。'
      if (message.includes('404')) {
        setEditorNotice('拖拽排序接口不可用，请重启 Go 后端后重试。')
      } else {
        setEditorNotice(message)
      }
      await refreshTree()
    }
  }, [refreshTree, reorderTree])

  const runEditorMenuAction = useCallback(async (
    action: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select_all',
    failureMessage?: string,
  ) => {
    const applied = await noteEditorRef.current?.runEditorAction(action)
    if (!applied && failureMessage) {
      setEditorNotice(failureMessage)
    }
  }, [])

  const handleSidebarNodeContextMenu = useCallback((event: ReactMouseEvent, node: { kind: 'folder' | 'note'; id: string }) => {
    event.preventDefault()

    if (node.kind === 'note') {
      const targetNote = noteByID.get(node.id)
      if (!targetNote) return

      const menuItems: ContextMenuItem[] = createNoteNodeContextMenuItems({
        onOpen: () => handleSelectNote(targetNote.id),
        onRename: () => handleRequestRenameNote(targetNote.id),
        onMoveToRoot: async () => {
          const rootCount = notes.filter((item) => !item.folder_id).length
          await handleTreeReorder({
            kind: 'note',
            item_id: targetNote.id,
            parent_id: null,
            index: rootCount,
          })
        },
        onProperties: () => openNoteTagsDialog(targetNote),
        onDelete: async () => handleDeleteNote(targetNote.id),
      })
      openContextMenu(event.clientX, event.clientY, menuItems)
      return
    }

    const folder = folderByID.get(node.id)
    if (!folder) return
    const menuItems: ContextMenuItem[] = createFolderNodeContextMenuItems({
      onNewNote: () => handleNewNote(folder.id),
      onNewFolder: () => handleCreateFolder(folder.id),
      onRename: () => openFolderNameDialog({
        mode: 'rename',
        folderID: folder.id,
        initialValue: folder.name,
      }),
      onProperties: () => setEditorNotice(`文件夹路径：${folder.path}`),
      onDelete: async () => handleDeleteFolder(folder.id),
    })
    openContextMenu(event.clientX, event.clientY, menuItems)
  }, [
    folderByID,
    handleCreateFolder,
    handleDeleteFolder,
    handleDeleteNote,
    handleNewNote,
    openFolderNameDialog,
    handleRequestRenameNote,
    handleSelectNote,
    handleTreeReorder,
    noteByID,
    notes,
    openContextMenu,
    openNoteTagsDialog,
  ])

  const handleSidebarBlankContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    openContextMenu(event.clientX, event.clientY, createBlankContextMenuItems({
      onNewNote: () => handleNewNote(null),
      onNewFolder: () => handleCreateFolder(null),
    }))
  }, [handleCreateFolder, handleNewNote, openContextMenu])

  const handleEditorContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    openContextMenu(event.clientX, event.clientY, createEditorContextMenuItems({
      onUndo: async () => runEditorMenuAction('undo'),
      onRedo: async () => runEditorMenuAction('redo'),
      onCut: async () => runEditorMenuAction('cut', '当前没有可剪切文本。'),
      onCopy: async () => runEditorMenuAction('copy', '当前没有可复制文本。'),
      onPaste: async () => runEditorMenuAction('paste', '读取剪贴板失败，请检查浏览器权限。'),
      onSelectAll: async () => runEditorMenuAction('select_all'),
    }))
  }, [openContextMenu, runEditorMenuAction])

  const handleWriteTransaction = useCallback((event: NoteWriteTransactionEvent) => {
    setWriteTxnNotice(event.message)
    if ((event.stage === 'done' || event.stage === 'locate') && event.query) {
      setEditorFlashSignal((prev) => prev + 1)
    }
  }, [])

  const cancelMemoryAutoCollapse = useCallback(() => {
    if (memoryAutoCollapseTimerRef.current != null) {
      window.clearTimeout(memoryAutoCollapseTimerRef.current)
      memoryAutoCollapseTimerRef.current = null
    }
  }, [])

  const scheduleMemoryAutoCollapse = useCallback((delay = 1600) => {
    cancelMemoryAutoCollapse()
    memoryAutoCollapseTimerRef.current = window.setTimeout(() => {
      setMemoryExpanded(false)
      memoryAutoCollapseTimerRef.current = null
    }, delay)
  }, [cancelMemoryAutoCollapse])

  const handleMemoryCardToggle = useCallback(() => {
    setMemoryExpanded((prev) => {
      const next = !prev
      if (next) scheduleMemoryAutoCollapse(2400)
      return next
    })
  }, [scheduleMemoryAutoCollapse])

  const handleMemoryCardMouseEnter = useCallback(() => {
    cancelMemoryAutoCollapse()
    setMemoryExpanded(true)
  }, [cancelMemoryAutoCollapse])

  const handleMemoryCardMouseLeave = useCallback(() => {
    scheduleMemoryAutoCollapse(1200)
  }, [scheduleMemoryAutoCollapse])

  const handlePreviewMemoryRevision = useCallback((memory: AgentMemoryEvent) => {
    if (memory.kind !== 'revision' || !memory.afterHash) return
    const target = getSnapshotContent(memory.afterHash)
    if (target == null) {
      setEditorNotice('回溯快照不存在，无法预览。')
      return
    }
    const result = noteEditorRef.current?.previewRevision(target)
    if (result?.changed) {
      setMemoryPreviewId(memory.id)
      setEditorNotice(`已预览回溯差异：${memory.summary.slice(0, 30)}`)
    }
  }, [])

  const handleClearMemoryPreview = useCallback(() => {
    noteEditorRef.current?.clearRevisionPreview()
    setMemoryPreviewId(null)
  }, [])

  const handleApplyMemoryRevision = useCallback(async (memory: AgentMemoryEvent) => {
    if (memory.kind !== 'revision') return
    const current = noteEditorRef.current?.getContent() ?? editContent
    const prepared = applyRevision(memory.id, current)
    if (!prepared.ok || !prepared.nextContent) {
      setEditorNotice(prepared.message)
      return
    }
    const targetNoteId = await ensureNoteTarget()
    if (!targetNoteId) return
    pushAIUndoSnapshot(targetNoteId, current)
    const next = noteEditorRef.current
      ? await noteEditorRef.current.applyAIChange(
        { from: 0, to: current.length, insert: prepared.nextContent },
        { stream: false },
      )
      : prepared.nextContent
    if (!noteEditorRef.current) {
      setEditContent(prepared.nextContent)
      setEditorSyncToken((prev) => prev + 1)
    }
    await notesApi.update(targetNoteId, {
      title: editTitle.trim() || '无标题笔记',
      content: next,
    }).catch(() => autoSave({ content: next }))
    noteEditorRef.current?.clearRevisionPreview()
    setMemoryPreviewId(null)
    setEditorFlashSignal((prev) => prev + 1)
    setEditorNotice('回溯版本已应用（当前状态已自动快照备份）。')
  }, [autoSave, editContent, editTitle, ensureNoteTarget, pushAIUndoSnapshot])

  const requestInlineSuggestion = useCallback(async (options?: {
    triggerKind?: 'automatic' | 'invoke' | 'speculative'
    force?: boolean
    speculative?: boolean
  }) => {
    const isManualInvoke = options?.triggerKind === 'invoke'
    if (!autoInlineCompletionEnabled && !isManualInvoke) {
      setInlineSuggestionPending(false)
      return
    }
    const force = Boolean(options?.force)
    const editor = noteEditorRef.current
    if (!editor || !activeNoteId || !noteReady) {
      setInlineSuggestionPending(false)
      return
    }
    if (editorComposing) {
      setInlineSuggestionPending(false)
      return
    }
    if (!force && Date.now() - lastInputAtRef.current < 500) {
      setInlineSuggestionPending(false)
      return
    }

    const cursorCtx = editor.getCursorContext(560)
    if (!cursorCtx) {
      setInlineSuggestionPending(false)
      return
    }
    const before = cursorCtx.before || ''
    const compactBefore = before.replace(/\s+/g, '').trim()
    const cjkCount = (compactBefore.match(/[\u3400-\u9fff]/g) || []).length
    const minRequired = cjkCount > 0 ? 2 : 5
    if (compactBefore.length < minRequired) {
      editor.clearInlineSuggestion()
      setInlineSuggestionPending(false)
      return
    }

    const after = cursorCtx.after || ''
    const cursorMode = detectMarkdownCursorMode(editor.getContent(), cursorCtx.cursor)
    const cacheKey = buildInlineSuggestionCacheKey(
      activeNoteId,
      before,
      after,
      cursorMode.mode,
      cursorMode.language,
    )
    const cached = inlineSuggestionCacheRef.current.get(cacheKey)
    if (cached && (Date.now() - cached.ts) < 1000 * 60 * 10) {
      editor.setInlineSuggestion(cached.text)
      currentInlineSuggestionRef.current = cached.text
      setAmbientCachePulse()
      setInlineSuggestionPending(false)
      return
    }

    const seq = ++inlineSuggestSeqRef.current
    inlineSuggestAbortRef.current?.abort()
    const controller = new AbortController()
    inlineSuggestAbortRef.current = controller
    const prefixText = before.slice(-900)
    const suffixText = after.slice(0, 320)
    const prefixTail = prefixText.slice(-200)
    const linkedTargets = collectWikilinkTargets(editContentRef.current).slice(0, 4)
    const linkedSummaries = linkedTargets
      .map((target) => {
        const key = target.trim().toLowerCase()
        const found = pickNoteByTitle(notes, key)
        if (!found) return `[[${target}]]`
        return `[[${found.title}]]: ${summarizeNotePreview(found.content || '')}`
      })
      .filter((item) => item.trim().length > 0)
    const memorySummaries = agentMemoriesRef.current
      .map((item) => `${item.noteTitle || '相关笔记'}: ${item.summary}`)
      .filter((item) => item.trim().length > 0)
      .slice(0, 4)
    const contextSummary = [...linkedSummaries, ...memorySummaries].slice(0, 6).join('\n').slice(0, 900)

    try {
      setInlineSuggestionPending(true)
      setAmbientThinking()
      const result = await notesApi.completeInline({
        prefix: prefixText,
        suffix: suffixText,
        contextSummary,
        mode: cursorMode.mode,
        language: cursorMode.language,
      }, controller.signal)

      if (inlineSuggestSeqRef.current !== seq) return
      const parsedCandidates = parseInlineSuggestionCandidates(result.completion || '')
      // Strip prefix overlap — only if the candidate starts with a long
      // exact suffix of the prefix (>=10 chars to avoid false positives)
      const dedupedCandidates = parsedCandidates.map((c) => {
        let result = c
        const tail = prefixTail.trimEnd()
        for (let overlap = Math.min(tail.length, result.length); overlap >= 10; overlap--) {
          if (tail.endsWith(result.slice(0, overlap))) {
            result = result.slice(overlap)
            break
          }
        }
        return result.trim()
      }).map((candidate) => validateInlineSuggestionCandidate(prefixText, candidate, cursorMode.mode))
        .filter((candidate): candidate is string => Boolean(candidate))
      const normalized = dedupedCandidates[0] || ''
      // Skip if same as just-accepted suggestion (prevents infinite loop)
      if (normalized && normalized === lastAcceptedTextRef.current) {
        editor.clearInlineSuggestion()
        setInlineSuggestionPending(false)
        return
      }
      if (!normalized) {
        editor.clearInlineSuggestion()
        setInlineSuggestionPending(false)
        return
      }
      inlineSuggestionCacheRef.current.set(cacheKey, {
        text: normalized,
        candidates: dedupedCandidates,
        ts: Date.now(),
      })
      if (inlineSuggestionCacheRef.current.size > 140) {
        const oldestKey = inlineSuggestionCacheRef.current.keys().next().value
        if (oldestKey) inlineSuggestionCacheRef.current.delete(oldestKey)
      }
      editor.setInlineSuggestion(normalized)
      currentInlineSuggestionRef.current = normalized
      setAiHealth('healthy')
      setInlineSuggestionPending(false)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        noteEditorRef.current?.clearInlineSuggestion()
      }
      setInlineSuggestionPending(false)
      setAmbientIdle()
    } finally {
      setInlineSuggestionPending(false)
      setAmbientIdle()
      if (inlineSuggestAbortRef.current === controller) {
        inlineSuggestAbortRef.current = null
      }
    }
  }, [activeNoteId, autoInlineCompletionEnabled, editorComposing, noteReady, notes, setAmbientIdle, setAmbientThinking])

  const scheduleInlineSuggestion = useCallback((delayMs = 600) => {
    if (inlineSuggestTimerRef.current != null) {
      window.clearTimeout(inlineSuggestTimerRef.current)
      inlineSuggestTimerRef.current = null
    }
    inlineSuggestTimerRef.current = window.setTimeout(() => {
      void requestInlineSuggestion({ triggerKind: 'automatic' })
    }, Math.max(600, delayMs))
  }, [requestInlineSuggestion])
  scheduleInlineSuggestionRef.current = scheduleInlineSuggestion

  const handleManualInvokeInlineSuggestion = useCallback(() => {
    inlineSuggestAbortRef.current?.abort()
    void requestInlineSuggestion({
      triggerKind: 'invoke',
      force: true,
      speculative: false,
    })
  }, [requestInlineSuggestion])

  // Only schedule inline suggestion on note switch, not on every keystroke.
  // Keystroke-driven suggestions are handled by the editor's onChange callback.
  useEffect(() => {
    if (!autoInlineCompletionEnabled) return
    if (!activeNoteId || !noteReady) return
    scheduleInlineSuggestion(300)
    return () => {
      if (inlineSuggestTimerRef.current != null) {
        window.clearTimeout(inlineSuggestTimerRef.current)
        inlineSuggestTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId, autoInlineCompletionEnabled, noteReady])

  useEffect(() => {
    const refresh = () => {
      setAgentMemories(getRelevantMemories({
        noteId: activeNoteId || undefined,
        noteTitle: note?.title,
        noteContent: editContent,
        limit: 8,
      }))
    }
    refresh()
    const timer = window.setInterval(refresh, 10000)
    return () => window.clearInterval(timer)
  }, [activeNoteId, note?.title])

  useEffect(() => {
    const onHotkey = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey
      if (!cmdOrCtrl || event.key.toLowerCase() !== 'b') return
      event.preventDefault()
      setShowSidebar((prev) => !prev)
    }
    window.addEventListener('keydown', onHotkey)
    return () => window.removeEventListener('keydown', onHotkey)
  }, [])

  const startResizeAI = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = aiPanelWidth
    const minWidth = 320
    const maxWidth = 620

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta))
      setAiPanelWidth(next)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [aiPanelWidth])

  const startResizeSidebar = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const minWidth = 220
    const maxWidth = 420

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta))
      setSidebarWidth(next)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('notes_ai_panel_width', String(aiPanelWidth))
  }, [aiPanelWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('notes_sidebar_width', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('notes_inline_auto_completion_enabled', autoInlineCompletionEnabled ? '1' : '0')
  }, [autoInlineCompletionEnabled])

  const { canUndoAI, canRedoAI } = useMemo(() => {
    const activeHistory = activeNoteId ? aiHistoryRef.current[activeNoteId] : undefined
    return {
      canUndoAI: (activeHistory?.undo.length || 0) > 0,
      canRedoAI: (activeHistory?.redo.length || 0) > 0,
    }
  }, [activeNoteId, aiHistoryVersion])

  return (
    <div className="relative h-full min-h-0 flex flex-col bg-bg-primary overflow-hidden">
      <div
        data-testid="notes-topbar"
        className="mx-3 mt-3 flex items-center justify-between rounded-2xl border border-white/45 bg-white/55 px-3 py-2 shadow-[0_8px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/20 dark:bg-white/10"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            onClick={() => setShowSidebar((prev) => !prev)}
            data-testid="notes-sidebar-toggle"
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            title="显示/隐藏笔记树（Cmd/Ctrl+B）"
          >
            {showSidebar ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <input
            ref={titleInputRef}
            data-testid="notes-title-input"
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            className="min-w-[180px] max-w-[620px] flex-1 truncate bg-transparent text-sm font-semibold text-text-primary outline-none md:text-base"
            placeholder="笔记标题..."
          />
          {saving && <span className="text-[10px] text-text-muted">保存中...</span>}
          <span className="sr-only">{aiHealth}:{aiAmbient}</span>
        </div>
        <button
          onClick={() => setShowAI((prev) => !prev)}
          data-testid="notes-agent-toggle"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-all ${
            showAI
              ? 'border-primary-300 bg-primary-50 text-primary-600 dark:bg-primary-900/20'
              : 'border-border-primary text-text-muted hover:border-primary-300 hover:text-text-primary'
          }`}
          title="显示/隐藏 Agent 面板"
        >
          Agent
          {showAI ? <PanelRightClose size={12} /> : <PanelRightOpen size={12} />}
        </button>
      </div>

      <div className="pointer-events-none absolute right-4 top-[84px] z-40 flex flex-col items-end gap-2">
        {editorNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="pointer-events-auto max-w-[360px] px-3 py-2 rounded-xl border border-primary-200/80 bg-primary-50/90 text-[12px] text-primary-700 shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:bg-primary-900/25 dark:border-primary-500/45 dark:text-primary-300 backdrop-blur-md"
          >
            {editorNotice}
          </motion.div>
        )}
        {writeTxnNotice && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="pointer-events-auto max-w-[360px] px-3 py-1.5 rounded-xl border border-border-primary bg-bg-secondary/80 text-[11px] text-text-secondary shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur-md"
          >
            写入事务：{writeTxnNotice}
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {folderNameDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="absolute inset-0 z-[140] flex items-center justify-center bg-slate-950/28 px-4 backdrop-blur-[2px]"
            onMouseDown={closeFolderNameDialog}
          >
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.985 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="w-full max-w-md rounded-2xl border border-white/45 bg-white/88 px-4 py-3 shadow-[0_18px_60px_rgba(15,23,42,0.22)] dark:border-white/18 dark:bg-slate-950/78"
              role="dialog"
              aria-modal="true"
              data-testid="notes-folder-name-dialog"
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeFolderNameDialog()
                }
              }}
            >
              <p className="text-sm font-semibold text-text-primary">{folderNameDialog.title}</p>
              <p className="mt-1 text-xs text-text-muted">
                {folderNameDialog.mode === 'create'
                  ? '文件夹会出现在当前层级，后续可拖拽调整顺序。'
                  : '重命名会同步更新树结构与路径展示。'}
              </p>

              <div className="mt-3">
                <label htmlFor="notes-folder-name-input" className="mb-1 block text-[11px] text-text-muted">
                  文件夹名称
                </label>
                <input
                  id="notes-folder-name-input"
                  ref={folderDialogInputRef}
                  data-testid="notes-folder-name-input"
                  value={folderNameDialog.value}
                  onChange={(event) => {
                    const value = event.target.value
                    setFolderDialogError(null)
                    setFolderNameDialog((prev) => (prev ? { ...prev, value } : prev))
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitFolderNameDialog()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      closeFolderNameDialog()
                    }
                  }}
                  maxLength={120}
                  className="h-10 w-full rounded-xl border border-border-primary bg-bg-secondary/70 px-3 text-sm text-text-primary outline-none transition-colors focus:border-primary-400/70"
                  placeholder="例如：研究计划"
                />
                {folderDialogError && (
                  <p className="mt-1.5 text-[11px] text-red-500">{folderDialogError}</p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeFolderNameDialog}
                  disabled={folderDialogSaving}
                  className="rounded-lg border border-border-primary px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-border-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void submitFolderNameDialog()
                  }}
                  disabled={folderDialogSaving}
                  className="rounded-lg border border-primary-400/65 bg-primary-500/14 px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-500/24 disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary-300"
                >
                  {folderDialogSaving ? '处理中…' : folderNameDialog.confirmLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {noteNameDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="absolute inset-0 z-[140] flex items-center justify-center bg-slate-950/28 px-4 backdrop-blur-[2px]"
            onMouseDown={closeNoteNameDialog}
          >
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.985 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="w-full max-w-md rounded-2xl border border-white/45 bg-white/88 px-4 py-3 shadow-[0_18px_60px_rgba(15,23,42,0.22)] dark:border-white/18 dark:bg-slate-950/78"
              role="dialog"
              aria-modal="true"
              data-testid="notes-rename-dialog"
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeNoteNameDialog()
                }
              }}
            >
              <p className="text-sm font-semibold text-text-primary">重命名笔记</p>
              <p className="mt-1 text-xs text-text-muted">双击侧栏笔记名或右键菜单可触发重命名。</p>

              <div className="mt-3">
                <label htmlFor="notes-rename-input" className="mb-1 block text-[11px] text-text-muted">
                  标题
                </label>
                <input
                  id="notes-rename-input"
                  ref={noteNameDialogInputRef}
                  data-testid="notes-rename-input"
                  value={noteNameDialog.value}
                  onChange={(event) => {
                    const value = event.target.value
                    setNoteNameDialogError(null)
                    setNoteNameDialog((prev) => (prev ? { ...prev, value } : prev))
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitNoteNameDialog()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      closeNoteNameDialog()
                    }
                  }}
                  maxLength={180}
                  className="h-10 w-full rounded-xl border border-border-primary bg-bg-secondary/70 px-3 text-sm text-text-primary outline-none transition-colors focus:border-primary-400/70"
                  placeholder="输入笔记标题"
                />
                {noteNameDialogError && (
                  <p className="mt-1.5 text-[11px] text-red-500">{noteNameDialogError}</p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeNoteNameDialog}
                  disabled={noteNameDialogSaving}
                  className="rounded-lg border border-border-primary px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-border-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void submitNoteNameDialog()
                  }}
                  disabled={noteNameDialogSaving}
                  className="rounded-lg border border-primary-400/65 bg-primary-500/14 px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-500/24 disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary-300"
                >
                  {noteNameDialogSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {noteTagsDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="absolute inset-0 z-[140] flex items-center justify-center bg-slate-950/28 px-4 backdrop-blur-[2px]"
            onMouseDown={closeNoteTagsDialog}
          >
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.985 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="w-full max-w-md rounded-2xl border border-white/45 bg-white/88 px-4 py-3 shadow-[0_18px_60px_rgba(15,23,42,0.22)] dark:border-white/18 dark:bg-slate-950/78"
              role="dialog"
              aria-modal="true"
              data-testid="notes-tags-dialog"
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeNoteTagsDialog()
                }
              }}
            >
              <p className="text-sm font-semibold text-text-primary">编辑标签</p>
              <p className="mt-1 text-xs text-text-muted">
                {noteTagsDialog.title}
              </p>

              <div className="mt-3">
                <label htmlFor="notes-tags-input" className="mb-1 block text-[11px] text-text-muted">
                  标签（逗号分隔）
                </label>
                <input
                  id="notes-tags-input"
                  ref={noteTagsDialogInputRef}
                  data-testid="notes-tags-input"
                  value={noteTagsDialog.value}
                  onChange={(event) => {
                    const value = event.target.value
                    setNoteTagsDialogError(null)
                    setNoteTagsDialog((prev) => (prev ? { ...prev, value } : prev))
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitNoteTagsDialog()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      closeNoteTagsDialog()
                    }
                  }}
                  className="h-10 w-full rounded-xl border border-border-primary bg-bg-secondary/70 px-3 text-sm text-text-primary outline-none transition-colors focus:border-primary-400/70"
                  placeholder="例如：重点, 复习, 算法"
                />
                {noteTagsDialogError && (
                  <p className="mt-1.5 text-[11px] text-red-500">{noteTagsDialogError}</p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeNoteTagsDialog}
                  disabled={noteTagsDialogSaving}
                  className="rounded-lg border border-border-primary px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-border-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void submitNoteTagsDialog()
                  }}
                  disabled={noteTagsDialogSaving}
                  className="rounded-lg border border-primary-400/65 bg-primary-500/14 px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-500/24 disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary-300"
                >
                  {noteTagsDialogSaving ? '保存中…' : '保存标签'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-h-0 flex overflow-hidden mt-3">
        {!showSidebar && (
          <motion.button
            type="button"
            onClick={() => setShowSidebar(true)}
            className="mx-2 h-full w-3 rounded-full border border-white/35 bg-white/35 dark:border-white/10 dark:bg-white/10 backdrop-blur-md hover:bg-white/55 transition-colors"
            title="展开笔记树（Cmd/Ctrl+B）"
            aria-label="展开笔记树"
            whileHover={{ scaleX: 1.2 }}
            whileTap={{ scaleX: 0.9 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          />
        )}
        {showSidebar && (
          <div
            style={{ width: sidebarWidth }}
            data-testid="notes-sidebar-panel"
            className="pm-elastic-panel relative h-full min-h-0 flex-shrink-0 overflow-hidden"
          >
            <NoteSidebar
              folders={folders}
              notes={filteredTreeNotes}
              activeNoteId={activeNoteId}
              onSelectNote={handleSelectNote}
              onRenameNote={handleRenameNoteInline}
              onNewNote={handleNewNote}
              onSearch={setSearchQuery}
              onCreateFolder={handleCreateFolder}
              onDeleteNote={handleDeleteNote}
              onDeleteFolder={handleDeleteFolder}
              onRenameFolder={handleRenameFolder}
              onReorder={handleTreeReorder}
              onNodeContextMenu={handleSidebarNodeContextMenu}
              onBlankContextMenu={handleSidebarBlankContextMenu}
              backlinks={backlinks}
            />
            <div
              onMouseDown={startResizeSidebar}
              data-testid="notes-sidebar-resize-handle"
              className="absolute right-0 top-0 z-20 h-full w-2 cursor-col-resize"
              title="拖动调整笔记树宽度"
            />
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden transition-opacity duration-200">
          {activeNoteId ? (
            <div className="flex-1 overflow-hidden px-3 pb-3">
              <AnimatePresence mode="wait" initial={false}>
                {!noteReady ? (
                  <motion.div
                    key={`note-loading:${activeNoteId}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
                    className="h-full rounded-2xl border border-border-primary bg-bg-secondary/65 px-4 py-3 text-xs text-text-muted"
                  >
                    正在加载笔记…
                  </motion.div>
                ) : (
                  <motion.div
                    key={`note-editor:${activeNoteId}:${editorSyncToken}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
                    className="h-full overflow-hidden"
                  >
                    <div className="mx-auto h-full w-full max-w-[920px] min-h-0" data-note-editor-host="true">
                      <div
                        className="h-full min-h-0"
                        data-testid="notes-editor-context-zone"
                        onContextMenu={handleEditorContextMenu}
                      >
                        <ErrorBoundary
                          resetKey={`${activeNoteId}:editor:${editorSyncToken}`}
                          fallback={(
                            <NoteEditorFallback
                              content={editContent}
                              onChange={handleContentChange}
                              onRetry={() => setEditorSyncToken((prev) => prev + 1)}
                            />
                          )}
                        >
                          <NoteEditor
                            ref={noteEditorRef}
                            key={`${activeNoteId}:${editorSyncToken}`}
                            content={editContent}
                            onChange={handleContentChange}
                            inlineSuggestionPending={inlineSuggestionPending}
                            autoInlineCompletionEnabled={autoInlineCompletionEnabled}
                            onCompositionStateChange={setEditorComposing}
                            onInlineSuggestionAccepted={() => {
                              // Track last accepted to prevent duplicate loop
                              lastAcceptedTextRef.current = currentInlineSuggestionRef.current
                              window.setTimeout(() => {
                                void requestInlineSuggestion({
                                  triggerKind: 'speculative',
                                  force: true,
                                  speculative: true,
                                })
                              }, 50)
                            }}
                            onInlineSuggestionInvoke={handleManualInvokeInlineSuggestion}
                            onOpenWikilink={handleOpenWikilink}
                            onHoverWikilink={handleHoverWikilink}
                            onSave={handleSave}
                            flashSignal={editorFlashSignal}
                          />
                        </ErrorBoundary>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-text-muted text-sm mb-3">选择一篇笔记开始编辑</p>
                <button
                  onClick={() => {
                    void handleNewNote(null)
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 transition-colors"
                >
                  + 新建笔记
                </button>
              </div>
            </div>
          )}
        </div>

        {showAI && (
          <motion.div
            initial={false}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            style={{ width: aiPanelWidth }}
            className="pm-elastic-panel relative h-full min-h-0 flex-shrink-0 overflow-hidden border-l border-border-primary/70"
          >
            <div
              onMouseDown={startResizeAI}
              className="absolute left-0 top-0 z-20 h-full w-2 cursor-col-resize"
              title="拖动调整 AI 侧栏宽度"
            />
            <div className="h-full min-h-0 flex flex-col">
              <motion.div
                layout
                onMouseEnter={handleMemoryCardMouseEnter}
                onMouseLeave={handleMemoryCardMouseLeave}
                className="mx-2 mt-2 mb-1 rounded-2xl border border-white/35 dark:border-white/15 bg-white/50 dark:bg-white/5 backdrop-blur-md px-3 py-2"
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              >
                <button
                  type="button"
                  onClick={handleMemoryCardToggle}
                  className="w-full flex items-center justify-between gap-2 text-left"
                  title="展开或收起共享记忆"
                >
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">Shared Memory</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                    <span>{agentMemories.length} 条</span>
                    <ChevronDown
                      size={12}
                      className={`transition-transform duration-200 ${memoryExpanded ? 'rotate-180' : 'rotate-0'}`}
                    />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {memoryExpanded && (
                    <motion.div
                      key="memory-expanded"
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1.5 max-h-[136px] overflow-auto pr-1">
                        {agentMemories.length === 0 && (
                          <p className="text-[11px] text-text-muted">暂无共享记忆，AI 对话后自动沉淀。</p>
                        )}
                        <AnimatePresence initial={false}>
                          {agentMemories.map((item) => (
                            <motion.div
                              key={item.id}
                              layout
                              initial={{ opacity: 0, y: 6, scale: 0.988 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -6, scale: 0.97 }}
                              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                              className={`rounded-lg border bg-bg-secondary/60 backdrop-blur-md px-2 py-1.5 ${memoryPreviewId === item.id ? 'border-primary-300/80 shadow-[0_8px_20px_rgba(59,130,246,0.14)]' : 'border-border-primary/70'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] text-text-primary truncate">{item.summary}</p>
                                {typeof item.score === 'number' && (
                                  <span className="text-[10px] text-text-muted">{Math.round(item.score * 100)}%</span>
                                )}
                              </div>
                              <p className="text-[10px] text-text-muted mt-0.5">{item.noteTitle || '未命名笔记'}</p>
                              {item.kind === 'revision' && item.afterHash && (
                                <div className="mt-1.5 flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    className="px-1.5 py-0.5 rounded-md border border-border-primary text-[10px] text-text-secondary hover:text-text-primary hover:border-primary-300 transition-colors"
                                    onClick={() => handlePreviewMemoryRevision(item)}
                                    title="预览回溯差异"
                                  >
                                    预览
                                  </button>
                                  <button
                                    type="button"
                                    className="px-1.5 py-0.5 rounded-md border border-primary-300/70 text-[10px] text-primary-600 dark:text-primary-300 hover:bg-primary-500/10 transition-colors"
                                    onClick={() => void handleApplyMemoryRevision(item)}
                                    title="应用该回溯版本"
                                  >
                                    回溯
                                  </button>
                                  {memoryPreviewId === item.id && (
                                    <motion.button
                                      type="button"
                                      className="px-1.5 py-0.5 rounded-md border border-border-primary text-[10px] text-text-muted hover:text-text-primary transition-colors"
                                      onClick={handleClearMemoryPreview}
                                      initial={{ opacity: 0, scale: 0.94 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      exit={{ opacity: 0, scale: 0.92 }}
                                      transition={{ duration: 0.16 }}
                                    >
                                      关闭预览
                                    </motion.button>
                                  )}
                                </div>
                              )}
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            <Suspense fallback={(
              <div className="h-full flex items-center justify-center text-xs text-text-muted">
                正在加载 AI 面板…
              </div>
            )}
            >
              <div className="min-h-0 flex-1">
                <NoteAIPanel
                  noteId={activeNoteId}
                  noteContent={editContent}
                  noteTitle={editTitle}
                  studentId={studentId}
                  onNoteCreated={handleNoteCreated}
                  onClose={() => setShowAI(false)}
                  onApplyEdit={handleApplyEdit}
                  onPreviewEdit={handlePreviewEdit}
                  onPreviewInlineReplace={handlePreviewInlineReplace}
                  onApplyInlineReplace={handleApplyInlineReplace}
                  onClearInlineReplacePreview={handleClearInlineReplacePreview}
                  externalPrompt={externalNotePrompt}
                  onExternalPromptConsumed={() => setExternalNotePrompt(null)}
                  getEditorCursorContext={handleGetEditorCursorContext}
                  onEnsureNoteTarget={ensureNoteTargetReady}
                  onLocate={handleLocateQuery}
                  onUndo={handleUndoAIEdit}
                  onRedo={handleRedoAIEdit}
                  onWriteTransaction={handleWriteTransaction}
                  canUndo={canUndoAI}
                  canRedo={canRedoAI}
                />
              </div>
            </Suspense>
            </div>
          </motion.div>
        )}
      </div>
      {wikilinkPreview && (
        <div
          className="pm-note-wikilink-preview"
          onMouseEnter={handlePreviewMouseEnter}
          onMouseLeave={handlePreviewMouseLeave}
          style={{ left: `${wikilinkPreview.x}px`, top: `${wikilinkPreview.y}px` }}
        >
          <p className="pm-note-wikilink-preview-title">{wikilinkPreview.title || wikilinkPreview.target}</p>
          <p className="pm-note-wikilink-preview-body">
            {wikilinkPreview.loading ? '正在加载双链预览…' : (wikilinkPreview.excerpt || '暂无可预览内容。')}
          </p>
          {wikilinkPreview.exists && !wikilinkPreview.loading && (
            <>
              <div className="pm-note-wikilink-preview-actions">
                <button
                  type="button"
                  className="pm-note-wikilink-summary-btn"
                  onClick={handleGeneratePreviewSummary}
                  disabled={Boolean(wikilinkPreview.summaryLoading)}
                >
                  <Sparkles size={12} />
                  {wikilinkPreview.summaryLoading ? 'Summarizing…' : 'Agent Summary'}
                </button>
                {wikilinkPreview.summaryEngine && (
                  <span className="pm-note-wikilink-preview-chip">{wikilinkPreview.summaryEngine}</span>
                )}
              </div>
              {wikilinkPreview.summaryFallback && (
                <p className="mt-1 text-[11px] text-amber-300/90">已切换至备用引擎</p>
              )}
            </>
          )}
          {(wikilinkPreview.summaryLoading || wikilinkPreview.summaryReady || wikilinkPreview.summaryError) && (
            <div className="pm-note-wikilink-summary-output">
              {wikilinkPreview.summaryLoading && <div className="pm-note-wikilink-loading-bar" />}
              {wikilinkPreview.summary && (
                <pre className="pm-note-wikilink-summary-text">{wikilinkPreview.summary}</pre>
              )}
              {wikilinkPreview.summaryError && (
                <p className="pm-note-wikilink-summary-error">{wikilinkPreview.summaryError}</p>
              )}
            </div>
          )}
          <p className="pm-note-wikilink-preview-tip">
            {wikilinkPreview.exists ? 'Cmd/Ctrl + Click 打开' : 'Cmd/Ctrl + Click 自动创建'}
          </p>
        </div>
      )}
    </div>
  )
}
