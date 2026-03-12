/**
 * GlassButton - 液态玻璃按钮组件
 *
 * 亮色/暗色双模式均实现玻璃态效果
 * - 支持多种大小（sm, md, lg）
 * - 支持多种颜色主题
 * - 支持 hover、active、loading 状态
 * - cursor-pointer + focus-visible 样式
 */

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useTheme } from '../../theme/ThemeContext'

type Size = 'sm' | 'md' | 'lg'
type Color = 'pink' | 'yellow' | 'blue' | 'green' | 'purple' | 'white' | 'black'

interface GlassButtonProps {
  children: ReactNode
  size?: Size
  color?: Color
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  className?: string
  type?: 'button' | 'submit' | 'reset'
}

const sizeMap: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-2.5 text-base',
  lg: 'px-8 py-3 text-lg',
}

const lightColorMap: Record<Color, { bg: string; text: string; border: string }> = {
  white: { bg: 'rgba(255,255,255,0.85)', text: '#1a1a1a', border: 'rgba(255,255,255,0.5)' },
  pink: { bg: 'rgba(249,197,235,0.8)', text: '#1a1a1a', border: 'rgba(255,255,255,0.4)' },
  yellow: { bg: 'rgba(254,243,199,0.8)', text: '#1a1a1a', border: 'rgba(255,255,255,0.4)' },
  blue: { bg: 'rgba(219,234,254,0.8)', text: '#1a1a1a', border: 'rgba(255,255,255,0.4)' },
  green: { bg: 'rgba(209,250,229,0.8)', text: '#1a1a1a', border: 'rgba(255,255,255,0.4)' },
  purple: { bg: 'rgba(233,213,255,0.8)', text: '#1a1a1a', border: 'rgba(255,255,255,0.4)' },
  black: { bg: '#1a1a1a', text: '#ffffff', border: 'rgba(0,0,0,0.2)' },
}

const darkColorMap: Record<Color, { bg: string; text: string; border: string }> = {
  white: { bg: 'rgba(255,255,255,0.1)', text: '#e2e8f0', border: 'rgba(255,255,255,0.15)' },
  pink: { bg: 'rgba(249,197,235,0.12)', text: '#fce7f3', border: 'rgba(249,197,235,0.2)' },
  yellow: { bg: 'rgba(254,243,199,0.12)', text: '#fef9c3', border: 'rgba(254,243,199,0.2)' },
  blue: { bg: 'rgba(96,165,250,0.15)', text: '#bfdbfe', border: 'rgba(96,165,250,0.2)' },
  green: { bg: 'rgba(74,222,128,0.12)', text: '#bbf7d0', border: 'rgba(74,222,128,0.2)' },
  purple: { bg: 'rgba(192,132,252,0.15)', text: '#e9d5ff', border: 'rgba(192,132,252,0.2)' },
  black: { bg: '#ffffff', text: '#1a1a1a', border: 'rgba(255,255,255,0.3)' },
}

export function GlassButton({
  children,
  size = 'md',
  color = 'white',
  onClick,
  disabled = false,
  loading = false,
  className = '',
  type = 'button',
}: GlassButtonProps) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const sizeClass = sizeMap[size]
  const colorStyle = isDark ? darkColorMap[color] : lightColorMap[color]

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`rounded-full font-semibold transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-400 focus-visible:outline-none ${sizeClass} ${className}`}
      style={{
        background: colorStyle.bg,
        color: colorStyle.text,
        backdropFilter: 'blur(12px) saturate(180%)',
        WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        border: `1px solid ${colorStyle.border}`,
        boxShadow: isDark
          ? '0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)'
          : '0 8px 32px rgba(0,0,0,0.08)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      whileHover={!disabled && !loading ? { scale: 1.05 } : {}}
      whileTap={!disabled && !loading ? { scale: 0.95 } : {}}
    >
      {loading ? '加载中...' : children}
    </motion.button>
  )
}
