import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import DashboardLayout from './components/DashboardLayout'
import { LoadingProvider } from './components/LoadingProvider'
import { HeroUIProvider } from './providers/HeroUIProvider'
import { ThemeProvider } from './theme/ThemeContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AgentSessionProvider } from './contexts/AgentSessionContext'
import { ContextMenuProvider } from './contexts/ContextMenuContext'
import { ErrorBoundary } from './components/ErrorBoundary'

const LAZY_RETRY_KEY = 'pathmind:lazy-retry-once'

function lazyWithRetry<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await importer()
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(LAZY_RETRY_KEY)
      }
      return mod
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isChunkError = /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module/i.test(message)

      if (isChunkError && typeof window !== 'undefined') {
        const hasRetried = window.sessionStorage.getItem(LAZY_RETRY_KEY) === '1'
        if (!hasRetried) {
          window.sessionStorage.setItem(LAZY_RETRY_KEY, '1')
          window.location.reload()
        }
      }
      throw error
    }
  })
}

// Lazy load pages
const HomePageBPCO = lazyWithRetry(() => import('./pages/HomePageBPCO'))
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'))
const MBTITestPage = lazyWithRetry(() => import('./pages/MBTITestPage'))
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'))
const ResultsPage = lazyWithRetry(() => import('./pages/ResultsPage'))
const CareerPage = lazyWithRetry(() => import('./pages/CareerPage'))
const LearningPathPage = lazyWithRetry(() => import('./pages/LearningPathPage'))
const AIAdvisor = lazyWithRetry(() => import('./pages/AIAdvisor'))
const GraphPage = lazyWithRetry(() => import('./pages/GraphPage'))
const StudentProfilePage = lazyWithRetry(() => import('./pages/StudentProfilePage'))
const ExperimentsPage = lazyWithRetry(() => import('./pages/ExperimentsPage'))
const NotesPage = lazyWithRetry(() => import('./pages/NotesPage'))
const DocumentsPage = lazyWithRetry(() => import('./pages/DocumentsPage'))
const FloatingAgent = lazyWithRetry(() => import('./components/FloatingAgent'))

// Admin pages
const AdminLayout = lazyWithRetry(() =>
  import('./components/admin').then((m) => ({ default: m.AdminLayout })),
)
const AdminDashboard = lazyWithRetry(() =>
  import('./pages/admin').then((m) => ({ default: m.AdminDashboard })),
)
const AdminQuestions = lazyWithRetry(() =>
  import('./pages/admin').then((m) => ({ default: m.AdminQuestions })),
)
const AdminStudents = lazyWithRetry(() =>
  import('./pages/admin').then((m) => ({ default: m.AdminStudents })),
)

// Loading fallback
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary">
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-12 h-12 rounded-2xl animate-pulse"
          style={{
            background: 'linear-gradient(135deg, var(--primary-600), var(--primary-400))',
          }}
        />
        <p className="text-sm text-text-muted">加载中...</p>
      </div>
    </div>
  )
}

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <PageLoader />

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

// Role guard wrapper
function RoleGuard({
  children,
  roles,
}: {
  children: React.ReactNode
  roles: string[]
}) {
  const { user, isLoading } = useAuth()

  if (isLoading) return <PageLoader />

  if (!user || !roles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-bg-primary">
        <div
          className="max-w-sm w-full p-8 rounded-3xl text-center"
          style={{
            background: 'rgba(255,255,255,0.7)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.3)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          }}
        >
          <h2 className="text-xl font-bold text-text-primary mb-2">
            权限不足
          </h2>
          <p className="text-sm text-text-muted">
            你没有访问此页面的权限
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

// Page-level error boundary wrapper (keeps auth/layout alive)
function PageBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>
}

function AppRoutes() {
  const [showFloatingAgent, setShowFloatingAgent] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setShowFloatingAgent(true), 280)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <HeroUIProvider>
      <LoadingProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public pages */}
            <Route index element={<HomePageBPCO />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="mbti-test" element={<MBTITestPage />} />

            {/* Dashboard - protected */}
            <Route
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route path="dashboard" element={<PageBoundary><DashboardPage /></PageBoundary>} />
              <Route path="results" element={<PageBoundary><ResultsPage /></PageBoundary>} />
              <Route path="careers" element={<PageBoundary><CareerPage /></PageBoundary>} />
              <Route path="learning-path" element={<PageBoundary><LearningPathPage /></PageBoundary>} />
              <Route path="ai-advisor" element={<PageBoundary><AIAdvisor /></PageBoundary>} />
              <Route path="graph" element={<PageBoundary><GraphPage /></PageBoundary>} />
              <Route path="profile" element={<PageBoundary><StudentProfilePage /></PageBoundary>} />
              <Route path="experiments" element={<PageBoundary><ExperimentsPage /></PageBoundary>} />
              <Route path="notes" element={<PageBoundary><NotesPage /></PageBoundary>} />
              <Route path="notes/:id" element={<PageBoundary><NotesPage /></PageBoundary>} />
              <Route path="documents" element={<PageBoundary><DocumentsPage /></PageBoundary>} />
            </Route>

            {/* Admin - teacher/admin only */}
            <Route
              path="admin"
              element={
                <ProtectedRoute>
                  <RoleGuard roles={['teacher', 'admin']}>
                    <Suspense fallback={<PageLoader />}>
                      <AdminLayout />
                    </Suspense>
                  </RoleGuard>
                </ProtectedRoute>
              }
            >
              <Route index element={<PageBoundary><AdminDashboard /></PageBoundary>} />
              <Route path="questions" element={<PageBoundary><AdminQuestions /></PageBoundary>} />
              <Route path="students" element={<PageBoundary><AdminStudents /></PageBoundary>} />
            </Route>
          </Routes>
          {showFloatingAgent ? (
            <Suspense fallback={null}>
              <FloatingAgent />
            </Suspense>
          ) : null}
        </Suspense>
      </LoadingProvider>
    </HeroUIProvider>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AgentSessionProvider>
            <ContextMenuProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </ContextMenuProvider>
          </AgentSessionProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
