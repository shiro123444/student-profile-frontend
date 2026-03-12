import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  onSelect?: () => void | Promise<void>
}

interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface ContextMenuContextValue {
  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void
  closeContextMenu: () => void
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null)

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fallback below
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    const result = document.execCommand('copy')
    document.body.removeChild(textarea)
    return result
  } catch {
    return false
  }
}

function clampPoint(x: number, y: number, itemCount: number): { x: number; y: number } {
  const menuWidth = 220
  const menuHeight = Math.max(52, itemCount * 30 + 10)
  const maxX = Math.max(8, window.innerWidth - menuWidth - 8)
  const maxY = Math.max(8, window.innerHeight - menuHeight - 8)
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(8, y), maxY),
  }
}

interface GlobalContextMenuActionHandlers {
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onCopyPath: () => Promise<void>
}

export function createGlobalContextMenuItems(
  handlers: GlobalContextMenuActionHandlers,
): ContextMenuItem[] {
  return [
    {
      id: 'global-back',
      label: '返回',
      shortcut: 'Alt+←',
      onSelect: handlers.onBack,
    },
    {
      id: 'global-forward',
      label: '前进',
      shortcut: 'Alt+→',
      onSelect: handlers.onForward,
    },
    {
      id: 'global-reload',
      label: '刷新',
      shortcut: 'Ctrl/Cmd+R',
      onSelect: handlers.onReload,
    },
    { id: 'sep-1', label: '', separator: true },
    {
      id: 'global-copy-path',
      label: '复制页面路径',
      onSelect: handlers.onCopyPath,
    },
  ]
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const closeContextMenu = useCallback(() => {
    setMenu(null)
  }, [])

  const openContextMenu = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    if (!Array.isArray(items) || items.length === 0) {
      setMenu(null)
      return
    }
    const point = clampPoint(x, y, items.length)
    setMenu({ x: point.x, y: point.y, items })
  }, [])

  const runAction = useCallback(async (item: ContextMenuItem) => {
    if (item.disabled) return
    closeContextMenu()
    try {
      await item.onSelect?.()
    } catch {
      // swallow to keep menu infra stable
    }
  }, [closeContextMenu])

  const buildGlobalItems = useCallback((): ContextMenuItem[] => {
    return createGlobalContextMenuItems({
      onBack: () => window.history.back(),
      onForward: () => window.history.forward(),
      onReload: () => window.location.reload(),
      onCopyPath: async () => {
        const path = `${window.location.pathname}${window.location.search}${window.location.hash}`
        await copyText(path)
      },
    })
  }, [])

  useEffect(() => {
    const close = () => closeContextMenu()
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu()
    }

    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onEscape)
    }
  }, [closeContextMenu])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-context-menu-native="true"]')) return
      event.preventDefault()
      openContextMenu(event.clientX, event.clientY, buildGlobalItems())
    }

    window.addEventListener('contextmenu', handler)
    return () => window.removeEventListener('contextmenu', handler)
  }, [buildGlobalItems, openContextMenu])

  const value = useMemo<ContextMenuContextValue>(() => ({
    openContextMenu,
    closeContextMenu,
  }), [closeContextMenu, openContextMenu])

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      {menu && (
        <div
          className="fixed z-[300] min-w-[220px] rounded-xl border border-border-primary bg-bg-primary/98 py-1.5 shadow-[0_18px_44px_rgba(15,23,42,0.18)] backdrop-blur-md"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {menu.items.map((item) => {
            if (item.separator) {
              return <div key={item.id} className="my-1 h-px bg-border-primary" />
            }
            return (
              <button
                key={item.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  void runAction(item)
                }}
                disabled={item.disabled}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors ${
                  item.disabled
                    ? 'cursor-not-allowed text-text-muted/55'
                    : item.danger
                      ? 'text-red-500 hover:bg-red-500/10'
                      : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                }`}
                role="menuitem"
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="text-[10px] text-text-muted">{item.shortcut}</span>}
              </button>
            )
          })}
        </div>
      )}
    </ContextMenuContext.Provider>
  )
}

export function useContextMenu() {
  const context = useContext(ContextMenuContext)
  if (!context) {
    throw new Error('useContextMenu must be used within ContextMenuProvider')
  }
  return context
}
