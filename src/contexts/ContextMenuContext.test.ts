import { describe, expect, it, vi } from 'vitest'

import { createGlobalContextMenuItems } from './ContextMenuContext'

describe('createGlobalContextMenuItems', () => {
  it('returns global fallback actions in stable order', async () => {
    const onBack = vi.fn()
    const onForward = vi.fn()
    const onReload = vi.fn()
    const onCopyPath = vi.fn(async () => {})

    const items = createGlobalContextMenuItems({
      onBack,
      onForward,
      onReload,
      onCopyPath,
    })

    expect(items.map((item) => item.id)).toEqual([
      'global-back',
      'global-forward',
      'global-reload',
      'sep-1',
      'global-copy-path',
    ])

    await items[0].onSelect?.()
    await items[1].onSelect?.()
    await items[2].onSelect?.()
    await items[4].onSelect?.()

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onForward).toHaveBeenCalledTimes(1)
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onCopyPath).toHaveBeenCalledTimes(1)
  })
})
