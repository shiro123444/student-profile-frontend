/**
 * 管理后台首页 - 概览统计
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { primary } from '../../theme/colors'
import { Users, CheckCircle, FileEdit, BarChart3 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// 模拟数据
const mockStats = {
  totalStudents: 156,
  completedTests: 142,
  totalQuestions: 93,
  avgCompletionRate: 91,
}

const mockRecentResults = [
  { id: '1', name: '张三', mbtiCode: 'INTJ', completedAt: '2025-01-03 14:30' },
  { id: '2', name: '李四', mbtiCode: 'ENFP', completedAt: '2025-01-03 13:45' },
  { id: '3', name: '王五', mbtiCode: 'ISTP', completedAt: '2025-01-03 12:20' },
  { id: '4', name: '赵六', mbtiCode: 'ESFJ', completedAt: '2025-01-03 11:15' },
  { id: '5', name: '钱七', mbtiCode: 'INFP', completedAt: '2025-01-03 10:00' },
]

const mockMbtiDistribution = [
  { type: 'INTJ', count: 18, percentage: 12.7 },
  { type: 'INFP', count: 16, percentage: 11.3 },
  { type: 'ENFP', count: 14, percentage: 9.9 },
  { type: 'INTP', count: 13, percentage: 9.2 },
  { type: 'ISTJ', count: 12, percentage: 8.5 },
  { type: 'ISFJ', count: 11, percentage: 7.7 },
  { type: 'ENTJ', count: 10, percentage: 7.0 },
  { type: 'ENFJ', count: 9, percentage: 6.3 },
]

// 统计卡片组件
function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  color, 
  delay 
}: { 
  title: string
  value: string | number
  icon: LucideIcon
  color: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="p-6 rounded-2xl border border-border-primary"
      style={{
        background: 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm mb-1 text-text-muted">{title}</p>
          <p className="text-3xl font-black text-text-primary">{value}</p>
        </div>
        <div 
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ background: `${color}15`, color }}
        >
          <Icon className="w-6 h-6" strokeWidth={1.5} />
        </div>
      </div>
    </motion.div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(mockStats)
  const [recentResults, setRecentResults] = useState(mockRecentResults)
  const [distribution, setDistribution] = useState(mockMbtiDistribution)

  // 模拟加载数据
  useEffect(() => {
    // 实际项目中这里会调用 API
    setStats(mockStats)
    setRecentResults(mockRecentResults)
    setDistribution(mockMbtiDistribution)
  }, [])

  return (
    <div className="p-6 md:p-8 lg:p-10">
      {/* 页面标题 */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-2xl md:text-3xl font-black mb-2 text-text-primary">
          管理概览
        </h1>
        <p className="text-text-secondary">
          查看测试数据统计和学生分析
        </p>
      </motion.div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="学生总数"
          value={stats.totalStudents}
          icon={Users}
          color={primary[500]}
          delay={0}
        />
        <StatCard
          title="已完成测试"
          value={stats.completedTests}
          icon={CheckCircle}
          color="#10B981"
          delay={0.1}
        />
        <StatCard
          title="题库数量"
          value={stats.totalQuestions}
          icon={FileEdit}
          color="#F59E0B"
          delay={0.2}
        />
        <StatCard
          title="完成率"
          value={`${stats.avgCompletionRate}%`}
          icon={BarChart3}
          color="#8B5CF6"
          delay={0.3}
        />
      </div>

      {/* 主内容区 */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* MBTI 分布 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-2 p-6 rounded-2xl border border-border-primary"
          style={{
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-text-primary">
              MBTI 类型分布
            </h2>
            <Link 
              to="/admin/students"
              className="text-sm font-medium transition-colors"
              style={{ color: 'var(--accent-text)' }}
            >
              查看详情 →
            </Link>
          </div>

          <div className="space-y-4">
            {distribution.map((item, index) => (
              <div key={item.type} className="flex items-center gap-4">
                <span 
                  className="w-12 text-sm font-mono font-bold text-text-secondary"
                >
                  {item.type}
                </span>
                <div className="flex-1 h-8 rounded-lg overflow-hidden bg-bg-tertiary">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${item.percentage * 5}%` }}
                    transition={{ delay: 0.5 + index * 0.05, duration: 0.5 }}
                    className="h-full rounded-lg flex items-center justify-end pr-3"
                    style={{ 
                      background: `linear-gradient(90deg, ${primary[400]} 0%, ${primary[600]} 100%)`,
                      minWidth: '60px',
                    }}
                  >
                    <span className="text-xs font-medium text-white">
                      {item.count}人
                    </span>
                  </motion.div>
                </div>
                <span 
                  className="w-12 text-sm text-right text-text-muted"
                >
                  {item.percentage}%
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 最近测试 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="p-6 rounded-2xl border border-border-primary"
          style={{
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-text-primary">
              最近测试
            </h2>
            <Link 
              to="/admin/students"
              className="text-sm font-medium transition-colors"
              style={{ color: 'var(--accent-text)' }}
            >
              全部 →
            </Link>
          </div>

          <div className="space-y-4">
            {recentResults.map((result) => (
              <div 
                key={result.id}
                className="flex items-center justify-between py-3 border-b last:border-0 border-border-primary"
              >
                <div>
                  <p className="font-medium text-text-primary">
                    {result.name}
                  </p>
                  <p className="text-xs text-text-muted">
                    {result.completedAt}
                  </p>
                </div>
                <span 
                  className="px-3 py-1 rounded-full text-sm font-mono font-bold"
                  style={{ 
                    background: `${primary[500]}15`,
                    color: primary[700],
                  }}
                >
                  {result.mbtiCode}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* 快捷操作 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="mt-8 grid md:grid-cols-2 gap-6"
      >
        <Link
          to="/admin/questions"
          className="p-6 rounded-2xl flex items-center gap-4 transition-all hover:shadow-lg hover:scale-[1.02] border border-border-primary"
          style={{
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div 
            className="w-14 h-14 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent-text)' }}
          >
            <FileEdit className="w-7 h-7" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="font-bold mb-1 text-text-primary">
              管理题目
            </h3>
            <p className="text-sm text-text-secondary">
              添加、编辑或删除测试题目
            </p>
          </div>
          <svg 
            className="w-5 h-5 ml-auto text-text-muted" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>

        <Link
          to="/admin/students"
          className="p-6 rounded-2xl flex items-center gap-4 transition-all hover:shadow-lg hover:scale-[1.02] border border-border-primary"
          style={{
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div 
            className="w-14 h-14 rounded-xl flex items-center justify-center"
            style={{ background: '#10B98115', color: '#10B981' }}
          >
            <Users className="w-7 h-7" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="font-bold mb-1 text-text-primary">
              学生数据
            </h3>
            <p className="text-sm text-text-secondary">
              查看学生测试结果和分析
            </p>
          </div>
          <svg 
            className="w-5 h-5 ml-auto text-text-muted" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </motion.div>
    </div>
  )
}
