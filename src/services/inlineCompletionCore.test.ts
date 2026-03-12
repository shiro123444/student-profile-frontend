import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createInlineCompletionController,
  detectMarkdownCursorMode,
  hasBracketMismatch,
  isLikelyProseForCodeCompletion,
} from './inlineCompletionCore'

describe('hasBracketMismatch', () => {
  it('returns false for balanced content', () => {
    expect(hasBracketMismatch('function a(){ return [1, 2, 3]; }')).toBe(false)
  })

  it('returns true for mismatched closing bracket', () => {
    expect(hasBracketMismatch('const x = (a + b]')).toBe(true)
  })
})

describe('detectMarkdownCursorMode', () => {
  it('detects code mode inside fenced block and returns language', () => {
    const content = [
      '# Title',
      '',
      '```ts',
      'const answer = foo',
      '',
    ].join('\n')
    const cursor = content.length
    const detected = detectMarkdownCursorMode(content, cursor)
    expect(detected).toEqual({ mode: 'code', language: 'ts' })
  })

  it('detects prose mode when cursor is outside fenced block', () => {
    const content = [
      '```python',
      'print("ok")',
      '```',
      '',
      '继续写总结',
    ].join('\n')
    const cursor = content.length
    const detected = detectMarkdownCursorMode(content, cursor)
    expect(detected).toEqual({ mode: 'prose', language: '' })
  })
})

describe('isLikelyProseForCodeCompletion', () => {
  it('flags sentence-like text as prose', () => {
    expect(isLikelyProseForCodeCompletion('这里我们先分析这个问题，然后再给出结论。')).toBe(true)
    expect(isLikelyProseForCodeCompletion('This paragraph explains how the code works in detail')).toBe(true)
  })

  it('keeps code-like snippets as non-prose', () => {
    expect(isLikelyProseForCodeCompletion('return fmt.Sprintf("%s:%d", host, port)')).toBe(false)
    expect(isLikelyProseForCodeCompletion('const result = await client.query(sql)')).toBe(false)
  })
})

describe('createInlineCompletionController', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces requests and only runs the latest payload', async () => {
    vi.useFakeTimers()
    const executor = vi.fn(async (payload: { prefix: string }, _signal: AbortSignal) => payload.prefix)
    const controller = createInlineCompletionController(executor, 300)

    const first = controller.request({ prefix: 'first', suffix: '' })
    const second = controller.request({ prefix: 'second', suffix: '' })

    vi.advanceTimersByTime(299)
    await Promise.resolve()
    expect(executor).toHaveBeenCalledTimes(0)

    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(executor).toHaveBeenCalledTimes(1)
    expect(executor).toHaveBeenLastCalledWith({ prefix: 'second', suffix: '' }, expect.any(AbortSignal))

    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toBe('second')
  })

  it('aborts in-flight request when a new request arrives', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const executor = vi.fn((payload: { prefix: string }, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(() => resolve(payload.prefix), 20)
        signal.addEventListener('abort', () => {
          window.clearTimeout(timer)
          const err = new Error('aborted')
          ;(err as Error & { name: string }).name = 'AbortError'
          reject(err)
        }, { once: true })
      })
    })
    const controller = createInlineCompletionController(executor, 300)

    const first = controller.request({ prefix: 'first', suffix: '' })
    vi.advanceTimersByTime(300)
    await Promise.resolve()
    expect(executor).toHaveBeenCalledTimes(1)

    const second = controller.request({ prefix: 'second', suffix: '' })
    expect(signals[0]?.aborted).toBe(true)

    vi.advanceTimersByTime(300)
    await Promise.resolve()
    vi.advanceTimersByTime(20)

    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toBe('second')
  })
})
