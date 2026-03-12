import { expect, test, type Page, type Route } from '@playwright/test'

interface MockFolder {
  id: string
  student_id: string
  name: string
  parent_id: string | null
  path: string
  sort_order: number
  created_at: string
  updated_at: string
}

interface MockNote {
  id: string
  student_id: string
  title: string
  content: string
  folder: string
  folder_id: string | null
  sort_order: number
  tags: string[]
  is_public: boolean
  word_count: number
  created_at: string
  updated_at: string
}

interface MockState {
  folders: MockFolder[]
  notes: MockNote[]
  reorderCalls: number
  updateCalls: number
  completeCalls: number
  inlineCompletion: string
  lastReorderPayload: ReorderPayload | null
}

interface ReorderPayload {
  kind: 'note' | 'folder'
  item_id: string
  parent_id?: string | null
  index: number
}

function nowISO(): string {
  return new Date().toISOString()
}

function createInitialState(): MockState {
  const createdAt = '2026-02-25T00:00:00.000Z'
  return {
    folders: [
      {
        id: 'folder-work',
        student_id: 'student-e2e',
        name: 'Work',
        parent_id: null,
        path: '/Work',
        sort_order: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    notes: [
      {
        id: 'note-1',
        student_id: 'student-e2e',
        title: 'Alpha Note',
        content: 'First line\nSecond line',
        folder: '/',
        folder_id: null,
        sort_order: 0,
        tags: ['focus'],
        is_public: false,
        word_count: 2,
        created_at: createdAt,
        updated_at: createdAt,
      },
      {
        id: 'note-2',
        student_id: 'student-e2e',
        title: 'Beta Note',
        content: 'Beta content',
        folder: '/',
        folder_id: null,
        sort_order: 1,
        tags: [],
        is_public: false,
        word_count: 2,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    reorderCalls: 0,
    updateCalls: 0,
    completeCalls: 0,
    inlineCompletion: '',
    lastReorderPayload: null,
  }
}

function normalizeNullableID(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function clampIndex(index: number, size: number): number {
  return Math.max(0, Math.min(index, size))
}

function sortByOrder<T extends { sort_order: number; id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order
    return left.id.localeCompare(right.id)
  })
}

function resequenceNotes(state: MockState, parentID: string | null) {
  const group = sortByOrder(state.notes.filter((item) => (item.folder_id || null) === parentID))
  group.forEach((item, index) => {
    item.sort_order = index
  })
}

function resequenceFolders(state: MockState, parentID: string | null) {
  const group = sortByOrder(state.folders.filter((item) => (item.parent_id || null) === parentID))
  group.forEach((item, index) => {
    item.sort_order = index
  })
}

function applyReorder(state: MockState, payload: ReorderPayload): boolean {
  if (payload.kind === 'note') {
    const moving = state.notes.find((item) => item.id === payload.item_id)
    if (!moving) return false
    const oldParent = moving.folder_id || null
    const nextParent = normalizeNullableID(payload.parent_id)

    moving.folder_id = nextParent
    if (nextParent) {
      const parent = state.folders.find((item) => item.id === nextParent)
      moving.folder = parent?.path || '/'
    } else {
      moving.folder = '/'
    }
    moving.updated_at = nowISO()

    const siblings = sortByOrder(
      state.notes.filter((item) => (item.folder_id || null) === nextParent && item.id !== moving.id),
    )
    siblings.splice(clampIndex(payload.index, siblings.length), 0, moving)
    siblings.forEach((item, index) => {
      item.sort_order = index
    })

    if (oldParent !== nextParent) {
      resequenceNotes(state, oldParent)
    }
    return true
  }

  const moving = state.folders.find((item) => item.id === payload.item_id)
  if (!moving) return false

  const oldParent = moving.parent_id || null
  const nextParent = normalizeNullableID(payload.parent_id)
  moving.parent_id = nextParent

  const nextParentPath = nextParent
    ? state.folders.find((item) => item.id === nextParent)?.path || '/'
    : '/'
  moving.path = nextParentPath === '/' ? `/${moving.name}` : `${nextParentPath}/${moving.name}`
  moving.updated_at = nowISO()

  const siblings = sortByOrder(
    state.folders.filter((item) => (item.parent_id || null) === nextParent && item.id !== moving.id),
  )
  siblings.splice(clampIndex(payload.index, siblings.length), 0, moving)
  siblings.forEach((item, index) => {
    item.sort_order = index
  })

  if (oldParent !== nextParent) {
    resequenceFolders(state, oldParent)
  }
  return true
}

async function jsonResponse(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  })
}

function parseBody(requestBody: string | null): Record<string, unknown> {
  if (!requestBody) return {}
  try {
    return JSON.parse(requestBody) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function attachApiMock(page: Page, state: MockState) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method().toUpperCase()
    const url = new URL(request.url())
    const path = url.pathname

    if (method === 'GET' && path === '/api/auth/me') {
      return jsonResponse(route, {
        user: {
          id: 'student-e2e',
          username: 'e2e-user',
          email: 'e2e@example.com',
          role: 'student',
        },
      })
    }

    if (method === 'POST' && path === '/api/auth/refresh') {
      return jsonResponse(route, { token: 'playwright-token' })
    }

    if (method === 'GET' && path === '/api/notes/tree') {
      return jsonResponse(route, {
        folders: sortByOrder(state.folders),
        notes: sortByOrder(state.notes),
      })
    }

    if (method === 'GET' && path === '/api/notes') {
      return jsonResponse(route, {
        notes: sortByOrder(state.notes),
        total: state.notes.length,
      })
    }

    if (method === 'POST' && path === '/api/notes/reorder') {
      const body = parseBody(request.postData())
      const payload: ReorderPayload = {
        kind: body.kind === 'folder' ? 'folder' : 'note',
        item_id: String(body.item_id || ''),
        parent_id: normalizeNullableID(body.parent_id),
        index: Number.isFinite(Number(body.index)) ? Number(body.index) : 0,
      }
      state.reorderCalls += 1
      state.lastReorderPayload = payload
      const ok = applyReorder(state, payload)
      if (!ok) {
        return jsonResponse(route, { error: 'item not found' }, 404)
      }
      return jsonResponse(route, { ok: true })
    }

    if (method === 'POST' && path === '/api/notes') {
      const body = parseBody(request.postData())
      const nextID = `note-${state.notes.length + 1}`
      const folderID = normalizeNullableID(body.folder_id)
      const folderPath = folderID
        ? state.folders.find((item) => item.id === folderID)?.path || '/'
        : '/'
      const note: MockNote = {
        id: nextID,
        student_id: 'student-e2e',
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '无标题笔记',
        content: typeof body.content === 'string' ? body.content : '',
        folder: folderPath,
        folder_id: folderID,
        sort_order: state.notes.filter((item) => (item.folder_id || null) === folderID).length,
        tags: [],
        is_public: false,
        word_count: 0,
        created_at: nowISO(),
        updated_at: nowISO(),
      }
      state.notes.push(note)
      return jsonResponse(route, note, 201)
    }

    const backlinksMatch = path.match(/^\/api\/notes\/([^/]+)\/backlinks$/)
    if (method === 'GET' && backlinksMatch) {
      return jsonResponse(route, [])
    }

    const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/)
    if (noteMatch) {
      const noteID = decodeURIComponent(noteMatch[1])
      const note = state.notes.find((item) => item.id === noteID)
      if (!note) {
        return jsonResponse(route, { error: 'note not found' }, 404)
      }

      if (method === 'GET') {
        return jsonResponse(route, note)
      }

      if (method === 'PUT') {
        const body = parseBody(request.postData())
        if (typeof body.title === 'string') note.title = body.title.trim() || '无标题笔记'
        if (typeof body.content === 'string') note.content = body.content
        if (Array.isArray(body.tags)) {
          note.tags = body.tags.map((item) => String(item)).filter(Boolean)
        }

        if (Object.prototype.hasOwnProperty.call(body, 'folder_id')) {
          const folderID = normalizeNullableID(body.folder_id)
          note.folder_id = folderID
          if (folderID) {
            const folder = state.folders.find((item) => item.id === folderID)
            note.folder = folder?.path || '/'
          } else {
            note.folder = '/'
          }
        } else if (typeof body.folder === 'string') {
          note.folder = body.folder.trim() || '/'
        }

        if (Number.isFinite(Number(body.sort_order))) {
          note.sort_order = Number(body.sort_order)
        }

        note.updated_at = nowISO()
        state.updateCalls += 1
        return jsonResponse(route, note)
      }

      if (method === 'DELETE') {
        state.notes = state.notes.filter((item) => item.id !== note.id)
        return route.fulfill({ status: 204 })
      }
    }

    if (method === 'POST' && path === '/api/complete') {
      state.completeCalls += 1
      return jsonResponse(route, { completion: state.inlineCompletion })
    }

    if (path.startsWith('/api/agent/')) {
      if (method === 'GET' && path === '/api/agent/tools') return jsonResponse(route, {})
      if (method === 'GET' && path === '/api/agent/skills') return jsonResponse(route, [])
      if (method === 'GET' && path === '/api/agent/list') return jsonResponse(route, [])
      if (method === 'GET' && path.startsWith('/api/agent/') && path.endsWith('/capabilities')) {
        return jsonResponse(route, { name: 'quick-qa', capabilities: [] })
      }
      if (method === 'GET' && path === '/api/agent/sessions') return jsonResponse(route, [])
      if (method === 'DELETE' && path === '/api/agent/sessions') return route.fulfill({ status: 204 })
      if (method === 'GET' && path === '/api/agent/approvals/metrics') {
        return jsonResponse(route, { pending_total: 0, by_risk: {} })
      }
      return jsonResponse(route, {})
    }

    return jsonResponse(route, {})
  })
}

async function openNotes(page: Page): Promise<MockState> {
  const state = createInitialState()
  await page.addInitScript(() => {
    window.localStorage.setItem('token', 'playwright-token')
  })
  await attachApiMock(page, state)
  await page.goto('/notes/note-1')
  await expect(page.getByTestId('notes-title-input')).toHaveValue('Alpha Note')
  await expect(page.getByTestId('notes-tree-note-note-1')).toBeVisible()
  await expect(page.getByTestId('notes-editor-context-zone')).toBeVisible()
  return state
}

async function getVisibleTreeNoteIDs(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="notes-tree-note-"]').evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-testid') || '').filter(Boolean),
  )
}

test('left sidebar width drag persists after reload', async ({ page }) => {
  await openNotes(page)

  const panel = page.getByTestId('notes-sidebar-panel')
  const handle = page.getByTestId('notes-sidebar-resize-handle')
  await expect(panel).toBeVisible()
  await expect(handle).toBeVisible()

  const initialWidth = await panel.evaluate((el) => Math.round(el.getBoundingClientRect().width))
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('sidebar resize handle is not visible')

  const startX = handleBox.x + handleBox.width / 2
  const y = handleBox.y + handleBox.height / 2
  await handle.dispatchEvent('mousedown', { clientX: startX, clientY: y, bubbles: true, button: 0 })
  await page.evaluate(({ x, y: moveY }) => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: moveY, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: moveY, bubbles: true }))
  }, { x: startX + 96, y })

  await expect.poll(async () =>
    Number(await page.evaluate(() => window.localStorage.getItem('notes_sidebar_width') || '0'))).toBeGreaterThan(initialWidth + 40)

  const resizedWidth = await page.evaluate(() => Number(window.localStorage.getItem('notes_sidebar_width') || '0'))
  await page.reload()
  await expect(page.getByTestId('notes-sidebar-panel')).toBeVisible()
  await expect.poll(async () =>
    Number(await page.evaluate(() => window.localStorage.getItem('notes_sidebar_width') || '0'))).toBe(resizedWidth)
})

test('tree reorder persists after refresh', async ({ page }) => {
  const state = await openNotes(page)

  const before = await getVisibleTreeNoteIDs(page)
  expect(before.slice(0, 2)).toEqual(['notes-tree-note-note-1', 'notes-tree-note-note-2'])

  const source = page.getByTestId('notes-tree-note-note-1')
  const target = page.getByTestId('notes-tree-note-note-2')
  const targetBox = await target.boundingBox()
  if (!targetBox) throw new Error('target note is not visible')
  const dragData = await page.evaluateHandle(() => new DataTransfer())

  await source.dispatchEvent('dragstart', { dataTransfer: dragData })
  await target.dispatchEvent('dragenter', { dataTransfer: dragData })
  await target.dispatchEvent('dragover', {
    dataTransfer: dragData,
    clientY: targetBox.y + targetBox.height - 2,
  })
  await target.dispatchEvent('drop', {
    dataTransfer: dragData,
    clientY: targetBox.y + targetBox.height - 2,
  })
  await source.dispatchEvent('dragend', { dataTransfer: dragData })

  await expect.poll(() => state.reorderCalls).toBeGreaterThan(0)
  await expect.poll(() => state.lastReorderPayload).toMatchObject({
    kind: 'note',
    item_id: 'note-1',
  })
  await expect.poll(async () => {
    const order = await getVisibleTreeNoteIDs(page)
    return order.slice(0, 2)
  }).toEqual(['notes-tree-note-note-2', 'notes-tree-note-note-1'])

  await page.reload()
  await expect.poll(async () => {
    const order = await getVisibleTreeNoteIDs(page)
    return order.slice(0, 2)
  }).toEqual(['notes-tree-note-note-2', 'notes-tree-note-note-1'])
})

test('title update syncs top bar, tree, and agent panel', async ({ page }) => {
  await openNotes(page)
  const nextTitle = 'Alpha Note Renamed'

  const titleInput = page.getByTestId('notes-title-input')
  await titleInput.fill(nextTitle)
  await expect(page.getByTestId('notes-tree-note-note-1')).toContainText(nextTitle)

  await page.getByTestId('notes-agent-toggle').click()
  await expect(page.getByText(`当前笔记：${nextTitle}`, { exact: false })).toBeVisible()
})

test('switching notes does not snap back to previous note', async ({ page }) => {
  await openNotes(page)

  await page.getByTestId('notes-tree-note-note-2').click()
  await expect(page).toHaveURL(/\/notes\/note-2$/)
  await expect(page.getByTestId('notes-title-input')).toHaveValue('Beta Note')

  await page.waitForTimeout(350)
  await expect(page).toHaveURL(/\/notes\/note-2$/)
  await expect(page.getByTestId('notes-title-input')).toHaveValue('Beta Note')

  await page.getByTestId('notes-tree-note-note-1').click()
  await expect(page).toHaveURL(/\/notes\/note-1$/)
  await expect(page.getByTestId('notes-title-input')).toHaveValue('Alpha Note')
})

test('tab accepts inline completion response', async ({ page }) => {
  const state = await openNotes(page)
  state.inlineCompletion = ' world'
  await page.getByTestId('notes-inline-mode-toggle').click()

  const editorContent = page.locator('.cm-content').first()
  await editorContent.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('hello')

  await page.keyboard.press('Tab')
  await expect.poll(() => state.completeCalls).toBeGreaterThan(0)
  await page.keyboard.press('Tab')

  await expect.poll(async () => (await editorContent.innerText()).replace(/\s+/g, ' ').trim())
    .toMatch(/hello\s*world/i)
})

test('editor uses custom context menu and action closes menu', async ({ page }) => {
  await openNotes(page)

  const editorZone = page.getByTestId('notes-editor-context-zone')
  await editorZone.click({ button: 'right' })

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Select All' })).toBeVisible()

  await page.getByRole('menuitem', { name: 'Select All' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
})
