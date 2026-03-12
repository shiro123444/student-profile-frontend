/**
 * MBTI 测试页面 - 重新设计版
 * 
 * 特色：
 * - Claude 风格左右分栏布局
 * - 多种测试类型选择
 * - 多种题目类型支持
 * - 进度保存和恢复
 * - 统一的专业蓝灰色配色
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { mbtiApi } from '../services/api'
import { 
  TestSelector, 
  BinaryQuestion, 
  ScaleQuestion, 
  ScenarioQuestion, 
  RankingQuestion,
  TestProgressSidebar,
} from '../components/mbti'
import { testCategories, getTestCategory, testCategoryIcons } from '../data/testCategories'
import { getQuestionsByCategory } from '../data/questions'
import type { 
  Question, 
  Answer, 
  TestProgress,
  BinaryQuestion as BinaryQuestionType,
  ScaleQuestion as ScaleQuestionType,
  ScenarioQuestion as ScenarioQuestionType,
  RankingQuestion as RankingQuestionType,
  BinaryAnswer,
  MBTIValue,
} from '../types/mbti'
import { primary } from '../theme/colors'
import { BreathingOrb } from '../components/animations'

// localStorage key
const PROGRESS_KEY_PREFIX = 'mbti_progress_'

// 获取保存的进度
function getSavedProgress(): TestProgress | null {
  for (const cat of testCategories) {
    const saved = localStorage.getItem(`${PROGRESS_KEY_PREFIX}${cat.id}`)
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {
        continue
      }
    }
  }
  return null
}

// 保存进度
function saveProgress(progress: TestProgress) {
  localStorage.setItem(
    `${PROGRESS_KEY_PREFIX}${progress.testCategoryId}`,
    JSON.stringify(progress)
  )
}

// 清除进度
function clearProgress(categoryId: string) {
  localStorage.removeItem(`${PROGRESS_KEY_PREFIX}${categoryId}`)
}

export default function MBTITestPage() {
  const navigate = useNavigate()
  
  // 状态
  const [phase, setPhase] = useState<'select' | 'name' | 'test'>('select')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [studentName, setStudentName] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [questions, setQuestions] = useState<Question[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [startTime, setStartTime] = useState<Date>(new Date())
  const [savedProgress, setSavedProgress] = useState<TestProgress | null>(null)

  // 加载保存的进度
  useEffect(() => {
    const progress = getSavedProgress()
    setSavedProgress(progress)
  }, [])

  // 选择测试类型
  const handleSelectTest = (categoryId: string) => {
    const existingProgress = localStorage.getItem(`${PROGRESS_KEY_PREFIX}${categoryId}`)
    
    if (existingProgress) {
      // 有未完成的测试，询问是否继续
      const progress: TestProgress = JSON.parse(existingProgress)
      setSelectedCategory(categoryId)
      setQuestions(getQuestionsByCategory(categoryId))
      setCurrentIndex(progress.currentQuestionIndex)
      setAnswers(progress.answers)
      setStartTime(new Date(progress.startedAt))
      setPhase('test')
    } else {
      setSelectedCategory(categoryId)
      setQuestions(getQuestionsByCategory(categoryId))
      setPhase('name')
    }
  }

  // 开始测试
  const handleStartTest = () => {
    if (!selectedCategory) return
    setStartTime(new Date())
    setPhase('test')
    
    // 保存初始进度
    saveProgress({
      testCategoryId: selectedCategory,
      currentQuestionIndex: 0,
      answers: {},
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    })
  }

  // 回答问题
  const handleAnswer = useCallback((answer: Answer) => {
    setAnswers(prev => {
      const newAnswers = { ...prev, [answer.questionId]: answer }
      
      // 保存进度
      if (selectedCategory) {
        saveProgress({
          testCategoryId: selectedCategory,
          currentQuestionIndex: currentIndex,
          answers: newAnswers,
          startedAt: startTime.toISOString(),
          lastUpdatedAt: new Date().toISOString(),
        })
      }
      
      return newAnswers
    })

    // 自动跳转到下一题（仅对二选一题型）
    if (answer.type === 'binary' && currentIndex < questions.length - 1) {
      setTimeout(() => setCurrentIndex(prev => prev + 1), 300)
    }
  }, [selectedCategory, currentIndex, startTime, questions.length])

  // 上一题
  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1)
    }
  }

  // 下一题
  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1)
    }
  }

  // 计算 MBTI 结果
  const calculateMBTI = () => {
    const counts: Record<MBTIValue, number> = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 }
    
    Object.values(answers).forEach(answer => {
      if (answer.type === 'binary') {
        counts[answer.selectedValue]++
      } else if (answer.type === 'scale') {
        const question = questions.find(q => q.id === answer.questionId) as ScaleQuestionType
        if (question) {
          const midPoint = Math.ceil(question.scaleSize / 2)
          if (answer.value < midPoint) {
            counts[question.leftValue] += (midPoint - answer.value)
          } else if (answer.value > midPoint) {
            counts[question.rightValue] += (answer.value - midPoint)
          }
        }
      } else if (answer.type === 'scenario') {
        const question = questions.find(q => q.id === answer.questionId) as ScenarioQuestionType
        if (question) {
          const selected = question.options[answer.selectedIndex]
          counts[selected.value] += selected.weight
        }
      } else if (answer.type === 'ranking') {
        const question = questions.find(q => q.id === answer.questionId) as RankingQuestionType
        if (question) {
          answer.order.forEach((itemId, index) => {
            const item = question.items.find(i => i.id === itemId)
            if (item) {
              // 排名越靠前权重越高
              counts[item.value as MBTIValue] += (question.items.length - index)
            }
          })
        }
      }
    })

    return [
      counts.E >= counts.I ? 'E' : 'I',
      counts.S >= counts.N ? 'S' : 'N',
      counts.T >= counts.F ? 'T' : 'F',
      counts.J >= counts.P ? 'J' : 'P',
    ].join('')
  }

  // 提交测试
  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      alert('请回答所有问题')
      return
    }

    setIsSubmitting(true)
    const mbtiType = calculateMBTI()

    // 转换答案格式（兼容旧 API）
    const formattedAnswers = Object.entries(answers).map(([questionId, answer]) => {
      if (answer.type === 'binary') {
        const question = questions.find(q => q.id === questionId) as BinaryQuestionType
        return {
          questionId: parseInt(questionId.replace(/\D/g, '')) || 1,
          answer: question?.options[0].value === (answer as BinaryAnswer).selectedValue ? 'A' : 'B' as 'A' | 'B',
        }
      }
      return {
        questionId: parseInt(questionId.replace(/\D/g, '')) || 1,
        answer: 'A' as 'A' | 'B',
      }
    })

    try {
      const result = await mbtiApi.submit({
        studentName: studentName || '匿名学生',
        answers: formattedAnswers,
      })

      // 清除进度
      if (selectedCategory) {
        clearProgress(selectedCategory)
      }

      if (result.studentId) {
        localStorage.setItem('studentId', result.studentId)
        localStorage.setItem('studentName', studentName || '匿名学生')
        localStorage.setItem('mbtiCode', result.mbtiCode)
        const dimensionParams = new URLSearchParams({
          type: result.mbtiCode,
          E: result.dimensions.E.toString(),
          I: result.dimensions.I.toString(),
          S: result.dimensions.S.toString(),
          N: result.dimensions.N.toString(),
          T: result.dimensions.T.toString(),
          F: result.dimensions.F.toString(),
          J: result.dimensions.J.toString(),
          P: result.dimensions.P.toString(),
        })
        navigate(`/results?${dimensionParams.toString()}`)
      } else {
        localStorage.setItem('mbtiCode', mbtiType)
        localStorage.setItem('studentName', studentName || '匿名学生')
        navigate(`/results?type=${mbtiType}`)
      }
    } catch {
      localStorage.setItem('mbtiCode', mbtiType)
      localStorage.setItem('studentName', studentName || '匿名学生')
      navigate(`/results?type=${mbtiType}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  // 渲染题目组件
  const renderQuestion = (question: Question) => {
    const answer = answers[question.id]
    
    switch (question.type) {
      case 'binary':
        return (
          <BinaryQuestion
            question={question}
            answer={answer as BinaryAnswer | undefined}
            onAnswer={handleAnswer}
          />
        )
      case 'scale':
        return (
          <ScaleQuestion
            question={question}
            answer={answer as any}
            onAnswer={handleAnswer}
          />
        )
      case 'scenario':
        return (
          <ScenarioQuestion
            question={question}
            answer={answer as any}
            onAnswer={handleAnswer}
          />
        )
      case 'ranking':
        return (
          <RankingQuestion
            question={question}
            answer={answer as any}
            onAnswer={handleAnswer}
          />
        )
      default:
        return null
    }
  }

  const currentQuestion = questions[currentIndex]
  const category = selectedCategory ? getTestCategory(selectedCategory) : null
  const progress = (currentIndex + 1) / questions.length * 100

  return (
    <div
      className="min-h-screen relative"
      style={{
        background: 'var(--bg-primary)',
      }}
    >
      {/* 背景呼吸光晕 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <BreathingOrb 
          color="rgba(226,232,240,0.3)"
          size={600}
          position={{ top: '-15%', right: '-10%' }}
          phaseOffset={0}
        />
        <BreathingOrb 
          color="rgba(241,245,249,0.25)"
          size={500}
          position={{ bottom: '-10%', left: '20%' }}
          phaseOffset={0.5}
        />
      </div>

      <AnimatePresence mode="wait">
        {/* 测试选择阶段 */}
        {phase === 'select' && (
          <motion.div
            key="select"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, filter: 'blur(10px)' }}
            transition={{ duration: 0.4 }}
          >
            <TestSelector 
              onSelectTest={handleSelectTest}
              savedProgress={savedProgress}
            />
          </motion.div>
        )}

        {/* 姓名输入阶段 */}
        {phase === 'name' && (
          <motion.div
            key="name"
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, filter: 'blur(10px)' }}
            transition={{ duration: 0.4 }}
            className="min-h-screen flex items-center justify-center p-6"
          >
            <div className="w-full max-w-md">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="p-8 rounded-3xl border border-border-primary"
                style={{
                  background: 'var(--bg-card)',
                  backdropFilter: 'blur(20px)',
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.08)',
                }}
              >
                {/* 返回按钮 */}
                <button
                  onClick={() => setPhase('select')}
                  className="flex items-center gap-2 mb-6 transition-colors text-text-muted"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  返回选择
                </button>

                {/* 图标 */}
                <div className="flex justify-center mb-6">
                  <div 
                    className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{ 
                      background: `linear-gradient(135deg, ${primary[500]} 0%, ${primary[700]} 100%)`,
                      boxShadow: `0 8px 24px ${primary[500]}40`,
                    }}
                  >
                    <span className="text-3xl">{(() => { const Icon = category ? testCategoryIcons[category.icon] : null; return Icon ? <Icon className="w-8 h-8 text-white" strokeWidth={1.5} /> : null })()}</span>
                  </div>
                </div>

                <h1 
                  className="text-2xl font-black text-center mb-2 text-text-primary"
                >
                  {category?.name}
                </h1>
                <p 
                  className="text-center mb-8 text-text-secondary"
                >
                  {category?.questionCount} 题 · 约 {category?.estimatedMinutes} 分钟
                </p>

                <div className="space-y-6">
                  <div>
                    <label 
                      className="block text-sm font-medium mb-2 text-text-secondary"
                    >
                      你的名字（可选）
                    </label>
                    <input
                      type="text"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      placeholder="请输入你的名字"
                      className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 transition-all bg-bg-primary border-border-primary text-text-primary"
                    />
                  </div>

                  <button
                    onClick={handleStartTest}
                    className="w-full py-4 rounded-xl font-semibold text-white transition-all hover:scale-[1.02]"
                    style={{ 
                      background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`,
                      boxShadow: `0 4px 12px ${primary[500]}30`,
                    }}
                  >
                    开始测试 →
                  </button>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}

        {/* 测试进行阶段 */}
        {phase === 'test' && currentQuestion && (
          <motion.div
            key="test"
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, filter: 'blur(10px)' }}
            transition={{ duration: 0.4 }}
            className="min-h-screen py-8 px-6 md:px-12"
          >
            <div className="max-w-6xl mx-auto">
              {/* 顶部导航 */}
              <div className="flex items-center justify-between mb-6">
                <Link 
                  to="/dashboard" 
                  className="flex items-center gap-2 transition-colors text-text-muted"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  退出测试
                </Link>
                <span 
                  className="text-sm font-medium text-text-secondary"
                >
                  {currentIndex + 1} / {questions.length}
                </span>
              </div>

              {/* 进度条 */}
              <div 
                className="h-1 rounded-full mb-8 overflow-hidden bg-border-primary"
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${primary[500]} 0%, ${primary[700]} 100%)` }}
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* 主内容区 - 左右分栏 */}
              <div className="grid lg:grid-cols-3 gap-8">
                {/* 左侧：题目区域 */}
                <div className="lg:col-span-2">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentQuestion.id}
                      initial={{ opacity: 0, x: 30, filter: 'blur(8px)' }}
                      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, x: -30, filter: 'blur(8px)' }}
                      transition={{ duration: 0.3 }}
                      className="p-8 rounded-3xl border border-border-primary"
                      style={{
                        background: 'var(--bg-card)',
                        backdropFilter: 'blur(20px)',
                      }}
                    >
                      {/* 题目类型标签 */}
                      <div className="flex items-center gap-2 mb-6">
                        <span
                          className="text-xs px-2 py-1 rounded-full"
                          style={{
                            background: 'var(--accent-bg)',
                            color: 'var(--accent-text)',
                          }}
                        >
                          问题 {currentIndex + 1}
                        </span>
                        <span 
                          className="text-xs text-text-muted"
                        >
                          {currentQuestion.dimension === 'EI' && '外向/内向'}
                          {currentQuestion.dimension === 'SN' && '感觉/直觉'}
                          {currentQuestion.dimension === 'TF' && '思考/情感'}
                          {currentQuestion.dimension === 'JP' && '判断/感知'}
                        </span>
                      </div>

                      {/* 题目内容 */}
                      {renderQuestion(currentQuestion)}

                      {/* 导航按钮 */}
                      <div className="flex justify-between items-center mt-8 pt-6 border-t border-border-primary">
                        <button
                          disabled={currentIndex === 0}
                          onClick={handlePrev}
                          className="px-4 py-2 rounded-xl font-medium transition-colors disabled:opacity-50 text-text-secondary"
                        >
                          ← 上一题
                        </button>

                        {currentIndex === questions.length - 1 ? (
                          <button
                            disabled={isSubmitting || Object.keys(answers).length < questions.length}
                            onClick={handleSubmit}
                            className="px-8 py-3 rounded-xl font-semibold text-white transition-all disabled:opacity-50"
                            style={{ 
                              background: `linear-gradient(135deg, ${primary[600]} 0%, ${primary[800]} 100%)`,
                            }}
                          >
                            {isSubmitting ? '提交中...' : '提交测试 →'}
                          </button>
                        ) : (
                          <button
                            disabled={!answers[currentQuestion.id]}
                            onClick={handleNext}
                            className="px-4 py-2 rounded-xl font-medium transition-colors disabled:opacity-50 text-text-secondary"
                          >
                            下一题 →
                          </button>
                        )}
                      </div>
                    </motion.div>
                  </AnimatePresence>

                  {/* 题目导航点 */}
                  <div className="flex justify-center gap-1.5 mt-6 flex-wrap">
                    {questions.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setCurrentIndex(index)}
                        className="h-2 rounded-full transition-all duration-200"
                        style={{
                          width: index === currentIndex ? 24 : 8,
                          background: index === currentIndex 
                            ? primary[600]
                            : answers[questions[index].id] 
                              ? primary[300]
                              : 'var(--border-primary)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* 右侧：进度侧边栏 */}
                <div className="hidden lg:block">
                  <TestProgressSidebar
                    currentIndex={currentIndex}
                    totalQuestions={questions.length}
                    answers={answers}
                    questions={questions}
                    estimatedMinutes={category?.estimatedMinutes || 20}
                    startTime={startTime}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
