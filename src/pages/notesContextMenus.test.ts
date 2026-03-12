import { describe, expect, it, vi } from 'vitest'

import {
  createBlankContextMenuItems,
  createEditorContextMenuItems,
  createFolderNodeContextMenuItems,
  createNoteNodeContextMenuItems,
} from './notesContextMenus'

describe('notes context menu item builders', () => {
  it('builds note node menu actions', () => {
    const items = createNoteNodeContextMenuItems({
      onOpen: vi.fn(),
      onRename: vi.fn(),
      onMoveToRoot: vi.fn(),
      onProperties: vi.fn(),
      onDelete: vi.fn(),
    })

    expect(items.map((item) => item.id)).toEqual([
      'note-open',
      'note-rename',
      'note-move-root',
      'note-properties',
      'sep-note-1',
      'note-delete',
    ])
    expect(items[5].danger).toBe(true)
  })

  it('builds folder node menu actions', () => {
    const items = createFolderNodeContextMenuItems({
      onNewNote: vi.fn(),
      onNewFolder: vi.fn(),
      onRename: vi.fn(),
      onProperties: vi.fn(),
      onDelete: vi.fn(),
    })

    expect(items.map((item) => item.id)).toEqual([
      'folder-new-note',
      'folder-new-folder',
      'folder-rename',
      'folder-properties',
      'sep-folder-1',
      'folder-delete',
    ])
  })

  it('builds editor and blank menus', () => {
    const blank = createBlankContextMenuItems({
      onNewNote: vi.fn(),
      onNewFolder: vi.fn(),
    })
    expect(blank.map((item) => item.id)).toEqual(['blank-new-note', 'blank-new-folder'])

    const editor = createEditorContextMenuItems({
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onCut: vi.fn(),
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onSelectAll: vi.fn(),
    })
    expect(editor.map((item) => item.id)).toEqual([
      'editor-undo',
      'editor-redo',
      'sep-editor-1',
      'editor-cut',
      'editor-copy',
      'editor-paste',
      'editor-select-all',
    ])
  })
})
