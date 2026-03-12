/**
 * 量表题型组件
 */

import { motion } from 'framer-motion'
import type { ScaleQuestion as ScaleQuestionType, ScaleAnswer } from '../../types/mbti'
import { primary } from '../../theme/colors'

interface ScaleQuestionProps {
  question: ScaleQuestionType
  answer?: ScaleAnswer
  onAnswer: (answer: ScaleAnswer) => void
}

export default function ScaleQuestion({ question, answer, onAnswer }: ScaleQuestionProps) {
  const scalePoints = Array.from({ length: question.scaleSize }, (_, i) => i + 1)
  const midPoint = Math.ceil(question.scaleSize / 2)

  const handleSelect = (value: number) => {
    onAnswer({
      questionId: question.id,
      type: 'scale',
      value,
    })
  }

  return (
    <div className="space-y-8">
      {/* 题目文本 */}
      <h2 
        className="text-xl md:text-2xl font-bold leading-relaxed text-center text-text-primary"
      >
        {question.text}
      </h2>

      {/* 量表 */}
      <div className="space-y-4">
        {/* 标签 */}
        <div className="flex justify-between text-sm font-medium px-2">
          <span style={{ color: 'var(--accent-text)' }}>{question.leftLabel}</span>
          <span style={{ color: 'var(--accent-text)' }}>{question.rightLabel}</span>
        </div>

        {/* 刻度点 */}
        <div className="flex justify-between items-center gap-2 md:gap-4">
          {scalePoints.map((point) => {
            const isSelected = answer?.value === point
            const isNeutral = point === midPoint
            
            return (
              <motion.button
                key={point}
                onClick={() => handleSelect(point)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="flex-1 flex flex-col items-center gap-2"
              >
                <div 
                  className="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center border-2 transition-all duration-200"
                  style={{
                    borderColor: isSelected ? primary[600] : 'var(--border-primary)',
                    background: isSelected 
                      ? `linear-gradient(135deg, ${primary[500]} 0%, ${primary[700]} 100%)`
                      : isNeutral 
                        ? 'var(--bg-tertiary)'
                        : 'var(--bg-card)',
                    boxShadow: isSelected ? `0 4px 12px ${primary[500]}40` : 'none',
                  }}
                >
                  <span 
                    className="text-sm font-bold"
                    style={{ color: isSelected ? 'white' : 'var(--text-secondary)' }}
                  >
                    {point}
                  </span>
                </div>
              </motion.button>
            )
          })}
        </div>

        {/* 说明文字 */}
        <div className="flex justify-between text-xs px-2 text-text-muted">
          <span>非常同意左边</span>
          <span>中立</span>
          <span>非常同意右边</span>
        </div>
      </div>
    </div>
  )
}
