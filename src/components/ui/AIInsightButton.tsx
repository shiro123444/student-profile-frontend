import { useState, useCallback } from 'react'
import { Sparkles, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { agentApi } from '../../services/api'

interface AIInsightButtonProps {
  agentName: string
  prompt: string
  studentId?: string
  label?: string
  className?: string
}

export default function AIInsightButton({
  agentName,
  prompt,
  studentId,
  label = 'AI 分析',
  className = '',
}: AIInsightButtonProps) {
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleClick = useCallback(async () => {
    if (result) {
      setExpanded(v => !v)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await agentApi.query({
        agentName,
        prompt,
        studentId,
        runtime: { mode: 'fast' },
      })
      setResult(res.response)
    } catch {
      setError('AI 服务暂时不可用')
    } finally {
      setLoading(false)
    }
  }, [agentName, prompt, studentId, result])

  return (
    <div className={className}>
      <button
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
          bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors
          disabled:opacity-50"
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
        {label}
        {result && (expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </button>

      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}

      {result && expanded && (
        <div className="mt-3 p-3 rounded-xl bg-bg-tertiary/50 border border-border-primary">
          <div className="prose prose-xs dark:prose-invert max-w-none
            prose-p:my-1 prose-headings:my-1.5 prose-li:my-0.5 prose-code:text-[11px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {result}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
