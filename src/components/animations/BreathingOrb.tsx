import { motion } from 'framer-motion'
import { breathingConfig } from '../../theme/motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'

interface BreathingOrbProps {
  /** 渐变颜色，如 'rgba(147,51,234,0.15)' */
  color: string
  /** 尺寸，默认 600 */
  size?: number
  /** 位置 */
  position?: {
    top?: string
    left?: string
    right?: string
    bottom?: string
  }
  /** 动画相位偏移 (0-1)，避免多个球同步 */
  phaseOffset?: number
  /** 额外的 className */
  className?: string
}

/**
 * BreathingOrb 呼吸光晕组件
 * 
 * 实现原理：
 * 1. 使用 Framer Motion 实现无限循环的缩放+透明度动画
 * 2. 通过 animation-delay (phaseOffset) 实现相位偏移
 * 3. 只使用 transform 和 opacity 确保 GPU 加速
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.3
 */
export function BreathingOrb({
  color,
  size = 600,
  position = {},
  phaseOffset = 0,
  className = '',
}: BreathingOrbProps) {
  const prefersReduced = useReducedMotion()

  // Respect prefers-reduced-motion: render static orb
  if (prefersReduced) {
    return (
      <div
        className={`absolute rounded-full pointer-events-none ${className}`}
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          opacity: 0.5,
          ...position,
        }}
      />
    )
  }

  return (
    <motion.div
      className={`absolute rounded-full pointer-events-none ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        ...position,
        // GPU acceleration optimization - only transform and opacity are animated
        willChange: 'transform, opacity',
      }}
      animate={{
        scale: [...breathingConfig.scaleRange],
        opacity: [...breathingConfig.opacityRange],
      }}
      transition={{
        duration: breathingConfig.duration,
        ease: breathingConfig.ease,
        repeat: Infinity,
        delay: phaseOffset * breathingConfig.duration, // 相位偏移
      }}
    />
  )
}

export default BreathingOrb
