import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from 'recharts'
import { GlassCard } from '../components/ui'
import { easings, durations } from '../theme/motion'
import { primary } from '../theme/colors'
import { mbtiApi } from '../services/api'
import type { MBTIType, Career } from '../services/api'
import { Sparkles, Target, BookOpen, MessageSquare, RotateCcw, Loader2, AlertCircle } from 'lucide-react'
import AIInsightButton from '../components/ui/AIInsightButton'

// Strengths mapping - personality-derived, not API data
const mbtiStrengths: Record<string, string[]> = {
  INTJ: ['战略思维', '独立自主', '逻辑分析', '追求卓越'],
  INTP: ['逻辑思维', '创新能力', '问题解决', '知识渴求'],
  ENTJ: ['领导能力', '决策果断', '目标导向', '高效执行'],
  ENTP: ['创新思维', '适应能力', '沟通技巧', '挑战精神'],
  INFJ: ['洞察力', '同理心', '创造力', '坚持理想'],
  INFP: ['创造力', '同理心', '适应性', '理想主义'],
  ENFJ: ['领导魅力', '沟通能力', '团队协作', '激励他人'],
  ENFP: ['创造力', '热情', '适应性', '人际交往'],
  ISTJ: ['可靠性', '组织能力', '注重细节', '责任心'],
  ISFJ: ['可靠性', '耐心', '细心', '奉献精神'],
  ESTJ: ['组织能力', '领导力', '执行力', '责任心'],
  ESFJ: ['社交能力', '同理心', '组织能力', '合作精神'],
  ISTP: ['动手能力', '问题解决', '适应性', '冷静'],
  ISFP: ['创造力', '审美', '适应性', '同理心'],
  ESTP: ['行动力', '适应性', '社交能力', '问题解决'],
  ESFP: ['热情', '社交能力', '适应性', '乐观'],
}

export default function ResultsPage() {
  const [searchParams] = useSearchParams()
  const mbtiType = searchParams.get('type') || 'INTJ'

  const [typeInfo, setTypeInfo] = useState<MBTIType | null>(null)
  const [careers, setCareers] = useState<Career[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      mbtiApi.getType(mbtiType),
      mbtiApi.getRecommendedCareers(mbtiType),
    ])
      .then(([type, careerData]) => {
        setTypeInfo(type)
        setCareers(careerData || [])
      })
      .catch((err) => setError(err.message || '获取结果失败'))
      .finally(() => setLoading(false))
  }, [mbtiType])

  const strengths = typeInfo?.strengths || mbtiStrengths[mbtiType] || ['分析能力', '学习能力', '适应性', '专注']

  const dimensions = [
    { name: '外向 E', value: mbtiType.includes('E') ? 75 : 25 },
    { name: '直觉 N', value: mbtiType.includes('N') ? 70 : 30 },
    { name: '思考 T', value: mbtiType.includes('T') ? 80 : 20 },
    { name: '判断 J', value: mbtiType.includes('J') ? 65 : 35 },
  ]

  const dimensionBars = [
    { left: { label: '内向 (I)', value: mbtiType.includes('I') ? 65 : 35 }, right: { label: '外向 (E)', value: mbtiType.includes('E') ? 65 : 35 } },
    { left: { label: '实感 (S)', value: mbtiType.includes('S') ? 60 : 40 }, right: { label: '直觉 (N)', value: mbtiType.includes('N') ? 60 : 40 } },
    { left: { label: '思考 (T)', value: mbtiType.includes('T') ? 70 : 30 }, right: { label: '情感 (F)', value: mbtiType.includes('F') ? 70 : 30 } },
    { left: { label: '判断 (J)', value: mbtiType.includes('J') ? 55 : 45 }, right: { label: '知觉 (P)', value: mbtiType.includes('P') ? 55 : 45 } },
  ]

  const smoothTransition = { duration: durations.slow, ease: easings.smooth }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-text-muted" strokeWidth={1.5} />
          <p className="text-text-secondary">分析结果加载中...</p>
        </div>
      </div>
    )
  }

  if (error || !typeInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary px-4">
        <GlassCard variant="standard" color="white" className="max-w-md w-full p-8 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" strokeWidth={1.5} />
          <h2 className="text-lg font-bold text-text-primary mb-2">加载失败</h2>
          <p className="text-text-muted mb-4">{error || '未找到该类型信息'}</p>
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

  return (
    <div
      className="min-h-screen py-12 px-4 overflow-y-auto"
      style={{ background: 'linear-gradient(180deg, var(--bg-primary) 0%, var(--bg-secondary) 100%)' }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={smoothTransition}
          className="text-center mb-12"
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 0, filter: 'blur(10px)' }}
            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
            transition={{ delay: 0.2, duration: durations.slow, ease: easings.smooth }}
            className="inline-block mb-6"
          >
            <div
              className="w-32 h-32 rounded-3xl flex items-center justify-center shadow-2xl"
              style={{ background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)` }}
            >
              <span className="text-4xl font-black text-white">{mbtiType}</span>
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: 0.4, ...smoothTransition }}
            className="text-4xl md:text-5xl font-black mb-4 text-text-primary"
          >
            你是 "{typeInfo.name}" 型人格
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, ...smoothTransition }}
            className="text-lg max-w-2xl mx-auto text-text-secondary"
          >
            {typeInfo.description}
          </motion.p>
        </motion.div>

        {/* Strengths */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-wrap justify-center gap-3 mb-12"
        >
          {strengths.map((strength, index) => (
            <GlassCard key={strength} variant="light" color="white" className="px-4 py-2">
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.6 + index * 0.1 }}
                className="text-sm font-medium text-text-secondary"
              >
                <Sparkles className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} />{strength}
              </motion.span>
            </GlassCard>
          ))}
        </motion.div>

        {/* Charts Grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {/* Radar Chart */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
          >
            <GlassCard variant="standard" color="white" className="p-6">
              <h3 className="text-lg font-bold mb-4 text-center text-text-primary">性格维度雷达图</h3>
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={dimensions}>
                  <PolarGrid stroke="var(--border-primary)" />
                  <PolarAngleAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                  <Radar name="维度" dataKey="value" stroke={primary[600]} fill={primary[500]} fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            </GlassCard>
          </motion.div>

          {/* Dimension Bars */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.7 }}
          >
            <GlassCard variant="standard" color="white" className="p-6">
              <h3 className="text-lg font-bold mb-6 text-center text-text-primary">维度分布</h3>
              <div className="space-y-6">
                {dimensionBars.map((dim, index) => (
                  <div key={index}>
                    <div className="flex justify-between text-sm mb-2">
                      <span style={{ fontWeight: dim.left.value > dim.right.value ? 'bold' : 'normal', color: dim.left.value > dim.right.value ? 'var(--text-primary)' : 'var(--text-muted)' }}>{dim.left.label}</span>
                      <span style={{ fontWeight: dim.right.value > dim.left.value ? 'bold' : 'normal', color: dim.right.value > dim.left.value ? 'var(--text-primary)' : 'var(--text-muted)' }}>{dim.right.label}</span>
                    </div>
                    <div className="h-3 rounded-full overflow-hidden flex" style={{ background: 'var(--bg-tertiary)' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${dim.left.value}%` }}
                        transition={{ delay: 0.8 + index * 0.1, duration: 0.5 }}
                        className="h-full rounded-l-full"
                        style={{ background: `linear-gradient(90deg, ${primary[500]} 0%, ${primary[600]} 100%)` }}
                      />
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${dim.right.value}%` }}
                        transition={{ delay: 0.8 + index * 0.1, duration: 0.5 }}
                        className="h-full rounded-r-full"
                        style={{ background: 'var(--border-primary)' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>

        {/* Career Suggestions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
        >
          <GlassCard
            variant="strong"
            color="white"
            className="p-8 mb-8 text-white"
            style={{ background: `linear-gradient(135deg, ${primary[800]} 0%, ${primary[900]} 100%)` }}
          >
            <h3 className="text-2xl font-bold mb-6"><Target className="w-5 h-5 inline-block mr-2 align-text-bottom" strokeWidth={1.5} />推荐 AI 职业方向</h3>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
              {careers.map((career, index) => (
                <motion.div
                  key={career.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1 + index * 0.1 }}
                  className="backdrop-blur rounded-2xl p-4 transition-colors hover:bg-bg-hover"
                  style={{ background: 'rgba(255,255,255,0.1)' }}
                >
                  <span className="font-medium">{career.name}</span>
                  {career.salaryRange && (
                    <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>{career.salaryRange}</p>
                  )}
                </motion.div>
              ))}
            </div>
            <Link
              to={`/careers?type=${mbtiType}`}
              className="inline-flex items-center gap-2 mt-6 transition-colors hover:text-white"
              style={{ color: 'rgba(255,255,255,0.8)' }}
            >
              查看详细职业分析 →
            </Link>
          </GlassCard>
        </motion.div>

        {/* AI Insight */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="flex justify-center"
        >
          <AIInsightButton
            agentName="mbti-analyst"
            prompt={`深度解读 MBTI 类型 ${mbtiType} 的性格特点，包括认知功能栈、职业倾向和个人成长建议`}
            studentId={localStorage.getItem('studentId') || undefined}
            label="AI 性格解读"
          />
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Link
            to="/learning-path"
            className="px-8 py-4 text-white rounded-full font-semibold transition-colors text-center"
            style={{ background: primary[800] }}
          >
            <BookOpen className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} /> 查看学习路径
          </Link>
          <Link
            to="/ai-advisor"
            className="px-8 py-4 bg-bg-secondary rounded-full font-semibold transition-all text-center border-2 border-border-primary text-text-primary"
          >
            <MessageSquare className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} /> 咨询 AI 助手
          </Link>
          <Link
            to="/mbti-test"
            className="px-8 py-4 rounded-full font-semibold transition-colors text-center bg-bg-tertiary text-text-secondary"
          >
            <RotateCcw className="w-4 h-4 inline-block mr-1 align-text-bottom" strokeWidth={1.5} /> 重新测试
          </Link>
        </motion.div>
      </div>
    </div>
  )
}
