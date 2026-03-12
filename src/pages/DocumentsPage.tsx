import { useCallback, useEffect, useMemo, useState, type ChangeEvent, lazy, Suspense } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  Eye,
  FileSearch,
  FileText,
  Loader2,
  NotebookPen,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import AIInsightButton from '../components/ui/AIInsightButton'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { documentsApi, type DocumentQueryResult, type LearningDocument } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const AgentClusterBoard = lazy(() => import('../components/agent/AgentClusterBoard'))
const TaskReceiptPanel = lazy(() => import('../components/agent/TaskReceiptPanel'))

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(iso?: string): string {
  if (!iso) return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function inferTitle(file: File): string {
  const name = file.name || 'untitled'
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return name
  return name.slice(0, dot)
}

export default function DocumentsPage() {
  const { user } = useAuth()
  const studentId = user?.id

  const [documents, setDocuments] = useState<LearningDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const [queryText, setQueryText] = useState('')
  const [querying, setQuerying] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [queryResults, setQueryResults] = useState<DocumentQueryResult[]>([])
  const [showSystemPanels, setShowSystemPanels] = useState(false)

  const loadDocuments = useCallback(async () => {
    try {
      setLoadingError(null)
      const list = await documentsApi.list()
      setDocuments(Array.isArray(list) ? list : [])
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载文档失败'
      setLoadingError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  useEffect(() => {
    if (loading) return
    const hasPendingIndex = documents.some(
      (item) => !item.is_indexed && (item.page_count ?? 0) >= 0,
    )
    if (!hasPendingIndex) return

    const timer = window.setInterval(() => {
      void loadDocuments()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [documents, loading, loadDocuments])

  const handlePickFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || [])
    event.currentTarget.value = ''
    if (picked.length === 0 || uploading) return

    const pdfFiles = picked.filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    )
    if (pdfFiles.length === 0) {
      setUploadMessage('仅支持 PDF 文件上传')
      return
    }

    setUploading(true)
    setUploadMessage(null)

    let success = 0
    const failed: string[] = []

    for (const file of pdfFiles) {
      try {
        await documentsApi.upload(file, { title: inferTitle(file) })
        success += 1
      } catch {
        failed.push(file.name)
      }
    }

    if (success > 0) {
      setUploadMessage(
        failed.length > 0
          ? `已上传 ${success} 个文件，失败 ${failed.length} 个`
          : `上传成功：${success} 个文件`,
      )
      await loadDocuments()
    } else {
      setUploadMessage(`上传失败：${failed.join('、') || '未知错误'}`)
    }

    setUploading(false)
  }

  const removeDocument = async (doc: LearningDocument) => {
    if (deletingId) return
    const confirmed = window.confirm(`确认删除文档「${doc.title}」？此操作将同时删除向量索引。`)
    if (!confirmed) return

    setDeletingId(doc.id)
    try {
      await documentsApi.delete(doc.id)
      setDocuments((prev) => prev.filter((item) => item.id !== doc.id))
      setQueryResults((prev) => prev.filter((item) => item.document_id !== doc.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除失败'
      setUploadMessage(message)
    } finally {
      setDeletingId(null)
    }
  }

  const previewDocument = async (doc: LearningDocument) => {
    if (previewingId || downloadingId) return
    setPreviewingId(doc.id)
    try {
      const file = await documentsApi.fetchFile(doc.id, 'preview')
      const url = URL.createObjectURL(file.blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      const message = error instanceof Error ? error.message : '预览失败'
      setUploadMessage(message)
    } finally {
      setPreviewingId(null)
    }
  }

  const downloadDocumentFile = async (doc: LearningDocument) => {
    if (previewingId || downloadingId) return
    setDownloadingId(doc.id)
    try {
      const file = await documentsApi.fetchFile(doc.id, 'download')
      const extension = doc.file_type ? `.${doc.file_type.toLowerCase()}` : ''
      const fallbackName = `${doc.title}${extension}`
      const url = URL.createObjectURL(file.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.filename || fallbackName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载失败'
      setUploadMessage(message)
    } finally {
      setDownloadingId(null)
    }
  }

  const runQuery = async () => {
    const q = queryText.trim()
    if (!q || querying) return

    setQuerying(true)
    setQueryError(null)
    try {
      const results = await documentsApi.query({ query: q, limit: 8 })
      setQueryResults(Array.isArray(results) ? results : [])
    } catch (error) {
      const message = error instanceof Error ? error.message : '语义检索失败'
      setQueryError(message)
      setQueryResults([])
    } finally {
      setQuerying(false)
    }
  }

  const totalBytes = useMemo(
    () => documents.reduce((sum, item) => sum + (item.file_size || 0), 0),
    [documents],
  )
  const indexedCount = useMemo(
    () => documents.filter((item) => item.is_indexed).length,
    [documents],
  )
  const filenameList = useMemo(
    () => documents.map((item) => item.title).join('、') || '暂无文件',
    [documents],
  )

  const fileSummary =
    documents.length > 0
      ? `当前文档 ${documents.length} 份（索引完成 ${indexedCount} 份，约 ${formatFileSize(totalBytes)}）`
      : '当前文档库为空，请先上传 PDF'

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_32px_rgba(15,23,42,0.08)] dark:border-white/20 dark:bg-white/10 px-5 py-4"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-text-primary mb-1">PDF 文档工作台</h1>
            <p className="text-text-muted max-w-3xl">
              上传、检索、沉淀笔记，主流程优先。系统编排与回执默认收起，避免干扰阅读与操作。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSystemPanels((prev) => !prev)}
            className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-border-primary bg-bg-primary text-text-muted hover:text-text-primary hover:border-primary-300 transition-all"
          >
            <Bot size={14} />
            {showSystemPanels ? '隐藏系统细节' : '显示系统细节'}
          </button>
        </div>
      </motion.div>

      {showSystemPanels && (
        <>
          <ErrorBoundary
            resetKey={documents.length}
            fallback={(
              <div className="rounded-2xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-xs text-amber-700">
                Agent 看板暂时不可用，但文档主页面仍可继续使用。请稍后刷新重试。
              </div>
            )}
          >
            <Suspense fallback={(
              <div className="rounded-2xl border border-border-primary bg-bg-secondary/70 px-4 py-3 text-xs text-text-muted">
                正在加载 Agent 看板...
              </div>
            )}
            >
              <AgentClusterBoard
                defaultAgent="document-reader"
                studentId={studentId}
                probePrompt="请针对 PDF 学习文档场景，演示检索、摘要、笔记沉淀和导出建议的执行链路。"
              />
            </Suspense>
          </ErrorBoundary>

          <ErrorBoundary
            resetKey={documents.length}
            fallback={(
              <div className="rounded-2xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-xs text-amber-700">
                任务回执组件加载失败，请刷新页面后重试。
              </div>
            )}
          >
            <Suspense fallback={(
              <div className="rounded-2xl border border-border-primary bg-bg-secondary/70 px-4 py-3 text-xs text-text-muted">
                正在加载任务回执...
              </div>
            )}
            >
              <TaskReceiptPanel
                title="文档链路任务回执"
                modules={['documents', 'pdf', 'notes', 'rag', 'advisor']}
                maxItems={5}
                emptyText="当前暂无文档链路任务回执，先在 AIAdvisor 启动模板。"
              />
            </Suspense>
          </ErrorBoundary>
        </>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="lg:col-span-2 rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_28px_rgba(15,23,42,0.06)] dark:border-white/20 dark:bg-white/10 p-4"
        >
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Upload size={16} />
              PDF 文档库
            </p>
            <span className="text-xs text-text-muted">{fileSummary}</span>
          </div>

          <label className="block rounded-xl border border-dashed border-border-primary bg-bg-primary px-4 py-6 text-center cursor-pointer hover:border-primary-300 transition-colors">
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={handlePickFiles}
            />
            <p className="text-sm font-medium text-text-primary flex items-center justify-center gap-2">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
              {uploading ? '上传中...' : '点击上传 PDF 到知识库'}
            </p>
            <p className="text-xs text-text-muted mt-1">支持多选，上传后自动触发后台索引</p>
          </label>

          {uploadMessage && (
            <p className="mt-2 text-xs text-text-muted">{uploadMessage}</p>
          )}
          {loadingError && (
            <p className="mt-2 text-xs text-red-500">{loadingError}</p>
          )}

          <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Loader2 size={14} className="animate-spin" />
                正在加载文档列表...
              </div>
            ) : documents.length === 0 ? (
              <p className="text-xs text-text-muted">还没有上传文档，先上传 1-2 个 PDF 试试完整链路。</p>
            ) : documents.map((item) => {
              const indexFailed = !item.is_indexed && (item.page_count ?? 0) < 0
              const indexed = item.is_indexed
              const badgeClass = indexFailed
                ? 'bg-red-500/10 text-red-500 border-red-500/30'
                : indexed
                  ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-500 border-amber-500/30'

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-xl border border-border-primary bg-bg-primary px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary truncate">{item.title}</p>
                    <p className="text-[11px] text-text-muted">
                      {item.file_type.toUpperCase()} · {formatFileSize(item.file_size)} · {formatDate(item.created_at)}
                    </p>
                    {indexFailed && (
                      <p className="text-[11px] text-red-500 mt-0.5">
                        索引失败：请检查 RAG 数据库/向量扩展后重试上传。
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${badgeClass}`}
                    >
                      {indexFailed ? (
                        <span className="inline-flex items-center gap-1">
                          <AlertCircle size={10} /> 索引失败
                        </span>
                      ) : item.is_indexed ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 size={10} /> 已索引
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Clock3 size={10} /> 索引中
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => previewDocument(item)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors disabled:opacity-50"
                      title="预览文档"
                      disabled={previewingId === item.id || downloadingId === item.id || deletingId === item.id}
                    >
                      {previewingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={() => downloadDocumentFile(item)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors disabled:opacity-50"
                      title="下载文档"
                      disabled={previewingId === item.id || downloadingId === item.id || deletingId === item.id}
                    >
                      {downloadingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    </button>
                    <button
                      onClick={() => removeDocument(item)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      title="删除文档"
                      disabled={deletingId === item.id}
                    >
                      {deletingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>

        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_28px_rgba(15,23,42,0.06)] dark:border-white/20 dark:bg-white/10 p-4 space-y-4"
        >
          <div>
            <p className="text-sm font-semibold text-text-primary mb-3">文档工作流动作</p>
            <div className="space-y-2">
              <AIInsightButton
                agentName="document-reader"
                studentId={studentId}
                label="文档摘要"
                prompt={`请根据以下 PDF 列表给出学习摘要框架与阅读优先级：${filenameList}`}
              />
              <AIInsightButton
                agentName="document-reader"
                studentId={studentId}
                label="关键概念"
                prompt={`请基于这些 PDF 文档标题，给出关键概念检索清单：${filenameList}`}
              />
              <AIInsightButton
                agentName="note-assistant"
                studentId={studentId}
                label="沉淀笔记"
                prompt={`基于文档列表生成一份结构化学习笔记模板：${filenameList}`}
              />
              <AIInsightButton
                agentName="quick-qa"
                studentId={studentId}
                label="导出建议"
                prompt={`如果要把笔记导出成 PDF，请给出目录结构和排版建议：${filenameList}`}
              />
            </div>
          </div>

          <div className="pt-2 border-t border-border-primary">
            <p className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
              <Search size={14} />
              语义检索
            </p>
            <div className="flex gap-2">
              <input
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    runQuery()
                  }
                }}
                placeholder="例如：什么是知识图谱中的节点关系？"
                className="flex-1 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-primary-300"
              />
              <button
                onClick={runQuery}
                disabled={querying || !queryText.trim()}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 transition-colors disabled:opacity-50"
              >
                {querying ? <Loader2 size={14} className="animate-spin" /> : '检索'}
              </button>
            </div>
            {queryError && (
              <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={12} />
                {queryError}
              </p>
            )}
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_28px_rgba(15,23,42,0.06)] dark:border-white/20 dark:bg-white/10 p-4"
      >
        <p className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
          <FileText size={14} />
          检索结果
        </p>
        {querying ? (
          <div className="text-xs text-text-muted flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            正在检索文档内容...
          </div>
        ) : queryResults.length === 0 ? (
          <p className="text-xs text-text-muted">暂无检索结果，输入问题后点击“检索”。</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {queryResults.map((result, index) => (
              <div
                key={`${result.document_id}-${index}`}
                className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-text-primary truncate">{result.document_title}</p>
                  <span className="text-[10px] text-text-muted">
                    score {(result.score || 0).toFixed(3)}
                    {result.page_number ? ` · p.${result.page_number}` : ''}
                  </span>
                </div>
                <p className="text-xs text-text-secondary line-clamp-3">{result.content}</p>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-white/45 bg-white/55 backdrop-blur-xl shadow-[0_10px_28px_rgba(15,23,42,0.06)] dark:border-white/20 dark:bg-white/10 p-4"
      >
        <p className="text-sm font-semibold text-text-primary mb-2">链路可视（用户视角）</p>
        <div className="grid md:grid-cols-4 gap-2">
          {[{ icon: FileSearch, name: '检索' }, { icon: Sparkles, name: '摘要' }, { icon: NotebookPen, name: '沉淀' }, { icon: Download, name: '导出' }].map((item, idx) => (
            <motion.div
              key={item.name}
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + idx * 0.06 }}
              className="rounded-xl border border-border-primary bg-bg-primary px-3 py-2"
            >
              <p className="text-xs text-text-muted mb-1">阶段 {idx + 1}</p>
              <p className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <item.icon size={14} /> {item.name}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
