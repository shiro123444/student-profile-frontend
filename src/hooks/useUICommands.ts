/**
 * useUICommands — Parses UI command JSON from agent SSE stream
 * and manages temporary visual effects that auto-revert on unmount.
 */

import { useState, useCallback, useEffect, useRef } from 'react'

export interface UICommand {
  ui_command: true
  command: 'highlight' | 'theme_pulse' | 'spotlight' | 'confetti' | 'morph_card' | 'typewriter' | 'focus_note_panel'
  target: string
  params: Record<string, unknown>
}

export interface ActiveEffect {
  id: string
  command: UICommand['command']
  target: string
  params: Record<string, unknown>
  expiresAt: number
}

const DEFAULT_DURATION: Record<UICommand['command'], number> = {
  highlight: 3000,
  theme_pulse: 3000,
  spotlight: 3500,
  confetti: 4000,
  morph_card: 4000,
  typewriter: 5000,
  focus_note_panel: 5000,
}

let effectCounter = 0

/**
 * Try to extract a UI command from a text chunk.
 * Agent tool results come as JSON with `ui_command: true`.
 */
export function parseUICommand(text: string): UICommand | null {
  try {
    const trimmed = text.trim()
    // Look for JSON objects in the text
    const jsonMatch = trimmed.match(/\{[^{}]*"ui_command"\s*:\s*true[^{}]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    if (parsed.ui_command === true && parsed.command && parsed.target) {
      return parsed as UICommand
    }
  } catch {
    // Not a UI command, ignore
  }
  return null
}

export function useUICommands() {
  const [effects, setEffects] = useState<ActiveEffect[]>([])
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const addEffect = useCallback((cmd: UICommand) => {
    const id = `effect-${++effectCounter}`
    const duration = (cmd.params.duration_ms as number) || DEFAULT_DURATION[cmd.command]

    const effect: ActiveEffect = {
      id,
      command: cmd.command,
      target: cmd.target,
      params: cmd.params,
      expiresAt: Date.now() + duration,
    }

    setEffects(prev => [...prev, effect])

    // Auto-remove after duration
    const timer = setTimeout(() => {
      setEffects(prev => prev.filter(e => e.id !== id))
      timersRef.current.delete(timer)
    }, duration)

    timersRef.current.add(timer)
  }, [])

  /** Process a text chunk from the agent stream — extract and apply any UI commands */
  const processChunk = useCallback((text: string) => {
    const cmd = parseUICommand(text)
    if (cmd) addEffect(cmd)
    return cmd
  }, [addEffect])

  /** Clear all active effects immediately */
  const clearAll = useCallback(() => {
    setEffects([])
    timersRef.current.forEach(t => clearTimeout(t))
    timersRef.current.clear()
  }, [])

  /** Get active effects for a specific target section */
  const getEffectsForTarget = useCallback(
    (target: string) => effects.filter(e => e.target === target),
    [effects],
  )

  // Cleanup all timers on unmount — auto-revert
  useEffect(() => {
    return () => {
      timersRef.current.forEach(t => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [])

  return {
    effects,
    addEffect,
    processChunk,
    clearAll,
    getEffectsForTarget,
    hasEffects: effects.length > 0,
  }
}
