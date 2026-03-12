import type { ContextMenuItem } from '../contexts/ContextMenuContext'

interface NoteNodeHandlers {
  onOpen: () => void | Promise<void>
  onRename: () => void | Promise<void>
  onMoveToRoot: () => void | Promise<void>
  onProperties: () => void | Promise<void>
  onDelete: () => void | Promise<void>
}

interface FolderNodeHandlers {
  onNewNote: () => void | Promise<void>
  onNewFolder: () => void | Promise<void>
  onRename: () => void | Promise<void>
  onProperties: () => void | Promise<void>
  onDelete: () => void | Promise<void>
}

interface BlankHandlers {
  onNewNote: () => void | Promise<void>
  onNewFolder: () => void | Promise<void>
}

interface EditorHandlers {
  onUndo: () => void | Promise<void>
  onRedo: () => void | Promise<void>
  onCut: () => void | Promise<void>
  onCopy: () => void | Promise<void>
  onPaste: () => void | Promise<void>
  onSelectAll: () => void | Promise<void>
}

export function createNoteNodeContextMenuItems(handlers: NoteNodeHandlers): ContextMenuItem[] {
  return [
    { id: 'note-open', label: '打开', onSelect: handlers.onOpen },
    { id: 'note-rename', label: '重命名', onSelect: handlers.onRename },
    { id: 'note-move-root', label: '移动到根目录', onSelect: handlers.onMoveToRoot },
    { id: 'note-properties', label: '属性（标签）', onSelect: handlers.onProperties },
    { id: 'sep-note-1', label: '', separator: true },
    { id: 'note-delete', label: '删除', danger: true, onSelect: handlers.onDelete },
  ]
}

export function createFolderNodeContextMenuItems(handlers: FolderNodeHandlers): ContextMenuItem[] {
  return [
    { id: 'folder-new-note', label: '新建笔记', onSelect: handlers.onNewNote },
    { id: 'folder-new-folder', label: '新建文件夹', onSelect: handlers.onNewFolder },
    { id: 'folder-rename', label: '重命名', onSelect: handlers.onRename },
    { id: 'folder-properties', label: '属性', onSelect: handlers.onProperties },
    { id: 'sep-folder-1', label: '', separator: true },
    { id: 'folder-delete', label: '删除', danger: true, onSelect: handlers.onDelete },
  ]
}

export function createBlankContextMenuItems(handlers: BlankHandlers): ContextMenuItem[] {
  return [
    { id: 'blank-new-note', label: '新建笔记', onSelect: handlers.onNewNote },
    { id: 'blank-new-folder', label: '新建文件夹', onSelect: handlers.onNewFolder },
  ]
}

export function createEditorContextMenuItems(handlers: EditorHandlers): ContextMenuItem[] {
  return [
    { id: 'editor-undo', label: 'Undo', shortcut: 'Ctrl/Cmd+Z', onSelect: handlers.onUndo },
    { id: 'editor-redo', label: 'Redo', shortcut: 'Ctrl/Cmd+Shift+Z', onSelect: handlers.onRedo },
    { id: 'sep-editor-1', label: '', separator: true },
    { id: 'editor-cut', label: 'Cut', shortcut: 'Ctrl/Cmd+X', onSelect: handlers.onCut },
    { id: 'editor-copy', label: 'Copy', shortcut: 'Ctrl/Cmd+C', onSelect: handlers.onCopy },
    { id: 'editor-paste', label: 'Paste', shortcut: 'Ctrl/Cmd+V', onSelect: handlers.onPaste },
    { id: 'editor-select-all', label: 'Select All', shortcut: 'Ctrl/Cmd+A', onSelect: handlers.onSelectAll },
  ]
}
