import { useState } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button, Divider } from '@heroui/react'
import { primary } from '../theme/colors'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { ApiError } from '../services/client'
import {
  GraduationCap,
  Brain,
  Map,
  School,
  Globe,
  Lightbulb,
  AlertTriangle,
  User,
  Lock,
  Mail,
  IdCard,
} from 'lucide-react'

// OAuth Icons
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
)

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
)

type LoginChannel = 'campus' | 'external'
type AuthMode = 'login' | 'register'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, register } = useAuth()
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [channel, setChannel] = useState<LoginChannel>('campus')
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Login form (默认填充 test/testtest 方便测试)
  const [username, setUsername] = useState('test')
  const [password, setPassword] = useState('testtest')

  // Register form
  const [regUsername, setRegUsername] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regStudentNumber, setRegStudentNumber] = useState('')

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard'

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) {
      setError('请填写用户名和密码')
      return
    }

    setIsLoading(true)
    setError('')
    try {
      await login(username, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!regUsername || !regEmail || !regPassword) {
      setError('请填写所有必填项')
      return
    }

    setIsLoading(true)
    setError('')
    try {
      await register({
        username: regUsername,
        email: regEmail,
        password: regPassword,
        student_number: regStudentNumber || undefined,
      })
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }

  // OAuth (placeholder)
  const handleOAuth = (provider: string) => {
    console.log(`OAuth with ${provider}`)
  }

  const glassStyle = isDark
    ? {
        background: 'rgba(255, 255, 255, 0.06)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }
    : {
        background: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.3)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
      }

  const channelTabStyle = (active: boolean) => ({
    background: active
      ? primary[600]
      : isDark
        ? 'rgba(255, 255, 255, 0.08)'
        : 'rgba(255, 255, 255, 0.5)',
    color: active ? '#fff' : 'var(--text-secondary)',
    backdropFilter: active ? 'none' : 'blur(10px)',
    border: active ? 'none' : `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.3)'}`,
    transition: 'all 0.3s ease',
  })

  const inputStyle = {
    borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.6)',
    color: 'var(--text-primary)',
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-bg-primary">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full"
          style={{
            background: `radial-gradient(circle, ${isDark ? `${primary[800]}30` : `${primary[200]}40`}, transparent 70%)`,
          }}
        />
        <div
          className="absolute -bottom-48 -right-48 w-[600px] h-[600px] rounded-full"
          style={{
            background: `radial-gradient(circle, ${isDark ? `${primary[900]}30` : `${primary[100]}50`}, transparent 70%)`,
          }}
        />
        <svg className="absolute inset-0 w-full h-full opacity-[0.03]">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--text-primary)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Left branding */}
      <div className="hidden lg:flex lg:w-[45%] relative items-center justify-center p-16">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: [0.25, 0.1, 0, 1] }}
          className="relative z-10 max-w-lg"
        >
          <div className="flex items-center gap-3 mb-12">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-lg"
              style={{ background: `linear-gradient(135deg, ${primary[600]}, ${primary[400]})` }}
            >
              P
            </div>
            <span className="text-xl font-black text-text-primary">PathMind</span>
          </div>

          <h1 className="text-4xl md:text-5xl font-black leading-tight mb-6 text-text-primary">
            智能学业
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: `linear-gradient(135deg, ${primary[600]}, ${primary[400]})` }}
            >
              画像平台
            </span>
          </h1>

          <p className="text-lg mb-12 text-text-muted">
            基于 MBTI 性格分析与知识图谱，为每位同学构建个性化的 AI 学习路径与职业规划
          </p>

          <div className="space-y-4">
            {[
              { icon: GraduationCap, title: '统一身份认证', desc: '校内学生一键登录，自动同步学籍信息' },
              { icon: Brain, title: '智能画像分析', desc: '多维度能力评估，精准匹配发展方向' },
              { icon: Map, title: '知识图谱导航', desc: '可视化学习路径，按需推荐课程资源' },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.15, duration: 0.6 }}
                className="flex items-start gap-4 p-4 rounded-2xl"
                style={glassStyle}
              >
                <item.icon className="w-6 h-6 mt-0.5 text-text-secondary" strokeWidth={1.5} />
                <div>
                  <p className="font-bold text-sm text-text-primary">{item.title}</p>
                  <p className="text-sm text-text-muted">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Right login area */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.25, 0.1, 0, 1] }}
          className="w-full max-w-md"
        >
          <div className="rounded-3xl p-8 sm:p-10" style={glassStyle}>
            {/* Mobile logo */}
            <Link to="/" className="lg:hidden inline-flex items-center gap-2 mb-8">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-sm"
                style={{ background: `linear-gradient(135deg, ${primary[600]}, ${primary[400]})` }}
              >
                P
              </div>
              <span className="text-lg font-black text-text-primary">PathMind</span>
            </Link>

            <h2 className="text-2xl font-bold mb-1 text-text-primary">
              {authMode === 'login' ? '登录平台' : '注册账号'}
            </h2>
            <p className="text-sm mb-8 text-text-muted">
              {authMode === 'login' ? '选择你的身份以继续' : '创建你的 PathMind 账号'}
            </p>

            {/* Error message */}
            {error && (
              <div
                className="mb-4 p-3 rounded-xl text-sm flex items-center gap-2"
                style={{
                  background: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
                  color: isDark ? '#fca5a5' : '#dc2626',
                  border: `1px solid ${isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'}`,
                }}
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
                {error}
              </div>
            )}

            {authMode === 'login' ? (
              <>
                {/* Channel tabs */}
                <div
                  className="flex gap-2 mb-8 p-1 rounded-2xl"
                  style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
                >
                  <button
                    onClick={() => setChannel('campus')}
                    className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold cursor-pointer"
                    style={channelTabStyle(channel === 'campus')}
                  >
                    <School className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />
                    校内学生
                  </button>
                  <button
                    onClick={() => setChannel('external')}
                    className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold cursor-pointer"
                    style={channelTabStyle(channel === 'external')}
                  >
                    <Globe className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />
                    校外用户
                  </button>
                </div>

                {channel === 'campus' ? (
                  <motion.div
                    key="campus"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                      <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium mb-2 text-text-secondary">
                            用户名 / 学号
                          </label>
                          <div className="relative">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                              <User className="w-5 h-5" strokeWidth={1.5} />
                            </div>
                            <input
                              type="text"
                              value={username}
                              onChange={(e) => setUsername(e.target.value)}
                              placeholder="zhangsan 或 U202112345"
                              className="w-full pl-11 pr-4 py-3 rounded-xl border-2 focus:outline-none transition-colors text-text-primary placeholder:text-text-muted"
                              style={inputStyle}
                              onFocus={(e) => (e.target.style.borderColor = primary[400])}
                              onBlur={(e) => (e.target.style.borderColor = inputStyle.borderColor)}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-2 text-text-secondary">
                            密码
                          </label>
                          <div className="relative">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                              <Lock className="w-5 h-5" strokeWidth={1.5} />
                            </div>
                            <input
                              type="password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="请输入密码"
                              className="w-full pl-11 pr-4 py-3 rounded-xl border-2 focus:outline-none transition-colors text-text-primary placeholder:text-text-muted"
                              style={inputStyle}
                              onFocus={(e) => (e.target.style.borderColor = primary[400])}
                              onBlur={(e) => (e.target.style.borderColor = inputStyle.borderColor)}
                            />
                          </div>
                        </div>

                        <Button
                          type="submit"
                          fullWidth
                          size="lg"
                          isLoading={isLoading}
                          className="font-semibold h-12 text-white"
                          style={{
                            background: `linear-gradient(135deg, ${primary[600]}, ${primary[500]})`,
                          }}
                        >
                          {isLoading ? '登录中...' : '登录'}
                        </Button>
                      </form>

                      <div className="flex items-center gap-4 my-4">
                        <Divider className="flex-1" />
                        <span className="text-xs text-text-muted">没有账号？</span>
                        <Divider className="flex-1" />
                      </div>

                      <button
                        onClick={() => {
                          setAuthMode('register')
                          setError('')
                        }}
                        className="w-full py-2.5 rounded-xl text-sm font-semibold cursor-pointer transition-colors"
                        style={{
                          border: `2px solid ${isDark ? 'rgba(255,255,255,0.15)' : primary[200]}`,
                          color: 'var(--accent-text)',
                          background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)',
                        }}
                      >
                        注册新账号
                      </button>

                      <div
                        className="mt-4 p-3 rounded-xl text-xs"
                        style={{
                          background: isDark ? 'rgba(255,255,255,0.06)' : `${primary[50]}80`,
                          color: 'var(--accent-text)',
                        }}
                      >
                        <Lightbulb className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />
                        登录后将自动同步你的学籍信息（姓名、院系、年级），无需手动填写
                      </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="external"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                      <p className="text-sm mb-5 text-text-muted">
                        校外同学或访客可使用第三方账号登录
                      </p>

                      <div className="space-y-3">
                        <Button
                          fullWidth
                          size="lg"
                          variant="bordered"
                          className="font-semibold h-12 transition-colors"
                          style={{
                            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                            borderWidth: 2,
                            background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)',
                            color: 'var(--text-primary)',
                          }}
                          startContent={<GoogleIcon />}
                          onPress={() => handleOAuth('google')}
                        >
                          使用 Google 登录
                        </Button>

                        <Button
                          fullWidth
                          size="lg"
                          variant="bordered"
                          className="font-semibold h-12 transition-colors"
                          style={{
                            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                            borderWidth: 2,
                            background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)',
                            color: 'var(--text-primary)',
                          }}
                          startContent={<GithubIcon />}
                          onPress={() => handleOAuth('github')}
                        >
                          使用 GitHub 登录
                        </Button>
                      </div>

                      <div
                        className="mt-6 p-3 rounded-xl text-xs"
                        style={{
                          background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <AlertTriangle className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />
                        校外账号部分功能受限（如学籍同步、课程推荐等），建议校内学生使用统一认证登录
                      </div>
                  </motion.div>
                )}
              </>
            ) : (
              /* Register form */
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-text-secondary">
                      用户名 <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                        <User className="w-5 h-5" strokeWidth={1.5} />
                      </div>
                      <input
                        type="text"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        placeholder="请输入用户名"
                        className="w-full pl-11 pr-4 py-3 rounded-xl border-2 focus:outline-none transition-colors text-text-primary placeholder:text-text-muted"
                        style={inputStyle}
                        onFocus={(e) => (e.target.style.borderColor = primary[400])}
                        onBlur={(e) => (e.target.style.borderColor = inputStyle.borderColor)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2 text-text-secondary">
                      邮箱 <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                        <Mail className="w-5 h-5" strokeWidth={1.5} />
                      </div>
                      <input
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="your@email.com"
                        className="w-full pl-11 pr-4 py-3 rounded-xl border-2 focus:outline-none transition-colors text-text-primary placeholder:text-text-muted"
                        style={inputStyle}
                        onFocus={(e) => (e.target.style.borderColor = primary[400])}
                        onBlur={(e) => (e.target.style.borderColor = inputStyle.borderColor)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2 text-text-secondary">
                      密码 <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                        <Lock className="w-5 h-5" strokeWidth={1.5} />
                      </div>
                      <input
                        type="password"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="至少 6 位"
                        className="w-full pl-11 pr-4 py-3 rounded-xl border-2 focus:outline-none transition-colors text-text-primary placeholder:text-text-muted"
                        style={inputStyle}
                        onFocus={(e) => (e.target.style.borderColor = primary[400])}
                        onBlur={(e) => (e.target.style.borderColor = inputStyle.borderColor)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2 text-text-secondary">
                      学号 <span className="text-text-muted text-xs">(选填)</span>
                    </label>
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
                        <IdCard className="w-5 h-5" strokeWidth={1.5} />
                      </div>
                      <input
                        type="text"
                        value={regStudentNumber}
                        onChange={(e) => setRegStudentNumber(e.target.value)}
                        placeholder="U202112345"
                        className="w-full pl-11 pr-4 py-3 rounded-xl border-2 focus:outline-none transition-colors text-text-primary placeholder:text-text-muted"
                        style={inputStyle}
                        onFocus={(e) => (e.target.style.borderColor = primary[400])}
                        onBlur={(e) => (e.target.style.borderColor = inputStyle.borderColor)}
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    fullWidth
                    size="lg"
                    isLoading={isLoading}
                    className="font-semibold h-12 text-white"
                    style={{
                      background: `linear-gradient(135deg, ${primary[600]}, ${primary[500]})`,
                    }}
                  >
                    {isLoading ? '注册中...' : '注册'}
                  </Button>
                </form>

                <div className="flex items-center gap-4 mt-4">
                  <Divider className="flex-1" />
                  <button
                    onClick={() => {
                      setAuthMode('login')
                      setError('')
                    }}
                    className="text-xs font-semibold cursor-pointer hover:underline"
                    style={{ color: 'var(--accent-text)' }}
                  >
                    已有账号？返回登录
                  </button>
                  <Divider className="flex-1" />
                </div>
              </motion.div>
            )}
          </div>

          {/* Bottom link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-text-muted">
              首次使用？
              <Link
                to="/mbti-test"
                className="font-semibold ml-1 hover:underline"
                style={{ color: 'var(--accent-text)' }}
              >
                先做一次性格测试 →
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
