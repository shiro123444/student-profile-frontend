export interface InlineCompletionPayload {
  prefix: string
  suffix: string
}

export type InlineCompletionMode = 'code' | 'prose'

export interface MarkdownCursorMode {
  mode: InlineCompletionMode
  language: string
}

export type InlineCompletionExecutor = (
  payload: InlineCompletionPayload,
  signal: AbortSignal,
) => Promise<string | null>

export interface InlineCompletionController {
  request: (payload: InlineCompletionPayload) => Promise<string | null>
  cancel: () => void
}

function parseFenceLanguage(rawInfo: string): string {
  const token = (rawInfo || '').trim().split(/\s+/)[0] || ''
  return token.replace(/[^a-zA-Z0-9_+#.\-]/g, '').toLowerCase()
}

function normalizeFenceChar(ch: string): string {
  if (ch === '｀') return '`'
  return ch
}

export function detectMarkdownCursorMode(
  content: string,
  cursor: number,
): MarkdownCursorMode {
  const safeContent = content || ''
  const safeCursor = Math.max(0, Math.min(cursor, safeContent.length))
  const before = safeContent.slice(0, safeCursor)

  let inFencedCode = false
  let fenceChar = ''
  let fenceLength = 0
  let fenceLanguage = ''

  const lines = before.replace(/\r/g, '').split('\n')
  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}([`｀]{3,}|~{3,})(.*)$/)
    if (!fenceMatch) continue
    const marker = fenceMatch[1] || ''
    const markerChar = normalizeFenceChar(marker[0] || '')
    if (!markerChar) continue

    if (!inFencedCode) {
      inFencedCode = true
      fenceChar = markerChar
      fenceLength = marker.length
      fenceLanguage = parseFenceLanguage(fenceMatch[2] || '')
      continue
    }

    if (markerChar === fenceChar && marker.length >= fenceLength) {
      inFencedCode = false
      fenceChar = ''
      fenceLength = 0
      fenceLanguage = ''
    }
  }

  if (!inFencedCode) {
    return { mode: 'prose', language: '' }
  }
  return { mode: 'code', language: fenceLanguage || 'plain' }
}

export function isLikelyProseForCodeCompletion(text: string): boolean {
  const normalized = (text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return true

  const hasCodeSymbols = /[{}()[\];=<>]|=>|:=|->|::|`/.test(normalized)
  if (/[\u3002\uff01\uff1f\uff1b]/.test(normalized) && !hasCodeSymbols) return true

  const cjkCount = (normalized.match(/[\u3400-\u9fff]/g) || []).length
  if (cjkCount >= 8 && !hasCodeSymbols && !/[._]/.test(normalized)) {
    return true
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length >= 5 && !hasCodeSymbols) {
    const mostlyAlphaWords = words.filter((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word))
    if (mostlyAlphaWords.length >= Math.ceil(words.length * 0.8)) {
      return true
    }
  }

  if (/^(这里|然后|接下来|首先|最后|This |Here |You can |In this )/i.test(normalized) && !hasCodeSymbols) {
    return true
  }

  return false
}

export function hasBracketMismatch(source: string): boolean {
  const stack: string[] = []
  const opening = new Set(['(', '[', '{'])
  const closing: Record<string, string> = {
    ')': '(',
    ']': '[',
    '}': '{',
  }

  for (const ch of source) {
    if (opening.has(ch)) {
      stack.push(ch)
      continue
    }
    const expectedOpen = closing[ch]
    if (!expectedOpen) continue
    if (stack.length === 0 || stack[stack.length - 1] !== expectedOpen) {
      return true
    }
    stack.pop()
  }

  return false
}

export function createInlineCompletionController(
  executor: InlineCompletionExecutor,
  debounceMs = 300,
): InlineCompletionController {
  let timer: number | null = null
  let inFlightController: AbortController | null = null
  let pendingResolve: ((value: string | null) => void) | null = null
  let seq = 0

  const cancel = () => {
    if (timer != null) {
      window.clearTimeout(timer)
      timer = null
    }
    if (pendingResolve) {
      pendingResolve(null)
      pendingResolve = null
    }
    inFlightController?.abort()
    inFlightController = null
  }

  const request = (payload: InlineCompletionPayload): Promise<string | null> => {
    seq += 1
    const requestSeq = seq
    if (timer != null) {
      window.clearTimeout(timer)
      timer = null
    }
    if (pendingResolve) {
      pendingResolve(null)
      pendingResolve = null
    }
    inFlightController?.abort()

    return new Promise((resolve) => {
      pendingResolve = resolve
      timer = window.setTimeout(async () => {
        timer = null
        pendingResolve = null
        const controller = new AbortController()
        inFlightController = controller
        try {
          const value = await executor(payload, controller.signal)
          if (seq !== requestSeq) {
            resolve(null)
            return
          }
          resolve(value ?? null)
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            resolve(null)
            return
          }
          resolve(null)
        } finally {
          if (inFlightController === controller) {
            inFlightController = null
          }
        }
      }, Math.max(0, debounceMs))
    })
  }

  return { request, cancel }
}
