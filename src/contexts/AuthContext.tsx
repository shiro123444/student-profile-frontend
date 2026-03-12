import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { authApi } from '../services/auth'
import { getToken, clearToken } from '../services/client'
import type { User } from '../services/auth'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  register: (data: {
    username: string
    email: string
    password: string
    student_number?: string
  }) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const logout = useCallback(() => {
    authApi.logout()
    setUser(null)
  }, [])

  // Check existing token on mount
  useEffect(() => {
    const token = getToken()
    if (!token) {
      setIsLoading(false)
      return
    }

    authApi
      .getMe()
      .then((res) => setUser(res.user))
      .catch(() => clearToken())
      .finally(() => setIsLoading(false))
  }, [])

  // Listen for auth:logout events (from 401 handler)
  useEffect(() => {
    const handler = () => {
      setUser(null)
    }
    window.addEventListener('auth:logout', handler)
    return () => window.removeEventListener('auth:logout', handler)
  }, [])

  const login = async (username: string, password: string) => {
    const res = await authApi.login({ username, password })
    setUser(res.user)
  }

  const register = async (data: {
    username: string
    email: string
    password: string
    student_number?: string
  }) => {
    const res = await authApi.register({ ...data, role: 'student' })
    setUser(res.user)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
