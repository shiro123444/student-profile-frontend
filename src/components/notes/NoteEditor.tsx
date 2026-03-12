import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Range,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  MatchDecorator,
  WidgetType,
  ViewUpdate,
  ViewPlugin,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { SearchCursor } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { Undo2, Redo2 } from 'lucide-react'
import { useTheme } from '../../theme/ThemeContext'

interface NoteEditorProps {
  content: string
  onChange: (value: string) => void
  onSave?: () => void
  flashSignal?: number
  inlineSuggestionPending?: boolean
  autoInlineCompletionEnabled?: boolean
  onInlineSuggestionAccepted?: () => void
  onInlineSuggestionInvoke?: () => void
  onCompositionStateChange?: (composing: boolean) => void
  onOpenWikilink?: (target: string) => void | Promise<void>
  onHoverWikilink?: (event: NoteEditorWikilinkHoverEvent | null) => void
}

export interface NoteEditorChange {
  from: number
  to: number
  insert: string
}

export interface NoteEditorApplyOptions {
  stream?: boolean
}

export interface NoteEditorHandle {
  getContent: () => string
  getCursorContext: (windowSize?: number) => { cursor: number; before: string; after: string } | null
  focus: () => void
  applyAIChange: (change: NoteEditorChange, options?: NoteEditorApplyOptions) => Promise<string>
  revealRange: (from: number, to: number) => { from: number; to: number; line: number } | null
  runEditorAction: (action: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select_all') => Promise<boolean>
  setInlineSuggestion: (text: string) => void
  clearInlineSuggestion: () => void
  previewRevision: (nextContent: string) => { changed: boolean; from: number; to: number } | null
  previewInlineReplace: (
    original: string,
    replacement: string,
  ) => { changed: boolean; from: number; to: number; replacement: string; original: string } | null
  clearRevisionPreview: () => void
}

export interface NoteEditorWikilinkHoverEvent {
  target: string
  clientX: number
  clientY: number
  rect: {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }
}

const wikilinkDecorator = new MatchDecorator({
  regexp: /\[\[[^\]]+\]\]/g,
  decoration: Decoration.mark({ class: 'pm-note-token-wikilink cm-wikilink' }),
})

const CALLOUT_TYPE_MAP: Record<string, string> = {
  note: 'note',
  info: 'info',
  tip: 'tip',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  error: 'danger',
  question: 'warning',
}

function normalizeCalloutType(raw: string): string {
  const normalized = raw.toLowerCase().trim()
  return CALLOUT_TYPE_MAP[normalized] || 'note'
}

function extractWikilinkTarget(rawText: string): string {
  const trimmed = rawText.trim()
  const match = trimmed.match(/^\[\[([\s\S]+)\]\]$/)
  const inside = match ? match[1].trim() : trimmed
  if (!inside) return ''
  return inside.split('|')[0].split('#')[0].trim()
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findRangeBySearchCursor(
  state: EditorState,
  query: string,
  cursorPos: number,
): { from: number; to: number } | null {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return null

  const docLength = state.doc.length
  const anchor = Math.max(0, Math.min(cursorPos, docLength))
  const nearFrom = Math.max(0, anchor - 4200)
  const nearTo = Math.min(docLength, anchor + 4200)

  const nearCursor = new SearchCursor(state.doc, normalizedQuery, nearFrom, nearTo)
  if (!nearCursor.next().done) {
    return {
      from: nearCursor.value.from,
      to: nearCursor.value.to,
    }
  }

  const globalCursor = new SearchCursor(state.doc, normalizedQuery)
  if (!globalCursor.next().done) {
    return {
      from: globalCursor.value.from,
      to: globalCursor.value.to,
    }
  }

  return null
}

function findRangeByLooseWhitespaceMatch(
  docText: string,
  query: string,
): { from: number; to: number } | null {
  const normalizedQuery = query
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
  if (!normalizedQuery) return null

  const tokenPattern = normalizedQuery
    .split(/\s+/)
    .map((token) => escapeRegExp(token))
    .join('\\s+')
  if (!tokenPattern) return null

  const matcher = new RegExp(tokenPattern, 'm')
  const match = matcher.exec(docText)
  if (!match || typeof match.index !== 'number') return null

  return {
    from: match.index,
    to: match.index + match[0].length,
  }
}

/** Check if cursor position is inside a fenced code block by counting opening/closing fences above. */
function isInsideCodeBlock(state: EditorState, pos: number): boolean {
  const doc = state.doc
  let depth = 0
  for (let i = 1; i <= doc.lines; i++) {
    const lineObj = doc.line(i)
    if (lineObj.from >= pos) break
    if (/^\s*(`{3,}|~{3,})/.test(lineObj.text)) depth++
  }
  return depth % 2 === 1
}

function continueMarkdownList(view: EditorView): boolean {
  if (view.composing) return false
  const selection = view.state.selection.main
  if (!selection.empty) return false

  const line = view.state.doc.lineAt(selection.head)
  const before = view.state.sliceDoc(line.from, selection.head)

  // Inside fenced code block: preserve indentation + smart indent
  if (isInsideCodeBlock(view.state, selection.head)) {
    const leadingWhitespace = before.match(/^(\s*)/)?.[1] || ''
    const trimmed = before.trimEnd()
    let extraIndent = ''
    if (trimmed.endsWith('{') || trimmed.endsWith('(') || trimmed.endsWith('[') || trimmed.endsWith(':')) {
      extraIndent = '  '
    }
    const insert = `\n${leadingWhitespace}${extraIndent}`
    view.dispatch({
      changes: { from: selection.head, to: selection.head, insert },
      selection: { anchor: selection.head + insert.length },
      annotations: Transaction.userEvent.of('input.enter'),
    })
    return true
  }

  const after = view.state.sliceDoc(selection.head, line.to)
  if (after.trim().length > 0) return false

  const taskMatch = before.match(/^(\s*)([-*+])\s+\[( |x|X)\]\s*(.*)$/)
  if (taskMatch) {
    const indent = taskMatch[1] || ''
    const bullet = taskMatch[2] || '-'
    const content = (taskMatch[4] || '').trim()
    const markerFrom = line.from + indent.length
    if (content.length === 0) {
      view.dispatch({
        changes: { from: markerFrom, to: selection.head, insert: '' },
        selection: { anchor: markerFrom },
        annotations: Transaction.userEvent.of('input.enter'),
      })
      return true
    }
    const insert = `\n${indent}${bullet} [ ] `
    view.dispatch({
      changes: { from: selection.head, to: selection.head, insert },
      selection: { anchor: selection.head + insert.length },
      annotations: Transaction.userEvent.of('input.enter'),
    })
    return true
  }

  const unorderedMatch = before.match(/^(\s*)([-*+])\s*(.*)$/)
  if (unorderedMatch) {
    const indent = unorderedMatch[1] || ''
    const bullet = unorderedMatch[2] || '-'
    const content = (unorderedMatch[3] || '').trim()
    const markerFrom = line.from + indent.length
    if (content.length === 0) {
      view.dispatch({
        changes: { from: markerFrom, to: selection.head, insert: '' },
        selection: { anchor: markerFrom },
        annotations: Transaction.userEvent.of('input.enter'),
      })
      return true
    }
    if (!before.trim().startsWith(bullet)) return false
    const insert = `\n${indent}${bullet} `
    view.dispatch({
      changes: { from: selection.head, to: selection.head, insert },
      selection: { anchor: selection.head + insert.length },
      annotations: Transaction.userEvent.of('input.enter'),
    })
    return true
  }

  const orderedMatch = before.match(/^(\s*)(\d+)\.\s*(.*)$/)
  if (orderedMatch) {
    const indent = orderedMatch[1] || ''
    const number = Number.parseInt(orderedMatch[2] || '1', 10)
    const content = (orderedMatch[3] || '').trim()
    const markerFrom = line.from + indent.length
    if (content.length === 0) {
      view.dispatch({
        changes: { from: markerFrom, to: selection.head, insert: '' },
        selection: { anchor: markerFrom },
        annotations: Transaction.userEvent.of('input.enter'),
      })
      return true
    }
    const nextNumber = Number.isFinite(number) ? number + 1 : 1
    const insert = `\n${indent}${nextNumber}. `
    view.dispatch({
      changes: { from: selection.head, to: selection.head, insert },
      selection: { anchor: selection.head + insert.length },
      annotations: Transaction.userEvent.of('input.enter'),
    })
    return true
  }

  return false
}

class CalloutIconWidget extends WidgetType {
  private readonly type: string

  constructor(type: string) {
    super()
    this.type = type
  }

  eq(other: CalloutIconWidget) {
    return other.type === this.type
  }

  toDOM() {
    const container = document.createElement('span')
    container.className = `pm-note-callout-icon pm-note-callout-icon-${this.type}`
    container.setAttribute('aria-hidden', 'true')
    container.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.8v3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.9" fill="currentColor"/></svg>'
    return container
  }

  ignoreEvent() {
    return true
  }
}

class ListBulletWidget extends WidgetType {
  toDOM() {
    const container = document.createElement('span')
    container.className = 'pm-md-list-bullet'
    container.setAttribute('aria-hidden', 'true')
    return container
  }

  ignoreEvent() {
    return true
  }
}

class ListOrderWidget extends WidgetType {
  private readonly label: string

  constructor(label: string) {
    super()
    this.label = label
  }

  eq(other: ListOrderWidget) {
    return this.label === other.label
  }

  toDOM() {
    const container = document.createElement('span')
    container.className = 'pm-md-list-order'
    container.setAttribute('aria-hidden', 'true')
    container.textContent = this.label
    return container
  }

  ignoreEvent() {
    return true
  }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const container = document.createElement('span')
    container.className = 'pm-md-hr-widget'
    container.setAttribute('aria-hidden', 'true')
    return container
  }

  ignoreEvent() {
    return true
  }
}

function parseFenceLanguage(rawInfo: string): string {
  const firstToken = (rawInfo || '').trim().split(/\s+/)[0] || ''
  return firstToken.replace(/[^a-zA-Z0-9_+#.\-]/g, '').toLowerCase()
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return true
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fallback below
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    const result = document.execCommand('copy')
    document.body.removeChild(textarea)
    return result
  } catch {
    return false
  }
}

async function readTextFromClipboard(): Promise<string | null> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      const content = await navigator.clipboard.readText()
      if (typeof content === 'string') return content
    } catch {
      // fallback below
    }
  }
  return null
}

class CodeBlockToolbarWidget extends WidgetType {
  private readonly code: string
  private readonly language: string

  constructor(code: string, language: string) {
    super()
    this.code = code
    this.language = language
  }

  eq(other: CodeBlockToolbarWidget) {
    return this.code === other.code && this.language === other.language
  }

  toDOM() {
    const container = document.createElement('span')
    container.className = 'pm-codeblock-tools'

    const langChip = document.createElement('span')
    langChip.className = 'pm-codeblock-lang-chip'
    langChip.textContent = this.language || 'text'
    container.appendChild(langChip)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pm-codeblock-copy-btn'
    button.textContent = '复制'
    button.title = '复制代码块'
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const success = await copyTextToClipboard(this.code)
      const original = button.textContent || '复制'
      button.textContent = success ? '已复制' : '失败'
      window.setTimeout(() => {
        button.textContent = original
      }, 1200)
    })
    container.appendChild(button)

    return container
  }

  ignoreEvent() {
    return false
  }
}

const wikilinkPlugin = ViewPlugin.fromClass(
  class {
    decorations

    constructor(view: EditorView) {
      this.decorations = wikilinkDecorator.createDeco(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = wikilinkDecorator.updateDeco(update, this.decorations)
      }
    }
  },
  { decorations: (value) => value.decorations },
)

const calloutPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view)
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()
      const visitedLineFrom = new Set<number>()

      for (const range of view.visibleRanges) {
        let line = view.state.doc.lineAt(range.from)
        const endLine = view.state.doc.lineAt(range.to)

        while (line.from <= endLine.from) {
          if (visitedLineFrom.has(line.from)) {
            if (line.number >= view.state.doc.lines) break
            line = view.state.doc.line(line.number + 1)
            continue
          }

          visitedLineFrom.add(line.from)
          const headerMatch = line.text.match(/^>\s*\[!([A-Za-z0-9_-]+)\]/)
          if (!headerMatch) {
            if (line.number >= view.state.doc.lines) break
            line = view.state.doc.line(line.number + 1)
            continue
          }

          const calloutType = normalizeCalloutType(headerMatch[1])
          let blockLine = line

          while (true) {
            visitedLineFrom.add(blockLine.from)
            if (!blockLine.text.startsWith('>')) break
            builder.add(
              blockLine.from,
              blockLine.from,
              Decoration.line({ attributes: { class: `pm-note-callout pm-note-callout-${calloutType}` } }),
            )

            if (blockLine.from === line.from) {
              builder.add(
                blockLine.from,
                blockLine.from,
                Decoration.widget({
                  widget: new CalloutIconWidget(calloutType),
                  side: -1,
                }),
              )
            }

            if (blockLine.number >= view.state.doc.lines) break
            const nextLine = view.state.doc.line(blockLine.number + 1)
            if (!nextLine.text.startsWith('>')) break
            blockLine = nextLine
          }

          line = blockLine.number >= view.state.doc.lines
            ? blockLine
            : view.state.doc.line(blockLine.number + 1)
        }
      }

      return builder.finish()
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

const codeBlockToolbarPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view)
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      if (view.visibleRanges.length === 0) {
        return Decoration.none
      }

      const builder = new RangeSetBuilder<Decoration>()
      let fromLine = view.state.doc.lines
      let toLine = 1
      for (const range of view.visibleRanges) {
        const rangeFrom = Math.max(1, view.state.doc.lineAt(range.from).number - 5)
        const rangeTo = Math.min(view.state.doc.lines, view.state.doc.lineAt(range.to).number + 5)
        fromLine = Math.min(fromLine, rangeFrom)
        toLine = Math.max(toLine, rangeTo)
      }

      let inFencedCode = false
      let fenceChar = ''
      let fenceLength = 0
      let fenceLanguage = ''
      let fenceContentFrom = 0
      let fenceStartLineTo = 0

      if (fromLine > 1) {
        for (let lineNumber = 1; lineNumber < fromLine; lineNumber += 1) {
          const line = view.state.doc.line(lineNumber)
          const fenceMatch = line.text.match(/^(\s{0,3})([`｀]{3,}|~{3,})(.*)$/)
          if (!fenceMatch) continue
          const marker = fenceMatch[2] || ''
          const markerChar = marker[0] || ''
          if (!inFencedCode) {
            inFencedCode = true
            fenceChar = markerChar
            fenceLength = marker.length
            fenceLanguage = parseFenceLanguage(fenceMatch[3] || '')
            fenceStartLineTo = line.to
            fenceContentFrom = Math.min(view.state.doc.length, line.to + 1)
          } else if (markerChar === fenceChar && marker.length >= fenceLength) {
            inFencedCode = false
            fenceChar = ''
            fenceLength = 0
            fenceLanguage = ''
            fenceContentFrom = 0
            fenceStartLineTo = 0
          }
        }
      }

      for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
        const line = view.state.doc.line(lineNumber)
        const fenceMatch = line.text.match(/^(\s{0,3})([`｀]{3,}|~{3,})(.*)$/)
        if (!fenceMatch) continue

        const marker = fenceMatch[2] || ''
        const markerChar = marker[0] || ''
        if (!inFencedCode) {
          inFencedCode = true
          fenceChar = markerChar
          fenceLength = marker.length
          fenceLanguage = parseFenceLanguage(fenceMatch[3] || '')
          fenceStartLineTo = line.to
          fenceContentFrom = Math.min(view.state.doc.length, line.to + 1)
          continue
        }

        if (markerChar !== fenceChar || marker.length < fenceLength) {
          continue
        }

        const contentFrom = Math.max(0, Math.min(fenceContentFrom, view.state.doc.length))
        const contentTo = Math.max(contentFrom, Math.min(line.from, view.state.doc.length))
        const code = view.state.sliceDoc(contentFrom, contentTo).replace(/\n$/, '')
        if (code) {
          builder.add(
            fenceStartLineTo,
            fenceStartLineTo,
            Decoration.widget({
              widget: new CodeBlockToolbarWidget(code, fenceLanguage),
              side: 1,
            }),
          )
        }

        inFencedCode = false
        fenceChar = ''
        fenceLength = 0
        fenceLanguage = ''
        fenceContentFrom = 0
        fenceStartLineTo = 0
      }

      return builder.finish()
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

const hiddenMarkdownMarker = Decoration.replace({})
const liveBoldMark = Decoration.mark({ class: 'pm-md-bold' })
const liveItalicMark = Decoration.mark({ class: 'pm-md-italic' })
const liveMarkHighlight = Decoration.mark({ class: 'pm-md-mark-highlight' })
const liveInlineCodeMark = Decoration.mark({ class: 'pm-md-inline-code' })
const liveWikilinkContentMark = Decoration.mark({ class: 'pm-md-wikilink-content' })
const liveCodeBlockLine = Decoration.line({ attributes: { class: 'pm-md-codeblock-line pm-md-codeblock-body' } })
const liveCodeFenceStartLine = Decoration.line({ attributes: { class: 'pm-md-codeblock-line pm-md-codeblock-fence pm-md-codeblock-start' } })
const liveCodeFenceEndLine = Decoration.line({ attributes: { class: 'pm-md-codeblock-line pm-md-codeblock-fence pm-md-codeblock-end' } })
const liveCodeKeywordMark = Decoration.mark({ class: 'pm-md-code-keyword' })
const liveCodeStringMark = Decoration.mark({ class: 'pm-md-code-string' })
const liveCodeCommentMark = Decoration.mark({ class: 'pm-md-code-comment' })
const liveCodeFunctionMark = Decoration.mark({ class: 'pm-md-code-function' })
const liveCodeNumberMark = Decoration.mark({ class: 'pm-md-code-number' })
const liveTableLine = Decoration.line({ attributes: { class: 'pm-md-table-line' } })
const liveTableSeparatorLine = Decoration.line({ attributes: { class: 'pm-md-table-line pm-md-table-separator' } })
const liveListLine = Decoration.line({ attributes: { class: 'pm-md-list-line' } })
const liveHorizontalRuleLine = Decoration.line({ attributes: { class: 'pm-md-hr-line' } })

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = this.buildDecorations(update.view)
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()
      const pendingDecorations: Array<{ from: number; to: number; decoration: Decoration }> = []
      const pushDecoration = (from: number, to: number, decoration: Decoration) => {
        if (!Number.isFinite(from) || !Number.isFinite(to)) return
        if (to < from) return
        pendingDecorations.push({ from, to, decoration })
      }
      const cursorPos = view.state.selection.main.head
      const isEditorFocused = view.hasFocus
      const activeLineNumber = view.state.doc.lineAt(cursorPos).number
      if (view.visibleRanges.length === 0) {
        return Decoration.none
      }
      let fromLine = view.state.doc.lines
      let toLine = 1
      for (const range of view.visibleRanges) {
        const rangeFrom = Math.max(1, view.state.doc.lineAt(range.from).number - 5)
        const rangeTo = Math.min(view.state.doc.lines, view.state.doc.lineAt(range.to).number + 5)
        fromLine = Math.min(fromLine, rangeFrom)
        toLine = Math.max(toLine, rangeTo)
      }
      let inFencedCode = false
      let fenceChar = ''
      let fenceLanguage = ''
      if (fromLine > 1) {
        for (let lineNumber = 1; lineNumber < fromLine; lineNumber += 1) {
          const line = view.state.doc.line(lineNumber)
          const fenceMatch = line.text.match(/^(\s{0,3})([`｀]{3,}|~{3,})(.*)$/)
          if (!fenceMatch) continue
          const marker = fenceMatch[2] || ''
          const markerChar = marker[0] || ''
          if (!inFencedCode) {
            inFencedCode = true
            fenceChar = markerChar
            fenceLanguage = parseFenceLanguage(fenceMatch[3] || '')
          } else if (markerChar === fenceChar) {
            inFencedCode = false
            fenceChar = ''
            fenceLanguage = ''
          }
        }
      }

      for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
        const line = view.state.doc.line(lineNumber)
        const lineText = line.text
        const lineIsActive = isEditorFocused && lineNumber === activeLineNumber

        const fenceMatch = lineText.match(/^(\s{0,3})([`｀]{3,}|~{3,})(.*)$/)
        if (fenceMatch) {
          const leadingSpaces = fenceMatch[1] || ''
          const marker = fenceMatch[2] || ''
          const markerChar = marker[0] || ''
          const openingFence = !inFencedCode
          pushDecoration(line.from, line.from, openingFence ? liveCodeFenceStartLine : liveCodeFenceEndLine)
          const markerFrom = line.from + leadingSpaces.length
          const markerTo = markerFrom + marker.length
          const infoFrom = markerTo
          const infoTo = line.to
          const cursorInsideMarker = cursorPos >= markerFrom && cursorPos <= markerTo
          const cursorInsideInfo = cursorPos >= infoFrom && cursorPos <= infoTo
          if (!lineIsActive && !cursorInsideMarker) {
            pushDecoration(markerFrom, markerTo, hiddenMarkdownMarker)
          }
          if (!lineIsActive && !cursorInsideInfo && infoTo > infoFrom) {
            pushDecoration(infoFrom, infoTo, hiddenMarkdownMarker)
          }
          if (!inFencedCode) {
            inFencedCode = true
            fenceChar = markerChar
            fenceLanguage = parseFenceLanguage(fenceMatch[3] || '')
          } else if (markerChar === fenceChar) {
            inFencedCode = false
            fenceChar = ''
            fenceLanguage = ''
          }
          continue
        }

        if (inFencedCode) {
          pushDecoration(line.from, line.from, liveCodeBlockLine)
          const language = fenceLanguage || 'plain'
          const lineOffset = line.from
          const addRegexMark = (regex: RegExp, decoration: Decoration) => {
            let match: RegExpExecArray | null = regex.exec(lineText)
            while (match) {
              const full = match[0]
              const from = lineOffset + match.index
              const to = from + full.length
              if (to > from) {
                pushDecoration(from, to, decoration)
              }
              if (full.length === 0) {
                regex.lastIndex += 1
              }
              match = regex.exec(lineText)
            }
          }
          const pythonKeywords = /\b(?:def|class|import|from|as|return|if|elif|else|for|while|try|except|finally|with|lambda|yield|async|await|pass|break|continue|in|is|not|and|or|None|True|False)\b/g
          const jsKeywords = /\b(?:function|const|let|var|if|else|for|while|return|class|new|import|export|from|await|async|try|catch|finally|switch|case|break|continue|null|undefined|true|false|this)\b/g
          const goKeywords = /\b(?:func|package|import|const|var|type|struct|interface|return|if|else|for|range|switch|case|default|go|defer|chan|map|break|continue|fallthrough|nil)\b/g
          const stringPattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g
          const numberPattern = /\b\d+(?:\.\d+)?\b/g
          const functionCallPattern = /\b([A-Za-z_]\w*)\s*(?=\()/g
          if (language === 'python' || language === 'py') {
            addRegexMark(pythonKeywords, liveCodeKeywordMark)
            addRegexMark(/#.*/g, liveCodeCommentMark)
          } else if (language === 'javascript' || language === 'js' || language === 'typescript' || language === 'ts') {
            addRegexMark(jsKeywords, liveCodeKeywordMark)
            addRegexMark(/\/\/.*/g, liveCodeCommentMark)
          } else if (language === 'go' || language === 'golang') {
            addRegexMark(goKeywords, liveCodeKeywordMark)
            addRegexMark(/\/\/.*/g, liveCodeCommentMark)
          } else {
            addRegexMark(/\b(?:if|else|for|while|return|class|def|func|import|from|const|let|var)\b/g, liveCodeKeywordMark)
            addRegexMark(/(?:#|\/\/).*/g, liveCodeCommentMark)
          }
          addRegexMark(stringPattern, liveCodeStringMark)
          addRegexMark(numberPattern, liveCodeNumberMark)
          addRegexMark(functionCallPattern, liveCodeFunctionMark)
          continue
        }

        if (!lineText.trim()) continue

        const horizontalRuleMatch = lineText.match(/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/)
        if (horizontalRuleMatch) {
          const leadingSpaces = (lineText.match(/^\s*/) || [''])[0].length
          const markerFrom = line.from + leadingSpaces
          pushDecoration(line.from, line.from, liveHorizontalRuleLine)
          pushDecoration(markerFrom, line.to, hiddenMarkdownMarker)
          pushDecoration(markerFrom, markerFrom, Decoration.widget({
            widget: new HorizontalRuleWidget(),
            side: 1,
          }))
          continue
        }

        const unorderedListMatch = lineText.match(/^(\s*)([-*+])(\s*)(.*)$/)
        if (unorderedListMatch) {
          const indent = unorderedListMatch[1] || ''
          const marker = unorderedListMatch[2] || '-'
          const gap = unorderedListMatch[3] || ''
          const markerFrom = line.from + indent.length
          const markerTo = markerFrom + marker.length + gap.length
          const cursorInsideMarker = cursorPos >= markerFrom && cursorPos <= markerTo
          pushDecoration(line.from, line.from, liveListLine)
          if (!cursorInsideMarker) {
            pushDecoration(markerFrom, markerTo, hiddenMarkdownMarker)
            pushDecoration(markerFrom, markerFrom, Decoration.widget({
              widget: new ListBulletWidget(),
              side: 1,
            }))
          }
        }

        const orderedListMatch = lineText.match(/^(\s*)(\d+)\.(\s*)(.*)$/)
        if (orderedListMatch) {
          const indent = orderedListMatch[1] || ''
          const numberText = orderedListMatch[2] || '1'
          const gap = orderedListMatch[3] || ''
          const markerFrom = line.from + indent.length
          const markerTo = markerFrom + numberText.length + 1 + gap.length
          const cursorInsideMarker = cursorPos >= markerFrom && cursorPos <= markerTo
          pushDecoration(line.from, line.from, liveListLine)
          if (!cursorInsideMarker) {
            pushDecoration(markerFrom, markerTo, hiddenMarkdownMarker)
            pushDecoration(markerFrom, markerFrom, Decoration.widget({
              widget: new ListOrderWidget(`${numberText}.`),
              side: 1,
            }))
          }
        }

        const tablePipeCount = (lineText.match(/\|/g) || []).length
        if (tablePipeCount >= 2) {
          const isTableSeparator = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(lineText)
          pushDecoration(line.from, line.from, isTableSeparator ? liveTableSeparatorLine : liveTableLine)
        }

        const headerMatch = lineText.match(/^(\s{0,3})([#＃]{1,6})(\s+)/)
        if (headerMatch) {
          const leadingSpaces = headerMatch[1] || ''
          const hashes = headerMatch[2]
          const level = Math.min(6, hashes.length)
          const hashStart = line.from + leadingSpaces.length
          const hashEnd = hashStart + hashes.length
          const headingContent = lineText.slice(headerMatch[0].length).trim()
          const headingCommitted = headingContent.length > 0 && /\s$/.test(lineText)
          const shouldHideHeadingMarker = !lineIsActive || headingCommitted
          const cursorInsideHash = cursorPos >= hashStart && cursorPos < hashEnd
          if (headingContent.length > 0) {
            pushDecoration(
              line.from,
              line.from,
              Decoration.line({ attributes: { class: `pm-md-heading pm-md-heading-${level}` } }),
            )
            if (shouldHideHeadingMarker && !cursorInsideHash) {
              pushDecoration(hashStart, hashEnd, hiddenMarkdownMarker)
            }
          }
        }

        const strongPattern = /\*\*([^\n*][\s\S]*?[^\n*]?)\*\*/g
        let strongMatch: RegExpExecArray | null = strongPattern.exec(lineText)
        while (strongMatch) {
          const full = strongMatch[0]
          const matchFrom = line.from + strongMatch.index
          const matchTo = matchFrom + full.length
          const cursorInsideStrong = cursorPos > matchFrom && cursorPos < matchTo
          if (matchTo - matchFrom > 4) {
            pushDecoration(matchFrom + 2, matchTo - 2, liveBoldMark)
          }
          if (!cursorInsideStrong) {
            pushDecoration(matchFrom, matchFrom + 2, hiddenMarkdownMarker)
            pushDecoration(matchTo - 2, matchTo, hiddenMarkdownMarker)
          }
          strongMatch = strongPattern.exec(lineText)
        }

        const italicStarPattern = /(^|[^*])\*([^*\n]+)\*(?!\*)/g
        let italicStarMatch: RegExpExecArray | null = italicStarPattern.exec(lineText)
        while (italicStarMatch) {
          const prefix = italicStarMatch[1] || ''
          const contentText = italicStarMatch[2] || ''
          const contentOffset = italicStarMatch.index + prefix.length + 1
          const contentFrom = line.from + contentOffset
          const contentTo = contentFrom + contentText.length
          const markerFrom = contentFrom - 1
          const markerTo = contentTo + 1
          const cursorInsideItalic = cursorPos > markerFrom && cursorPos < markerTo
          if (contentText.trim().length > 0) {
            pushDecoration(contentFrom, contentTo, liveItalicMark)
            if (!cursorInsideItalic) {
              pushDecoration(markerFrom, markerFrom + 1, hiddenMarkdownMarker)
              pushDecoration(markerTo - 1, markerTo, hiddenMarkdownMarker)
            }
          }
          italicStarMatch = italicStarPattern.exec(lineText)
        }

        const italicUnderscorePattern = /(^|[^_])_([^_\n]+)_(?!_)/g
        let italicUnderscoreMatch: RegExpExecArray | null = italicUnderscorePattern.exec(lineText)
        while (italicUnderscoreMatch) {
          const prefix = italicUnderscoreMatch[1] || ''
          const contentText = italicUnderscoreMatch[2] || ''
          const contentOffset = italicUnderscoreMatch.index + prefix.length + 1
          const contentFrom = line.from + contentOffset
          const contentTo = contentFrom + contentText.length
          const markerFrom = contentFrom - 1
          const markerTo = contentTo + 1
          const cursorInsideItalic = cursorPos > markerFrom && cursorPos < markerTo
          if (contentText.trim().length > 0) {
            pushDecoration(contentFrom, contentTo, liveItalicMark)
            if (!cursorInsideItalic) {
              pushDecoration(markerFrom, markerFrom + 1, hiddenMarkdownMarker)
              pushDecoration(markerTo - 1, markerTo, hiddenMarkdownMarker)
            }
          }
          italicUnderscoreMatch = italicUnderscorePattern.exec(lineText)
        }

        const inlineCodePattern = /([`｀]+)([^`｀\n]+?)\1/g
        let inlineCodeMatch: RegExpExecArray | null = inlineCodePattern.exec(lineText)
        while (inlineCodeMatch) {
          const full = inlineCodeMatch[0]
          const marker = inlineCodeMatch[1] || '`'
          const markerLength = marker.length
          const matchFrom = line.from + inlineCodeMatch.index
          const matchTo = matchFrom + full.length
          const cursorInsideInlineCode = cursorPos > matchFrom && cursorPos < matchTo
          if (matchTo - matchFrom > markerLength * 2) {
            pushDecoration(matchFrom + markerLength, matchTo - markerLength, liveInlineCodeMark)
          }
          if (!cursorInsideInlineCode) {
            pushDecoration(matchFrom, matchFrom + markerLength, hiddenMarkdownMarker)
            pushDecoration(matchTo - markerLength, matchTo, hiddenMarkdownMarker)
          }
          inlineCodeMatch = inlineCodePattern.exec(lineText)
        }

        const markHighlightPattern = /==([^=\n][^=\n]*?)==/g
        let markHighlightMatch: RegExpExecArray | null = markHighlightPattern.exec(lineText)
        while (markHighlightMatch) {
          const full = markHighlightMatch[0]
          const matchFrom = line.from + markHighlightMatch.index
          const matchTo = matchFrom + full.length
          const contentFrom = matchFrom + 2
          const contentTo = matchTo - 2
          const cursorInsideMark = cursorPos > matchFrom && cursorPos < matchTo
          if (contentTo > contentFrom) {
            pushDecoration(contentFrom, contentTo, liveMarkHighlight)
            if (!cursorInsideMark) {
              pushDecoration(matchFrom, contentFrom, hiddenMarkdownMarker)
              pushDecoration(contentTo, matchTo, hiddenMarkdownMarker)
            }
          }
          markHighlightMatch = markHighlightPattern.exec(lineText)
        }

        const wikilinkPattern = /\[\[([^[\]\n]+)\]\]/g
        let wikilinkMatch: RegExpExecArray | null = wikilinkPattern.exec(lineText)
        while (wikilinkMatch) {
          const full = wikilinkMatch[0]
          const matchFrom = line.from + wikilinkMatch.index
          const matchTo = matchFrom + full.length
          const cursorInsideWikilink = cursorPos > matchFrom && cursorPos < matchTo
          if (matchTo - matchFrom > 4) {
            pushDecoration(matchFrom + 2, matchTo - 2, liveWikilinkContentMark)
          }
          if (!cursorInsideWikilink) {
            pushDecoration(matchFrom, matchFrom + 2, hiddenMarkdownMarker)
            pushDecoration(matchTo - 2, matchTo, hiddenMarkdownMarker)
          }
          wikilinkMatch = wikilinkPattern.exec(lineText)
        }
      }

      try {
        pendingDecorations
          .sort((left, right) => {
            if (left.from !== right.from) return left.from - right.from
            if (left.to !== right.to) return left.to - right.to
            return 0
          })
          .forEach((entry) => {
            builder.add(entry.from, entry.to, entry.decoration)
          })
        return builder.finish()
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('[NoteEditor] live preview decoration build failed', {
            error,
            pendingCount: pendingDecorations.length,
          })
        }
        return Decoration.none
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

const setAIHighlightEffect = StateEffect.define<{ from: number; to: number }>()
const clearAIHighlightEffect = StateEffect.define<void>()
const setInlineSuggestionEffect = StateEffect.define<{ from: number; text: string }>()
const clearInlineSuggestionEffect = StateEffect.define<void>()
const setRevisionPreviewEffect = StateEffect.define<{ from: number; to: number; insert: string }>()
const clearRevisionPreviewEffect = StateEffect.define<void>()
const setAIOutputFlashEffect = StateEffect.define<{ ranges: Array<{ from: number; to: number }> }>()
const clearAIOutputFlashEffect = StateEffect.define<void>()

const aiHighlightMark = Decoration.mark({
  class: 'cm-ai-highlight',
})

const aiHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    let nextDecorations = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(clearAIHighlightEffect)) {
        nextDecorations = Decoration.none
      }
      if (effect.is(setAIHighlightEffect)) {
        const { from, to } = effect.value
        nextDecorations = from < to
          ? Decoration.set([aiHighlightMark.range(from, to)], true)
          : Decoration.none
      }
    }
    return nextDecorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

const aiOutputFlashMark = Decoration.mark({
  class: 'cm-ai-output',
})

const aiOutputFlashField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    let nextDecorations = decorations.map(transaction.changes)
    if (transaction.docChanged) {
      nextDecorations = Decoration.none
    }
    for (const effect of transaction.effects) {
      if (effect.is(clearAIOutputFlashEffect)) {
        nextDecorations = Decoration.none
      }
      if (effect.is(setAIOutputFlashEffect)) {
        const ranges = effect.value.ranges
          .map((range) => ({
            from: Math.max(0, Math.min(range.from, transaction.state.doc.length)),
            to: Math.max(0, Math.min(range.to, transaction.state.doc.length)),
          }))
          .filter((range) => range.to > range.from)
          .map((range) => aiOutputFlashMark.range(range.from, range.to))
        nextDecorations = ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none
      }
    }
    return nextDecorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

class InlineSuggestionWidget extends WidgetType {
  private readonly text: string

  constructor(text: string) {
    super()
    this.text = text
  }

  eq(other: InlineSuggestionWidget) {
    return this.text === other.text
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'pm-note-inline-suggestion'
    span.textContent = this.text
    return span
  }
}

class RevisionAddedWidget extends WidgetType {
  private readonly text: string

  constructor(text: string) {
    super()
    this.text = text
  }

  eq(other: RevisionAddedWidget) {
    return this.text === other.text
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-diff-added'
    wrap.textContent = this.text
    return wrap
  }
}

interface InlineSuggestionState {
  from: number
  text: string
  decorations: DecorationSet
}

function createInlineSuggestionState(from: number, text: string): InlineSuggestionState {
  if (!text) {
    return {
      from: -1,
      text: '',
      decorations: Decoration.none,
    }
  }
  return {
    from,
    text,
    decorations: Decoration.set([
      Decoration.widget({
        widget: new InlineSuggestionWidget(text),
        side: 1,
      }).range(from),
    ], true),
  }
}

const inlineSuggestionField = StateField.define<InlineSuggestionState>({
  create() {
    return createInlineSuggestionState(-1, '')
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(clearInlineSuggestionEffect)) {
        return createInlineSuggestionState(-1, '')
      }
      if (effect.is(setInlineSuggestionEffect)) {
        const nextFrom = Math.max(0, Math.min(effect.value.from, transaction.state.doc.length))
        return createInlineSuggestionState(nextFrom, effect.value.text || '')
      }
    }
    // typing-as-suggested: if user types chars that match the suggestion prefix, trim it
    if (transaction.docChanged && value.text && value.from >= 0) {
      let insertedText = ''
      let insertFrom = -1
      let isDeletion = false
      transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (toA > fromA) isDeletion = true
        const txt = inserted.toString()
        if (txt.length > 0) {
          insertedText = txt
          insertFrom = fromA
        }
      })
      // deletion or non-adjacent edit → clear
      if (isDeletion || (insertFrom >= 0 && insertFrom !== value.from)) {
        return createInlineSuggestionState(-1, '')
      }
      // check if typed text matches suggestion prefix
      if (insertedText && value.text.startsWith(insertedText)) {
        const remaining = value.text.slice(insertedText.length)
        const newFrom = value.from + insertedText.length
        if (!remaining) return createInlineSuggestionState(-1, '')
        return createInlineSuggestionState(newFrom, remaining)
      }
      // typed text doesn't match → clear
      if (insertedText) {
        return createInlineSuggestionState(-1, '')
      }
    }
    if (!value.text) return value
    const mappedFrom = transaction.changes.mapPos(value.from, 1)
    if (mappedFrom !== value.from) {
      return createInlineSuggestionState(mappedFrom, value.text)
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

const diffRemovedMark = Decoration.mark({ class: 'cm-diff-removed' })

const revisionPreviewField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    let nextDecorations = decorations.map(transaction.changes)
    if (transaction.docChanged) {
      nextDecorations = Decoration.none
    }
    for (const effect of transaction.effects) {
      if (effect.is(clearRevisionPreviewEffect)) {
        nextDecorations = Decoration.none
      }
      if (effect.is(setRevisionPreviewEffect)) {
        const { from, to, insert } = effect.value
        const parts: Range<Decoration>[] = []
        if (from < to) {
          parts.push(diffRemovedMark.range(from, to))
        }
        if (insert) {
          parts.push(Decoration.widget({
            widget: new RevisionAddedWidget(insert),
            side: 1,
          }).range(from))
        }
        nextDecorations = parts.length > 0 ? Decoration.set(parts, true) : Decoration.none
      }
    }
    return nextDecorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

const aiOutputFlashPlugin = ViewPlugin.fromClass(
  class {
    private clearTimer: number | null = null
    private frameHandle: number | null = null
    private dispatching = false

    update(update: ViewUpdate) {
      if (this.dispatching) return
      const ranges: Array<{ from: number; to: number }> = []
      for (const transaction of update.transactions) {
        const event = transaction.annotation(Transaction.userEvent)
        if (event !== 'ai.output') continue
        transaction.changes.iterChanges((_, __, fromB, toB) => {
          if (toB > fromB) {
            ranges.push({ from: fromB, to: toB })
          }
        })
      }
      if (ranges.length === 0) return

      if (this.frameHandle != null) {
        cancelAnimationFrame(this.frameHandle)
      }
      if (this.clearTimer != null) {
        window.clearTimeout(this.clearTimer)
      }

      this.frameHandle = requestAnimationFrame(() => {
        this.dispatching = true
        update.view.dispatch({
          effects: setAIOutputFlashEffect.of({ ranges }),
        })
        this.dispatching = false
        this.clearTimer = window.setTimeout(() => {
          this.dispatching = true
          update.view.dispatch({
            effects: clearAIOutputFlashEffect.of(),
          })
          this.dispatching = false
          this.clearTimer = null
        }, 160)
      })
    }

    destroy() {
      if (this.frameHandle != null) {
        cancelAnimationFrame(this.frameHandle)
      }
      if (this.clearTimer != null) {
        window.clearTimeout(this.clearTimer)
      }
    }
  },
)

const lightTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--text-primary)',
      fontFamily: '"Noto Serif SC", "Serifa", Georgia, "Times New Roman", serif',
    },
    '.cm-scroller': {
      overflow: 'auto',
      lineHeight: '1.72',
      paddingBottom: '24px',
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '18px 20px',
      caretColor: 'var(--text-primary)',
    },
    '.cm-line': {
      color: 'var(--text-secondary)',
    },
    '.cm-gutters': {
      border: 'none',
      backgroundColor: 'transparent',
      color: 'color-mix(in srgb, var(--text-muted) 85%, transparent)',
      paddingRight: '6px',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--text-secondary)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: 'var(--text-primary)',
    },
    '.pm-note-token-wikilink': {
      color: '#2563eb',
      fontWeight: '600',
    },
    '.pm-note-token-callout': {
      color: '#b45309',
      fontWeight: '600',
    },
    '.cm-ai-highlight': {
      backgroundColor: 'rgba(59, 130, 246, 0.22)',
      borderRadius: '4px',
      boxShadow: '0 0 0 1px rgba(59, 130, 246, 0.28) inset',
      transition: 'background-color 160ms ease-out',
    },
  },
  { dark: false },
)

const darkAdjustTheme = EditorView.theme(
  {
    '.cm-line': {
      color: '#cbd5e1',
    },
    '.pm-note-token-wikilink': {
      color: '#93c5fd',
      fontWeight: '600',
    },
    '.pm-note-token-callout': {
      color: '#fcd34d',
      fontWeight: '600',
    },
    '.cm-ai-highlight': {
      backgroundColor: 'rgba(96, 165, 250, 0.28)',
      boxShadow: '0 0 0 1px rgba(147, 197, 253, 0.42) inset',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
  },
  { dark: true },
)

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor({
  content,
  onChange,
  flashSignal,
  inlineSuggestionPending = false,
  autoInlineCompletionEnabled = true,
  onInlineSuggestionAccepted,
  onInlineSuggestionInvoke,
  onCompositionStateChange,
  onOpenWikilink,
  onHoverWikilink,
}, ref) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [flashActive, setFlashActive] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<EditorView | null>(null)
  const applyingExternalRef = useRef(false)
  const suppressOnChangeRef = useRef(false)
  const lockExternalSyncRef = useRef(false)
  const highlightClearTimerRef = useRef<number | null>(null)
  const wikilinkHoverTimerRef = useRef<number | null>(null)
  const wikilinkHoverTargetRef = useRef<string | null>(null)
  const wikilinkHoverElementRef = useRef<HTMLElement | null>(null)
  const onChangeRef = useRef(onChange)
  const onInlineSuggestionAcceptedRef = useRef(onInlineSuggestionAccepted)
  const onInlineSuggestionInvokeRef = useRef(onInlineSuggestionInvoke)
  const onCompositionStateChangeRef = useRef(onCompositionStateChange)
  const onOpenWikilinkRef = useRef(onOpenWikilink)
  const onHoverWikilinkRef = useRef(onHoverWikilink)
  const inlineSuggestionPendingRef = useRef(inlineSuggestionPending)
  const autoInlineCompletionEnabledRef = useRef(autoInlineCompletionEnabled)
  const themeCompartmentRef = useRef(new Compartment())

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onInlineSuggestionAcceptedRef.current = onInlineSuggestionAccepted
  }, [onInlineSuggestionAccepted])
  useEffect(() => {
    onInlineSuggestionInvokeRef.current = onInlineSuggestionInvoke
  }, [onInlineSuggestionInvoke])

  useEffect(() => {
    onCompositionStateChangeRef.current = onCompositionStateChange
  }, [onCompositionStateChange])

  useEffect(() => {
    onOpenWikilinkRef.current = onOpenWikilink
  }, [onOpenWikilink])

  useEffect(() => {
    onHoverWikilinkRef.current = onHoverWikilink
  }, [onHoverWikilink])

  useEffect(() => {
    inlineSuggestionPendingRef.current = inlineSuggestionPending
  }, [inlineSuggestionPending])

  useEffect(() => {
    autoInlineCompletionEnabledRef.current = autoInlineCompletionEnabled
  }, [autoInlineCompletionEnabled])

  const clearWikilinkHover = useCallback(() => {
    if (wikilinkHoverTimerRef.current != null) {
      window.clearTimeout(wikilinkHoverTimerRef.current)
      wikilinkHoverTimerRef.current = null
    }
    if (wikilinkHoverTargetRef.current) {
      wikilinkHoverTargetRef.current = null
      onHoverWikilinkRef.current?.(null)
    }
    wikilinkHoverElementRef.current = null
  }, [])

  const baseExtensions = useMemo(
    () => [
      history(),
      lineNumbers(),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: false,
        completeHTMLTags: false,
        pasteURLAsLink: false,
      }),
      EditorView.lineWrapping,
      aiHighlightField,
      aiOutputFlashField,
      inlineSuggestionField,
      revisionPreviewField,
      wikilinkPlugin,
      calloutPlugin,
      codeBlockToolbarPlugin,
      livePreviewPlugin,
      aiOutputFlashPlugin,
      keymap.of([
        {
          key: 'Enter',
          run: (view) => continueMarkdownList(view),
        },
        {
          key: 'Escape',
          run: (view) => {
            const inlineSuggestion = view.state.field(inlineSuggestionField)
            if (!inlineSuggestion.text) return false
            view.dispatch({ effects: clearInlineSuggestionEffect.of() })
            return true
          },
        },
        {
          key: 'Tab',
          run: (view) => {
            if (view.composing) return false
            if (!view.state.selection.main.empty) {
              return indentWithTab.run?.(view) ?? false
            }
            const inlineSuggestion = view.state.field(inlineSuggestionField)
            if (!inlineSuggestion.text || inlineSuggestion.from < 0) {
              // No suggestion available - check if we should trigger manual invoke
              const head = view.state.selection.main.head
              const line = view.state.doc.lineAt(head)
              const before = view.state.sliceDoc(line.from, head)
              if (/^\s*$/.test(before)) {
                return indentWithTab.run?.(view) ?? false
              }
              // Trigger manual invoke if not already pending
              if (!inlineSuggestionPendingRef.current) {
                onInlineSuggestionInvokeRef.current?.()
              }
              return true
            }
            const head = view.state.selection.main.head
            // Accept if cursor is at or near the suggestion start
            if (head < inlineSuggestion.from || head > inlineSuggestion.from + inlineSuggestion.text.length) {
              return indentWithTab.run?.(view) ?? false
            }
            const insertAt = inlineSuggestion.from
            const insertText = inlineSuggestion.text
            const cursorAfter = insertAt + insertText.length
            suppressOnChangeRef.current = true
            lockExternalSyncRef.current = true
            view.dispatch({
              changes: { from: insertAt, to: insertAt, insert: insertText },
              selection: { anchor: cursorAfter },
              effects: [clearInlineSuggestionEffect.of(), clearRevisionPreviewEffect.of()],
              annotations: Transaction.userEvent.of('input.complete'),
            })
            suppressOnChangeRef.current = false
            onChangeRef.current(view.state.doc.toString())
            onInlineSuggestionAcceptedRef.current?.()
            return true
          },
        },
        {
          key: 'Mod-\\',
          run: () => {
            onInlineSuggestionInvokeRef.current?.()
            return true
          },
        },
        {
          key: 'Alt-\\',
          run: () => {
            onInlineSuggestionInvokeRef.current?.()
            return true
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      EditorView.domEventHandlers({
        compositionstart: () => {
          onCompositionStateChangeRef.current?.(true)
          return false
        },
        compositionend: () => {
          onCompositionStateChangeRef.current?.(false)
          return false
        },
        blur: () => {
          onCompositionStateChangeRef.current?.(false)
          return false
        },
        click: (event) => {
          const targetEl = event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>('.cm-wikilink')
            : null
          if (!targetEl) return false
          if (!event.metaKey && !event.ctrlKey) return false
          const target = extractWikilinkTarget(targetEl.innerText || targetEl.textContent || '')
          if (!target) return false
          event.preventDefault()
          const open = onOpenWikilinkRef.current
          if (open) {
            void Promise.resolve(open(target))
          }
          clearWikilinkHover()
          return true
        },
        mousemove: (event) => {
          const targetEl = event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>('.cm-wikilink')
            : null
          if (!targetEl) {
            clearWikilinkHover()
            return false
          }
          const target = extractWikilinkTarget(targetEl.innerText || targetEl.textContent || '')
          if (!target) {
            clearWikilinkHover()
            return false
          }
          if (
            wikilinkHoverTargetRef.current === target
            && wikilinkHoverElementRef.current === targetEl
          ) {
            return false
          }
          if (wikilinkHoverTimerRef.current != null) {
            window.clearTimeout(wikilinkHoverTimerRef.current)
            wikilinkHoverTimerRef.current = null
          }
          wikilinkHoverElementRef.current = targetEl
          wikilinkHoverTimerRef.current = window.setTimeout(() => {
            const rect = targetEl.getBoundingClientRect()
            wikilinkHoverTargetRef.current = target
            onHoverWikilinkRef.current?.({
              target,
              clientX: event.clientX,
              clientY: event.clientY,
              rect: {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              },
            })
          }, 500)
          return false
        },
        mouseleave: () => {
          clearWikilinkHover()
          return false
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        if (applyingExternalRef.current) return
        if (suppressOnChangeRef.current) return
        onChangeRef.current(update.state.doc.toString())
      }),
    ],
    [],
  )

  useEffect(() => {
    if (!rootRef.current || editorRef.current) return
    const state = EditorState.create({
      doc: content || '',
      extensions: [
        ...baseExtensions,
        themeCompartmentRef.current.of(
          isDark
            ? [oneDark, darkAdjustTheme]
            : [lightTheme],
        ),
      ],
    })
    const view = new EditorView({
      state,
      parent: rootRef.current,
    })
    editorRef.current = view

    return () => {
      onCompositionStateChangeRef.current?.(false)
      if (highlightClearTimerRef.current != null) {
        window.clearTimeout(highlightClearTimerRef.current)
      }
      if (wikilinkHoverTimerRef.current != null) {
        window.clearTimeout(wikilinkHoverTimerRef.current)
      }
      view.destroy()
      editorRef.current = null
    }
  }, [baseExtensions, clearWikilinkHover])

  useEffect(() => {
    const view = editorRef.current
    if (!view) return
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(
        isDark
          ? [oneDark, darkAdjustTheme]
          : [lightTheme],
      ),
    })
  }, [isDark])

  useEffect(() => {
    const view = editorRef.current
    if (!view) return
    if (lockExternalSyncRef.current) {
      const current = view.state.doc.toString()
      if ((content || '') === current) {
        lockExternalSyncRef.current = false
      }
      return
    }
    const current = view.state.doc.toString()
    const next = content || ''
    if (current === next) return
    applyingExternalRef.current = true
    try {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: next },
        effects: [clearInlineSuggestionEffect.of(), clearRevisionPreviewEffect.of()],
      })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[NoteEditor] dispatch failed, rebuilding editor state', error)
      }
      const recovered = EditorState.create({
        doc: next,
        extensions: [
          ...baseExtensions,
          themeCompartmentRef.current.of(isDark ? [oneDark, darkAdjustTheme] : [lightTheme]),
        ],
      })
      view.setState(recovered)
    }
    applyingExternalRef.current = false
  }, [baseExtensions, content, isDark])

  const applyAIChange = useCallback(async (change: NoteEditorChange, options?: NoteEditorApplyOptions): Promise<string> => {
    const view = editorRef.current
    if (!view) return content || ''

    const docLength = view.state.doc.length
    const from = Math.max(0, Math.min(change.from, docLength))
    const to = Math.max(from, Math.min(change.to, docLength))
    const insert = change.insert || ''
    const stream = Boolean(options?.stream) && insert.length > 0

    lockExternalSyncRef.current = true
    suppressOnChangeRef.current = true

    if (!stream) {
      view.dispatch({
        changes: { from, to, insert },
        annotations: Transaction.userEvent.of('ai.output'),
        effects: [clearRevisionPreviewEffect.of(), EditorView.scrollIntoView(from + insert.length)],
      })
      suppressOnChangeRef.current = false
      const nextContent = view.state.doc.toString()
      onChangeRef.current(nextContent)
      return nextContent
    }

    if (from !== to) {
      view.dispatch({
        changes: { from, to, insert: '' },
        annotations: Transaction.userEvent.of('ai.output'),
        effects: [clearRevisionPreviewEffect.of(), EditorView.scrollIntoView(from)],
      })
    }

    const target = insert
    const maxFrames = 26
    const frameChunk = Math.max(24, Math.ceil(target.length / maxFrames))
    let cursor = 0

    await new Promise<void>((resolve) => {
      const step = () => {
        const nextCursor = Math.min(target.length, cursor + frameChunk)
        const chunk = target.slice(cursor, nextCursor)
        if (chunk.length > 0) {
          const insertAt = from + cursor
          view.dispatch({
            changes: { from: insertAt, to: insertAt, insert: chunk },
            annotations: Transaction.userEvent.of('ai.output'),
            effects: [clearRevisionPreviewEffect.of(), EditorView.scrollIntoView(insertAt + chunk.length)],
          })
        }
        cursor = nextCursor
        if (cursor >= target.length) {
          resolve()
          return
        }
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })

    suppressOnChangeRef.current = false
    const nextContent = view.state.doc.toString()
    onChangeRef.current(nextContent)
    return nextContent
  }, [content])

  const revealRange = useCallback((rawFrom: number, rawTo: number) => {
    const view = editorRef.current
    if (!view) return null

    const docLength = view.state.doc.length
    const from = Math.max(0, Math.min(rawFrom, docLength))
    const normalizedTo = Math.max(0, Math.min(rawTo, docLength))
    const to = Math.max(from + 1, normalizedTo)
    const safeTo = Math.min(to, docLength)

    view.dispatch({
      selection: EditorSelection.range(from, safeTo),
      effects: [
        setAIHighlightEffect.of({ from, to: safeTo }),
        EditorView.scrollIntoView(from, { y: 'center', yMargin: 20 }),
      ],
      annotations: Transaction.userEvent.of('select.search'),
    })
    view.focus()

    if (highlightClearTimerRef.current != null) {
      window.clearTimeout(highlightClearTimerRef.current)
    }
    highlightClearTimerRef.current = window.setTimeout(() => {
      const latestView = editorRef.current
      if (!latestView) return
      latestView.dispatch({
        effects: clearAIHighlightEffect.of(),
      })
      highlightClearTimerRef.current = null
    }, 2200)

    return {
      from,
      to: safeTo,
      line: view.state.doc.lineAt(from).number,
    }
  }, [])

  useImperativeHandle(ref, () => ({
    getContent: () => editorRef.current?.state.doc.toString() || '',
    getCursorContext: (windowSize = 460) => {
      const view = editorRef.current
      if (!view) return null
      const cursor = view.state.selection.main.head
      const safeWindow = Math.max(120, Math.min(windowSize, 2400))
      const beforeFrom = Math.max(0, cursor - safeWindow)
      const afterTo = Math.min(view.state.doc.length, cursor + Math.floor(safeWindow * 0.4))
      return {
        cursor,
        before: view.state.sliceDoc(beforeFrom, cursor),
        after: view.state.sliceDoc(cursor, afterTo),
      }
    },
    focus: () => editorRef.current?.focus(),
    applyAIChange,
    revealRange,
    runEditorAction: async (action) => {
      const view = editorRef.current
      if (!view) return false
      view.focus()

      switch (action) {
        case 'undo':
          undo(view)
          return true
        case 'redo':
          redo(view)
          return true
        case 'select_all': {
          const length = view.state.doc.length
          view.dispatch({
            selection: EditorSelection.range(0, length),
            annotations: Transaction.userEvent.of('select.all'),
          })
          return true
        }
        case 'copy':
        case 'cut': {
          const selection = view.state.selection.main
          if (selection.empty) return false
          const selectedText = view.state.sliceDoc(selection.from, selection.to)
          const copied = await copyTextToClipboard(selectedText)
          if (!copied) return false
          if (action === 'cut') {
            view.dispatch({
              changes: { from: selection.from, to: selection.to, insert: '' },
              selection: { anchor: selection.from },
              annotations: Transaction.userEvent.of('delete.cut'),
            })
          }
          return true
        }
        case 'paste': {
          const clipText = await readTextFromClipboard()
          if (clipText == null) return false
          const selection = view.state.selection.main
          const nextCursor = selection.from + clipText.length
          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: clipText },
            selection: { anchor: nextCursor },
            annotations: Transaction.userEvent.of('input.paste'),
          })
          return true
        }
        default:
          return false
      }
    },
    setInlineSuggestion: (text: string) => {
      const view = editorRef.current
      if (!view) return
      const nextText = (text || '').replace(/\r/g, '').trimEnd()
      if (!nextText) {
        view.dispatch({ effects: clearInlineSuggestionEffect.of() })
        return
      }
      const cursor = view.state.selection.main.head
      view.dispatch({
        effects: setInlineSuggestionEffect.of({ from: cursor, text: nextText }),
      })
    },
    clearInlineSuggestion: () => {
      const view = editorRef.current
      if (!view) return
      view.dispatch({ effects: clearInlineSuggestionEffect.of() })
    },
    previewRevision: (nextContent: string) => {
      const view = editorRef.current
      if (!view) return null
      const current = view.state.doc.toString()
      const target = nextContent || ''
      if (current === target) {
        view.dispatch({ effects: clearRevisionPreviewEffect.of() })
        return { changed: false, from: 0, to: 0 }
      }

      let prefix = 0
      while (
        prefix < current.length
        && prefix < target.length
        && current.charCodeAt(prefix) === target.charCodeAt(prefix)
      ) {
        prefix += 1
      }

      let suffix = 0
      while (
        suffix + prefix < current.length
        && suffix + prefix < target.length
        && current.charCodeAt(current.length - 1 - suffix) === target.charCodeAt(target.length - 1 - suffix)
      ) {
        suffix += 1
      }

      const from = prefix
      const to = Math.max(prefix, current.length - suffix)
      const insert = target.slice(prefix, Math.max(prefix, target.length - suffix))
      view.dispatch({
        effects: [
          setRevisionPreviewEffect.of({ from, to, insert }),
          EditorView.scrollIntoView(from, { y: 'center', yMargin: 20 }),
        ],
      })
      return { changed: true, from, to }
    },
    previewInlineReplace: (original: string, replacement: string) => {
      const view = editorRef.current
      if (!view) return null

      const targetOriginal = (original || '').replace(/\r/g, '').trim()
      const targetReplacement = (replacement || '').replace(/\r/g, '')
      if (!targetOriginal) {
        view.dispatch({ effects: clearRevisionPreviewEffect.of() })
        return null
      }

      const cursor = view.state.selection.main.head
      let matchRange = findRangeBySearchCursor(view.state, targetOriginal, cursor)
      if (!matchRange) {
        matchRange = findRangeByLooseWhitespaceMatch(view.state.doc.toString(), targetOriginal)
      }
      if (!matchRange) {
        view.dispatch({ effects: clearRevisionPreviewEffect.of() })
        return null
      }

      const currentSegment = view.state.sliceDoc(matchRange.from, matchRange.to)
      if (currentSegment === targetReplacement) {
        view.dispatch({ effects: clearRevisionPreviewEffect.of() })
        return {
          changed: false,
          from: matchRange.from,
          to: matchRange.to,
          replacement: targetReplacement,
          original: currentSegment,
        }
      }

      view.dispatch({
        effects: [
          setRevisionPreviewEffect.of({
            from: matchRange.from,
            to: matchRange.to,
            insert: targetReplacement,
          }),
          EditorView.scrollIntoView(matchRange.from, { y: 'center', yMargin: 18 }),
        ],
      })

      return {
        changed: true,
        from: matchRange.from,
        to: matchRange.to,
        replacement: targetReplacement,
        original: currentSegment,
      }
    },
    clearRevisionPreview: () => {
      const view = editorRef.current
      if (!view) return
      view.dispatch({ effects: clearRevisionPreviewEffect.of() })
    },
  }), [applyAIChange, revealRange])

  useEffect(() => {
    if (!flashSignal) return
    setFlashActive(true)
    const timer = window.setTimeout(() => setFlashActive(false), 900)
    return () => window.clearTimeout(timer)
  }, [flashSignal])

  return (
    <div
      className={`h-full rounded-2xl border bg-bg-primary/95 backdrop-blur-sm overflow-hidden transition-[box-shadow,border-color] duration-300 ${
        flashActive
          ? 'border-primary-300 ring-2 ring-primary-200/70 dark:ring-primary-500/35 shadow-[0_0_0_1px_rgba(99,102,241,0.25)]'
          : 'border-border-primary'
      }`}
    >
      <div className="h-10 px-3 border-b border-border-primary bg-bg-secondary/70 backdrop-blur-sm flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-text-muted">Markdown 编辑器</p>
          <span
            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
              inlineSuggestionPending
                ? 'border-violet-300/70 text-violet-600 dark:text-violet-300 bg-violet-100/55 dark:bg-violet-900/20'
                : 'border-border-primary text-text-muted bg-bg-primary/60'
            }`}
            title={inlineSuggestionPending ? 'AI 正在生成内联补全' : '内联补全就绪'}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${inlineSuggestionPending ? 'bg-current animate-pulse' : 'bg-current/40'}`} />
            补全
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const view = editorRef.current
              if (!view) return
              view.focus()
              undo(view)
            }}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            title="撤销（Ctrl/Cmd+Z）"
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              const view = editorRef.current
              if (!view) return
              view.focus()
              redo(view)
            }}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            title="重做（Ctrl/Cmd+Shift+Z）"
          >
            <Redo2 size={13} />
          </button>
        </div>
      </div>
      <div ref={rootRef} className="pm-note-cm-editor h-[calc(100%-40px)]" />
    </div>
  )
})

export default NoteEditor
