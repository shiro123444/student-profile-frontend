import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  defaultAnimateLayoutChanges,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { FileText, Folder, FolderOpen, Plus, Search, Trash2 } from 'lucide-react'
import type { Note, NoteFolder, NoteReorderPayload } from '../../services/api'
import { normalizeTreeNodeID } from './treeDnd'

// ---------- types ----------

interface NoteSidebarProps {
  folders: NoteFolder[]
  notes: Note[]
  activeNoteId: string | null
  backlinks?: Note[]
  onSelectNote: (id: string) => void
  onRequestRenameNote?: (id: string) => void
  onRenameNote?: (id: string, title: string) => Promise<void> | void
  onNewNote: (folderID?: string | null) => void
  onSearch: (query: string) => void
  onCreateFolder: (parentID?: string | null) => void
  onDeleteNote?: (id: string) => Promise<void> | void
  onDeleteFolder?: (id: string) => Promise<void> | void
  onRenameFolder?: (id: string, name: string) => Promise<void> | void
  onReorder?: (payload: NoteReorderPayload) => Promise<void> | void
  onNodeContextMenu?: (event: ReactMouseEvent, node: { kind: 'folder' | 'note'; id: string }) => void
  onBlankContextMenu?: (event: ReactMouseEvent) => void
}

interface FlatNode {
  uid: string
  id: string
  kind: 'folder' | 'note'
  parentId: string | null
  depth: number
  name: string
  updatedAt: string
  isExpanded?: boolean
}

// ---------- helpers ----------

const ROOT_KEY = '__root__'

function keyFor(parentID?: string | null): string {
  return parentID || ROOT_KEY
}

function sortByOrder<T extends { sort_order?: number; updated_at?: string; name?: string; title?: string }>(left: T, right: T) {
  const leftSort = Number.isFinite(Number(left.sort_order)) ? Number(left.sort_order) : 0
  const rightSort = Number.isFinite(Number(right.sort_order)) ? Number(right.sort_order) : 0
  if (leftSort !== rightSort) return leftSort - rightSort
  if (left.updated_at && right.updated_at && left.updated_at !== right.updated_at) {
    return right.updated_at.localeCompare(left.updated_at)
  }
  const leftName = (left.name || left.title || '').toLowerCase()
  const rightName = (right.name || right.title || '').toLowerCase()
  return leftName.localeCompare(rightName)
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function buildChildrenMaps(folders: NoteFolder[], notes: Note[]) {
  const folderMap = new Map<string, NoteFolder[]>()
  const noteMap = new Map<string, Note[]>()
  for (const folder of folders) {
    const key = keyFor(normalizeTreeNodeID(folder.parent_id))
    const group = folderMap.get(key) || []
    group.push(folder)
    folderMap.set(key, group)
  }
  for (const [key, group] of folderMap) {
    folderMap.set(key, [...group].sort(sortByOrder))
  }
  for (const note of notes) {
    const key = keyFor(normalizeTreeNodeID(note.folder_id))
    const group = noteMap.get(key) || []
    group.push(note)
    noteMap.set(key, group)
  }
  for (const [key, group] of noteMap) {
    noteMap.set(key, [...group].sort(sortByOrder))
  }
  return { folderMap, noteMap }
}

function flattenTree(
  folderMap: Map<string, NoteFolder[]>,
  noteMap: Map<string, Note[]>,
  expandedFolders: Set<string>,
  parentId: string | null = null,
  depth = 0,
): FlatNode[] {
  const result: FlatNode[] = []
  const key = keyFor(parentId)

  const subFolders = folderMap.get(key) || []
  for (const folder of subFolders) {
    const isExpanded = expandedFolders.has(folder.id)
    result.push({
      uid: `f:${folder.id}`,
      id: folder.id,
      kind: 'folder',
      parentId,
      depth,
      name: folder.name,
      updatedAt: folder.updated_at,
      isExpanded,
    })
    if (isExpanded) {
      result.push(...flattenTree(folderMap, noteMap, expandedFolders, folder.id, depth + 1))
    }
  }

  const subNotes = noteMap.get(key) || []
  for (const note of subNotes) {
    result.push({
      uid: `n:${note.id}`,
      id: note.id,
      kind: 'note',
      parentId,
      depth,
      name: note.title || '无标题笔记',
      updatedAt: note.updated_at,
    })
  }

  return result
}

function computeReorderPayload(
  flatNodes: FlatNode[],
  activeUid: string,
  overUid: string,
  deltaX: number,
  folders: NoteFolder[],
): NoteReorderPayload | null {
  const activeIdx = flatNodes.findIndex((n) => n.uid === activeUid)
  const overIdx = flatNodes.findIndex((n) => n.uid === overUid)
  if (activeIdx < 0 || overIdx < 0) return null

  const activeNode = flatNodes[activeIdx]
  const overNode = flatNodes[overIdx]
  const folderByID = new Map<string, NoteFolder>()
  folders.forEach((f) => folderByID.set(f.id, f))

  // Prevent folder cycle
  if (activeNode.kind === 'folder') {
    let checkId: string | null = overNode.parentId
    while (checkId) {
      if (checkId === activeNode.id) return null
      checkId = normalizeTreeNodeID(folderByID.get(checkId)?.parent_id)
    }
    if (overNode.kind === 'folder' && overNode.id === activeNode.id) return null
  }

  // X-axis outdent: drag left -> move one level up (folder -> parent folder / root)
  if (deltaX < -20 && activeNode.parentId) {
    const currentParent = folderByID.get(activeNode.parentId)
    const outParentId = normalizeTreeNodeID(currentParent?.parent_id)
    const siblings = flatNodes.filter(
      (n) => n.kind === activeNode.kind && n.parentId === outParentId && n.uid !== activeUid,
    )
    const overInSiblings = siblings.findIndex((n) => n.uid === overUid)
    const index = overInSiblings >= 0 ? overInSiblings : siblings.length
    return {
      kind: activeNode.kind,
      item_id: activeNode.id,
      parent_id: outParentId,
      index: Math.max(0, index),
    }
  }

  // X-axis nesting: drag right → nest inside folder above
  if (deltaX > 20) {
    const aboveIdx = overIdx > activeIdx ? overIdx : Math.max(0, overIdx - 1)
    const aboveNode = flatNodes[aboveIdx]
    if (aboveNode && aboveNode.kind === 'folder' && aboveNode.uid !== activeUid) {
      return { kind: activeNode.kind, item_id: activeNode.id, parent_id: aboveNode.id, index: 0 }
    }
  }

  // Item dropped directly ON a folder → put inside (both notes and folders)
  if (overNode.kind === 'folder' && overNode.uid !== activeUid && deltaX > -12) {
    // Extra cycle check: make sure target folder isn't a descendant of the dragged folder
    if (activeNode.kind === 'folder') {
      let checkId2: string | null = overNode.id
      while (checkId2) {
        if (checkId2 === activeNode.id) return null
        checkId2 = normalizeTreeNodeID(folderByID.get(checkId2)?.parent_id)
      }
    }
    return { kind: activeNode.kind, item_id: activeNode.id, parent_id: overNode.id, index: 0 }
  }

  // Standard reorder: same parent as overNode
  const targetParentId = overNode.parentId
  const siblings = flatNodes.filter(
    (n) => n.kind === activeNode.kind && n.parentId === targetParentId && n.uid !== activeUid,
  )
  const overInSiblings = siblings.findIndex((n) => n.uid === overUid)

  let index: number
  if (overInSiblings >= 0) {
    index = activeIdx < overIdx ? overInSiblings + 1 : overInSiblings
  } else {
    index = siblings.length
  }

  // No-op check
  if (activeNode.parentId === targetParentId) {
    const currentSiblings = flatNodes.filter(
      (n) => n.kind === activeNode.kind && n.parentId === targetParentId,
    )
    const currentIdx = currentSiblings.findIndex((n) => n.uid === activeUid)
    if (currentIdx === index) return null
  }

  return { kind: activeNode.kind, item_id: activeNode.id, parent_id: targetParentId, index: Math.max(0, index) }
}

// ---------- SortableTreeItem ----------

interface SortableTreeItemProps {
  node: FlatNode
  isActive: boolean
  isDragSource: boolean
  isHoverExpandTarget: boolean
  isRenaming: boolean
  renamingValue: string
  onToggleFolder: (id: string) => void
  onSelectNote: (id: string) => void
  onStartRename: (kind: 'folder' | 'note', id: string, name: string) => void
  onRenamingValueChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onDeleteNote?: (id: string) => Promise<void> | void
  onDeleteFolder?: (id: string) => Promise<void> | void
  onNodeContextMenu?: (event: ReactMouseEvent, node: { kind: 'folder' | 'note'; id: string }) => void
}

const SortableTreeItemInner = memo(function SortableTreeItemInner({
  node,
  isActive,
  isDragSource,
  isHoverExpandTarget,
  isRenaming,
  renamingValue,
  onToggleFolder,
  onSelectNote,
  onStartRename,
  onRenamingValueChange,
  onCommitRename,
  onCancelRename,
  onDeleteNote,
  onDeleteFolder,
  onNodeContextMenu,
}: SortableTreeItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: node.uid,
    disabled: isRenaming,
    transition: {
      duration: 180,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    },
    animateLayoutChanges: (args) => defaultAnimateLayoutChanges({
      ...args,
      wasDragging: true,
    }),
  })

  const depthPadding = `${8 + node.depth * 14}px`

  const baseStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform ? { ...transform, scaleX: 1, scaleY: 1 } : null),
    transition,
    opacity: isDragging || isDragSource ? 0.58 : 1,
    paddingLeft: depthPadding,
    willChange: 'transform',
    zIndex: isDragging ? 30 : 'auto',
    boxShadow: isDragging ? '0 12px 28px rgba(15,23,42,0.16)' : 'none',
  }

  const isDropTarget = isOver && !isDragging

  if (node.kind === 'folder') {
    return (
      <div
        ref={setNodeRef}
        style={baseStyle}
        {...attributes}
        {...listeners}
        className={`group flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary/70 cursor-grab active:cursor-grabbing transition-colors duration-150
          ${isDropTarget || isHoverExpandTarget ? 'bg-blue-500/15 ring-1 ring-blue-400/60' : ''}`}
        onContextMenu={(event) => {
          if (!onNodeContextMenu) return
          event.preventDefault()
          onNodeContextMenu(event, { kind: 'folder', id: node.id })
        }}
        onDoubleClick={() => onStartRename('folder', node.id, node.name)}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFolder(node.id) }}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded-sm text-text-muted hover:text-text-primary"
          title={node.isExpanded ? '收起' : '展开'}
        >
          <span className={`inline-block transition-transform duration-150 ${node.isExpanded ? 'rotate-90' : 'rotate-0'}`}>▸</span>
        </button>
        {node.isExpanded ? <FolderOpen size={13} className="text-yellow-500" /> : <Folder size={13} className="text-yellow-500" />}
        {isRenaming ? (
          <input
            value={renamingValue}
            onChange={(event) => onRenamingValueChange(event.target.value)}
            onBlur={() => onCommitRename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); onCommitRename() }
              if (event.key === 'Escape') { event.preventDefault(); onCancelRename() }
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            autoFocus
            className="flex-1 min-w-0 rounded border border-primary-400/50 bg-bg-primary px-1.5 py-0.5 text-xs text-text-primary outline-none"
          />
        ) : (
          <span className="truncate text-text-primary flex-1">{node.name}</span>
        )}
        {!isRenaming && onDeleteFolder && (
          <button
            type="button"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); void onDeleteFolder(node.id) }}
            onPointerDown={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-text-muted hover:text-red-500"
            title="删除文件夹"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    )
  }

  // Note item
  return (
    <div
      ref={setNodeRef}
      style={baseStyle}
      {...attributes}
      {...listeners}
      className={`group flex items-center gap-2 rounded-md px-2 py-1 cursor-grab active:cursor-grabbing border-l-2 transition-colors duration-150
        ${isActive ? 'bg-primary-500/10 border-l-primary-400 text-text-primary' : 'border-l-transparent text-text-secondary hover:bg-bg-tertiary/70'}`}
      onClick={() => { if (!isRenaming) onSelectNote(node.id) }}
      onContextMenu={(event) => {
        if (!onNodeContextMenu) return
        event.preventDefault()
        onNodeContextMenu(event, { kind: 'note', id: node.id })
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onStartRename('note', node.id, node.name) }}
      title={node.name}
    >
      <FileText size={13} className="shrink-0 text-sky-500" />
      <div className="min-w-0 flex-1">
        {isRenaming ? (
          <input
            value={renamingValue}
            onChange={(event) => onRenamingValueChange(event.target.value)}
            onBlur={() => onCommitRename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); onCommitRename() }
              if (event.key === 'Escape') { event.preventDefault(); onCancelRename() }
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            autoFocus
            className="w-full min-w-0 rounded border border-primary-400/50 bg-bg-primary px-1.5 py-0.5 text-xs text-text-primary outline-none"
          />
        ) : (
          <>
            <div className="truncate text-xs text-current">{node.name}</div>
            <div className="text-[10px] text-text-muted">{formatDate(node.updatedAt)}</div>
          </>
        )}
      </div>
      {!isRenaming && onDeleteNote && (
        <button
          type="button"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); void onDeleteNote(node.id) }}
          onPointerDown={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-text-muted hover:text-red-500"
          title="删除笔记"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
})

// ---------- DragOverlay preview ----------

function TreeItemPreview({ node }: { node: FlatNode | undefined }) {
  if (!node) return null
  return (
    <div
      className="flex items-center gap-2 rounded-md bg-bg-secondary px-3 py-1.5 text-xs shadow-lg ring-1 ring-border-primary/50 opacity-90 pointer-events-none"
      style={{ width: 180 }}
    >
      {node.kind === 'folder'
        ? <Folder size={13} className="text-yellow-500" />
        : <FileText size={13} className="text-sky-500" />}
      <span className="truncate text-text-primary">{node.name}</span>
    </div>
  )
}

function OverlayPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

// ---------- Main component ----------

function NoteSidebar({
  folders,
  notes,
  activeNoteId,
  backlinks,
  onSelectNote,
  onRenameNote,
  onNewNote,
  onSearch,
  onCreateFolder,
  onDeleteNote,
  onDeleteFolder,
  onRenameFolder,
  onReorder,
  onNodeContextMenu,
  onBlankContextMenu,
}: NoteSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  // Inline rename
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null)
  const [renamingNodeKind, setRenamingNodeKind] = useState<'folder' | 'note' | null>(null)
  const [renamingValue, setRenamingValue] = useState('')

  // dnd-kit state
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const dragDeltaXRef = useRef(0)

  // Hover-to-expand
  const expandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredFolderUidRef = useRef<string | null>(null)
  const [hoverExpandTarget, setHoverExpandTarget] = useState<string | null>(null)

  const searchTimerRef = useRef<number | null>(null)

  // Persist expanded folders
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('notes_tree_expanded')
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setExpandedFolders(new Set(parsed.filter((item) => typeof item === 'string')))
      }
    } catch { /* noop */ }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('notes_tree_expanded', JSON.stringify([...expandedFolders]))
    } catch { /* noop */ }
  }, [expandedFolders])

  useEffect(() => () => {
    if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current)
    if (expandTimeoutRef.current) clearTimeout(expandTimeoutRef.current)
  }, [])

  // --- Hover-to-expand ---
  const clearExpandTimeout = useCallback(() => {
    if (expandTimeoutRef.current) {
      clearTimeout(expandTimeoutRef.current)
      expandTimeoutRef.current = null
    }
    hoveredFolderUidRef.current = null
    setHoverExpandTarget(null)
  }, [])

  // --- Build flat tree ---
  const { folderMap, noteMap } = useMemo(
    () => buildChildrenMaps(folders, notes),
    [folders, notes],
  )

  const flatNodes = useMemo(
    () => flattenTree(folderMap, noteMap, expandedFolders),
    [folderMap, noteMap, expandedFolders],
  )

  const flatNodeIds = useMemo(() => flatNodes.map((n) => n.uid), [flatNodes])

  const nodeByUid = useMemo(() => {
    const map = new Map<string, FlatNode>()
    flatNodes.forEach((n) => map.set(n.uid, n))
    return map
  }, [flatNodes])

  // --- dnd-kit sensors ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // --- dnd-kit callbacks ---
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveUid(event.active.id as string)
    dragDeltaXRef.current = 0
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over, delta } = event
    dragDeltaXRef.current = delta.x

    if (!over) { clearExpandTimeout(); return }

    const overUid = over.id as string
    const overNode = nodeByUid.get(overUid)
    if (!overNode) { clearExpandTimeout(); return }

    // Hover-to-expand collapsed folders
    if (overNode.kind === 'folder' && !overNode.isExpanded) {
      if (overUid !== hoveredFolderUidRef.current) {
        clearExpandTimeout()
        hoveredFolderUidRef.current = overUid
        setHoverExpandTarget(overNode.id)
        expandTimeoutRef.current = setTimeout(() => {
          setExpandedFolders((prev) => {
            if (prev.has(overNode.id)) return prev
            const next = new Set(prev)
            next.add(overNode.id)
            return next
          })
          expandTimeoutRef.current = null
          hoveredFolderUidRef.current = null
          setHoverExpandTarget(null)
        }, 500)
      }
    } else if (hoveredFolderUidRef.current !== overUid) {
      clearExpandTimeout()
    }
  }, [clearExpandTimeout, nodeByUid])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    clearExpandTimeout()
    const { active, over } = event
    setActiveUid(null)

    if (!over || active.id === over.id || !onReorder) return

    const payload = computeReorderPayload(
      flatNodes,
      active.id as string,
      over.id as string,
      dragDeltaXRef.current,
      folders,
    )
    if (payload) void onReorder(payload)
  }, [clearExpandTimeout, flatNodes, folders, onReorder])

  const handleDragCancel = useCallback(() => {
    clearExpandTimeout()
    setActiveUid(null)
  }, [clearExpandTimeout])

  // --- UI callbacks ---
  const toggleFolder = useCallback((folderID: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderID)) next.delete(folderID)
      else next.add(folderID)
      return next
    })
  }, [])

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value)
    if (searchTimerRef.current != null) window.clearTimeout(searchTimerRef.current)
    searchTimerRef.current = window.setTimeout(() => { onSearch(value) }, 300)
  }, [onSearch])

  const startRename = useCallback((kind: 'folder' | 'note', id: string, currentName: string) => {
    setRenamingNodeId(id)
    setRenamingNodeKind(kind)
    setRenamingValue(currentName)
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingNodeId(null)
    setRenamingNodeKind(null)
    setRenamingValue('')
  }, [])

  const commitRename = useCallback(async () => {
    if (!renamingNodeId || !renamingNodeKind) { cancelRename(); return }
    const nextName = renamingValue.trim()
    if (!nextName) { cancelRename(); return }
    try {
      if (renamingNodeKind === 'folder' && onRenameFolder) {
        await onRenameFolder(renamingNodeId, nextName)
      } else if (renamingNodeKind === 'note' && onRenameNote) {
        await onRenameNote(renamingNodeId, nextName)
      }
    } finally {
      cancelRename()
    }
  }, [cancelRename, onRenameFolder, onRenameNote, renamingNodeId, renamingNodeKind, renamingValue])

  const activeNode = activeUid ? nodeByUid.get(activeUid) : undefined

  const showEmpty = folders.length === 0 && notes.length === 0

  return (
    <div
      data-testid="notes-tree-sidebar"
      className="flex h-full min-h-0 flex-col border-r border-border-primary bg-bg-secondary/40"
      onContextMenu={(event) => {
        if (!onBlankContextMenu) return
        event.preventDefault()
        onBlankContextMenu(event)
      }}
    >
      {/* Header */}
      <div className="border-b border-border-primary p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-text-primary">Notes</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onCreateFolder(null)}
              data-testid="notes-tree-create-folder-root"
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
              title="新建文件夹"
            >
              <Folder size={14} />
            </button>
            <button
              type="button"
              onClick={() => onNewNote(null)}
              data-testid="notes-tree-create-note-root"
              className="rounded p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
              title="新建笔记"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            data-testid="notes-tree-search-input"
            value={searchQuery}
            onChange={(event) => handleSearch(event.target.value)}
            placeholder="搜索或 #tag"
            className="h-8 w-full rounded-lg border border-border-primary bg-bg-tertiary pl-7 pr-2 text-xs text-text-primary outline-none transition-colors focus:border-primary-400/60"
          />
        </div>
      </div>

      {/* Tree area */}
      <div className="flex-1 overflow-auto px-1.5 py-2">
        {showEmpty ? (
          <div className="px-2 py-6 text-center text-xs text-text-muted">还没有笔记，点击 + 创建</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={flatNodeIds} strategy={verticalListSortingStrategy}>
              {flatNodes.map((node) => {
                const isNodeRenaming = renamingNodeId === node.id && renamingNodeKind === node.kind
                return (
                  <SortableTreeItemInner
                    key={node.uid}
                    node={node}
                    isActive={node.kind === 'note' && activeNoteId === node.id}
                    isDragSource={activeUid === node.uid}
                    isHoverExpandTarget={hoverExpandTarget === node.id && node.kind === 'folder'}
                    isRenaming={isNodeRenaming}
                    renamingValue={isNodeRenaming ? renamingValue : ''}
                    onToggleFolder={toggleFolder}
                    onSelectNote={onSelectNote}
                    onStartRename={startRename}
                    onRenamingValueChange={setRenamingValue}
                    onCommitRename={commitRename}
                    onCancelRename={cancelRename}
                    onDeleteNote={onDeleteNote}
                    onDeleteFolder={onDeleteFolder}
                    onNodeContextMenu={onNodeContextMenu}
                  />
                )
              })}
            </SortableContext>

            <OverlayPortal>
              <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
                {activeUid ? <TreeItemPreview node={activeNode} /> : null}
              </DragOverlay>
            </OverlayPortal>
          </DndContext>
        )}
      </div>

      {/* Backlinks */}
      {backlinks && backlinks.length > 0 && (
        <div className="border-t border-border-primary p-2">
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-text-muted">Backlinks</p>
          <div className="space-y-1">
            {backlinks.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => onSelectNote(note.id)}
                className="w-full truncate rounded px-1.5 py-1 text-left text-[11px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
              >
                ← {note.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(NoteSidebar)
