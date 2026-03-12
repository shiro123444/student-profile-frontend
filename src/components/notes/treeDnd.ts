import type { Note, NoteFolder, NoteReorderPayload } from '../../services/api'

export interface TreeDropPreview {
  targetType: 'folder' | 'note' | 'root'
  targetId: string | null
  position: 'before' | 'after' | 'inside'
}

export interface DraggingTreeNode {
  kind: 'folder' | 'note'
  id: string
}

const ROOT_KEY = '__root__'

export function normalizeTreeNodeID(id?: string | null): string | null {
  if (!id) return null
  const trimmed = id.trim()
  return trimmed.length > 0 ? trimmed : null
}

function keyFor(parentID?: string | null): string {
  return parentID || ROOT_KEY
}

function findIndexByID<T extends { id: string }>(items: T[], id: string): number {
  return items.findIndex((item) => item.id === id)
}

function computeIndexWithinSiblings<T extends { id: string }>(
  siblings: T[],
  draggingID: string,
  targetID: string,
  position: 'before' | 'after',
): number | null {
  const targetIndex = findIndexByID(siblings, targetID)
  if (targetIndex < 0) return null

  let index = position === 'after' ? targetIndex + 1 : targetIndex
  const sourceIndex = findIndexByID(siblings, draggingID)
  if (sourceIndex >= 0 && sourceIndex < index) {
    index -= 1
  }
  return Math.max(0, index)
}

function isNoopMove<T extends { id: string }>(siblings: T[], draggingID: string, index: number): boolean {
  const sourceIndex = findIndexByID(siblings, draggingID)
  return sourceIndex >= 0 && sourceIndex === index
}

function wouldCreateFolderCycle(
  draggingID: string,
  nextParentID: string | null,
  folderByID: Map<string, NoteFolder>,
): boolean {
  if (!nextParentID) return false
  if (nextParentID === draggingID) return true

  const draggingFolder = folderByID.get(draggingID)
  const nextParent = folderByID.get(nextParentID)
  if (!draggingFolder || !nextParent) return false
  return nextParent.path.startsWith(`${draggingFolder.path}/`)
}

/**
 * Three-zone hitbox calculation (improved for better UX):
 * - Folders: top 25% = before, middle 50% = inside, bottom 25% = after
 * - Notes (when dragging a note): top 25% = before, middle 50% = inside-parent, bottom 25% = after
 *   "inside-parent" means drop into the note's parent folder — this allows dragging
 *   a note over another note to place it in the same folder
 * - Notes (when dragging a folder): only before/after (50/50)
 */
export function resolveDropPreview(
  clientY: number,
  rectTop: number,
  rectHeight: number,
  targetType: 'folder' | 'note',
  targetID: string,
  draggingKind?: 'folder' | 'note',
): TreeDropPreview {
  const ratio = (clientY - rectTop) / Math.max(1, rectHeight)
  if (targetType === 'folder') {
    if (ratio < 0.25) {
      return { targetType, targetId: targetID, position: 'before' }
    }
    if (ratio > 0.75) {
      return { targetType, targetId: targetID, position: 'after' }
    }
    return { targetType, targetId: targetID, position: 'inside' }
  }
  // For notes: if a note is being dragged, use three-zone (top 25% before, middle 50% inside, bottom 25% after)
  // "inside" on a note means "move into the same parent folder as this note" — this is used
  // to signal visual highlight and to allow cross-parent drops
  if (draggingKind === 'note') {
    if (ratio < 0.25) {
      return { targetType, targetId: targetID, position: 'before' }
    }
    if (ratio > 0.75) {
      return { targetType, targetId: targetID, position: 'after' }
    }
    // Middle zone on a note — treat as "drop into this note's parent folder"
    return { targetType, targetId: targetID, position: 'inside' }
  }
  return {
    targetType,
    targetId: targetID,
    position: ratio > 0.5 ? 'after' : 'before',
  }
}

interface BuildTreeReorderPayloadOptions {
  dragging: DraggingTreeNode
  preview: TreeDropPreview
  folderByID: Map<string, NoteFolder>
  noteByID: Map<string, Note>
  folderChildrenMap: Map<string, NoteFolder[]>
  noteChildrenMap: Map<string, Note[]>
}

export function buildTreeReorderPayload(
  options: BuildTreeReorderPayloadOptions,
): NoteReorderPayload | null {
  const {
    dragging,
    preview,
    folderByID,
    noteByID,
    folderChildrenMap,
    noteChildrenMap,
  } = options

  if (dragging.kind === 'note') {
    if (preview.targetType === 'note' && preview.targetId) {
      const target = noteByID.get(preview.targetId)
      if (!target) return null

      if (preview.position === 'inside') {
        // "inside" on a note: move dragged note into the target note's parent folder
        // at the position right after the target note
        const parentID = normalizeTreeNodeID(target.folder_id)
        const siblings = noteChildrenMap.get(keyFor(parentID)) || []
        const targetIdx = findIndexByID(siblings, target.id)
        const sourceIdx = findIndexByID(siblings, dragging.id)
        let index = targetIdx >= 0 ? targetIdx + 1 : siblings.length
        if (sourceIdx >= 0 && sourceIdx < index) {
          index -= 1
        }
        // Check if this is a no-op (same parent, same position)
        const currentParent = normalizeTreeNodeID(noteByID.get(dragging.id)?.folder_id)
        if (currentParent === parentID && isNoopMove(siblings, dragging.id, index)) return null
        return {
          kind: 'note',
          item_id: dragging.id,
          parent_id: parentID,
          index,
        }
      }

      const parentID = normalizeTreeNodeID(target.folder_id)
      const siblings = noteChildrenMap.get(keyFor(parentID)) || []
      const index = computeIndexWithinSiblings(siblings, dragging.id, target.id, preview.position)
      if (index == null) return null
      // For cross-parent moves, don't check noop on wrong sibling list
      const currentParent = normalizeTreeNodeID(noteByID.get(dragging.id)?.folder_id)
      if (currentParent === parentID && isNoopMove(siblings, dragging.id, index)) return null
      return {
        kind: 'note',
        item_id: dragging.id,
        parent_id: parentID,
        index,
      }
    }

    if (preview.targetType === 'folder' && preview.targetId) {
      if (preview.position === 'inside') {
        // Drop note into folder - place at end
        const parentID = preview.targetId
        const siblings = noteChildrenMap.get(keyFor(parentID)) || []
        const currentParent = normalizeTreeNodeID(noteByID.get(dragging.id)?.folder_id)

        // If already in this folder, keep current position
        if (currentParent === parentID) {
          const sourceIndex = findIndexByID(siblings, dragging.id)
          if (sourceIndex >= 0) return null // No-op
        }

        // Place at end of folder
        const index = siblings.length
        return {
          kind: 'note',
          item_id: dragging.id,
          parent_id: parentID,
          index,
        }
      }
      // before/after a folder: place note at the same level as the folder
      const targetFolder = folderByID.get(preview.targetId)
      if (!targetFolder) return null
      const parentID = normalizeTreeNodeID(targetFolder.parent_id)
      const siblings = noteChildrenMap.get(keyFor(parentID)) || []

      // For simplicity: before = start, after = end
      const index = preview.position === 'before' ? 0 : siblings.length
      const sourceIndex = findIndexByID(siblings, dragging.id)
      if (sourceIndex >= 0 && sourceIndex < index) {
        return {
          kind: 'note',
          item_id: dragging.id,
          parent_id: parentID,
          index: index - 1,
        }
      }

      return {
        kind: 'note',
        item_id: dragging.id,
        parent_id: parentID,
        index,
      }
    }

    if (preview.targetType === 'root') {
      const siblings = noteChildrenMap.get(ROOT_KEY) || []
      const sourceIndex = findIndexByID(siblings, dragging.id)
      const index = sourceIndex >= 0 ? Math.max(0, siblings.length - 1) : siblings.length
      if (isNoopMove(siblings, dragging.id, index)) return null
      return {
        kind: 'note',
        item_id: dragging.id,
        parent_id: null,
        index,
      }
    }

    return null
  }

  if (preview.targetType === 'note') {
    return null
  }

  if (preview.targetType === 'folder' && preview.targetId) {
    const target = folderByID.get(preview.targetId)
    if (!target) return null
    if (target.id === dragging.id) return null

    if (preview.position === 'inside') {
      if (wouldCreateFolderCycle(dragging.id, target.id, folderByID)) return null
      const siblings = folderChildrenMap.get(keyFor(target.id)) || []
      const sourceIndex = findIndexByID(siblings, dragging.id)
      const index = sourceIndex >= 0 ? Math.max(0, siblings.length - 1) : siblings.length
      if (isNoopMove(siblings, dragging.id, index)) return null
      return {
        kind: 'folder',
        item_id: dragging.id,
        parent_id: target.id,
        index,
      }
    }

    const parentID = normalizeTreeNodeID(target.parent_id)
    if (wouldCreateFolderCycle(dragging.id, parentID, folderByID)) return null
    const siblings = folderChildrenMap.get(keyFor(parentID)) || []
    const index = computeIndexWithinSiblings(siblings, dragging.id, target.id, preview.position)
    if (index == null || isNoopMove(siblings, dragging.id, index)) return null
    return {
      kind: 'folder',
      item_id: dragging.id,
      parent_id: parentID,
      index,
    }
  }

  const siblings = folderChildrenMap.get(ROOT_KEY) || []
  const sourceIndex = findIndexByID(siblings, dragging.id)
  const index = sourceIndex >= 0 ? Math.max(0, siblings.length - 1) : siblings.length
  if (isNoopMove(siblings, dragging.id, index)) return null
  return {
    kind: 'folder',
    item_id: dragging.id,
    parent_id: null,
    index,
  }
}
