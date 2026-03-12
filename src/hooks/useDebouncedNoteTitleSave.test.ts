import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  NOTE_TITLE_SAVE_DEBOUNCE_MS,
  normalizeNoteTitle,
  useDebouncedNoteTitleSave,
} from './useDebouncedNoteTitleSave'

describe('normalizeNoteTitle', () => {
  it('falls back to default title for empty input', () => {
    expect(normalizeNoteTitle('   ')).toBe('无标题笔记')
  })

  it('keeps trimmed title for non-empty input', () => {
    expect(normalizeNoteTitle('  My Note  ')).toBe('My Note')
  })
})

describe('useDebouncedNoteTitleSave', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies optimistic title immediately and saves after debounce', () => {
    vi.useFakeTimers()
    const applyOptimisticTitle = vi.fn()
    const saveTitle = vi.fn()

    renderHook(() => useDebouncedNoteTitleSave({
      noteID: 'note-1',
      noteTitle: 'Old',
      editTitle: 'New Title',
      applyOptimisticTitle,
      saveTitle,
    }))

    expect(applyOptimisticTitle).toHaveBeenCalledWith('note-1', 'New Title')
    expect(saveTitle).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(NOTE_TITLE_SAVE_DEBOUNCE_MS - 1)
    })
    expect(saveTitle).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(saveTitle).toHaveBeenCalledWith('New Title')
  })

  it('does not persist when title is unchanged', () => {
    vi.useFakeTimers()
    const applyOptimisticTitle = vi.fn()
    const saveTitle = vi.fn()

    renderHook(() => useDebouncedNoteTitleSave({
      noteID: 'note-1',
      noteTitle: 'Same',
      editTitle: 'Same',
      applyOptimisticTitle,
      saveTitle,
    }))

    act(() => {
      vi.advanceTimersByTime(NOTE_TITLE_SAVE_DEBOUNCE_MS)
    })

    expect(applyOptimisticTitle).toHaveBeenCalledWith('note-1', 'Same')
    expect(saveTitle).not.toHaveBeenCalled()
  })
})
