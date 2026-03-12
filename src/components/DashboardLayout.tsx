/**
 * Dashboard Layout - 专业光感玻璃设计
 * 
 * 设计原则：
 * - 使用低饱和度的中性色
 * - 微妙的玻璃态效果
 * - 柔和的呼吸光晕
 * - 专业的层次感
 * - 滚动时的模糊过渡效果
 */

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Outlet, useLocation, Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  BarChart3,
  Briefcase,
  BookOpen,
  MessageCircle,
  Network,
  Settings,
  UserCircle,
  FlaskConical,
  StickyNote,
  FileText,
  LogOut,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BreathingOrb } from './animations'
import { neutral, primary } from '../theme/colors'
import { ThemeToggle, useTheme } from '../theme/ThemeContext'
import { useAuth } from '../contexts/AuthContext'

// Nav item config with Lucide icons
interface NavItemConfig {
  path: string
  label: string
  Icon: LucideIcon
}

const navItems: NavItemConfig[] = [
  { path: '/dashboard', label: '概览', Icon: LayoutDashboard },
  { path: '/results', label: '结果分析', Icon: BarChart3 },
  { path: '/careers', label: '职业推荐', Icon: Briefcase },
  { path: '/learning-path', label: '学习路径', Icon: BookOpen },
  { path: '/profile', label: '学生画像', Icon: UserCircle },
  { path: '/experiments', label: '实验管理', Icon: FlaskConical },
  { path: '/notes', label: '笔记', Icon: StickyNote },
  { path: '/documents', label: 'PDF 工作台', Icon: FileText },
]

const bottomNavItems: NavItemConfig[] = [
  { path: '/ai-advisor', label: 'AI 助手', Icon: MessageCircle },
  { path: '/graph', label: '知识图谱', Icon: Network },
  { path: '/admin', label: '管理后台', Icon: Settings },
]

// 响应式 margin hook
const useResponsiveMargin = (isCollapsed: boolean) => {
  const [isMobile, setIsMobile] = useState(false)
  
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  return isMobile ? 0 : (isCollapsed ? 72 : 240)
}

// 光感玻璃导航项组件 - 使用 Lucide 图标
function NavItem({
  item,
  isActive,
  isCollapsed
}: {
  item: NavItemConfig
  isActive: boolean
  isCollapsed: boolean
}) {
  return (
    <Link
      to={item.path}
      className={`
        relative flex items-center rounded-xl transition-all duration-300 group cursor-pointer
        ${isCollapsed ? 'justify-center px-3 py-3' : 'px-4 py-3 gap-3'}
        ${isActive
          ? 'text-white shadow-lg'
          : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
        }
      `}
      style={isActive ? {
        background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`,
      } : {}}
      title={isCollapsed ? item.label : undefined}
    >
      {/* 激活指示器 - 左侧竖条 */}
      {isActive && !isCollapsed && (
        <motion.div
          layoutId="activeIndicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
          style={{ background: 'rgba(255,255,255,0.5)' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      )}

      <item.Icon
        className={`flex-shrink-0 transition-transform duration-200 ${isCollapsed ? 'w-6 h-6' : 'w-5 h-5'} ${!isActive ? 'group-hover:scale-110' : ''}`}
        strokeWidth={1.5}
      />
      
      <AnimatePresence>
        {!isCollapsed && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2 }}
            className="text-sm font-medium tracking-wide whitespace-nowrap"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
      
      {/* Tooltip for collapsed state */}
      {isCollapsed && (
        <div 
          className="absolute left-full ml-3 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50"
          style={{ 
            background: neutral[800], 
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          {item.label}
          <div 
            className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 rotate-45"
            style={{ background: neutral[800] }}
          />
        </div>
      )}
    </Link>
  )
}

export default function DashboardLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const marginLeft = useResponsiveMargin(isCollapsed)
  const { theme } = useTheme()
  const { user, logout } = useAuth()
  const isDark = theme === 'dark'

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // 滚动模糊效果 - 用于主内容区
  const mainRef = useRef<HTMLDivElement>(null)

  // 关闭移动端菜单当路由变化
  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  // 禁用浏览器自动滚动恢复，避免刷新后回到旧滚动位置
  useEffect(() => {
    if (typeof window === 'undefined' || !('scrollRestoration' in window.history)) return
    const prev = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = prev
    }
  }, [])

  // 路由切换时重置滚动，避免新页面被保留滚动位置顶出可视区
  useLayoutEffect(() => {
    const mainEl = mainRef.current

    const resetScroll = () => {
      if (mainEl) {
        mainEl.scrollTop = 0
        mainEl.scrollLeft = 0
      }
      window.scrollTo(0, 0)
    }

    resetScroll()
    const raf1 = window.requestAnimationFrame(resetScroll)
    const raf2 = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resetScroll)
    })
    const timer = window.setTimeout(resetScroll, 120)

    return () => {
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
      window.clearTimeout(timer)
    }
  }, [location.pathname, location.key])

  const isActive = (path: string) => location.pathname === path

  return (
    <div className="h-screen min-h-0 w-full relative flex overflow-hidden" style={{ background: isDark ? '#0c0c0c' : `linear-gradient(135deg, ${neutral[50]} 0%, #F8FAFC 50%, rgba(241,245,249,0.5) 100%)` }}>
      {/* 背景呼吸光晕 - 使用专业的低饱和度色彩 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <BreathingOrb 
          color={isDark ? 'rgba(30,30,30,0.4)' : 'rgba(226,232,240,0.4)'}
          size={800}
          position={{ top: '-20%', right: '-15%' }}
          phaseOffset={0}
        />
        <BreathingOrb 
          color={isDark ? 'rgba(20,20,20,0.35)' : 'rgba(241,245,249,0.35)'}
          size={600}
          position={{ bottom: '-15%', left: '10%' }}
          phaseOffset={0.33}
        />
        <BreathingOrb 
          color={isDark ? 'rgba(25,25,25,0.3)' : 'rgba(248,250,252,0.3)'}
          size={500}
          position={{ top: '40%', left: '60%' }}
          phaseOffset={0.66}
        />
      </div>

      {/* 侧边栏 - 桌面端 - 光感玻璃设计 */}
      <motion.aside
        className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 z-40"
        animate={{ width: isCollapsed ? 72 : 240 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        style={isDark ? {
          background: 'linear-gradient(135deg, rgba(20,20,20,0.95) 0%, rgba(20,20,20,0.85) 100%)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        } : {
          background: 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderRight: '1px solid rgba(255,255,255,0.5)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
        }}
      >
        {/* Logo - 使用专业的蓝灰色渐变 */}
        <div 
          className="h-16 flex items-center justify-between px-4"
          style={{ borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.05)' }}
        >
          <Link to="/" className="flex items-center gap-3">
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg"
              style={{ background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)` }}
            >
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <AnimatePresence>
              {!isCollapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="font-bold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  PathMind
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
        </div>

        {/* 导航项 */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavItem 
              key={item.path} 
              item={item} 
              isActive={isActive(item.path)}
              isCollapsed={isCollapsed}
            />
          ))}
          
          <div className="my-4 border-t border-border-primary" />
          
          {bottomNavItems.map((item) => (
            <NavItem 
              key={item.path} 
              item={item} 
              isActive={isActive(item.path)}
              isCollapsed={isCollapsed}
            />
          ))}
        </nav>

        {/* 底部：用户信息 + 主题切换 + 折叠 */}
        <div className="p-3 space-y-2 border-t border-border-primary">
          {/* 用户信息 + 登出 */}
          {user && !isCollapsed && (
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-text-muted truncate">{user.username}</span>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                title="退出登录"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
          {user && isCollapsed && (
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center p-2 rounded-xl text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
              title="退出登录"
            >
              <LogOut className="w-5 h-5" strokeWidth={1.5} />
            </button>
          )}
          <div className="flex items-center justify-between">
            <ThemeToggle />
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-all duration-200 text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
            >
              <motion.svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                animate={{ rotate: isCollapsed ? 180 : 0 }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </motion.svg>
              <AnimatePresence>
                {!isCollapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-sm"
                  >
                    收起
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>
      </motion.aside>

      {/* 移动端顶部栏 - 光感玻璃设计 */}
      <div 
        className="md:hidden fixed top-0 left-0 right-0 h-16 z-40 flex items-center justify-between px-4 border-b border-border-primary"
        style={isDark ? {
          background: 'linear-gradient(135deg, rgba(20,20,20,0.95) 0%, rgba(20,20,20,0.85) 100%)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        } : {
          background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.9) 100%)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
        }}
      >
        <Link to="/" className="flex items-center gap-3">
          <div 
            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg"
            style={{ background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)` }}
          >
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-bold" style={{ color: 'var(--text-primary)' }}>PathMind</span>
        </Link>
        
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors text-text-secondary"
        >
          <motion.div className="flex flex-col gap-1.5">
            <motion.span 
              className="w-6 h-0.5 rounded-full bg-text-secondary"
              animate={{ rotate: isMobileMenuOpen ? 45 : 0, y: isMobileMenuOpen ? 8 : 0 }}
            />
            <motion.span 
              className="w-6 h-0.5 rounded-full bg-text-secondary"
              animate={{ opacity: isMobileMenuOpen ? 0 : 1 }}
            />
            <motion.span 
              className="w-6 h-0.5 rounded-full bg-text-secondary"
              animate={{ rotate: isMobileMenuOpen ? -45 : 0, y: isMobileMenuOpen ? -8 : 0 }}
            />
          </motion.div>
        </button>
      </div>

      {/* 移动端菜单 - 光感玻璃设计 */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="md:hidden fixed inset-0 z-30 pt-16"
            style={{
              background: isDark ? 'rgba(12,12,12,0.98)' : `linear-gradient(135deg, rgba(255,255,255,0.98) 0%, ${neutral[50]}F2 100%)`,
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            }}
          >
            <nav className="p-4 space-y-2">
              {[...navItems, ...bottomNavItems].map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer ${isActive(item.path) ? '' : 'text-text-secondary'}`}
                  style={isActive(item.path) ? {
                    background: `linear-gradient(135deg, ${primary[100]} 0%, ${primary[50]} 100%)`,
                    color: primary[800],
                  } : {}}
                >
                  <item.Icon className="w-6 h-6" strokeWidth={1.5} />
                  <span className="font-medium">{item.label}</span>
                </Link>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 主内容区 - 垂直滚动 + 滚动模糊过渡 */}
      <main
        ref={mainRef}
        className="flex-1 h-full min-h-0 pt-16 md:pt-0 relative z-10 transition-all duration-300 overflow-y-auto"
        style={{ marginLeft }}
      >
        <div className="h-full min-h-0 flex flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
