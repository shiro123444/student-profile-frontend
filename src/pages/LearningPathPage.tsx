import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
import { GlassCard } from '../components/ui'
import { easings, durations } from '../theme/motion'
import { primary, secondary } from '../theme/colors'
import { learningPathApi } from '../services/api'
import type { LearningPath, Course } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { MessageSquare, Clock, BookOpen, Trophy, Target, Loader2, AlertCircle, Route } from 'lucide-react'
import AIInsightButton from '../components/ui/AIInsightButton'

export default function LearningPathPage() {
  const { user } = useAuth()
  const [learningPaths, setLearningPaths] = useState<LearningPath[]>([])
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null)
  const [completedCourses, setCompletedCourses] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })

  useEffect(() => {
    setLoading(true)
    setError(null)
    learningPathApi
      .getRecommended(user?.id)
      .then((data) => {
        const paths = data || []
        setLearningPaths(paths)
        if (paths.length > 0) setSelectedPathId(paths[0].id)
      })
      .catch((err) => setError(err.message || '获取学习路径失败'))
      .finally(() => setLoading(false))
  }, [user?.id])

  const selectedPath = learningPaths.find((p) => p.id === selectedPathId)
  const pathCourses: Course[] = selectedPath?.courses || []

  const extractHours = (duration: string): number => {
    const match = duration.match(/\d+/)
    return match ? parseInt(match[0], 10) : 0
  }

  const totalHours = pathCourses.reduce((sum, c) => sum + extractHours(c.duration), 0)
  const completedHours = pathCourses
    .filter((c) => completedCourses.includes(c.id) || c.completed)
    .reduce((sum, c) => sum + extractHours(c.duration), 0)
  const progress = totalHours > 0 ? Math.round((completedHours / totalHours) * 100) : 0

  const smoothTransition = { duration: durations.slow, ease: easings.smooth }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-text-muted" strokeWidth={1.5} />
          <p className="text-text-secondary">加载学习路径中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary px-4">
        <GlassCard variant="standard" color="white" className="max-w-md w-full p-8 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" strokeWidth={1.5} />
          <h2 className="text-lg font-bold text-text-primary mb-2">加载失败</h2>
          <p className="text-text-muted mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 rounded-full text-white font-medium"
            style={{ background: primary[700] }}
          >
            重试
          </button>
        </GlassCard>
      </div>
    )
  }

  if (learningPaths.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary px-4">
        <GlassCard variant="standard" color="white" className="max-w-md w-full p-8 text-center">
          <Route className="w-12 h-12 mx-auto mb-4 text-text-muted" strokeWidth={1.5} />
          <h2 className="text-lg font-bold text-text-primary mb-2">暂无学习路径</h2>
          <p className="text-text-muted mb-4">请先完成 MBTI 测试以获取个性化学习路径推荐</p>
          <Link
            to="/mbti-test"
            className="inline-block px-6 py-2 rounded-full text-white font-medium"
            style={{ background: primary[700] }}
          >
            开始测试
          </Link>
        </GlassCard>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="min-h-screen py-8 px-4 md:px-8 overflow-y-auto bg-bg-primary"
    >
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={smoothTransition}
          className="mb-12"
        >
          <h1 className="text-4xl md:text-5xl font-black mb-4 text-text-primary">
            个性化学习路径
          </h1>
          <p className="text-lg max-w-2xl text-text-secondary">
            根据你的职业目标，定制化的学习计划帮助你高效成长
          </p>
        </motion.div>

        {/* Path Selection Cards */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {learningPaths.map((path, index) => (
            <motion.button
              key={path.id}
              initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
              animate={isInView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
              transition={{ delay: 0.1 + index * 0.1, duration: durations.slow, ease: easings.smooth }}
              onClick={() => setSelectedPathId(path.id)}
              className="text-left p-6 rounded-2xl transition-all duration-300 cursor-pointer"
              style={selectedPathId === path.id ? {
                background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`,
                color: 'white',
                boxShadow: '0 12px 40px rgba(71, 85, 105, 0.25)',
                transform: 'scale(1.02)',
              } : {
                background: 'white',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex items-start gap-4">
                <Route className="w-8 h-8 flex-shrink-0" strokeWidth={1.5} />
                <div className="flex-1">
                  <h3
                    className="font-bold text-lg mb-1"
                    style={{ color: selectedPathId === path.id ? 'white' : 'var(--text-primary)' }}
                  >
                    {path.name}
                  </h3>
                  <p
                    className="text-sm mb-2"
                    style={{ color: selectedPathId === path.id ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)' }}
                  >
                    {path.description}
                  </p>
                  <span
                    className="text-xs font-medium"
                    style={{ color: selectedPathId === path.id ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}
                  >
                    预计 {path.estimatedDuration}
                  </span>
                </div>
              </div>
            </motion.button>
          ))}
        </div>

        {/* Progress Card */}
        {selectedPath && (
          <motion.div
            initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }}
            animate={isInView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
            transition={{ delay: 0.3, duration: durations.slow, ease: easings.smooth }}
          >
            <GlassCard variant="standard" color="white" className="p-8 mb-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <h3 className="text-lg font-bold mb-2 text-text-primary">学习进度</h3>
                  <p className="text-text-secondary">
                    已完成 {completedHours} / {totalHours} 小时
                  </p>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-4xl font-black text-text-primary">{progress}%</p>
                    <p className="text-sm text-text-muted">完成度</p>
                  </div>
                  <div className="w-32 h-32 relative">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="64" cy="64" r="56" stroke="var(--border-primary)" strokeWidth="8" fill="none" />
                      <circle
                        cx="64" cy="64" r="56"
                        stroke="url(#progressGradient)"
                        strokeWidth="8"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${progress * 3.52} 352`}
                      />
                      <defs>
                        <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor={primary[500]} />
                          <stop offset="100%" stopColor={primary[700]} />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Course List */}
        <div className="space-y-4">
          {pathCourses.map((course, index) => {
            const isCompleted = completedCourses.includes(course.id) || course.completed

            return (
              <motion.div
                key={course.id}
                initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                animate={isInView ? { opacity: 1, y: 0, filter: 'blur(0px)' } : {}}
                transition={{ delay: 0.4 + index * 0.08, duration: durations.normal, ease: easings.smooth }}
              >
                <GlassCard
                  variant={isCompleted ? 'light' : 'standard'}
                  color="white"
                  className="p-6 transition-all duration-300"
                  style={isCompleted ? {
                    borderColor: secondary[200],
                    background: `${secondary[50]}80`
                  } : {
                    borderColor: 'var(--border-primary)'
                  }}
                >
                  <div className="flex items-start gap-6">
                    {/* Order Number */}
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg flex-shrink-0"
                      style={isCompleted ? {
                        background: secondary[500],
                        color: 'white',
                      } : {
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {isCompleted ? '✓' : index + 1}
                    </div>

                    {/* Course Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div>
                          <h4 className="text-lg font-bold text-text-primary">{course.name}</h4>
                          <p className="text-sm mt-1 text-text-secondary">{course.description}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 mt-4">
                        <span className="text-sm px-3 py-1 rounded-full bg-bg-tertiary text-text-secondary">
                          <Clock className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />{course.duration}
                        </span>
                        <span className="text-sm px-3 py-1 rounded-full bg-bg-tertiary text-text-secondary">
                          <BookOpen className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />{course.provider}
                        </span>
                        {course.rating > 0 && (
                          <div className="flex items-center gap-1">
                            <span style={{ color: '#F59E0B' }}>★</span>
                            <span className="text-sm font-semibold text-text-secondary">{course.rating}</span>
                          </div>
                        )}
                        <span
                          className="text-sm px-3 py-1 rounded-full"
                          style={{ background: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                        >
                          {course.level === 'advanced' ? '高级' : course.level === 'intermediate' ? '中级' : '初级'}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0">
                      {!isCompleted ? (
                        <button
                          onClick={() => setCompletedCourses([...completedCourses, course.id])}
                          className="px-5 py-2.5 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
                          style={{ background: primary[800] }}
                        >
                          开始学习
                        </button>
                      ) : (
                        <span
                          className="px-5 py-2.5 text-sm font-semibold rounded-xl"
                          style={{ background: 'var(--tag-info-bg)', color: 'var(--tag-info-text)' }}
                        >
                          已完成 ✓
                        </span>
                      )}
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            )
          })}
        </div>

        {/* Completion Card */}
        {progress === 100 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-8"
          >
            <GlassCard
              variant="strong"
              color="white"
              className="p-8 text-white text-center"
              style={{ background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)` }}
            >
              <span className="mb-4 block flex justify-center"><Trophy className="w-10 h-10" strokeWidth={1.5} /></span>
              <h3 className="text-2xl font-bold mb-4">恭喜完成学习路径！</h3>
              <p className="mb-6" style={{ color: 'rgba(255,255,255,0.8)' }}>你已经掌握了成为 AI 工程师所需的核心技能</p>
              <button
                className="px-8 py-3 bg-bg-secondary rounded-full font-semibold transition-colors"
                style={{ color: 'var(--accent-text)' }}
              >
                申请认证证书
              </button>
            </GlassCard>
          </motion.div>
        )}

        {/* AI Insight */}
        {selectedPath && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : {}}
            transition={{ delay: 0.45 }}
            className="mt-6 flex justify-center"
          >
            <AIInsightButton
              agentName="learning-coach"
              prompt={`基于我当前的学习进度（完成 ${progress}%），分析学习路径「${selectedPath.name}」的下一步建议`}
              studentId={user?.id}
              label="AI 学习建议"
            />
          </motion.div>
        )}

        {/* Bottom Actions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 0.5 }}
          className="mt-8 flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Link
            to="/ai-advisor"
            className="px-8 py-4 text-white rounded-full font-semibold transition-colors text-center"
            style={{ background: primary[800] }}
          >
            <MessageSquare className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} /> 咨询 AI 助手
          </Link>
          <Link
            to="/careers"
            className="px-8 py-4 bg-bg-secondary rounded-full font-semibold transition-all text-center border-2 border-border-primary text-text-primary"
          >
            <Target className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} /> 查看职业推荐
          </Link>
        </motion.div>
      </div>
    </div>
  )
}
