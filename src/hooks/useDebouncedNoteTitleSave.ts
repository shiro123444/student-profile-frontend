import { useEffect } from 'react'

export const NOTE_TITLE_SAVE_DEBOUNCE_MS = 400

interface UseDebouncedNoteTitleSaveParams {
  noteID: string | null
  noteTitle: string | null | undefined
  editTitle: string
  applyOptimisticTitle: (noteID: string, title: string) => void
  saveTitle: (title: string) => void
}

export function normalizeNoteTitle(title: string): string {
  const normalized = title.trim()
  return normalized.length > 0 ? normalized : '无标题笔记'
}

export function useDebouncedNoteTitleSave({
  noteID,
  noteTitle,
  editTitle,
  applyOptimisticTitle,
  saveTitle,
}: UseDebouncedNoteTitleSaveParams) {
  useEffect(() => {
    if (!noteID) return

    const nextTitle = normalizeNoteTitle(editTitle)

    // Only apply optimistic update if title actually changed
    if (nextTitle !== (noteTitle || '无标题笔记')) {
      applyOptimisticTitle(noteID, nextTitle)
    }

    const timer = window.setTimeout(() => {
      if (nextTitle !== (noteTitle || '')) {
        saveTitle(nextTitle)
      }
    }, NOTE_TITLE_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTitle, noteID, noteTitle])
}
