/**
 * 排序题型组件
 * 
 * 使用拖拽排序功能
 */

import { useState, useEffect } from 'react'
import { motion, Reorder } from 'framer-motion'
import type { RankingQuestion as RankingQuestionType, RankingAnswer } from '../../types/mbti'
import { primary } from '../../theme/colors'

interface RankingQuestionProps {
  question: RankingQuestionType
  answer?: RankingAnswer
  onAnswer: (answer: RankingAnswer) => void
}

interface RankItem {
  id: string
  text: string
  value: string
}

export default function RankingQuestion({ question, answer, onAnswer }: RankingQuestionProps) {
  // 初始化排序状态
  const [items, setItems] = useState<RankItem[]>(() => {
    if (answer?.order) {
      // 根据已有答案恢复顺序
      return answer.order.map(id => {
        const item = question.items.find(i => i.id === id)
        return item || { id, text: '', value: '' }
      }).filter(item => item.text)
    }
    return question.items.map(item => ({
      id: item.id,
      text: item.text,
      value: item.value,
    }))
  })

  // 当排序变化时更新答案
  useEffect(() => {
    const order = items.map(item => item.id)
    onAnswer({
      questionId: question.id,
      type: 'ranking',
      order,
    })
  }, [items, question.id, onAnswer])

  return (
    <div className="space-y-6">
      {/* 题目文本 */}
      <h2 
        className="text-xl md:text-2xl font-bold leading-relaxed text-text-primary"
      >
        {question.text}
      </h2>

      {/* 说明 */}
      <div 
        className="flex items-center gap-2 text-sm text-text-muted"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
        <span>拖拽调整顺序，从最喜欢到最不喜欢</span>
      </div>

      {/* 可拖拽列表 */}
      <Reorder.Group 
        axis="y" 
        values={items} 
        onReorder={setItems}
        className="space-y-3"
      >
        {items.map((item, index) => (
          <Reorder.Item
            key={item.id}
            value={item}
            className="cursor-grab active:cursor-grabbing"
          >
            <motion.div
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="p-4 rounded-xl border flex items-center gap-4 transition-shadow hover:shadow-md"
              style={{
                background: 'var(--bg-card)',
                borderColor: 'var(--border-primary)',
              }}
            >
              {/* 排名数字 */}
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{
                  background: index === 0 
                    ? `linear-gradient(135deg, ${primary[500]} 0%, ${primary[700]} 100%)`
                    : 'var(--bg-tertiary)',
                  color: index === 0 ? 'white' : 'var(--text-secondary)',
                }}
              >
                {index + 1}
              </div>

              {/* 拖拽手柄 */}
              <div 
                className="flex-shrink-0 text-text-muted"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </div>

              {/* 选项文本 */}
              <span 
                className="font-medium flex-1 text-text-primary"
              >
                {item.text}
              </span>

              {/* 排名标签 */}
              {index === 0 && (
                <span 
                  className="text-xs px-2 py-1 rounded-full"
                  style={{
                    background: 'var(--accent-bg)',
                    color: 'var(--accent-text)',
                  }}
                >
                  最喜欢
                </span>
              )}
              {index === items.length - 1 && (
                <span 
                  className="text-xs px-2 py-1 rounded-full"
                  style={{ 
                    background: 'color-mix(in srgb, var(--text-muted) 8%, transparent)',
                    color: 'var(--text-muted)',
                  }}
                >
                  最不喜欢
                </span>
              )}
            </motion.div>
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </div>
  )
}
