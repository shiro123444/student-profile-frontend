/**
 * 情景题型组件
 */

import { motion } from 'framer-motion'
import type { ScenarioQuestion as ScenarioQuestionType, ScenarioAnswer } from '../../types/mbti'
import { primary } from '../../theme/colors'
import { BookOpen } from 'lucide-react'

interface ScenarioQuestionProps {
  question: ScenarioQuestionType
  answer?: ScenarioAnswer
  onAnswer: (answer: ScenarioAnswer) => void
}

export default function ScenarioQuestion({ question, answer, onAnswer }: ScenarioQuestionProps) {
  const handleSelect = (index: number) => {
    onAnswer({
      questionId: question.id,
      type: 'scenario',
      selectedIndex: index,
    })
  }

  return (
    <div className="space-y-6">
      {/* 题目标题 */}
      <h2 
        className="text-xl md:text-2xl font-bold leading-relaxed text-text-primary"
      >
        {question.text}
      </h2>

      {/* 情景描述 */}
      <div 
        className="p-5 rounded-2xl"
        style={{
          background: 'var(--accent-bg)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <div className="flex items-start gap-3">
          <BookOpen className="w-6 h-6" strokeWidth={1.5} />
          <p 
            className="text-base leading-relaxed text-text-secondary"
          >
            {question.scenario}
          </p>
        </div>
      </div>

      {/* 选项 */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-text-muted">
          你会怎么做？
        </p>
        
        {question.options.map((option, index) => {
          const isSelected = answer?.selectedIndex === index
          const optionLabel = String.fromCharCode(65 + index) // A, B, C, D...
          
          return (
            <motion.button
              key={index}
              onClick={() => handleSelect(index)}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="w-full p-4 rounded-xl text-left transition-all duration-200 flex items-start gap-3 border"
              style={{
                borderColor: isSelected ? primary[500] : 'var(--border-primary)',
                background: isSelected ? `${primary[500]}10` : 'var(--bg-card)',
              }}
            >
              {/* 选项标签 */}
              <div 
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold transition-colors"
                style={{
                  background: isSelected ? primary[600] : 'var(--border-primary)',
                  color: isSelected ? 'white' : 'var(--text-secondary)',
                }}
              >
                {optionLabel}
              </div>

              {/* 选项文本 */}
              <span 
                className="font-medium pt-0.5 text-text-primary"
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
