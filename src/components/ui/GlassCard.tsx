/**
 * GlassCard - 液态玻璃卡片组件
 *
 * 亮色/暗色双模式均实现真正的玻璃态效果
 * - 半透明背景 + backdrop-filter blur
 * - 支持多种变体（standard, strong, light）
 * - 支持多种颜色主题（pink, yellow, blue, green, purple, white）
 * - 暗色模式保留微弱色调而非完全降级
 */

import type { ReactNode, CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useTheme } from '../../theme/ThemeContext'

type Variant = 'standard' | 'strong' | 'light'
type Color = 'pink' | 'yellow' | 'blue' | 'green' | 'purple' | 'white'

interface GlassCardProps {
  children: ReactNode
  variant?: Variant
  color?: Color
  className?: string
  style?: CSSProperties
  onClick?: () => void
  hover?: boolean
}

// Light mode color styles
const lightColorMap: Record<Color, { bg: string; border: string; shadow: string }> = {
  white: {
    bg: 'rgba(255,255,255,0.75)',
    border: 'rgba(255,255,255,0.4)',
    shadow: '0 8px 32px rgba(0,0,0,0.08)',
  },
  pink: {
    bg: 'linear-gradient(135deg, rgba(249,197,235,0.7) 0%, rgba(255,255,255,0.3) 100%)',
    border: 'rgba(255,255,255,0.4)',
    shadow: '0 8px 32px rgba(249,197,235,0.15)',
  },
  yellow: {
    bg: 'linear-gradient(135deg, rgba(254,243,199,0.7) 0%, rgba(255,255,255,0.3) 100%)',
    border: 'rgba(255,255,255,0.4)',
    shadow: '0 8px 32px rgba(254,243,199,0.15)',
  },
  blue: {
    bg: 'linear-gradient(135deg, rgba(219,234,254,0.7) 0%, rgba(255,255,255,0.3) 100%)',
    border: 'rgba(255,255,255,0.4)',
    shadow: '0 8px 32px rgba(219,234,254,0.15)',
  },
  green: {
    bg: 'linear-gradient(135deg, rgba(209,250,229,0.7) 0%, rgba(255,255,255,0.3) 100%)',
    border: 'rgba(255,255,255,0.4)',
    shadow: '0 8px 32px rgba(209,250,229,0.15)',
  },
  purple: {
    bg: 'linear-gradient(135deg, rgba(233,213,255,0.7) 0%, rgba(255,255,255,0.3) 100%)',
    border: 'rgba(255,255,255,0.4)',
    shadow: '0 8px 32px rgba(233,213,255,0.15)',
  },
}

// Dark mode - true liquid glass with subtle color tints
const darkColorMap: Record<Color, { bg: string; border: string; shadow: string }> = {
  white: {
    bg: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.1)',
    shadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
  },
  pink: {
    bg: 'linear-gradient(135deg, rgba(249,197,235,0.08) 0%, rgba(255,255,255,0.04) 100%)',
    border: 'rgba(249,197,235,0.15)',
    shadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(249,197,235,0.08)',
  },
  yellow: {
    bg: 'linear-gradient(135deg, rgba(254,243,199,0.08) 0%, rgba(255,255,255,0.04) 100%)',
    border: 'rgba(254,243,199,0.15)',
    shadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(254,243,199,0.08)',
  },
  blue: {
    bg: 'linear-gradient(135deg, rgba(96,165,250,0.1) 0%, rgba(255,255,255,0.04) 100%)',
    border: 'rgba(96,165,250,0.15)',
    shadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(96,165,250,0.08)',
  },
  green: {
    bg: 'linear-gradient(135deg, rgba(74,222,128,0.08) 0%, rgba(255,255,255,0.04) 100%)',
    border: 'rgba(74,222,128,0.15)',
    shadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(74,222,128,0.08)',
  },
  purple: {
    bg: 'linear-gradient(135deg, rgba(192,132,252,0.1) 0%, rgba(255,255,255,0.04) 100%)',
    border: 'rgba(192,132,252,0.15)',
    shadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(192,132,252,0.08)',
  },
}

const variantBlur: Record<Variant, string> = {
  standard: 'blur(16px) saturate(180%)',
  strong: 'blur(12px) saturate(200%)',
  light: 'blur(20px) saturate(160%)',
}

export function GlassCard({
  children,
  variant = 'standard',
  color = 'white',
  className = '',
  style,
  onClick,
  hover = true,
}: GlassCardProps) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const colorStyle = isDark ? darkColorMap[color] : lightColorMap[color]
  const blur = variantBlur[variant]

  return (
    <motion.div
      className={`rounded-2xl p-6 border transition-all ${className}`}
      style={{
        background: colorStyle.bg,
        backdropFilter: blur,
        WebkitBackdropFilter: blur,
        borderColor: colorStyle.border,
        boxShadow: colorStyle.shadow,
        ...style,
      }}
      whileHover={hover ? { scale: 1.02, y: -4 } : {}}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </motion.div>
  )
}
