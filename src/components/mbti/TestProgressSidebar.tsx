/**
 * 测试进度侧边栏组件
 * 
 * 显示进度、剩余时间、维度统计
 */

import { motion } from 'framer-motion'
import type { Question, Answer } from '../../types/mbti'
import { primary } from '../../theme/colors'

interface TestProgressSidebarProps {
  currentIndex: number
  totalQuestions: number
  answers: Record<string, Answer>
  questions: Question[]
  estimatedMinutes: number
  startTime: Date
}

// 计算维度进度
function calculateDimensionProgress(
  questions: Question[],
  answers: Record<string, Answer>
) {
  const dimensions = {
    EI: { total: 0, answered: 0 },
    SN: { total: 0, answered: 0 },
    TF: { total: 0, answered: 0 },
    JP: { total: 0, answered: 0 },
  }

  questions.forEach(q => {
    dimensions[q.dimension].total++
    if (answers[q.id]) {
      dimensions[q.dimension].answered++
    }
  })

  return dimensions
}

// 格式化时间
function formatTime(minutes: number): string {
  if (minutes < 1) return '不到 1 分钟'
  if (minutes < 60) return `约 ${Math.round(minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return `约 ${hours} 小时 ${mins} 分钟`
}

export default function TestProgressSidebar({
  currentIndex,
  totalQuestions,
  answers,
  questions,
  estimatedMinutes,
  startTime,
}: TestProgressSidebarProps) {
  const answeredCount = Object.keys(answers).length
  const progress = (answeredCount / totalQuestions) * 100
  const dimensions = calculateDimensionProgress(questions, answers)

  // 估算剩余时间
  const elapsedMinutes = (Date.now() - startTime.getTime()) / 1000 / 60
  const avgTimePerQuestion = answeredCount > 0 ? elapsedMinutes / answeredCount : estimatedMinutes / totalQuestions
  const remainingQuestions = totalQuestions - answeredCount
  const estimatedRemainingMinutes = remainingQuestions * avgTimePerQuestion

  const dimensionLabels = {
    EI: { name: 'E/I', desc: '外向/内向' },
    SN: { name: 'S/N', desc: '感觉/直觉' },
    TF: { name: 'T/F', desc: '思考/情感' },
    JP: { name: 'J/P', desc: '判断/感知' },
  }

  return (
    <div 
      className="p-6 rounded-2xl h-fit sticky top-6 border border-border-primary"
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* 标题 */}
      <h3 
        className="text-lg font-bold mb-6 text-text-primary"
      >
        测试进度
      </h3>

      {/* 总进度条 */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-text-secondary">完成进度</span>
          <span className="font-medium" style={{ color: 'var(--accent-text)' }}>
            {Math.round(progress)}%
          </span>
        </div>
        <div 
          className="h-2 rounded-full overflow-hidden bg-border-primary"
        >
          <motion.div
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${primary[500]} 0%, ${primary[700]} 100%)` }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* 统计数据 */}
      <div className="space-y-4 mb-6">
        <div className="flex justify-between">
          <span className="text-sm text-text-muted">已完成</span>
          <span className="text-sm font-medium text-text-primary">
            {answeredCount} / {totalQuestions} 题
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-text-muted">当前题目</span>
          <span className="text-sm font-medium text-text-primary">
            第 {currentIndex + 1} 题
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-text-muted">预计剩余</span>
          <span className="text-sm font-medium text-text-primary">
            {formatTime(estimatedRemainingMinutes)}
          </span>
        </div>
      </div>

      {/* 分割线 */}
      <div className="border-t my-6 border-border-primary" />

      {/* 维度进度 */}
      <div>
        <h4 
          className="text-sm font-medium mb-4 text-text-secondary"
        >
          维度进度
        </h4>
        <div className="space-y-3">
          {(Object.entries(dimensions) as [keyof typeof dimensions, typeof dimensions.EI][]).map(([key, value]) => {
            const dimProgress = value.total > 0 ? (value.answered / value.total) * 100 : 0
            return (
              <div key={key}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-secondary">
                    {dimensionLabels[key].name}
                    <span className="ml-1 text-text-muted">
                      {dimensionLabels[key].desc}
                    </span>
                  </span>
                  <span className="text-text-muted">
                    {value.answered}/{value.total}
                  </span>
                </div>
                <div 
                  className="h-1.5 rounded-full overflow-hidden bg-border-primary"
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: primary[400] }}
                    initial={{ width: 0 }}
                    animate={{ width: `${dimProgress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
