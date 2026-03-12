import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  notesApi,
  type Note,
  type NoteFolder,
  type NoteFolderCreatePayload,
  type NoteFolderUpdatePayload,
  type NoteReorderPayload,
} from '../services/api'

interface UseNotesTreeOptions {
  search?: string
}

function normalizeId(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function bySortOrder<T extends { sort_order?: number; updated_at?: string; name?: string; title?: string }>(left: T, right: T): number {
  const leftOrder = Number.isFinite(Number(left.sort_order)) ? Number(left.sort_order) : 0
  const rightOrder = Number.isFinite(Number(right.sort_order)) ? Number(right.sort_order) : 0
  if (leftOrder !== rightOrder) return leftOrder - rightOrder

  if (left.updated_at && right.updated_at && left.updated_at !== right.updated_at) {
    return right.updated_at.localeCompare(left.updated_at)
  }

  const leftName = (left.name || left.title || '').toLowerCase()
  const rightName = (right.name || right.title || '').toLowerCase()
  return leftName.localeCompare(rightName)
}

function applyLocalReorder(
  folders: NoteFolder[],
  notes: Note[],
  payload: NoteReorderPayload,
): { folders: NoteFolder[]; notes: Note[] } {
  const parentID = normalizeId(payload.parent_id)
  const nextFolders = folders.map((item) => ({ ...item }))
  const nextNotes = notes.map((item) => ({ ...item }))

  if (payload.kind === 'folder') {
    const moving = nextFolders.find((item) => item.id === payload.item_id)
    if (!moving) return { folders, notes }

    const previousParent = normalizeId(moving.parent_id)
    moving.parent_id = parentID

    const groups = new Map<string | null, NoteFolder[]>()
    for (const folder of nextFolders) {
      const key = normalizeId(folder.parent_id)
      const group = groups.get(key) || []
      group.push(folder)
      groups.set(key, group)
    }

    const targetGroup = (groups.get(parentID) || []).filter((item) => item.id !== moving.id).sort(bySortOrder)
    const insertAt = Math.max(0, Math.min(payload.index, targetGroup.length))
    targetGroup.splice(insertAt, 0, moving)
    targetGroup.forEach((item, index) => {
      item.sort_order = index
    })

    groups.set(parentID, targetGroup)

    if (previousParent !== parentID) {
      const oldGroup = (groups.get(previousParent) || []).filter((item) => item.id !== moving.id).sort(bySortOrder)
      oldGroup.forEach((item, index) => {
        item.sort_order = index
      })
      groups.set(previousParent, oldGroup)
    }

    return {
      folders: [...nextFolders].sort(bySortOrder),
      notes,
    }
  }

  const movingNote = nextNotes.find((item) => item.id === payload.item_id)
  if (!movingNote) return { folders, notes }

  const previousParent = normalizeId(movingNote.folder_id)
  movingNote.folder_id = parentID

  if (parentID) {
    const parentFolder = nextFolders.find((item) => item.id === parentID)
    if (parentFolder) {
      movingNote.folder = parentFolder.path
    }
  } else {
    movingNote.folder = '/'
  }

  const groups = new Map<string | null, Note[]>()
  for (const note of nextNotes) {
    const key = normalizeId(note.folder_id)
    const group = groups.get(key) || []
    group.push(note)
    groups.set(key, group)
  }

  const targetGroup = (groups.get(parentID) || []).filter((item) => item.id !== movingNote.id).sort(bySortOrder)
  const insertAt = Math.max(0, Math.min(payload.index, targetGroup.length))
  targetGroup.splice(insertAt, 0, movingNote)
  targetGroup.forEach((item, index) => {
    item.sort_order = index
  })
  groups.set(parentID, targetGroup)

  if (previousParent !== parentID) {
    const oldGroup = (groups.get(previousParent) || []).filter((item) => item.id !== movingNote.id).sort(bySortOrder)
    oldGroup.forEach((item, index) => {
      item.sort_order = index
    })
    groups.set(previousParent, oldGroup)
  }

  return {
    folders,
    notes: [...nextNotes].sort(bySortOrder),
  }
}

export function useNotesTree(options: UseNotesTreeOptions = {}) {
  const [folders, setFolders] = useState<NoteFolder[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const foldersRef = useRef(folders)
  const notesRef = useRef(notes)
  foldersRef.current = folders
  notesRef.current = notes

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const tree = await notesApi.getTree()
      const nextFolders = Array.isArray(tree.folders) ? [...tree.folders].sort(bySortOrder) : []
      const nextNotes = Array.isArray(tree.notes) ? [...tree.notes].sort(bySortOrder) : []
      setFolders(nextFolders)
      setNotes(nextNotes)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载笔记树失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const applyOptimisticTitle = useCallback((noteID: string, title: string) => {
    const nextTitle = title.trim() || '无标题笔记'
    setNotes((prev) => prev.map((item) => (item.id === noteID ? { ...item, title: nextTitle } : item)))
  }, [])

  const upsertNote = useCallback((note: Note) => {
    setNotes((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === note.id)
      if (existingIndex === -1) {
        return [...prev, note].sort(bySortOrder)
      }
      const next = [...prev]
      next[existingIndex] = note
      return next.sort(bySortOrder)
    })
  }, [])

  const removeNote = useCallback((noteID: string) => {
    setNotes((prev) => prev.filter((item) => item.id !== noteID))
  }, [])

  const createFolder = useCallback(async (payload: NoteFolderCreatePayload) => {
    const folder = await notesApi.createFolder(payload)
    setFolders((prev) => [...prev, folder].sort(bySortOrder))
    return folder
  }, [])

  const updateFolder = useCallback(async (id: string, payload: NoteFolderUpdatePayload) => {
    const folder = await notesApi.updateFolder(id, payload)
    setFolders((prev) => prev.map((item) => (item.id === id ? folder : item)).sort(bySortOrder))
    return folder
  }, [])

  const deleteFolder = useCallback(async (id: string, strategy: 'move_to_parent' | 'delete_recursive' = 'move_to_parent') => {
    await notesApi.deleteFolder(id, strategy)
    await refresh()
  }, [refresh])

  const reorder = useCallback(async (payload: NoteReorderPayload) => {
    const prevFolders = foldersRef.current
    const prevNotes = notesRef.current
    const optimistic = applyLocalReorder(prevFolders, prevNotes, payload)

    setFolders(optimistic.folders)
    setNotes(optimistic.notes)

    try {
      await notesApi.reorder(payload)
    } catch (error) {
      setFolders(prevFolders)
      setNotes(prevNotes)
      throw error
    }
  }, [])

  const normalizedSearch = (options.search || '').trim().toLowerCase()
  const tagFilter = normalizedSearch.startsWith('#') ? normalizedSearch.slice(1).trim() : ''

  const visibleNotes = useMemo(() => {
    if (!normalizedSearch) return notes
    return notes.filter((item) => {
      if (tagFilter) {
        return Array.isArray(item.tags) && item.tags.some((tag) => tag.toLowerCase().includes(tagFilter))
      }
      const title = (item.title || '').toLowerCase()
      const folder = (item.folder || '').toLowerCase()
      const tags = (item.tags || []).join(' ').toLowerCase()
      return title.includes(normalizedSearch) || folder.includes(normalizedSearch) || tags.includes(normalizedSearch)
    })
  }, [normalizedSearch, notes, tagFilter])

  return {
    folders,
    notes: visibleNotes,
    allNotes: notes,
    loading,
    error,
    refresh,
    applyOptimisticTitle,
    upsertNote,
    removeNote,
    createFolder,
    updateFolder,
    deleteFolder,
    reorder,
  }
}
