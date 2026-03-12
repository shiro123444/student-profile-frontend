import { createContext, useContext, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

interface AgentSessionContextType {
  getSession: (agentName: string) => string | undefined
  setSession: (agentName: string, sessionId: string) => void
  removeSession: (agentName: string) => void
  listSessions: () => Record<string, string>
  clearSessions: () => void
}

const AgentSessionContext = createContext<AgentSessionContextType | undefined>(undefined)

const STORAGE_KEY = 'pathmind.agent_sessions.v1'

function loadStoredSessions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === 'string' && typeof value === 'string' && key && value) {
        result[key] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

function persistSessions(map: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore storage failures
  }
}

export function AgentSessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Record<string, string>>(() => loadStoredSessions())

  const getSession = useCallback((agentName: string) => {
    return sessions[agentName]
  }, [sessions])

  const setSession = useCallback((agentName: string, sessionId: string) => {
    setSessions(prev => {
      const next = { ...prev, [agentName]: sessionId }
      persistSessions(next)
      return next
    })
  }, [])

  const removeSession = useCallback((agentName: string) => {
    setSessions(prev => {
      if (!prev[agentName]) return prev
      const next = { ...prev }
      delete next[agentName]
      persistSessions(next)
      return next
    })
  }, [])

  const listSessions = useCallback(() => {
    return sessions
  }, [sessions])

  const clearSessions = useCallback(() => {
    setSessions({})
    persistSessions({})
  }, [])

  const value = useMemo(() => ({
    getSession,
    setSession,
    removeSession,
    listSessions,
    clearSessions,
  }), [getSession, setSession, removeSession, listSessions, clearSessions])

  return (
    <AgentSessionContext.Provider value={value}>
      {children}
    </AgentSessionContext.Provider>
  )
}

export function useAgentSession() {
  const ctx = useContext(AgentSessionContext)
  if (!ctx) throw new Error('useAgentSession must be used within AgentSessionProvider')
  return ctx
}
