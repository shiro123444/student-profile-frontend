import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Send, Sparkles, X, Undo2, Redo2, Check, ChevronDown, ChevronRight, Wrench, Plus } from 'lucide-react'
import { useAgentStream, type AgentMessage } from '../../hooks/useAgentStream'
import { appendAgentMemory } from '../../services/agentMemoryBridge'

export type NoteAIEditAction =
  | 'append'
  | 'replace_all'
  | 'insert_after_anchor'
  | 'replace_anchor'

export interface NoteAIEditPayload {
  action: NoteAIEditAction
  content: string
  anchor?: string
  targetNoteId?: string
  source?: string
}

export interface NoteAIApplyResult {
  ok: boolean
  message: string
}

export interface NoteWriteTransactionEvent {
  stage: 'start' | 'locate' | 'apply' | 'done' | 'error'
  message: string
  query?: string
}

export interface NoteAIInlineReplacePatch {
  original: string
  replacement: string
}

interface NoteAIPanelProps {
  noteId?: string | null
  noteContent?: string
  noteTitle?: string
  studentId?: string
  onNoteCreated?: () => void
  onClose?: () => void
  onApplyEdit?: (payload: NoteAIEditPayload) => NoteAIApplyResult | Promise<NoteAIApplyResult>
  onPreviewEdit?: (payload: NoteAIEditPayload) => NoteAIApplyResult | Promise<NoteAIApplyResult>
  onLocate?: (query: string) => NoteAIApplyResult | void
  onUndo?: () => NoteAIApplyResult | Promise<NoteAIApplyResult> | void
  onRedo?: () => NoteAIApplyResult | Promise<NoteAIApplyResult> | void
  onEnsureNoteTarget?: () => Promise<boolean>
  onPreviewInlineReplace?: (patch: NoteAIInlineReplacePatch) => NoteAIApplyResult | Promise<NoteAIApplyResult>
  onApplyInlineReplace?: (patch: NoteAIInlineReplacePatch) => NoteAIApplyResult | Promise<NoteAIApplyResult>
  onClearInlineReplacePreview?: () => void
  externalPrompt?: string | null
  onExternalPromptConsumed?: () => void
  getEditorCursorContext?: () => { cursor: number; before: string; after: string } | null
  onWriteTransaction?: (event: NoteWriteTransactionEvent) => void
  canUndo?: boolean
  canRedo?: boolean
}

interface ParsedEditPlan {
  action: NoteAIEditAction
  anchor?: string
  content: string
}

interface ToolTrace {
  id: string
  text: string
}

interface NoteAgentRuntimeDecision {
  runtime: {
    mode: 'balanced' | 'deep'
    engine?: 'claude'
    modelTier?: 'sonnet'
  }
  reason: string
}

interface RenderedAssistantContent {
  cleanedMarkdown: string
  analysisMarkdown: string | null
  actionHint: string | null
}

interface NoteConversationThread {
  id: string
  title: string
  preview: string
  updatedAt: number
  messages: AgentMessage[]
}

interface MessageBubbleProps {
  message: AgentMessage
  streaming: boolean
  noteTitle?: string
}

function analysisPreview(content: string): string {
  const normalized = (content || '').replace(/\r/g, '').trim()
  if (!normalized) return '分析内容生成中…'
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return '分析内容生成中…'
  return lines.slice(0, 2).join(' ').slice(0, 180)
}

function summarizeAssistantMessage(raw: string): { title: string; detail: string } {
  const inlinePatch = parseInlineReplacePatch(raw || '')
  const plan = parseEditPlan(raw || '')
  const rendered = renderAssistantContent(raw || '')
  const analysis = rendered.analysisMarkdown ? analysisPreview(rendered.analysisMarkdown) : ''
  const detailSource = analysis || rendered.cleanedMarkdown || ''
  const detail = detailSource.replace(/\s+/g, ' ').trim().slice(0, 140) || '已执行本轮笔记处理。'

  if (inlinePatch) {
    return {
      title: `行内替换 · ${inlinePatch.original.replace(/\s+/g, ' ').slice(0, 22)}`,
      detail: inlinePatch.replacement.replace(/\s+/g, ' ').slice(0, 140) || detail,
    }
  }

  if (plan) {
    return {
      title: `修改 ${actionLabel(plan.action)}${plan.anchor ? ` · ${plan.anchor.slice(0, 24)}` : ''}`,
      detail,
    }
  }
  return { title: '处理完成', detail }
}

const MessageBubble = memo(function MessageBubble({ message, streaming, noteTitle }: MessageBubbleProps) {
  const assistantRender = useMemo(
    () => (message.role === 'assistant' ? renderAssistantContent(message.content || '') : null),
    [message.role, message.content],
  )
  const assistantSummary = useMemo(
    () => summarizeAssistantMessage(message.content || ''),
    [message.content],
  )

  return (
    <div className={`flex min-w-0 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`min-w-0 ${message.role === 'user' ? 'max-w-[90%]' : 'max-w-full'} rounded-xl px-3 py-2 text-xs leading-relaxed ${
        message.role === 'user'
          ? 'bg-primary-500/20 text-text-primary'
          : 'bg-bg-tertiary text-text-secondary'
      } overflow-hidden`}
      >
        {message.role === 'assistant' ? (
          <div className="space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-text-primary truncate">{assistantSummary.title}</p>
              {assistantRender?.actionHint && (
                <span className="px-1.5 py-0.5 rounded-md border border-border-primary bg-bg-secondary/70 text-[10px] text-text-muted">
                  {assistantRender.actionHint}
                </span>
              )}
            </div>
            {streaming ? (
              <p className="text-[11px] text-text-muted leading-relaxed">
                正在处理《{noteTitle || '当前笔记'}》并执行写入…
                <span className="inline-block h-3 w-[5px] ml-1 rounded-[2px] bg-primary-500/80 animate-pulse align-middle" />
              </p>
            ) : (
              <p className="text-[11px] text-text-muted leading-relaxed">{assistantSummary.detail}</p>
            )}
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words">
            <p className="text-[11px] text-text-muted/80 mb-0.5">你的请求</p>
            <p className="text-xs text-text-primary">{message.content}</p>
          </div>
        )}
      </div>
    </div>
  )
}, (prev, next) => prev.message === next.message && prev.streaming === next.streaming && prev.noteTitle === next.noteTitle)

function createThreadId() {
  return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function buildThreadTitle(messages: AgentMessage[], fallback: string): string {
  const firstUser = messages.find((item) => item.role === 'user' && item.content.trim().length > 0)
  if (!firstUser) return fallback
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 28)
}

function buildThreadPreview(messages: AgentMessage[]): string {
  const lastAssistant = [...messages].reverse().find((item) => item.role === 'assistant' && item.content.trim().length > 0)
  if (lastAssistant) {
    const summary = summarizeAssistantMessage(lastAssistant.content)
    return summary.detail
  }
  const lastUser = [...messages].reverse().find((item) => item.role === 'user' && item.content.trim().length > 0)
  return lastUser ? lastUser.content.replace(/\s+/g, ' ').trim().slice(0, 60) : '等待开始对话'
}

const ThreadItem = memo(function ThreadItem({
  thread,
  active,
  onSelect,
}: {
  thread: NoteConversationThread
  active: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(thread.id)}
      className={`w-full text-left rounded-lg border px-2.5 py-2 transition-colors ${
        active
          ? 'border-primary-300/70 bg-primary-500/10'
          : 'border-border-primary bg-bg-secondary/40 hover:bg-bg-secondary/70'
      }`}
    >
      <p className="text-[11px] font-medium text-text-primary truncate">{thread.title}</p>
      <p className="mt-0.5 text-[10px] text-text-muted line-clamp-1">{thread.preview}</p>
    </button>
  )
})

const NOTE_AGENT_PROMPT_SPEC = `你是 PathMind 笔记助手。

要求：
1) 使用简体中文，客观克制，避免 emoji。
2) 输出 Markdown。
3) 先给「## 分析」。
4) 若给出可直接写入笔记的内容，必须输出如下控制块（由系统解析，不要省略）：
\`\`\`pathmind-edit
action: append | insert_after_anchor | replace_anchor | replace_all
anchor: 可选，锚点文本
\`\`\`
5) 控制块后输出「## 可应用片段」，内容要能直接落笔记。
6) 默认优先使用低风险动作（append / insert_after_anchor / replace_anchor）；只有在确有必要时才用 replace_all。
7) 只要涉及教材/PDF/文档事实，必须先调用 search_documents；若未命中，写清查询词与返回 count，再给通用建议。
8) 「可应用片段」不要再包裹 \`\`\`markdown 代码块；直接输出正文。
9) 写作内容必须遵守当前编辑器可渲染语法：标题（#..######）、有序/无序列表、任务列表、表格、引用、代码块（\`\`\`lang）、内联代码（\`code\`）、高亮（==text==）、双链（[[note]]）。
10) 绝对禁止输出破坏语法的半成品（例如未闭合的 \`\`\` 或 [[ ）。
11) 若用户未明确要求跨笔记，不要改写其他笔记正文；仅基于当前笔记上下文。
12) 若当前笔记已存在代码块，默认优先“在原代码上修补/注释”，不要无条件追加到末尾；若动作不明确，先说明待确认点。

边界：
- 你不能声称“已修改用户笔记”。
- 低风险动作可自动写入，高风险替换需用户确认。

当任务是“修改已有段落/代码”时，优先返回下面 XML：
<replace>
  <original>需要替换的原文（必须来自当前笔记）</original>
  <replacement>替换后的内容</replacement>
</replace>
不要和 pathmind-edit 混用。若无法精确定位 original，请明确说明。`

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parseInlineReplacePatch(rawContent: string): NoteAIInlineReplacePatch | null {
  const content = (rawContent || '').trim()
  if (!content) return null

  const replaceMatch = content.match(/<replace>\s*<original>([\s\S]*?)<\/original>\s*<replacement>([\s\S]*?)<\/replacement>\s*<\/replace>/i)
  if (!replaceMatch) return null

  const original = decodeXmlEntities((replaceMatch[1] || '').trim())
  const replacement = decodeXmlEntities((replaceMatch[2] || '').trim())
  if (!original || !replacement) return null

  return {
    original,
    replacement,
  }
}

function normalizeEditableContent(raw: string): string {
  const text = (raw || '').trim()
  if (!text) return ''

  const wrapped = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  if (!wrapped) return text

  const inner = wrapped[1].trim()
  const looksLikeDocument = /(^|\n)\s{0,3}(#{1,6}\s+|- |\d+\.\s+|>\s+|\[\[.+\]\]|```)/.test(inner)
  return looksLikeDocument ? inner : text
}

function parseEditPlan(rawContent: string): ParsedEditPlan | null {
  const content = rawContent.trim()
  if (!content) return null

  const blockMatch = content.match(/```pathmind-edit\s*([\s\S]*?)```/i)
  const hasControlBlock = Boolean(blockMatch)
  const configRaw = blockMatch?.[1] || ''
  const parsedConfig: Record<string, string> = {}

  configRaw.split('\n').forEach((line) => {
    const match = line.match(/^\s*([a-z_]+)\s*:\s*(.+?)\s*$/i)
    if (!match) return
    parsedConfig[match[1].toLowerCase()] = match[2].trim()
  })

  const actionRaw = (parsedConfig.action || 'append').toLowerCase()
  const allowed: NoteAIEditAction[] = ['append', 'replace_all', 'insert_after_anchor', 'replace_anchor']
  const action: NoteAIEditAction = allowed.includes(actionRaw as NoteAIEditAction)
    ? (actionRaw as NoteAIEditAction)
    : 'append'

  const withoutControlBlock = blockMatch
    ? content.replace(blockMatch[0], '').trim()
    : content

  const editableSectionMatch = withoutControlBlock.match(/##\s*可应用片段\s*([\s\S]*)/i)
  const editableSection = editableSectionMatch?.[1]?.trim()
  if (!hasControlBlock && !editableSection) return null

  const finalContent = normalizeEditableContent(editableSection || withoutControlBlock)
  if (!finalContent) return null

  const anchor = parsedConfig.anchor?.trim()
  return {
    action,
    anchor: anchor || undefined,
    content: finalContent,
  }
}

function renderAssistantContent(rawContent: string): RenderedAssistantContent {
  const content = (rawContent || '').trim()
  if (!content) {
    return {
      cleanedMarkdown: '',
      analysisMarkdown: null,
      actionHint: null,
    }
  }

  const blockMatch = content.match(/```pathmind-edit\s*([\s\S]*?)```/i)
  const configRaw = blockMatch?.[1] || ''
  const actionRaw = configRaw.match(/^\s*action\s*:\s*(.+?)\s*$/im)?.[1]?.trim() || ''
  const anchorRaw = configRaw.match(/^\s*anchor\s*:\s*(.+?)\s*$/im)?.[1]?.trim() || ''
  const actionHint = actionRaw
    ? `${actionRaw}${anchorRaw ? ` · 锚点 ${anchorRaw}` : ''}`
    : null

  const rawWithoutControlBlock = blockMatch
    ? content.replace(blockMatch[0], '')
    : content
  const cleanedMarkdown = rawWithoutControlBlock
    .replace(/```pathmind-edit[\s\S]*$/i, '')
    .trim()

  const analysisRegex = /(?:^|\n)##\s*分析\s*\n([\s\S]*?)(?=\n##\s*可应用片段|\n##\s*[^\n]+|$)/i
  const analysisMatch = cleanedMarkdown.match(analysisRegex)
  const analysisMarkdown = analysisMatch?.[1]?.trim() || null
  const cleanedWithoutAnalysis = analysisMatch
    ? cleanedMarkdown.replace(analysisMatch[0], '\n').trim()
    : cleanedMarkdown

  return {
    cleanedMarkdown: cleanedWithoutAnalysis,
    analysisMarkdown,
    actionHint,
  }
}

function actionLabel(action: NoteAIEditAction) {
  if (action === 'replace_all') return '替换整篇'
  if (action === 'insert_after_anchor') return '锚点后插入'
  if (action === 'replace_anchor') return '替换锚点段落'
  return '追加末尾'
}

function looksLikeCodeIntent(prompt: string): boolean {
  const text = (prompt || '').toLowerCase()
  if (!text) return false
  return /(代码|程序|脚本|函数|python|javascript|typescript|java|c\+\+|golang|go|bug|报错|debug|修复|重构|algorithm|code|function|stack trace)/i.test(text)
}

function hasExplicitEditAction(prompt: string): boolean {
  const text = (prompt || '').toLowerCase()
  if (!text) return false
  return /(追加|新增|插入|末尾|append|add|replace|替换|覆盖|改写|重写|rewrite|refactor|锚点|anchor)/i.test(text)
}

function extractFirstFencedCodeBlock(markdown: string): string | null {
  const text = (markdown || '').trim()
  if (!text) return null
  const match = text.match(/```[a-zA-Z0-9_+\-]*\n[\s\S]*?\n```/)
  return match ? match[0].trim() : null
}

function stripAssistantBoilerplate(markdown: string): string {
  return (markdown || '')
    .replace(/```pathmind-edit[\s\S]*?```/gi, '')
    .replace(/<replace>[\s\S]*?<\/replace>/gi, '')
    .replace(/(^|\n)##\s*(分析|可应用片段|结论|说明)\s*\n?/gi, '\n')
    .replace(/(^|\n)\s*>?\s*提示[:：].*$/gim, '\n')
    .trim()
}

function normalizePlanContent(rawContent: string, userPrompt: string): string {
  const stripped = stripAssistantBoilerplate(rawContent)
  if (!stripped) return ''

  if (looksLikeCodeIntent(userPrompt)) {
    const fenced = extractFirstFencedCodeBlock(stripped)
    if (fenced) return fenced
  }

  return stripped
}

function getAutoApplyBlockReason(
  plan: ParsedEditPlan,
  userPrompt: string,
  noteContent?: string,
): string | null {
  const current = noteContent || ''
  if (
    plan.action === 'append'
    && looksLikeCodeIntent(userPrompt)
    && /```/.test(current)
    && !hasExplicitEditAction(userPrompt)
  ) {
    return '检测到当前笔记已存在代码，且你未明确“追加还是替换”。已暂停自动写入，请先确认。'
  }
  return null
}

function emitAutoApplyDebug(event: string, payload: Record<string, unknown>) {
  if (!import.meta.env.DEV) return
  console.debug('[note-ai:auto-apply]', {
    ts: new Date().toISOString(),
    event,
    ...payload,
  })
}

function toolLabel(tool: string) {
  if (tool.includes('semantic_search_notes')) return '语义检索笔记'
  if (tool.includes('search_notes')) return '检索笔记'
  if (tool.includes('search_documents')) return '检索教材'
  if (tool.includes('get_note_content')) return '读取笔记'
  if (tool.includes('get_note_graph')) return '分析关联图谱'
  if (tool.includes('delegate_to_agent')) return '委托专业 Agent'
  return tool
}

function toolTraceText(tool: string, status: string, reason?: string) {
  const label = toolLabel(tool)
  const suffix = reason ? `（${reason.slice(0, 64)}）` : ''
  if (status === 'success' || status === 'done') return `${label}：完成${suffix}`
  if (status === 'retry') return `${label}：重试中${suffix}`
  if (status === 'fallback') return `${label}：降级执行${suffix}`
  if (status.includes('handoff')) return `${label}：协作中${suffix}`
  return `${label}：执行中${suffix}`
}

function extractWriteQuery(content: string): string | undefined {
  const first = content.split('\n').map((line) => line.trim()).find(Boolean)
  if (!first) return undefined
  return first.slice(0, 24)
}

function resolveNoteAgentRuntime(
  userPrompt: string,
  noteContent: string | undefined,
): NoteAgentRuntimeDecision {
  const prompt = (userPrompt || '').trim()
  const contentSize = (noteContent || '').trim().length
  const combinedSize = prompt.length + contentSize

  const deepKeywords = [
    '重构',
    '重写',
    '系统设计',
    '架构',
    '多步骤',
    '多阶段',
    '对比分析',
    '批判性',
    '严格论证',
    '长文',
    '全文',
    '整篇',
    '复杂',
    '推理',
    'workflow',
    'refactor',
    'architecture',
    'multi-step',
    'deep analysis',
  ]
  const matchedKeyword = deepKeywords.find((token) =>
    prompt.toLowerCase().includes(token.toLowerCase()),
  )

  const shouldUseDeep =
    Boolean(matchedKeyword) ||
    prompt.length >= 260 ||
    contentSize >= 5200 ||
    combinedSize >= 6200

  if (shouldUseDeep) {
    return {
      runtime: {
        mode: 'deep',
        engine: 'claude',
        modelTier: 'sonnet',
      },
      reason: matchedKeyword
        ? `任务包含复杂指令（${matchedKeyword}）`
        : '任务体量较大，启用深度链路',
    }
  }

  return {
    runtime: {
      mode: 'balanced',
    },
    reason: '常规任务，使用平衡链路',
  }
}

export default function NoteAIPanel({
  noteId,
  noteContent,
  noteTitle,
  studentId,
  onNoteCreated,
  onClose,
  onApplyEdit,
  onPreviewEdit,
  onLocate,
  onUndo,
  onRedo,
  onEnsureNoteTarget,
  onPreviewInlineReplace,
  onApplyInlineReplace,
  onClearInlineReplacePreview,
  externalPrompt,
  onExternalPromptConsumed,
  getEditorCursorContext,
  onWriteTransaction,
  canUndo = false,
  canRedo = false,
}: NoteAIPanelProps) {
  const [toolTraces, setToolTraces] = useState<ToolTrace[]>([])
  const [panelNotice, setPanelNotice] = useState<string | null>(null)
  const [pendingRiskyPlan, setPendingRiskyPlan] = useState<ParsedEditPlan | null>(null)
  const [pendingInlinePatch, setPendingInlinePatch] = useState<NoteAIInlineReplacePatch | null>(null)
  const [showToolTrace, setShowToolTrace] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [threads, setThreads] = useState<NoteConversationThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const streamSessionKey = useMemo(
    () => `note-assistant:${noteId || 'draft'}:${activeThreadId || 'default'}`,
    [activeThreadId, noteId],
  )

  const pushToolTrace = useCallback((text: string, options?: { open?: boolean }) => {
    const trace: ToolTrace = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
    }
    setToolTraces((prev) => [...prev.slice(-7), trace])
    if (options?.open) setShowToolTrace(true)
  }, [])

  const threadStorageKey = useMemo(
    () => (noteId ? `pathmind.notes.ai.threads:${noteId}` : null),
    [noteId],
  )
  const legacyStorageKey = useMemo(
    () => (noteId ? `pathmind.notes.ai.history:${noteId}` : null),
    [noteId],
  )

  const { messages, isStreaming, sendMessage, stop, setMessages } = useAgentStream({
    onToolCall: (event) => {
      const tool = String(event.tool || '').trim()
      if (!tool) return
      const status = String(event.status || 'calling').trim()
      const reason = typeof event.reason === 'string' ? event.reason : undefined
      pushToolTrace(toolTraceText(tool, status, reason), { open: true })
    },
  })

  const inputRef = useRef<HTMLInputElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const shouldStickBottomRef = useRef(true)
  const scrollFrameRef = useRef<number | null>(null)
  const autoAppliedPlanRef = useRef<string>('')
  const autoApplyArmedRef = useRef(false)
  const scopeKeyRef = useRef<string>('')
  const lastMessage = messages[messages.length - 1]
  const lastMessageContent = lastMessage?.content || ''

  useEffect(() => {
    if (!threadStorageKey) {
      setThreads([])
      setActiveThreadId(null)
      setMessages([])
      return
    }
    try {
      const raw = localStorage.getItem(threadStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const restored: NoteConversationThread[] = parsed
            .map((item: unknown) => (item && typeof item === 'object' ? item as Record<string, unknown> : null))
            .filter((item): item is Record<string, unknown> => item !== null)
            .map((item, index) => {
              const messagesRaw = Array.isArray(item.messages) ? item.messages : []
              const threadMessages: AgentMessage[] = messagesRaw
                .map((entry: unknown) => (entry && typeof entry === 'object' ? entry as Record<string, unknown> : null))
                .filter((entry): entry is Record<string, unknown> => entry !== null)
                .map((entry): AgentMessage => {
                  const role: AgentMessage['role'] = entry.role === 'assistant' ? 'assistant' : 'user'
                  return {
                    id: String(entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
                    role,
                    content: String(entry.content || ''),
                    agentName: typeof entry.agentName === 'string' ? entry.agentName : undefined,
                  }
                })
              return {
                id: String(item.id || `thread_${index}`),
                title: String(item.title || `记录 ${index + 1}`),
                preview: String(item.preview || buildThreadPreview(threadMessages)),
                updatedAt: Number(item.updatedAt || Date.now()),
                messages: threadMessages,
              }
            })
            .slice(0, 20)
          if (restored.length > 0) {
            setThreads(restored)
            setActiveThreadId(restored[0].id)
            setMessages(restored[0].messages)
            return
          }
        }
      }

      const legacyRaw = legacyStorageKey ? localStorage.getItem(legacyStorageKey) : null
      let initialMessages: AgentMessage[] = []
      if (legacyRaw) {
        const parsedLegacy = JSON.parse(legacyRaw)
        if (Array.isArray(parsedLegacy)) {
          initialMessages = parsedLegacy
            .map((entry: unknown) => (entry && typeof entry === 'object' ? entry as Record<string, unknown> : null))
            .filter((entry): entry is Record<string, unknown> => entry !== null)
            .map((entry): AgentMessage => {
              const role: AgentMessage['role'] = entry.role === 'assistant' ? 'assistant' : 'user'
              return {
                id: String(entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
                role,
                content: String(entry.content || ''),
                agentName: typeof entry.agentName === 'string' ? entry.agentName : undefined,
              }
            })
            .slice(-80)
        }
      }
      const fallbackThread: NoteConversationThread = {
        id: createThreadId(),
        title: buildThreadTitle(initialMessages, '记录 1'),
        preview: buildThreadPreview(initialMessages),
        updatedAt: Date.now(),
        messages: initialMessages,
      }
      setThreads([fallbackThread])
      setActiveThreadId(fallbackThread.id)
      setMessages(initialMessages)
    } catch {
      const fallbackThread: NoteConversationThread = {
        id: createThreadId(),
        title: '记录 1',
        preview: '等待开始对话',
        updatedAt: Date.now(),
        messages: [],
      }
      setThreads([fallbackThread])
      setActiveThreadId(fallbackThread.id)
      setMessages([])
    }
  }, [legacyStorageKey, setMessages, threadStorageKey])

  useEffect(() => {
    if (!activeThreadId) return
    setThreads((prev) => {
      const idx = prev.findIndex((item) => item.id === activeThreadId)
      if (idx < 0) return prev
      const next = [...prev]
      const existing = next[idx]
      const nextMessages = messages.slice(-80)
      next[idx] = {
        ...existing,
        updatedAt: Date.now(),
        title: buildThreadTitle(nextMessages, existing.title || `记录 ${idx + 1}`),
        preview: buildThreadPreview(nextMessages),
        messages: nextMessages,
      }
      return next
    })
  }, [activeThreadId, messages])

  useEffect(() => {
    if (!threadStorageKey) return
    try {
      localStorage.setItem(threadStorageKey, JSON.stringify(threads.slice(0, 20)))
    } catch {
      // ignore
    }
  }, [threadStorageKey, threads])

  useEffect(() => {
    const nextScope = `${noteId || 'none'}::${activeThreadId || 'default'}`
    if (!scopeKeyRef.current) {
      scopeKeyRef.current = nextScope
      return
    }
    if (scopeKeyRef.current === nextScope) return
    scopeKeyRef.current = nextScope
    if (isStreaming) stop()
    emitAutoApplyDebug('scope_reset', {
      noteId,
      activeThreadId,
      nextScope,
    })
    setPendingRiskyPlan(null)
    setPendingInlinePatch(null)
    onClearInlineReplacePreview?.()
    setToolTraces([])
    setShowToolTrace(false)
    setHistoryOpen(false)
    autoApplyArmedRef.current = false
    setMessages([])
  }, [activeThreadId, isStreaming, noteId, onClearInlineReplacePreview, setMessages, stop])

  const handleMessageScroll = useCallback(() => {
    const list = messageListRef.current
    if (!list) return
    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    shouldStickBottomRef.current = distanceToBottom <= 88
  }, [])

  useEffect(() => {
    const list = messageListRef.current
    if (!list) return
    if (isStreaming && !shouldStickBottomRef.current) return

    if (scrollFrameRef.current != null) {
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      list.scrollTo({
        top: list.scrollHeight,
        behavior: isStreaming ? 'auto' : 'smooth',
      })
      scrollFrameRef.current = null
    })

    return () => {
      if (scrollFrameRef.current != null) {
        cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
    }
  }, [isStreaming, messages.length, lastMessageContent])

  useEffect(() => {
    if (isStreaming || !onNoteCreated || messages.length === 0) return
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && last.content) onNoteCreated()
  }, [isStreaming, messages, onNoteCreated])

  useEffect(() => {
    if (isStreaming || messages.length === 0) return
    const lastAssistant = [...messages].reverse().find((msg) => msg.role === 'assistant' && msg.content.trim().length > 0)
    if (!lastAssistant) return
    appendAgentMemory({
      scope: 'notes',
      agent: 'note-assistant',
      noteId: noteId || undefined,
      noteTitle: noteTitle || undefined,
      summary: lastAssistant.content.replace(/\s+/g, ' ').slice(0, 220),
      tools: toolTraces.slice(-4).map((item) => item.text),
    })
  }, [isStreaming, messages, noteId, noteTitle, toolTraces])

  useEffect(() => {
    if (!panelNotice) return
    const timer = window.setTimeout(() => setPanelNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [panelNotice])

  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((item) => item.role === 'assistant' && (item.content || '').trim().length > 0),
    [messages]
  )
  const latestUserMessage = useMemo(
    () => [...messages].reverse().find((item) => item.role === 'user' && (item.content || '').trim().length > 0),
    [messages]
  )
  const latestUserPrompt = latestUserMessage?.content || ''
  const latestInlinePatch = useMemo(
    () => (isStreaming ? null : parseInlineReplacePatch(latestAssistantMessage?.content || '')),
    [latestAssistantMessage?.content, isStreaming],
  )
  const latestPlan = useMemo(
    () => (isStreaming ? null : parseEditPlan(latestAssistantMessage?.content || '')),
    [latestAssistantMessage?.content, isStreaming]
  )

  const runPlan = useCallback(async (
    plan: ParsedEditPlan,
    source: string,
  ): Promise<NoteAIApplyResult> => {
    if (!onApplyEdit) return { ok: false, message: '当前不支持自动写入。' }
    const normalizedContent = normalizePlanContent(plan.content, latestUserPrompt)
    if (!normalizedContent) {
      return { ok: false, message: '可应用内容为空（已过滤分析/控制文本），未执行写入。' }
    }
    const effectivePlan: ParsedEditPlan = {
      ...plan,
      content: normalizedContent,
    }

    onWriteTransaction?.({
      stage: 'apply',
      message: `准备写入：${actionLabel(effectivePlan.action)}`,
      query: extractWriteQuery(effectivePlan.content),
    })

    if (effectivePlan.anchor && onLocate) {
      onLocate(effectivePlan.anchor)
      onWriteTransaction?.({
        stage: 'locate',
        message: `定位锚点：${effectivePlan.anchor}`,
        query: effectivePlan.anchor,
      })
    }

    if (onEnsureNoteTarget) {
      const ready = await onEnsureNoteTarget()
      if (!ready) {
        return { ok: false, message: '当前无法创建或选中笔记，未执行写入。' }
      }
    }

    const primary = await Promise.resolve(onApplyEdit({
      action: effectivePlan.action,
      anchor: effectivePlan.anchor,
      content: effectivePlan.content,
      targetNoteId: noteId || undefined,
      source,
    }))

    onWriteTransaction?.({
      stage: primary.ok ? 'done' : 'error',
      message: primary.ok ? `写入成功：${actionLabel(effectivePlan.action)}` : `写入失败：${primary.message}`,
      query: extractWriteQuery(effectivePlan.content),
    })

    if (primary.ok || effectivePlan.action === 'append') return primary

    if ((effectivePlan.action === 'insert_after_anchor' || effectivePlan.action === 'replace_anchor') && onApplyEdit) {
      const fallback = await Promise.resolve(onApplyEdit({
        action: 'append',
        content: effectivePlan.content,
        targetNoteId: noteId || undefined,
        source: `${source}_fallback_append`,
      }))
      if (fallback.ok) {
        onWriteTransaction?.({
          stage: 'done',
          message: '锚点失败，已降级为追加写入',
          query: extractWriteQuery(effectivePlan.content),
        })
        return { ok: true, message: `${primary.message} 已自动降级为追加写入。` }
      }
    }

    return primary
  }, [latestUserPrompt, noteId, onApplyEdit, onLocate, onEnsureNoteTarget, onWriteTransaction])

  useEffect(() => {
    if (!latestInlinePatch || !latestAssistantMessage) return
    if (!autoApplyArmedRef.current) {
      emitAutoApplyDebug('skip_unarmed_inline', {
        noteId,
        activeThreadId,
        messageId: latestAssistantMessage.id,
      })
      return
    }
    autoApplyArmedRef.current = false

    const signature = [
      latestAssistantMessage.id,
      'inline_replace',
      latestInlinePatch.original.slice(0, 96),
      latestInlinePatch.replacement.slice(0, 96),
    ].join('|')
    if (autoAppliedPlanRef.current === signature) return
    autoAppliedPlanRef.current = signature

    let cancelled = false
    void (async () => {
      if (!onPreviewInlineReplace || !onApplyInlineReplace) {
        setPanelNotice('当前编辑器暂不支持行内替换，请稍后重试。')
        return
      }
      const preview = await Promise.resolve(onPreviewInlineReplace(latestInlinePatch))
      if (cancelled) return
      if (!preview.ok) {
        setPanelNotice(preview.message || '未能定位可替换原文，请补充更精确指令。')
        pushToolTrace(`行内替换：定位失败（${preview.message}）`, { open: true })
        return
      }
      setPendingInlinePatch(latestInlinePatch)
      setPendingRiskyPlan(null)
      pushToolTrace('行内替换：已定位，等待确认', { open: true })
      setPanelNotice('已定位行内替换差异，请确认是否应用。')
    })()

    return () => {
      cancelled = true
    }
  }, [
    activeThreadId,
    latestAssistantMessage,
    latestInlinePatch,
    noteId,
    onApplyInlineReplace,
    onPreviewInlineReplace,
    pushToolTrace,
  ])

  useEffect(() => {
    if (!latestPlan || !latestAssistantMessage || latestInlinePatch) return
    if (!autoApplyArmedRef.current) {
      emitAutoApplyDebug('skip_unarmed', {
        noteId,
        activeThreadId,
        messageId: latestAssistantMessage.id,
        action: latestPlan.action,
      })
      return
    }
    autoApplyArmedRef.current = false

    const signature = [
      latestAssistantMessage.id,
      latestPlan.action,
      latestPlan.anchor || '',
      latestPlan.content.length.toString(),
      latestPlan.content.slice(0, 120),
    ].join('|')
    if (autoAppliedPlanRef.current === signature) return

    autoAppliedPlanRef.current = signature
    emitAutoApplyDebug('plan_detected', {
      noteId,
      activeThreadId,
      messageId: latestAssistantMessage.id,
      action: latestPlan.action,
      signature,
    })

    // Only truly auto-apply if user explicitly asked to append/续写
    const userExplicitlyAppend = latestPlan.action === 'append' && hasExplicitEditAction(latestUserPrompt)

    if (userExplicitlyAppend) {
      // User explicitly said "追加/续写/append" → auto-apply directly
      onWriteTransaction?.({
        stage: 'start',
        message: `写入事务开始：${actionLabel(latestPlan.action)}`,
        query: extractWriteQuery(latestPlan.content),
      })
      pushToolTrace(`内联写入：开始（${actionLabel(latestPlan.action)}）`, { open: true })
      let cancelled = false
      void (async () => {
        const result = await runPlan(latestPlan, 'assistant_auto_apply')
        if (cancelled) return
        emitAutoApplyDebug('applied', {
          noteId,
          activeThreadId,
          messageId: latestAssistantMessage.id,
          action: latestPlan.action,
          ok: result.ok,
          message: result.message,
        })
        setPendingRiskyPlan(null)
        pushToolTrace(
          result.ok
            ? `内联写入：成功（${actionLabel(latestPlan.action)}）`
            : `内联写入：失败（${result.message}）`,
          { open: true },
        )
        setPanelNotice(result.ok ? `已自动应用：${actionLabel(latestPlan.action)}` : result.message)
      })()

      return () => {
        cancelled = true
      }
    }

    // All other cases: show diff preview in editor + pending confirmation
    let cancelled = false
    void (async () => {
      if (onPreviewEdit) {
        const normalizedContent = normalizePlanContent(latestPlan.content, latestUserPrompt)
        if (normalizedContent) {
          const preview = await Promise.resolve(onPreviewEdit({
            action: latestPlan.action,
            content: normalizedContent,
            anchor: latestPlan.anchor,
          }))
          if (cancelled) return
          if (preview.ok) {
            emitAutoApplyDebug('preview_shown', {
              noteId,
              activeThreadId,
              messageId: latestAssistantMessage.id,
              action: latestPlan.action,
            })
          }
        }
      }
      if (cancelled) return
      setPendingRiskyPlan(latestPlan)
      const label = latestPlan.action === 'replace_all'
        ? '检测到整篇替换建议，请确认后应用。'
        : `已生成修改预览（${actionLabel(latestPlan.action)}），请确认后应用。`
      setPanelNotice(label)
      pushToolTrace(`内联写入：待确认（${actionLabel(latestPlan.action)}）`, { open: true })
    })()

    return () => {
      cancelled = true
    }
  }, [activeThreadId, latestInlinePatch, latestPlan, latestAssistantMessage, latestUserPrompt, noteContent, noteId, onPreviewEdit, onWriteTransaction, pushToolTrace, runPlan])

  const handleSend = async (text: string) => {
    if (!text.trim()) return
    if (onEnsureNoteTarget) {
      const ready = await onEnsureNoteTarget()
      if (!ready) {
        setPanelNotice('请先创建或选择一篇笔记。')
        return
      }
    }
    if (inputRef.current) inputRef.current.value = ''
    setPendingInlinePatch(null)
    setPendingRiskyPlan(null)
    onClearInlineReplacePreview?.()

    const runtimeDecision = resolveNoteAgentRuntime(text, noteContent)
    pushToolTrace(`路由：${runtimeDecision.reason}`, { open: false })
    autoApplyArmedRef.current = true
    emitAutoApplyDebug('armed_on_send', {
      noteId,
      activeThreadId,
      promptPreview: text.slice(0, 72),
    })

    const cursorContext = getEditorCursorContext?.()

    sendMessage(text, {
      agentName: 'note-assistant',
      sessionKey: streamSessionKey,
      studentId,
      context: {
        note_id: noteId || null,
        note_title: noteTitle || null,
        thread_id: activeThreadId || null,
        cursor_context: cursorContext
          ? {
            cursor: cursorContext.cursor,
            before: cursorContext.before.slice(-2400),
            after: cursorContext.after.slice(0, 900),
          }
          : null,
        editor_profile: 'pathmind_markdown_live_preview_v1',
        render_constraints: [
          'close_fences',
          'close_wikilinks',
          'valid_markdown_block_structure',
        ],
      },
      runtime: {
        mode: runtimeDecision.runtime.mode,
        engine: runtimeDecision.runtime.engine,
        modelTier: runtimeDecision.runtime.modelTier,
      },
      buildPrompt: (userPrompt) => {
        const noteBlock = noteContent && noteTitle
          ? `当前笔记标题: ${noteTitle}\n当前笔记内容:\n${noteContent.slice(0, 6000)}`
          : '当前尚未选择笔记内容。'
        const cursorBlock = cursorContext
          ? `光标附近上下文（用于精准替换）:\n[BEFORE]\n${cursorContext.before.slice(-1600)}\n[AFTER]\n${cursorContext.after.slice(0, 600)}`
          : '当前未提供光标上下文。'
        return `${NOTE_AGENT_PROMPT_SPEC}\n\n${noteBlock}\n\n${cursorBlock}\n\n用户请求: ${userPrompt}`
      },
    })
  }

  useEffect(() => {
    const prompt = (externalPrompt || '').trim()
    if (!prompt) return
    if (isStreaming) return
    void handleSend(prompt)
    onExternalPromptConsumed?.()
  }, [externalPrompt, handleSend, isStreaming, onExternalPromptConsumed])

  const handleRejectInlinePatch = useCallback(() => {
    setPendingInlinePatch(null)
    onClearInlineReplacePreview?.()
    setPanelNotice('已取消本次行内替换。')
  }, [onClearInlineReplacePreview])

  const handleApplyInlinePatch = useCallback(async () => {
    if (!pendingInlinePatch || !onApplyInlineReplace) {
      setPanelNotice('当前没有可应用的行内替换。')
      return
    }
    const result = await Promise.resolve(onApplyInlineReplace(pendingInlinePatch))
    if (!result.ok) {
      setPanelNotice(result.message)
      pushToolTrace(`行内替换：应用失败（${result.message}）`, { open: true })
      return
    }
    pushToolTrace('行内替换：应用成功', { open: true })
    setPendingInlinePatch(null)
    onClearInlineReplacePreview?.()
    setPanelNotice(result.message || '已应用行内替换。')
  }, [onApplyInlineReplace, onClearInlineReplacePreview, pendingInlinePatch, pushToolTrace])

  const handleApplySuggestion = async () => {
    const targetPlan = pendingRiskyPlan || latestPlan
    if (!targetPlan || !onApplyEdit) {
      setPanelNotice('当前回复没有可应用片段。')
      return
    }
    onClearInlineReplacePreview?.()
    onWriteTransaction?.({
      stage: 'start',
      message: `手动确认写入：${actionLabel(targetPlan.action)}`,
      query: extractWriteQuery(targetPlan.content),
    })
    pushToolTrace(`内联写入：开始（${actionLabel(targetPlan.action)}）`, { open: true })
    const result = await runPlan(targetPlan, 'assistant_manual_confirm')
    setPendingRiskyPlan(null)
    pushToolTrace(
      result.ok
        ? `内联写入：成功（${actionLabel(targetPlan.action)}）`
        : `内联写入：失败（${result.message}）`,
      { open: true },
    )
    setPanelNotice(result.message)
  }

  const handleRejectSuggestion = useCallback(() => {
    setPendingRiskyPlan(null)
    onClearInlineReplacePreview?.()
    setPanelNotice('已取消本次修改。')
  }, [onClearInlineReplacePreview])

  const handleUndo = async () => {
    if (!onUndo) return
    const result = await Promise.resolve(onUndo())
    if (result && typeof result === 'object' && 'message' in result) {
      setPanelNotice(result.message)
    }
  }

  const handleRedo = async () => {
    if (!onRedo) return
    const result = await Promise.resolve(onRedo())
    if (result && typeof result === 'object' && 'message' in result) {
      setPanelNotice(result.message)
    }
  }

  const createThread = useCallback(() => {
    if (isStreaming) stop()
    autoApplyArmedRef.current = false
    setPendingInlinePatch(null)
    onClearInlineReplacePreview?.()
    const nextIndex = threads.length + 1
    const nextThread: NoteConversationThread = {
      id: createThreadId(),
      title: `记录 ${nextIndex}`,
      preview: '等待开始对话',
      updatedAt: Date.now(),
      messages: [],
    }
    setThreads((prev) => [nextThread, ...prev].slice(0, 20))
    setActiveThreadId(nextThread.id)
    setMessages([])
    setPanelNotice('已新建一条独立对话记录。')
  }, [isStreaming, onClearInlineReplacePreview, setMessages, stop, threads.length])

  const handleSelectThread = useCallback((id: string) => {
    if (isStreaming) stop()
    autoApplyArmedRef.current = false
    setPendingInlinePatch(null)
    onClearInlineReplacePreview?.()
    setActiveThreadId(id)
    const thread = threads.find((item) => item.id === id)
    setMessages(thread?.messages || [])
  }, [isStreaming, onClearInlineReplacePreview, setMessages, stop, threads])

  return (
    <div className="relative h-full min-h-0 px-2 pb-2">
      <div className="h-full min-h-0 rounded-2xl border border-white/45 bg-white/55 dark:border-white/20 dark:bg-white/10 backdrop-blur-xl shadow-[0_8px_28px_rgba(15,23,42,0.08)] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-primary">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary-500" />
            <span className="text-xs font-semibold text-text-primary">AI 笔记助手</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { void handleUndo() }}
              disabled={!canUndo}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border-primary text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              title="撤销最近一次 AI 修改"
            >
              <Undo2 size={12} />
              撤销
            </button>
            <button
              type="button"
              onClick={() => { void handleRedo() }}
              disabled={!canRedo}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border-primary text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              title="重做最近一次 AI 撤销"
            >
              <Redo2 size={12} />
              重做
            </button>
            {onClose && (
              <button onClick={onClose} className="p-1 rounded hover:bg-bg-tertiary text-text-muted">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="px-3 py-2 border-b border-border-primary bg-bg-primary/55">
          <p className="text-[11px] text-text-muted leading-relaxed">
            你只需自然语言下达目标。Agent 会自主检索、分析并执行低风险写入；仅高风险整篇替换需要你确认。
          </p>
        </div>

        <div className="px-3 py-2 border-b border-border-primary bg-bg-primary/45 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-text-muted leading-5 truncate">
              当前笔记：{noteTitle || '未命名'} · 记录隔离存储
            </p>
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={createThread}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border-primary text-[10px] text-text-muted bg-bg-secondary/65 hover:text-text-primary transition-colors"
                title="新建一条独立记录"
              >
                <Plus size={11} />
                新记录
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border-primary text-[10px] text-text-muted bg-bg-secondary/65 hover:text-text-primary transition-colors"
                title="查看会话历史"
              >
                记录 {threads.length}
                {historyOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
              <button
                type="button"
                onClick={() => setShowToolTrace((prev) => !prev)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border-primary text-[10px] text-text-muted bg-bg-secondary/65 hover:text-text-primary transition-colors"
                title="查看工具执行记录"
              >
                <Wrench size={11} />
                工具
                {toolTraces.length > 0 ? ` ${toolTraces.length}` : ''}
                {showToolTrace ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            </div>
          </div>
          {historyOpen && (
            <div className="mt-1.5 max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {threads.length === 0 ? (
                <p className="text-[10px] text-text-muted">暂无历史记录。</p>
              ) : (
                <>
                  {threads.map((thread) => (
                    <ThreadItem
                      key={thread.id}
                      thread={thread}
                      active={thread.id === activeThreadId}
                      onSelect={handleSelectThread}
                    />
                  ))}
                </>
              )}
            </div>
          )}
          {showToolTrace && (
            <div className="mt-1.5 max-h-20 overflow-y-auto space-y-1 pr-1">
              {toolTraces.length === 0 ? (
                <p className="text-[10px] text-text-muted">暂无工具调用。</p>
              ) : toolTraces.slice(-8).map((item) => (
                <p
                  key={item.id}
                  className="px-1.5 py-1 rounded-md text-[10px] border border-border-primary text-text-muted bg-bg-secondary/60"
                >
                  {item.text}
                </p>
              ))}
            </div>
          )}
        </div>

        {panelNotice && (
          <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-lg border border-primary-200/80 bg-primary-50/80 text-[11px] text-primary-700 dark:bg-primary-900/20 dark:border-primary-500/40 dark:text-primary-300">
            {panelNotice}
          </div>
        )}

        <div
          ref={messageListRef}
          onScroll={handleMessageScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2.5"
        >
          {messages.length === 0 && (
            <div className="rounded-xl border border-border-primary bg-bg-secondary/45 px-3 py-2 text-xs text-text-muted">
              例如：请把这篇笔记改写成「概念-例子-反思」结构，并插入到“核心原则”段落后。
            </div>
          )}
          {messages.map((msg, index) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              streaming={msg.role === 'assistant' && index === messages.length - 1 && isStreaming}
              noteTitle={noteTitle}
            />
          ))}
        </div>

        <div className="p-3 border-t border-border-primary">
          {pendingInlinePatch && (
            <div className="mb-2 rounded-xl border border-primary-300/55 bg-bg-primary/92 px-3 py-2.5 shadow-md">
              <p className="text-xs font-semibold text-text-primary">确认行内替换</p>
              <p className="mt-1 text-[11px] text-text-muted leading-relaxed">
                Agent 提供了精准替换片段，已在编辑器中高亮预览差异。确认后会仅替换命中的原文，不追加到末尾。
              </p>
              <div className="mt-2 space-y-1.5">
                <div className="rounded-md border border-border-primary bg-bg-secondary/55 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">Original</p>
                  <p className="mt-0.5 text-[11px] text-text-secondary whitespace-pre-wrap break-words">
                    {pendingInlinePatch.original.slice(0, 260)}
                  </p>
                </div>
                <div className="rounded-md border border-primary-300/50 bg-primary-500/10 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-primary-700 dark:text-primary-300">Replacement</p>
                  <p className="mt-0.5 text-[11px] text-text-primary whitespace-pre-wrap break-words">
                    {pendingInlinePatch.replacement.slice(0, 260)}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleRejectInlinePatch}
                  className="px-3 py-1.5 rounded-lg text-xs border border-border-primary text-text-secondary hover:text-text-primary"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => { void handleApplyInlinePatch() }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-primary-300/70 text-primary-700 dark:text-primary-300 bg-primary-500/10 hover:bg-primary-500/15 transition-colors"
                >
                  <Check size={12} />
                  Accept
                </button>
              </div>
            </div>
          )}
          {pendingRiskyPlan && (
            <div className="mb-2 rounded-xl border border-primary-300/55 bg-bg-primary/92 px-3 py-2.5 shadow-md">
              <p className="text-xs font-semibold text-text-primary">
                {pendingRiskyPlan.action === 'replace_all' ? '确认整篇替换' : '确认修改'}
              </p>
              <p className="mt-1 text-[11px] text-text-muted leading-relaxed">
                Agent 建议执行：{actionLabel(pendingRiskyPlan.action)}
                {pendingRiskyPlan.anchor ? `（锚点：${pendingRiskyPlan.anchor}）` : ''}。
                {pendingRiskyPlan.action === 'replace_all'
                  ? '该操作可能覆盖较多内容，请在编辑器中查看差异后确认。'
                  : '请在编辑器中查看红绿差异后确认是否应用。'}
              </p>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleRejectSuggestion}
                  className="px-3 py-1.5 rounded-lg text-xs border border-border-primary text-text-secondary hover:text-text-primary"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => { void handleApplySuggestion() }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-primary-300/70 text-primary-700 dark:text-primary-300 bg-primary-500/10 hover:bg-primary-500/15 transition-colors"
                >
                  <Check size={12} />
                  Accept
                </button>
              </div>
            </div>
          )}
          {isStreaming && (
            <button
              onClick={stop}
              className="w-full mb-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10 rounded transition-colors"
            >
              停止生成
            </button>
          )}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend(inputRef.current?.value || '')
                }
              }}
              placeholder="例如：把这段改成学术风格，重点补充可插入段落"
              disabled={isStreaming}
              className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-bg-tertiary border border-border-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-500/50 disabled:opacity-50"
            />
            <button
              onClick={() => { void handleSend(inputRef.current?.value || '') }}
              disabled={isStreaming}
              className="p-1.5 rounded-lg bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 disabled:opacity-30 transition-colors"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
