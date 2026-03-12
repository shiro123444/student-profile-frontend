import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { GlassCard } from '../components/ui'
import { primary, secondary } from '../theme/colors'
import { useAuth } from '../contexts/AuthContext'
import { studentApi } from '../services/api'
import type { StudentProfile, LearningTrend } from '../services/api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { User, Award, FlaskConical, BookOpen, TrendingUp, Target, Loader2, AlertCircle, RefreshCw } from 'lucide-react'

function getLevelStyle(level: string) {
  switch (level) {
    case 'S': return { bg: `linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)`, color: '#78350F', label: 'S 级 - 卓越' }
    case 'A': return { bg: `linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%)`, color: '#1E3A5F', label: 'A 级 - 优秀' }
    case 'B': return { bg: `linear-gradient(135deg, #34D399 0%, #10B981 100%)`, color: '#064E3B', label: 'B 级 - 良好' }
    case 'C': return { bg: `linear-gradient(135deg, #FB923C 0%, #F97316 100%)`, color: '#7C2D12', label: 'C 级 - 一般' }
    case 'D': return { bg: `linear-gradient(135deg, #F87171 0%, #EF4444 100%)`, color: '#7F1D1D', label: 'D 级 - 需提升' }
    default: return { bg: `linear-gradient(135deg, ${primary[400]} 0%, ${primary[600]} 100%)`, color: '#fff', label: level || '未评估' }
  }
}

export default function StudentProfilePage() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [trend, setTrend] = useState<LearningTrend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = (userId: string) => {
    setLoading(true)
    setError(null)
    Promise.all([
      studentApi.getProfile(userId),
      studentApi.getLearningTrend(userId).catch(() => []),
    ])
      .then(([profileData, trendData]) => {
        setProfile(profileData)
        setTrend(trendData || [])
      })
      .catch((err) => setError(err.message || '获取画像数据失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (user?.id) fetchData(user.id)
    else setLoading(false)
  }, [user?.id])

  const handleRefresh = async () => {
    if (!user?.id || refreshing) return
    setRefreshing(true)
    try {
      const updated = await studentApi.refreshProfile(user.id)
      setProfile(updated)
    } catch {
      // silently fail
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-text-muted" strokeWidth={1.5} />
          <p className="text-text-secondary">加载学生画像...</p>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <GlassCard variant="standard" color="white" className="p-8 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" strokeWidth={1.5} />
          <h2 className="text-lg font-bold text-text-primary mb-2">加载失败</h2>
          <p className="text-text-muted mb-4">{error || '请先登录查看学生画像'}</p>
          <button
            onClick={() => user?.id && fetchData(user.id)}
            className="px-6 py-2 rounded-full text-white font-medium"
            style={{ background: primary[700] }}
          >
            重试
          </button>
        </GlassCard>
      </div>
    )
  }

  const levelStyle = getLevelStyle(profile.level)
  const metrics = [
    { label: '实验完成度', value: profile.experimentCompletionRate, icon: FlaskConical, detail: `${profile.completedExperiments}/${profile.totalExperiments} 实验` },
    { label: '知识掌握率', value: profile.knowledgeMasteryRate, icon: BookOpen, detail: '基于实验成绩评估' },
    { label: '学习活跃度', value: profile.learningActivity, icon: TrendingUp, detail: '近期活动频率' },
    { label: '准确率', value: profile.accuracyRate, icon: Target, detail: '实验答题准确率' },
  ]

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">学生画像</h1>
          <p className="text-text-muted">多维度能力评估与学习数据分析</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer"
          style={{ background: 'var(--tag-bg)', color: 'var(--tag-text)' }}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          刷新
        </button>
      </motion.div>

      {/* Student Info + Level */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid md:grid-cols-3 gap-4 mb-6"
      >
        {/* Student Card */}
        <GlassCard variant="standard" color="white" className="md:col-span-2">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: `linear-gradient(135deg, ${primary[500]} 0%, ${primary[700]} 100%)` }}
            >
              <User className="w-8 h-8 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">{profile.student.name}</h2>
              <p className="text-sm text-text-muted">学号: {profile.student.studentNumber}</p>
              <div className="flex items-center gap-2 mt-1">
                {profile.student.mbtiCode && (
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                  >
                    {profile.student.mbtiCode}
                  </span>
                )}
                {profile.student.className && (
                  <span className="text-xs text-text-muted">{profile.student.className}</span>
                )}
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Level Badge */}
        <GlassCard variant="strong" color="white" className="flex items-center justify-center text-center" style={{ background: levelStyle.bg }}>
          <div>
            <Award className="w-10 h-10 mx-auto mb-2 text-white" strokeWidth={1.5} />
            <p className="text-2xl font-black text-white">{profile.level}</p>
            <p className="text-sm text-white" style={{ opacity: 0.8 }}>{getLevelStyle(profile.level).label.split(' - ')[1]}</p>
          </div>
        </GlassCard>
      </motion.div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {metrics.map((metric, index) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.05 }}
          >
            <GlassCard variant="standard" color="white">
              <div className="flex items-center gap-3 mb-3">
                <metric.icon className="w-5 h-5 text-text-muted" strokeWidth={1.5} />
                <span className="text-sm text-text-secondary">{metric.label}</span>
              </div>
              <p className="text-3xl font-black text-text-primary mb-1">
                {Math.round(metric.value * 100)}%
              </p>
              {/* Progress bar */}
              <div className="h-2 rounded-full bg-bg-tertiary overflow-hidden mb-2">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${metric.value * 100}%` }}
                  transition={{ delay: 0.5 + index * 0.1, duration: 0.5 }}
                  className="h-full rounded-full"
                  style={{
                    background: metric.value >= 0.8 ? secondary[500] :
                      metric.value >= 0.6 ? primary[500] :
                      '#F59E0B'
                  }}
                />
              </div>
              <p className="text-xs text-text-muted">{metric.detail}</p>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Learning Trend Chart */}
      {trend.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <GlassCard variant="standard" color="white" className="p-6">
            <h3 className="text-lg font-bold text-text-primary mb-4">学习趋势</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(255,255,255,0.95)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '12px',
                  }}
                />
                <Line type="monotone" dataKey="score" stroke={primary[600]} strokeWidth={2} dot={false} name="成绩" />
                <Line type="monotone" dataKey="accuracy" stroke={secondary[500]} strokeWidth={2} dot={false} name="准确率" />
              </LineChart>
            </ResponsiveContainer>
          </GlassCard>
        </motion.div>
      )}
    </div>
  )
}
