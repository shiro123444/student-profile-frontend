/**
 * Dashboard Page - 液态玻璃设计 + API 数据对接
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { GlassCard } from '../components/ui'
import { primary } from '../theme/colors'
import { useAuth } from '../contexts/AuthContext'
import { studentApi } from '../services/api'
import type { StudentProfile } from '../services/api'
import { Brain, BarChart3, Target, Bot, CheckCircle, TrendingUp, BookOpen, FlaskConical, Loader2, Award } from 'lucide-react'

const quickActions = [
  {
    title: 'MBTI 测试',
    desc: '完成性格评估',
    link: '/mbti-test',
    icon: Brain,
    color: 'pink' as const,
  },
  {
    title: '结果分析',
    desc: '深入了解性格',
    link: '/results',
    icon: BarChart3,
    color: 'yellow' as const,
  },
  {
    title: '职业推荐',
    desc: '探索职业方向',
    link: '/careers',
    icon: Target,
    color: 'blue' as const,
  },
  {
    title: 'AI 助手',
    desc: '个性化建议',
    link: '/ai-advisor',
    icon: Bot,
    color: 'purple' as const,
  },
]

// Level badge colors
function getLevelStyle(level: string) {
  switch (level) {
    case 'S': return { bg: 'var(--tag-warning-bg)', color: 'var(--tag-warning-text)', label: 'S 级' }
    case 'A': return { bg: 'var(--tag-bg)', color: 'var(--tag-text)', label: 'A 级' }
    case 'B': return { bg: 'var(--tag-success-bg)', color: 'var(--tag-success-text)', label: 'B 级' }
    case 'C': return { bg: 'var(--tag-danger-bg)', color: 'var(--tag-danger-text)', label: 'C 级' }
    default: return { bg: 'var(--tag-bg)', color: 'var(--tag-text)', label: level || 'N/A' }
  }
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) {
      setLoading(false)
      return
    }
    studentApi
      .getProfile(user.id)
      .then(setProfile)
      .catch(() => { /* silently fail, show default UI */ })
      .finally(() => setLoading(false))
  }, [user?.id])

  const stats = profile ? [
    { label: '实验完成', value: `${profile.completedExperiments}/${profile.totalExperiments}`, icon: FlaskConical, color: 'pink' as const },
    { label: '知识掌握率', value: `${Math.round(profile.knowledgeMasteryRate * 100)}%`, icon: BookOpen, color: 'blue' as const },
    { label: '综合等级', value: getLevelStyle(profile.level).label, icon: Award, color: 'yellow' as const },
    { label: '准确率', value: `${Math.round(profile.accuracyRate * 100)}%`, icon: CheckCircle, color: 'purple' as const },
  ] : [
    { label: '已完成测试', value: '--', icon: CheckCircle, color: 'pink' as const },
    { label: '学习时长', value: '--', icon: TrendingUp, color: 'blue' as const },
    { label: '综合等级', value: '--', icon: Award, color: 'yellow' as const },
    { label: '完成课程', value: '--', icon: BookOpen, color: 'purple' as const },
  ]

  const mbtiCode = profile?.student?.mbtiCode
  const levelStyle = profile ? getLevelStyle(profile.level) : null

  return (
    <div
      className="min-h-screen p-4 md:p-6 lg:p-8 overflow-y-auto"
      style={{ background: `linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 50%, ${primary[50]}40 100%)` }}
    >
      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6"
      >
        <p className="text-sm mb-1 font-medium" style={{ color: 'var(--accent-text)' }}>个人中心</p>
        <h1 className="text-text-primary text-2xl md:text-3xl font-black tracking-tight">
          {user ? `欢迎回来，${user.username}` : '欢迎回来'}
        </h1>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        {stats.map((stat, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: index * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <GlassCard
              variant="standard"
              color={stat.color}
              className="h-full"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-text-primary text-2xl md:text-3xl font-black">
                    {loading ? <Loader2 className="w-6 h-6 animate-spin" strokeWidth={1.5} /> : stat.value}
                  </p>
                  <p className="text-text-muted text-xs mt-1">{stat.label}</p>
                </div>
                <stat.icon className="w-8 h-8 text-text-secondary" style={{ opacity: 0.3 }} strokeWidth={1.5} />
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* MBTI Card */}
      <motion.div
        initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6"
      >
        <GlassCard variant="strong" color="white">
          <div className="flex flex-col md:flex-row items-start gap-4 md:gap-6">
            <div
              className="w-20 h-20 md:w-24 md:h-24 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg"
              style={{ background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)` }}
            >
              <span className="text-xl md:text-2xl font-black tracking-wider text-white">
                {mbtiCode || '?'}
              </span>
            </div>

            <div className="flex-1">
              {mbtiCode ? (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-text-primary text-xl md:text-2xl font-bold">
                      {mbtiCode} 型人格
                    </h2>
                    {levelStyle && (
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ background: levelStyle.bg, color: levelStyle.color }}
                      >
                        {levelStyle.label}
                      </span>
                    )}
                  </div>
                  <p className="text-text-secondary leading-relaxed mb-4 text-sm">
                    {profile ? `实验完成度 ${Math.round(profile.experimentCompletionRate * 100)}%，学习活跃度 ${Math.round(profile.learningActivity * 100)}%` : '查看你的详细性格分析和职业推荐'}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-text-primary text-xl md:text-2xl font-bold mb-2">尚未测试</h2>
                  <p className="text-text-secondary leading-relaxed mb-4 text-sm">
                    完成 MBTI 测试以获取个性化职业推荐和学习路径
                  </p>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {mbtiCode ? (
                  <>
                    <Link
                      to={`/results?type=${mbtiCode}`}
                      className="px-4 py-2 rounded-full font-semibold text-sm transition-all text-white hover:shadow-lg"
                      style={{ background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)` }}
                    >
                      查看详细分析 →
                    </Link>
                    <Link
                      to={`/careers?type=${mbtiCode}`}
                      className="px-4 py-2 rounded-full font-semibold text-sm transition-colors bg-bg-tertiary text-text-primary"
                    >
                      职业推荐
                    </Link>
                  </>
                ) : (
                  <Link
                    to="/mbti-test"
                    className="px-4 py-2 rounded-full font-semibold text-sm transition-all text-white hover:shadow-lg"
                    style={{ background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)` }}
                  >
                    开始测试 →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Quick Actions + Profile Summary */}
      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.3, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <h3 className="text-text-muted text-sm font-medium mb-3">快速操作</h3>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((action, index) => (
              <Link key={index} to={action.link}>
                <GlassCard
                  variant="standard"
                  color={action.color}
                  className="h-full"
                >
                  <div className="text-center">
                    <action.icon className="w-6 h-6 mb-2 mx-auto" strokeWidth={1.5} />
                    <h4 className="text-text-primary font-bold text-sm">{action.title}</h4>
                    <p className="text-text-muted text-xs mt-1">{action.desc}</p>
                  </div>
                </GlassCard>
              </Link>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.4, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <h3 className="text-text-muted text-sm font-medium mb-3">学习概览</h3>
          <GlassCard variant="standard" color="white">
            {profile ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">实验完成度</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full bg-bg-tertiary overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${profile.experimentCompletionRate * 100}%`, background: primary[500] }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-text-primary">{Math.round(profile.experimentCompletionRate * 100)}%</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">知识掌握率</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full bg-bg-tertiary overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${profile.knowledgeMasteryRate * 100}%`, background: primary[500] }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-text-primary">{Math.round(profile.knowledgeMasteryRate * 100)}%</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">学习活跃度</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full bg-bg-tertiary overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${profile.learningActivity * 100}%`, background: primary[500] }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-text-primary">{Math.round(profile.learningActivity * 100)}%</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">准确率</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full bg-bg-tertiary overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${profile.accuracyRate * 100}%`, background: primary[500] }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-text-primary">{Math.round(profile.accuracyRate * 100)}%</span>
                  </div>
                </div>
                <Link
                  to="/profile"
                  className="block text-center text-sm font-medium mt-2 pt-3 border-t border-border-primary transition-colors"
                  style={{ color: 'var(--accent-text)' }}
                >
                  查看完整画像 →
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-bg-hover transition-colors cursor-pointer">
                  <CheckCircle className="w-5 h-5 text-green-500" strokeWidth={1.5} />
                  <div className="flex-1">
                    <p className="text-text-primary text-sm font-medium">完成 MBTI 测试</p>
                  </div>
                  <p className="text-text-muted text-xs">待完成</p>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-bg-hover transition-colors cursor-pointer">
                  <TrendingUp className="w-5 h-5 text-blue-500" strokeWidth={1.5} />
                  <div className="flex-1">
                    <p className="text-text-primary text-sm font-medium">查看职业推荐</p>
                  </div>
                  <p className="text-text-muted text-xs">待完成</p>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-bg-hover transition-colors cursor-pointer">
                  <BookOpen className="w-5 h-5 text-purple-500" strokeWidth={1.5} />
                  <div className="flex-1">
                    <p className="text-text-primary text-sm font-medium">开始学习计划</p>
                  </div>
                  <p className="text-text-muted text-xs">待完成</p>
                </div>
              </div>
            )}
          </GlassCard>
        </motion.div>
      </div>
    </div>
  )
}
