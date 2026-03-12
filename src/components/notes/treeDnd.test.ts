import { describe, expect, it } from 'vitest'

import type { Note, NoteFolder } from '../../services/api'
import { buildTreeReorderPayload, resolveDropPreview } from './treeDnd'

const makeFolder = (overrides: Partial<NoteFolder>): NoteFolder => ({
  id: 'folder-1',
  student_id: 'stu',
  name: 'Folder',
  parent_id: null,
  path: '/Folder',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const makeNote = (overrides: Partial<Note>): Note => ({
  id: 'note-1',
  title: 'Note',
  content: '',
  folder: '/',
  folder_id: null,
  sort_order: 0,
  tags: [],
  is_public: false,
  word_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('resolveDropPreview', () => {
  it('resolves folder target into before/inside/after', () => {
    expect(resolveDropPreview(10, 0, 100, 'folder', 'f-1')).toEqual({
      targetType: 'folder',
      targetId: 'f-1',
      position: 'before',
    })

    expect(resolveDropPreview(50, 0, 100, 'folder', 'f-1')).toEqual({
      targetType: 'folder',
      targetId: 'f-1',
      position: 'inside',
    })

    expect(resolveDropPreview(95, 0, 100, 'folder', 'f-1')).toEqual({
      targetType: 'folder',
      targetId: 'f-1',
      position: 'after',
    })
  })

  it('resolves note target into before/after only', () => {
    expect(resolveDropPreview(25, 0, 100, 'note', 'n-1')).toEqual({
      targetType: 'note',
      targetId: 'n-1',
      position: 'before',
    })

    expect(resolveDropPreview(75, 0, 100, 'note', 'n-1')).toEqual({
      targetType: 'note',
      targetId: 'n-1',
      position: 'after',
    })
  })
})

describe('buildTreeReorderPayload', () => {
  it('builds note reorder payload when dropping after another note', () => {
    const noteA = makeNote({ id: 'note-a', folder_id: 'folder-a', folder: '/A', sort_order: 0 })
    const noteB = makeNote({ id: 'note-b', folder_id: 'folder-a', folder: '/A', sort_order: 1 })

    const payload = buildTreeReorderPayload({
      dragging: { kind: 'note', id: 'note-a' },
      preview: { targetType: 'note', targetId: 'note-b', position: 'after' },
      folderByID: new Map<string, NoteFolder>(),
      noteByID: new Map<string, Note>([
        [noteA.id, noteA],
        [noteB.id, noteB],
      ]),
      folderChildrenMap: new Map<string, NoteFolder[]>(),
      noteChildrenMap: new Map<string, Note[]>([
        ['folder-a', [noteA, noteB]],
      ]),
    })

    expect(payload).toEqual({
      kind: 'note',
      item_id: 'note-a',
      parent_id: 'folder-a',
      index: 1,
    })
  })

  it('builds folder reorder payload when dropping inside folder', () => {
    const parent = makeFolder({ id: 'folder-parent', parent_id: null, path: '/Parent' })
    const childA = makeFolder({ id: 'child-a', parent_id: 'folder-parent', path: '/Parent/ChildA', sort_order: 0 })

    const payload = buildTreeReorderPayload({
      dragging: { kind: 'folder', id: 'folder-drag' },
      preview: { targetType: 'folder', targetId: 'folder-parent', position: 'inside' },
      folderByID: new Map<string, NoteFolder>([[parent.id, parent]]),
      noteByID: new Map<string, Note>(),
      folderChildrenMap: new Map<string, NoteFolder[]>([
        ['folder-parent', [childA]],
      ]),
      noteChildrenMap: new Map<string, Note[]>(),
    })

    expect(payload).toEqual({
      kind: 'folder',
      item_id: 'folder-drag',
      parent_id: 'folder-parent',
      index: 1,
    })
  })

  it('returns null when folder is dropped onto a note target', () => {
    const payload = buildTreeReorderPayload({
      dragging: { kind: 'folder', id: 'folder-a' },
      preview: { targetType: 'note', targetId: 'note-a', position: 'before' },
      folderByID: new Map<string, NoteFolder>(),
      noteByID: new Map<string, Note>(),
      folderChildrenMap: new Map<string, NoteFolder[]>(),
      noteChildrenMap: new Map<string, Note[]>(),
    })

    expect(payload).toBeNull()
  })

  it('returns null when folder is dropped inside itself', () => {
    const rootFolder = makeFolder({ id: 'folder-root', path: '/Root' })

    const payload = buildTreeReorderPayload({
      dragging: { kind: 'folder', id: 'folder-root' },
      preview: { targetType: 'folder', targetId: 'folder-root', position: 'inside' },
      folderByID: new Map<string, NoteFolder>([[rootFolder.id, rootFolder]]),
      noteByID: new Map<string, Note>(),
      folderChildrenMap: new Map<string, NoteFolder[]>(),
      noteChildrenMap: new Map<string, Note[]>(),
    })

    expect(payload).toBeNull()
  })

  it('builds note reorder payload at folder top when hovering folder top zone', () => {
    const folderA = makeFolder({ id: 'folder-a', path: '/A' })
    const noteA = makeNote({ id: 'note-a', folder_id: 'folder-a', folder: '/A', sort_order: 0 })
    const noteB = makeNote({ id: 'note-b', folder_id: 'folder-a', folder: '/A', sort_order: 1 })

    const payload = buildTreeReorderPayload({
      dragging: { kind: 'note', id: 'note-b' },
      preview: { targetType: 'folder', targetId: 'folder-a', position: 'before' },
      folderByID: new Map<string, NoteFolder>([[folderA.id, folderA]]),
      noteByID: new Map<string, Note>([
        [noteA.id, noteA],
        [noteB.id, noteB],
      ]),
      folderChildrenMap: new Map<string, NoteFolder[]>(),
      noteChildrenMap: new Map<string, Note[]>([
        ['folder-a', [noteA, noteB]],
      ]),
    })

    expect(payload).toEqual({
      kind: 'note',
      item_id: 'note-b',
      parent_id: 'folder-a',
      index: 0,
    })
  })
})
