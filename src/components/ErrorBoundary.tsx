import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  resetKey?: string | number
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  componentDidUpdate(prevProps: Props) {
    if (
      this.state.hasError &&
      this.props.resetKey !== undefined &&
      this.props.resetKey !== prevProps.resetKey
    ) {
      this.setState({ hasError: false, error: null })
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      const message = this.state.error?.message || '发生了未知错误'
      const isChunkError = /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module/i.test(message)

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-bg-primary">
          <div
            className="max-w-md w-full p-8 rounded-3xl text-center"
            style={{
              background: 'var(--bg-card)',
              backdropFilter: 'blur(20px)',
              border: '1px solid var(--border-primary)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
            }}
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-text-primary mb-2">
              页面出现了问题
            </h2>
            <p className="text-sm text-text-muted mb-6">
              {isChunkError ? '页面资源加载失败，请刷新资源后重试。' : message}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-6 py-2.5 rounded-xl font-medium text-white cursor-pointer transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #475569, #334155)' }}
              >
                重试
              </button>
              {isChunkError && (
                <button
                  onClick={() => {
                    this.setState({ hasError: false, error: null })
                    window.location.reload()
                  }}
                  className="px-6 py-2.5 rounded-xl font-medium cursor-pointer transition-opacity hover:opacity-90 border border-border-primary text-text-secondary"
                >
                  刷新资源
                </button>
              )}
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null })
                  window.location.href = '/dashboard'
                }}
                className="px-6 py-2.5 rounded-xl font-medium cursor-pointer transition-opacity hover:opacity-90 border border-border-primary text-text-secondary"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
