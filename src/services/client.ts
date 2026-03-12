// HTTP Client - JWT 自动注入 + 401 刷新 + 错误处理
// Dev 默认走 Vite /api 代理，避免端口错配（8080/18080）导致登录失败
const API_BASE = import.meta.env.VITE_API_URL?.trim() || '/api'

export class ApiError extends Error {
  status: number

  constructor(
    status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function getToken(): string | null {
  return localStorage.getItem('token')
}

function setToken(token: string) {
  localStorage.setItem('token', token)
}

function clearToken() {
  localStorage.removeItem('token')
}

async function refreshToken(): Promise<string | null> {
  const token = getToken()
  if (!token) return null

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.token) {
      setToken(data.token)
      return data.token
    }
    return null
  } catch {
    return null
  }
}

let refreshPromise: Promise<string | null> | null = null

export async function fetchWithAuthRetry(
  endpoint: string,
  init?: RequestInit & { skipAuth?: boolean },
): Promise<Response> {
  const { skipAuth, ...requestInit } = init || {}
  const headers = new Headers(requestInit.headers || {})

  if (!skipAuth) {
    const token = getToken()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
  }

  const execute = (authHeaders: Headers) =>
    fetch(`${API_BASE}${endpoint}`, {
      ...requestInit,
      headers: authHeaders,
    })

  let response = await execute(headers)

  if (response.status !== 401 || skipAuth) {
    return response
  }

  if (!refreshPromise) {
    refreshPromise = refreshToken()
  }
  const newToken = await refreshPromise
  refreshPromise = null

  if (!newToken) {
    clearToken()
    window.dispatchEvent(new CustomEvent('auth:logout'))
    return response
  }

  headers.set('Authorization', `Bearer ${newToken}`)
  response = await execute(headers)
  return response
}

export async function request<T>(
  endpoint: string,
  options?: RequestInit & { skipAuth?: boolean },
): Promise<T> {
  const { skipAuth, ...init } = options || {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  }

  if (!skipAuth) {
    const token = getToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...init,
    headers,
  })

  // Handle 401 - try token refresh once
  if (res.status === 401 && !skipAuth) {
    if (!refreshPromise) {
      refreshPromise = refreshToken()
    }
    const newToken = await refreshPromise
    refreshPromise = null

    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`
      const retryRes = await fetch(`${API_BASE}${endpoint}`, { ...init, headers })
      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({ error: '请求失败' }))
        throw new ApiError(retryRes.status, err.error || '请求失败')
      }
      return retryRes.json()
    }

    // Refresh failed - clear token and redirect
    clearToken()
    window.dispatchEvent(new CustomEvent('auth:logout'))
    throw new ApiError(401, '登录已过期，请重新登录')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }))
    throw new ApiError(res.status, err.error || `请求失败 (${res.status})`)
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T

  return res.json()
}

export { getToken, setToken, clearToken, API_BASE }
