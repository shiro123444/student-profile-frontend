// Auth API - 认证相关接口

import { request, setToken, clearToken } from './client'

// Types
export interface User {
  id: string
  username: string
  email: string
  role: 'student' | 'teacher' | 'admin' | 'operator'
  student_number?: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
  student_number?: string
  role?: string
}

export interface LoginRequest {
  username: string
  password: string
}

export const authApi = {
  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    const res = await request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
      skipAuth: true,
    })
    setToken(res.token)
    return res
  },

  login: async (data: LoginRequest): Promise<AuthResponse> => {
    const res = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
      skipAuth: true,
    })
    setToken(res.token)
    return res
  },

  getMe: () => request<{ user: User }>('/auth/me'),

  logout: () => {
    clearToken()
    window.dispatchEvent(new CustomEvent('auth:logout'))
  },
}
