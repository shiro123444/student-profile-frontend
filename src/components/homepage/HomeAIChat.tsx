/**
 * HomeAIChat — Claude Code 风格底部悬浮输入条 + 液态玻璃对话面板
 *
 * 设计:
 * - 底部固定的玻璃态输入条（类似 Claude Code 终端输入）
 * - 对话输出向上浮动展开
 * - 旁边可弹出 Skills / MCP 工具面板
 * - 全部使用液态透明玻璃风格
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, Send, Sparkles, StopCircle,
  Wrench, Zap, ChevronUp, Compass,
  Target, Brain, BarChart3, Rocket,
  type LucideIcon,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useNavigate } from 'react-router-dom'
import { useAgentStream, type AgentStreamCallbacks } from '../../hooks/useAgentStream'
import { useUICommands } from '../../hooks/useUICommands'
import type { UICommand } from '../../hooks/useUICommands'
import UIEffectLayer from '../ui/UIEffectLayer'
import { useTheme } from '../../theme/ThemeContext'
import { agentApi, type ToolAnnotationHints, type ToolPackageCatalog } from '../../services/api'

// ── Data ──

const QUICK_PROMPTS: { icon: LucideIcon; label: string; text: string }[] = [
  { icon: Compass, label: '参观', text: '带我参观一下这个平台吧！' },
  { icon: Target, label: '职业', text: '现在最热门的 AI 职业有哪些？' },
  { icon: Brain, label: 'MBTI', text: '快速介绍一下 MBTI 性格测试' },
  { icon: BarChart3, label: '数据', text: '展示一下平台的整体数据' },
]

const SKILLS: { name: string; desc: string; icon: LucideIcon }[] = [
  { name: 'career-exploration', desc: '画像 → MBTI → 职业匹配', icon: Target },
  { name: 'learning-diagnosis', desc: '进度分析 → 个性化建议', icon: BarChart3 },
  { name: 'homepage-tour', desc: '平台功能互动展示', icon: Rocket },
]

const MCP_TOOLS = [
  { category: '学生', tools: ['get_student_profile', 'get_learning_history'] },
  { category: 'MBTI', tools: ['get_mbti_type_info', 'get_quick_mbti_insight'] },
  { category: '职业', tools: ['search_careers', 'get_trending_careers'] },
  { category: '文档', tools: ['search_documents', 'unified_search'] },
  { category: '图谱', tools: ['query_knowledge_graph', 'get_learning_path'] },
  { category: '笔记', tools: ['search_notes', 'create_note', 'get_note_graph'] },
  { category: '主页', tools: ['get_platform_stats', 'get_featured_experiments', 'emit_ui_command', 'navigate_page'] },
]

type RuntimeMode = 'fast' | 'balanced' | 'deep'

const MODE_OPTIONS: { value: RuntimeMode; label: string }[] = [
  { value: 'fast', label: '快速' },
  { value: 'balanced', label: '平衡' },
  { value: 'deep', label: '深度' },
]

type ToolMetaMap = Record<string, {
  annotations?: ToolAnnotationHints | null
  riskLevel?: string
}>

function buildToolMetaMap(catalog: ToolPackageCatalog): ToolMetaMap {
  const map: ToolMetaMap = {}
  for (const pkg of Object.values(catalog)) {
    for (const detail of pkg.tool_details || []) {
      map[detail.name] = {
        annotations: detail.annotations || null,
        riskLevel: detail.risk_level || 'unknown',
      }
    }
  }
  return map
}

function getToolRiskLabel(meta?: { annotations?: ToolAnnotationHints | null; riskLevel?: string }): string {
  const ann = meta?.annotations
  const riskLevel = meta?.riskLevel || 'unknown'

  if (ann?.destructiveHint || riskLevel === 'destructive') return '高风险'
  if (ann?.readOnlyHint || riskLevel === 'read_only') return '只读'
  if (ann?.openWorldHint || riskLevel === 'open_world') return '外部'
  if (ann?.idempotentHint || riskLevel === 'idempotent') return '幂等'
  return '未标注'
}

// ── Glass helpers ──

function glass(isDark: boolean, level: 'light' | 'medium' | 'strong' = 'medium') {
  const blurMap = { light: 'blur(12px)', medium: 'blur(20px)', strong: 'blur(30px)' }
  const bgDark = { light: 'rgba(15,15,25,0.6)', medium: 'rgba(15,15,25,0.75)', strong: 'rgba(15,15,25,0.85)' }
  const bgLight = { light: 'rgba(255,255,255,0.55)', medium: 'rgba(255,255,255,0.7)', strong: 'rgba(255,255,255,0.82)' }
  return {
    background: isDark ? bgDark[level] : bgLight[level],
    backdropFilter: blurMap[level],
    WebkitBackdropFilter: blurMap[level],
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.6)'}`,
    boxShadow: isDark
      ? '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)'
      : '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
  }
}

// ── Component ──

export function HomeAIChat() {
  const [input, setInput] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [toolTab, setToolTab] = useState<'skills' | 'mcp'>('skills')
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('balanced')
  const [runtimeMeta, setRuntimeMeta] = useState<{ engine: string; model: string; mode: string } | null>(null)
  const [toolMetaMap, setToolMetaMap] = useState<ToolMetaMap>({})
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const { effects, addEffect, clearAll } = useUICommands()

  // Structured event callbacks from agent stream
  const streamCallbacks = useMemo<AgentStreamCallbacks>(() => ({
    onMeta: (meta) => {
      setRuntimeMeta({ engine: meta.engine, model: meta.model, mode: meta.mode })
    },
    onUICommand: (cmd) => {
      addEffect({
        ui_command: true,
        command: cmd.command as UICommand['command'],
        target: cmd.target,
        params: cmd.params,
      })
    },
    onNavigate: (nav) => {
      navigate(nav.to)
    },
  }), [addEffect, navigate])

  const { messages, isStreaming, sendMessage, stop, clearMessages } = useAgentStream(streamCallbacks)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (messages.length > 0) setIsExpanded(true)
  }, [messages])

  useEffect(() => {
    let cancelled = false

    const loadToolMetadata = async () => {
      try {
        const catalog = await agentApi.publicTools()
        if (!cancelled) setToolMetaMap(buildToolMetaMap(catalog))
      } catch {
        if (!cancelled) setToolMetaMap({})
      }
    }

    void loadToolMetadata()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSend = useCallback((text?: string) => {
    const msg = text || input.trim()
    if (!msg) return
    setInput('')
    setShowTools(false)
    sendMessage(msg, {
      agentName: 'homepage-guide',
      public: true,
      runtime: { mode: runtimeMode },
    })
  }, [input, runtimeMode, sendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') { setIsExpanded(false); setShowTools(false) }
  }, [handleSend])

  const handleClear = useCallback(() => {
    clearMessages(); clearAll(); setIsExpanded(false); setRuntimeMeta(null)
  }, [clearMessages, clearAll])

  const cleanContent = (text: string) =>
    text.replace(/\{[^{}]*"ui_command"\s*:\s*true[^{}]*\}/g, '').trim()

  const g = glass(isDark, 'medium')
  const gStrong = glass(isDark, 'strong')
  const textMuted = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'
  const textPrimary = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)'
  const accent = '#6366f1'
  const activeMode = runtimeMeta?.mode || runtimeMode
  const runtimeBadge = runtimeMeta
    ? `${runtimeMeta.engine} · ${runtimeMeta.model || 'default'}`
    : '等待路由'

  return (
    <>
      <UIEffectLayer effects={effects} />

      <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none pb-5 px-4">
        <div className="w-full max-w-2xl pointer-events-auto flex gap-3 items-end">

          {/* ── Main column: output + input bar ── */}
          <div className="flex-1 flex flex-col gap-2">

            {/* ── Floating output panel ── */}
            <AnimatePresence>
              {isExpanded && messages.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: 20, height: 0 }}
                  transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                  className="rounded-2xl overflow-hidden"
                  style={gStrong}
                >
                  {/* Header */}
                  <div
                    className="flex items-center justify-between px-4 py-2.5"
                    style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: accent }} />
                      <span className="text-xs font-medium" style={{ color: textMuted }}>
                        homepage-guide
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{
                          color: textPrimary,
                          background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                        }}
                      >
                        {activeMode} · {runtimeBadge}
                      </span>
                      {isStreaming && (
                        <motion.span
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                          className="text-xs"
                          style={{ color: accent }}
                        >
                          streaming...
                        </motion.span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleClear}
                        className="text-xs px-2 py-0.5 rounded-md transition-colors hover:bg-white/10"
                        style={{ color: textMuted }}
                      >
                        清空
                      </button>
                      <button
                        onClick={() => setIsExpanded(false)}
                        className="p-1 rounded-md transition-colors hover:bg-white/10"
                        style={{ color: textMuted }}
                      >
                        <ChevronUp size={14} style={{ transform: 'rotate(180deg)' }} />
                      </button>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="max-h-80 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin">
                    {messages.map(msg => (
                      <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm"
                          style={
                            msg.role === 'user'
                              ? {
                                  background: `linear-gradient(135deg, ${accent}, #8b5cf6)`,
                                  color: 'white',
                                  borderBottomRightRadius: 4,
                                }
                              : {
                                  background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                                  color: textPrimary,
                                  borderBottomLeftRadius: 4,
                                  border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}`,
                                }
                          }
                        >
                          {msg.role === 'assistant' ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:m-0 [&>p+p]:mt-1.5">
                              <ReactMarkdown>
                                {cleanContent(msg.content) || (isStreaming ? '...' : '')}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            msg.content
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Quick prompts (show when no messages) ── */}
            <AnimatePresence>
              {messages.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="flex gap-2 justify-center flex-wrap"
                >
                  {QUICK_PROMPTS.map(p => (
                    <button
                      key={p.label}
                      onClick={() => handleSend(p.text)}
                      className="px-3 py-1.5 rounded-full text-xs transition-all hover:scale-105 flex items-center gap-1.5 cursor-pointer"
                      style={{
                        ...glass(isDark, 'light'),
                        color: textPrimary,
                      }}
                    >
                      <p.icon size={12} style={{ color: accent }} />
                      {p.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Input bar ── */}
            <motion.div
              layout
              className="rounded-2xl px-4 py-3"
              style={g}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {MODE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      onClick={() => setRuntimeMode(option.value)}
                      disabled={isStreaming}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all disabled:opacity-50"
                      style={{
                        color: activeMode === option.value ? 'white' : textMuted,
                        background: activeMode === option.value
                          ? `linear-gradient(135deg, ${accent}, #8b5cf6)`
                          : 'transparent',
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <span className="text-[10px]" style={{ color: textMuted }}>
                  {runtimeBadge}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Bot size={18} style={{ color: accent, flexShrink: 0 }} />
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => { if (messages.length > 0) setIsExpanded(true) }}
                  placeholder="Ask PathMind AI anything..."
                  disabled={isStreaming}
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: textPrimary }}
                />
                <div className="flex items-center gap-1.5">
                  {isStreaming ? (
                    <button
                      onClick={stop}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: '#ef4444' }}
                    >
                      <StopCircle size={18} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSend()}
                      disabled={!input.trim()}
                      className="p-1.5 rounded-lg transition-all disabled:opacity-30"
                      style={{ color: accent }}
                    >
                      <Send size={16} />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>

          {/* ── Side tool button + panel ── */}
          <div className="flex flex-col items-center gap-2 mb-1">
            {/* Tool panel */}
            <AnimatePresence>
              {showTools && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                  className="w-72 rounded-2xl overflow-hidden"
                  style={gStrong}
                >
                  {/* Tabs */}
                  <div
                    className="flex"
                    style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}
                  >
                    {(['skills', 'mcp'] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setToolTab(tab)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors"
                        style={{
                          color: toolTab === tab ? accent : textMuted,
                          borderBottom: toolTab === tab ? `2px solid ${accent}` : '2px solid transparent',
                        }}
                      >
                        {tab === 'skills' ? <Zap size={12} /> : <Wrench size={12} />}
                        {tab === 'skills' ? 'Skills' : 'MCP Tools'}
                      </button>
                    ))}
                  </div>

                  {/* Content */}
                  <div className="p-3 max-h-64 overflow-y-auto scrollbar-thin">
                    {toolTab === 'skills' ? (
                      <div className="space-y-1.5">
                        {SKILLS.map(s => (
                          <button
                            key={s.name}
                            onClick={() => {
                              handleSend(`运行 ${s.name} skill`)
                              setShowTools(false)
                            }}
                            className="w-full text-left rounded-xl px-3 py-2.5 transition-all hover:scale-[1.02] cursor-pointer group"
                            style={{
                              background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                              border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`,
                            }}
                          >
                            <div className="flex items-center gap-2.5">
                              <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                                style={{
                                  background: isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)',
                                }}
                              >
                                <s.icon size={16} style={{ color: accent }} />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold tracking-wide" style={{ color: textPrimary }}>{s.name}</div>
                                <div className="text-[11px] mt-0.5 opacity-60" style={{ color: textPrimary }}>{s.desc}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {MCP_TOOLS.map(group => (
                          <div key={group.category}>
                            <div
                              className="text-[10px] font-bold uppercase tracking-widest mb-2 px-1"
                              style={{ color: accent }}
                            >
                              {group.category}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {group.tools.map(tool => {
                                const meta = toolMetaMap[tool]
                                const riskLabel = getToolRiskLabel(meta)
                                const isDanger = riskLabel === '高风险'
                                const isSafe = riskLabel === '只读'
                                const isExternal = riskLabel === '外部'
                                const isIdempotent = riskLabel === '幂等'

                                return (
                                  <div
                                    key={tool}
                                    className="px-2 py-1 rounded-lg text-[10px] border flex items-center gap-1.5"
                                    style={{
                                      background: isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)',
                                      color: isDark ? 'rgba(165,180,252,0.9)' : accent,
                                      borderColor: isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.12)',
                                    }}
                                  >
                                    <span className="font-mono leading-none">{tool}</span>
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[9px] leading-none"
                                      style={{
                                        color: isDanger
                                          ? '#ef4444'
                                          : isSafe
                                            ? '#22c55e'
                                            : isExternal
                                              ? '#f59e0b'
                                              : isIdempotent
                                                ? '#3b82f6'
                                                : textMuted,
                                        background: isDanger
                                          ? 'rgba(239,68,68,0.14)'
                                          : isSafe
                                            ? 'rgba(34,197,94,0.14)'
                                            : isExternal
                                              ? 'rgba(245,158,11,0.14)'
                                              : isIdempotent
                                                ? 'rgba(59,130,246,0.14)'
                                                : isDark
                                                  ? 'rgba(255,255,255,0.08)'
                                                  : 'rgba(0,0,0,0.06)',
                                      }}
                                    >
                                      {riskLabel}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Toggle button */}
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowTools(!showTools)}
              className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors"
              style={{
                ...glass(isDark, 'medium'),
                color: showTools ? accent : textMuted,
              }}
            >
              <Sparkles size={18} />
            </motion.button>
          </div>
        </div>
      </div>
    </>
  )
}
