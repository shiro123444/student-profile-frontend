/**
 * 二选一题型组件
 */

import { motion } from 'framer-motion'
import type { BinaryQuestion as BinaryQuestionType, BinaryAnswer } from '../../types/mbti'
// theme/colors import removed (neutral unused)

interface BinaryQuestionProps {
  question: BinaryQuestionType
  answer?: BinaryAnswer
  onAnswer: (answer: BinaryAnswer) => void
}

export default function BinaryQuestion({ question, answer, onAnswer }: BinaryQuestionProps) {
  const handleSelect = (value: BinaryQuestionType['options'][0]['value']) => {
    onAnswer({
      questionId: question.id,
      type: 'binary',
      selectedValue: value,
    })
  }

  return (
    <div className="space-y-6">
      {/* 题目文本 */}
      <h2 
        className="text-xl md:text-2xl font-bold leading-relaxed text-text-primary"
      >
        {question.text}
      </h2>

      {/* 选项 */}
      <div className="space-y-4">
        {question.options.map((option, index) => {
          const isSelected = answer?.selectedValue === option.value
          return (
            <motion.button
              key={index}
              onClick={() => handleSelect(option.value)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full p-5 rounded-2xl text-left transition-all duration-200 flex items-center gap-4 border"
              style={{
                borderColor: isSelected ? '#64748B' : 'var(--border-primary)',
                background: isSelected ? 'rgba(100,116,139,0.1)' : 'var(--bg-card)',
              }}
            >
              {/* 选择圆圈 */}
              <div 
                className="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                style={{
                  borderColor: isSelected ? '#64748B' : 'var(--border-primary)',
                  background: isSelected ? '#64748B' : 'transparent',
                }}
              >
                {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>

              {/* 选项文本 */}
              <span 
                className="font-medium text-text-primary"
              >
                {option.text}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
