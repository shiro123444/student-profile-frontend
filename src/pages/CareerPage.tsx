import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { GlassCard } from '../components/ui'
import { easings, durations } from '../theme/motion'
import { primary } from '../theme/colors'
import { mbtiApi } from '../services/api'
import type { Career } from '../services/api'
import { Brain, BarChart3, Target, Bot, TrendingUp, Flame, Sparkles, MessageSquare, Loader2, AlertCircle } from 'lucide-react'
import AIInsightButton from '../components/ui/AIInsightButton'

// Map career names to icons based on keywords
function getCareerIcon(name: string) {
  const lower = name.toLowerCase()
  if (lower.includes('研究') || lower.includes('research')) return Brain
  if (lower.includes('数据') || lower.includes('data')) return TrendingUp
  if (lower.includes('产品') || lower.includes('product') || lower.includes('经理')) return BarChart3
  if (lower.includes('nlp') || lower.includes('语言')) return MessageSquare
  if (lower.includes('视觉') || lower.includes('vision')) return Bot
  return Target
}

export default function CareerPage() {
  const [searchParams] = useSearchParams()
  const mbtiType = searchParams.get('type') || 'INTJ'
  const [selectedCareer, setSelectedCareer] = useState<string | null>(null)
  const [careers, setCareers] = useState<Career[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })

  useEffect(() => {
    setLoading(true)
    setError(null)
    mbtiApi
      .getRecommendedCareers(mbtiType)
      .then((data) => {
        const list = data || []
        setCareers(list)
        if (list.length > 0) setSelectedCareer(list[0].id)
      })
      .catch((err) => setError(err.message || '获取职业推荐失败'))
      .finally(() => setLoading(false))
  }, [mbtiType])

  const selectedCareerData = useMemo(
    () => careers.find((c) => c.id === selectedCareer) || careers[0],
    [selectedCareer, careers]
  )

  const smoothTransition = { duration: durations.slow, ease: easings.smooth }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-text-muted" strokeWidth={1.5} />
          <p className="text-text-secondary">加载职业推荐中...</p>
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

  if (careers.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary px-4">
        <GlassCard variant="standard" color="white" className="max-w-md w-full p-8 text-center">
          <Target className="w-12 h-12 mx-auto mb-4 text-text-muted" strokeWidth={1.5} />
          <h2 className="text-lg font-bold text-text-primary mb-2">暂无推荐</h2>
          <p className="text-text-muted mb-4">当前 MBTI 类型 ({mbtiType}) 暂无匹配的职业推荐</p>
          <Link
            to="/mbti-test"
            className="inline-block px-6 py-2 rounded-full text-white font-medium"
            style={{ background: primary[700] }}
          >
            重新测试
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
          <div className="flex items-center gap-3 mb-4">
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, ...smoothTransition }}
              className="px-3 py-1 text-sm font-bold rounded-full"
              style={{ background: 'var(--tag-bg)', color: 'var(--tag-text)' }}
            >
              {mbtiType}
            </motion.span>
            <span className="text-text-muted">型人格推荐</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-4 text-text-primary">
            AI 职业探索
          </h1>
          <p className="text-lg max-w-2xl text-text-secondary">
            基于你的性格特质，我们为你推荐最适合的 AI 领域职业方向
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Career List */}
          <motion.div
            initial={{ opacity: 0, x: -30, filter: 'blur(10px)' }}
            animate={isInView ? { opacity: 1, x: 0, filter: 'blur(0px)' } : {}}
            transition={{ delay: 0.2, duration: durations.slow, ease: easings.smooth }}
            className="lg:col-span-1"
          >
            <GlassCard variant="standard" color="white" className="p-6 sticky top-8">
              <h2 className="text-lg font-bold mb-4 text-text-primary">适合你的职业</h2>
              <div className="space-y-3">
                {careers.map((career) => {
                  const isSelected = selectedCareer === career.id
                  const Icon = getCareerIcon(career.name)
                  return (
                    <motion.button
                      key={career.id}
                      onClick={() => setSelectedCareer(career.id)}
                      whileHover={{ x: 5 }}
                      className="w-full text-left p-4 rounded-2xl transition-all duration-200 cursor-pointer"
                      style={isSelected ? {
                        background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`,
                        color: 'white',
                        boxShadow: '0 8px 24px rgba(71, 85, 105, 0.25)',
                      } : {
                        background: 'rgba(255,255,255,0.6)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-primary)',
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-6 h-6" strokeWidth={1.5} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{career.name}</p>
                          <p className="text-xs" style={{ opacity: 0.7 }}>{career.salaryRange}</p>
                        </div>
                      </div>
                    </motion.button>
                  )
                })}
              </div>
            </GlassCard>
          </motion.div>

          {/* Career Detail */}
          <motion.div
            initial={{ opacity: 0, x: 30, filter: 'blur(10px)' }}
            animate={isInView ? { opacity: 1, x: 0, filter: 'blur(0px)' } : {}}
            transition={{ delay: 0.3, duration: durations.slow, ease: easings.smooth }}
            className="lg:col-span-2 space-y-6"
          >
            {selectedCareerData && (() => {
              const DetailIcon = getCareerIcon(selectedCareerData.name)
              return (
                <>
                  {/* Main Card */}
                  <motion.div
                    key={selectedCareerData.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <GlassCard variant="standard" color="white" className="p-8">
                      <div className="flex items-start gap-6 mb-8">
                        <div
                          className="w-20 h-20 rounded-2xl flex items-center justify-center"
                          style={{ background: `linear-gradient(135deg, ${primary[500]} 0%, ${primary[700]} 100%)` }}
                        >
                          <DetailIcon className="w-10 h-10 text-white" strokeWidth={1.5} />
                        </div>
                        <div className="flex-1">
                          <h2 className="text-2xl md:text-3xl font-bold mb-2 text-text-primary">
                            {selectedCareerData.name}
                          </h2>
                          <p className="mb-4 text-text-secondary">{selectedCareerData.description}</p>
                          <div className="flex flex-wrap gap-2">
                            <span
                              className="px-3 py-1 text-sm font-medium rounded-full"
                              style={{ background: 'var(--tag-info-bg)', color: 'var(--tag-info-text)' }}
                            >
                              {selectedCareerData.demandLevel === 'high' ? (
                                <><Flame className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />需求旺盛</>
                              ) : selectedCareerData.demandLevel === 'medium' ? '需求中等' : '需求一般'}
                            </span>
                            {selectedCareerData.suitableMBTI.length > 0 && (
                              <span
                                className="px-3 py-1 text-sm font-medium rounded-full"
                                style={{ background: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                              >
                                <Sparkles className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />
                                适合 {selectedCareerData.suitableMBTI.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-2 gap-6 pt-6 border-t border-border-primary">
                        <div>
                          <p className="text-sm mb-1 text-text-muted">薪资范围</p>
                          <p className="text-xl font-bold text-text-primary">{selectedCareerData.salaryRange}</p>
                        </div>
                        <div>
                          <p className="text-sm mb-1 text-text-muted">市场需求</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full overflow-hidden bg-border-primary">
                              <div
                                className="h-full"
                                style={{
                                  width: selectedCareerData.demandLevel === 'high' ? '100%' : selectedCareerData.demandLevel === 'medium' ? '65%' : '35%',
                                  background: `linear-gradient(90deg, ${primary[500]} 0%, ${primary[700]} 100%)`
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>

                  {/* Skills */}
                  {selectedCareerData.requiredSkills.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                    >
                      <GlassCard variant="standard" color="white" className="p-8">
                        <h3 className="text-xl font-bold mb-6 text-text-primary">核心技能要求</h3>
                        <div className="space-y-4">
                          {selectedCareerData.requiredSkills.map((skill) => (
                            <div
                              key={skill.id}
                              className="flex items-center justify-between p-4 rounded-xl transition-colors bg-bg-primary hover:bg-bg-tertiary"
                            >
                              <div>
                                <p className="font-semibold text-text-primary">{skill.name}</p>
                                {skill.description && (
                                  <p className="text-sm text-text-muted">{skill.description}</p>
                                )}
                              </div>
                              <span className="text-xs px-2 py-1 rounded-full bg-bg-tertiary text-text-muted">
                                {skill.category}
                              </span>
                            </div>
                          ))}
                        </div>
                      </GlassCard>
                    </motion.div>
                  )}

                  {/* AI Insight */}
                  {selectedCareerData && (
                    <AIInsightButton
                      agentName="career-advisor"
                      prompt={`分析「${selectedCareerData.name}」这个职业对 MBTI 类型 ${mbtiType} 的匹配度，包括优势、挑战和发展建议`}
                      studentId={localStorage.getItem('studentId') || undefined}
                      label="AI 职业分析"
                      className="mb-4"
                    />
                  )}

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row gap-4">
                    <Link
                      to="/learning-path"
                      className="flex-1 px-6 py-4 text-white rounded-2xl font-semibold transition-colors text-center"
                      style={{ background: primary[800] }}
                    >
                      <Sparkles className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} /> 查看学习路径
                    </Link>
                    <Link
                      to="/ai-advisor"
                      className="flex-1 px-6 py-4 bg-bg-secondary rounded-2xl font-semibold transition-colors text-center text-text-primary border border-border-primary"
                    >
                      <MessageSquare className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} /> 咨询 AI 助手
                    </Link>
                  </div>
                </>
              )
            })()}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
