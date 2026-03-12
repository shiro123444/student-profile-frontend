import { useState, useEffect, useCallback, useRef } from 'react'
import { notesApi, type Note, type NoteGraph } from '../services/api'

// ── useNotes: list + filter + refresh ──

interface UseNotesOptions {
  folder?: string
  tags?: string
  search?: string
  page?: number
  pageSize?: number
}

export function useNotes(options: UseNotesOptions = {}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await notesApi.list({
        folder: options.folder,
        tags: options.tags,
        search: options.search,
        page: options.page,
        page_size: options.pageSize,
      })
      setNotes(res.notes || [])
      setTotal(res.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载笔记失败')
    } finally {
      setLoading(false)
    }
  }, [options.folder, options.tags, options.search, options.page, options.pageSize])

  useEffect(() => { fetch() }, [fetch])

  return { notes, total, loading, error, refresh: fetch }
}

// ── useNote: single note + auto-save ──

export function useNote(id: string | null) {
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<{ title?: string; content?: string }>({})
  const fetchSeqRef = useRef(0)

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const requestSeq = ++fetchSeqRef.current

    if (!id) {
      setNote(null)
      lastSavedRef.current = {}
      return
    }
    // 切换笔记时立即清空旧内容，避免旧笔记内容“串”到新笔记
    setNote(null)
    setLoading(true)
    setError(null)
    notesApi.get(id)
      .then((nextNote) => {
        if (requestSeq !== fetchSeqRef.current) return
        setNote(nextNote)
        lastSavedRef.current = {
          title: nextNote.title || '',
          content: nextNote.content || '',
        }
      })
      .catch((e) => {
        if (requestSeq !== fetchSeqRef.current) return
        setError(e instanceof Error ? e.message : '加载笔记失败')
      })
      .finally(() => {
        if (requestSeq !== fetchSeqRef.current) return
        setLoading(false)
      })
  }, [id])

  const save = useCallback(async (data: { title?: string; content?: string; folder?: string; tags?: string[] }) => {
    if (!id) return
    setSaving(true)
    try {
      const updated = await notesApi.update(id, data)
      setNote(updated)
      lastSavedRef.current = {
        title: updated.title || '',
        content: updated.content || '',
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [id])

  const autoSave = useCallback((data: { title?: string; content?: string }) => {
    const titleChanged = typeof data.title === 'string'
      ? data.title !== (lastSavedRef.current.title || '')
      : false
    const contentChanged = typeof data.content === 'string'
      ? data.content !== (lastSavedRef.current.content || '')
      : false

    if (!titleChanged && !contentChanged) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => save(data), 1200)
  }, [save])

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return { note, loading, saving, error, save, autoSave }
}

// ── useNoteGraph ──

export function useNoteGraph() {
  const [graph, setGraph] = useState<NoteGraph | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const data = await notesApi.getGraph()
      setGraph(data)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { graph, loading, refresh: fetch }
}
