/**
 * UIEffectLayer — Renders temporary visual effects triggered by the homepage agent.
 * Overlays on page sections identified by data-section-id attributes.
 */

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ActiveEffect } from '../../hooks/useUICommands'

interface UIEffectLayerProps {
  effects: ActiveEffect[]
}

/** Resolve a target section's bounding rect by data-section-id */
function getTargetRect(target: string): DOMRect | null {
  const el = document.querySelector(`[data-section-id="${target}"]`)
  return el ? el.getBoundingClientRect() : null
}

// ── Individual effect renderers ──

function HighlightEffect({ target, params }: { target: string; params: Record<string, unknown> }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const color = (params.color as string) || 'rgba(99, 102, 241, 0.6)'

  const updateRect = useCallback(() => setRect(getTargetRect(target)), [target])

  useEffect(() => {
    updateRect()
    window.addEventListener('scroll', updateRect)
    window.addEventListener('resize', updateRect)
    return () => {
      window.removeEventListener('scroll', updateRect)
      window.removeEventListener('resize', updateRect)
    }
  }, [updateRect])

  if (!rect) return null

  return (
    <motion.div
      initial={{ opacity: 0, boxShadow: `0 0 0px ${color}` }}
      animate={{
        opacity: [0, 1, 1, 0],
        boxShadow: [
          `0 0 0px ${color}`,
          `0 0 30px ${color}, inset 0 0 20px ${color}40`,
          `0 0 20px ${color}`,
          `0 0 0px ${color}`,
        ],
      }}
      transition={{ duration: 3, times: [0, 0.2, 0.8, 1] }}
      className="pointer-events-none rounded-2xl"
      style={{
        position: 'fixed',
        top: rect.top - 8,
        left: rect.left - 8,
        width: rect.width + 16,
        height: rect.height + 16,
        border: `2px solid ${color}`,
        zIndex: 9998,
      }}
    />
  )
}

function SpotlightEffect({ target }: { target: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  const updateRect = useCallback(() => setRect(getTargetRect(target)), [target])

  useEffect(() => {
    updateRect()
    window.addEventListener('scroll', updateRect)
    window.addEventListener('resize', updateRect)
    return () => {
      window.removeEventListener('scroll', updateRect)
      window.removeEventListener('resize', updateRect)
    }
  }, [updateRect])

  if (!rect) return null

  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const r = Math.max(rect.width, rect.height) / 2 + 40

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: 3.5, times: [0, 0.15, 0.85, 1] }}
      className="pointer-events-none"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9997,
        background: `radial-gradient(circle ${r}px at ${cx}px ${cy}px, transparent 0%, rgba(0,0,0,0.65) 100%)`,
      }}
    />
  )
}

function ConfettiEffect({ target }: { target: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    setRect(getTargetRect(target))
  }, [target])

  if (!rect) return null

  const particles = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    x: Math.random() * rect.width,
    color: ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'][i % 6],
    delay: Math.random() * 0.5,
    rotation: Math.random() * 360,
  }))

  return (
    <div
      className="pointer-events-none overflow-hidden"
      style={{
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: 9999,
      }}
    >
      {particles.map(p => (
        <motion.div
          key={p.id}
          initial={{ y: -10, x: p.x, opacity: 1, rotate: 0, scale: 1 }}
          animate={{
            y: rect.height + 20,
            x: p.x + (Math.random() - 0.5) * 100,
            opacity: [1, 1, 0],
            rotate: p.rotation + 360,
            scale: [1, 1.2, 0.5],
          }}
          transition={{ duration: 2.5, delay: p.delay, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            width: 8,
            height: 8,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            backgroundColor: p.color,
          }}
        />
      ))}
    </div>
  )
}

function ThemePulseEffect({ params }: { params: Record<string, unknown> }) {
  const color = (params.color as string) || 'rgba(139, 92, 246, 0.15)'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: 3, ease: 'easeInOut' }}
      className="pointer-events-none"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9996,
        background: `radial-gradient(ellipse at center, ${color} 0%, transparent 70%)`,
      }}
    />
  )
}

function TypewriterEffect({ target, params }: { target: string; params: Record<string, unknown> }) {
  const text = (params.text as string) || 'PathMind AI'
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [displayed, setDisplayed] = useState('')

  useEffect(() => {
    setRect(getTargetRect(target))
  }, [target])

  useEffect(() => {
    let i = 0
    const interval = setInterval(() => {
      if (i <= text.length) {
        setDisplayed(text.slice(0, i))
        i++
      } else {
        clearInterval(interval)
      }
    }, 60)
    return () => clearInterval(interval)
  }, [text])

  if (!rect) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none"
      style={{
        position: 'fixed',
        top: rect.top + rect.height / 2 - 20,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
        zIndex: 9999,
        fontSize: '1.25rem',
        fontWeight: 600,
        color: 'var(--text-primary)',
        textShadow: '0 0 20px rgba(99, 102, 241, 0.5)',
        whiteSpace: 'nowrap',
      }}
    >
      {displayed}
      <motion.span
        animate={{ opacity: [1, 0] }}
        transition={{ duration: 0.5, repeat: Infinity }}
      >
        |
      </motion.span>
    </motion.div>
  )
}

// ── Main Layer ──

export default function UIEffectLayer({ effects }: UIEffectLayerProps) {
  if (effects.length === 0) return null

  return (
    <AnimatePresence>
      {effects.map(effect => {
        switch (effect.command) {
          case 'highlight':
            return <HighlightEffect key={effect.id} target={effect.target} params={effect.params} />
          case 'spotlight':
            return <SpotlightEffect key={effect.id} target={effect.target} />
          case 'confetti':
            return <ConfettiEffect key={effect.id} target={effect.target} />
          case 'theme_pulse':
            return <ThemePulseEffect key={effect.id} params={effect.params} />
          case 'typewriter':
            return <TypewriterEffect key={effect.id} target={effect.target} params={effect.params} />
          case 'morph_card':
            // morph_card reuses highlight with a scale pulse
            return <HighlightEffect key={effect.id} target={effect.target} params={{ color: 'rgba(139, 92, 246, 0.5)', ...effect.params }} />
          default:
            return null
        }
      })}
    </AnimatePresence>
  )
}
