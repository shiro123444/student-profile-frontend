import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { graphApi } from '../services/api'
import type { KnowledgeGraphData as ApiGraphData } from '../services/api'
import type { GraphCommandEvent } from '../hooks/useAgentStream'

// Graph data types for ForceGraph2D
interface GraphNode {
  id: string
  name: string
  type: 'student' | 'mbti' | 'career' | 'skill' | 'course' | 'learning_path'
  color: string
  size: number
  description?: string
  [key: string]: unknown
}

interface GraphLink {
  source: string
  target: string
  type: string
  label: string
}

interface ForceGraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

interface KnowledgeGraphProps {
  studentId?: string
  careerId?: string
  mode?: 'student' | 'career' | 'full'
  onNodeClick?: (node: GraphNode) => void
  graphCommand?: GraphCommandEvent & { issuedAt?: number }
  onCommandExecuted?: (result: GraphCommandExecutionResult) => void
}

export interface GraphCommandExecutionResult {
  command: string
  target?: string
  params?: Record<string, unknown>
  issuedAt?: number
  executedAt: number
  status: 'success' | 'ignored' | 'error'
  success: boolean
  message: string
  undoCommand?: GraphCommandEvent
}

// Node type color mapping
const nodeColors: Record<string, string> = {
  student: '#ec4899',
  mbti: '#8b5cf6',
  career: '#10b981',
  skill: '#f59e0b',
  course: '#3b82f6',
  learning_path: '#ef4444',
}

// Node type size mapping
const nodeSizes: Record<string, number> = {
  student: 16,
  mbti: 14,
  career: 18,
  skill: 10,
  course: 12,
  learning_path: 14,
}

// Node type labels
const nodeTypeLabels: Record<string, string> = {
  student: '学生',
  mbti: 'MBTI类型',
  career: '职业',
  skill: '技能',
  course: '课程',
  learning_path: '学习路径',
}

export default function KnowledgeGraph({
  studentId,
  careerId,
  mode = 'full',
  onNodeClick,
  graphCommand,
  onCommandExecuted,
}: KnowledgeGraphProps) {
  const graphRef = useRef<any>(null)
  const [rawGraphData, setRawGraphData] = useState<ForceGraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [activeTypeFilters, setActiveTypeFilters] = useState<string[]>([])
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([])
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 800,
    height: typeof window !== 'undefined' ? window.innerHeight : 600
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const lastCommandKeyRef = useRef<string>('')

  const graphData = useMemo<ForceGraphData>(() => {
    if (activeTypeFilters.length === 0) {
      return rawGraphData
    }
    const allow = new Set(activeTypeFilters)
    const nodes = rawGraphData.nodes.filter((node) => allow.has(node.type))
    const nodeIds = new Set(nodes.map((node) => node.id))
    const links = rawGraphData.links.filter((link) => {
      const source = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
      const target = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
      return nodeIds.has(source) && nodeIds.has(target)
    })
    return { nodes, links }
  }, [rawGraphData, activeTypeFilters])

  // Fetch graph data via API service
  useEffect(() => {
    const fetchGraphData = async () => {
      setLoading(true)
      setError(null)

      try {
        let apiData: ApiGraphData

        if (mode === 'student' && studentId) {
          apiData = await graphApi.getStudentGraph(studentId)
        } else if (mode === 'career' && careerId) {
          apiData = await graphApi.getCareerGraph(careerId)
        } else {
          apiData = await graphApi.getFullGraph()
        }

        const formattedData: ForceGraphData = {
          nodes: apiData.nodes.map((node) => ({
            ...node,
            color: node.color || nodeColors[node.type] || '#9ca3af',
            size: node.size || nodeSizes[node.type] || 8,
          })),
          links: apiData.edges.map((edge) => ({
            source: edge.source,
            target: edge.target,
            label: edge.label,
            type: edge.type,
          })),
        }
        setRawGraphData(formattedData)
        setActiveTypeFilters([])
        setHighlightedNodeIds([])
      } catch (err) {
        console.error('获取图谱数据失败:', err)
        setError('无法连接到服务器，请确保后端服务已启动')

        // Dev mode: use mock data
        if (import.meta.env.DEV) {
          setRawGraphData(getMockData())
        }
      } finally {
        setLoading(false)
      }
    }

    fetchGraphData()
  }, [mode, studentId, careerId])

  // Responsive container sizing
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const width = rect.width > 0 ? rect.width : window.innerWidth
        const height = rect.height > 0 ? rect.height : window.innerHeight
        setDimensions({ width, height })
      } else {
        setDimensions({ width: window.innerWidth, height: window.innerHeight })
      }
    }

    updateDimensions()

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions()
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    window.addEventListener('resize', updateDimensions)
    const timer = setTimeout(updateDimensions, 100)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateDimensions)
      clearTimeout(timer)
    }
  }, [])

  // Configure D3 force simulation
  useEffect(() => {
    if (graphRef.current && graphData.nodes.length > 0) {
      const fg = graphRef.current

      try {
        const chargeForce = fg.d3Force('charge')
        if (chargeForce) {
          chargeForce.strength(-200)
          chargeForce.distanceMax(200)
        }

        const linkForce = fg.d3Force('link')
        if (linkForce) {
          linkForce.distance(100)
          linkForce.strength(0.5)
        }

        fg.d3ReheatSimulation()
      } catch (e) {
        console.warn('D3 force configuration failed:', e)
      }

      setTimeout(() => {
        if (fg) {
          fg.zoomToFit(600, 80)
        }
      }, 2000)
    }
  }, [graphData])

  // Node drawing function
  const drawNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (node.x === undefined || node.y === undefined || !isFinite(node.x) || !isFinite(node.y)) {
        return
      }

      const x = node.x
      const y = node.y
      const baseSize = node.size || 10
      const color = node.color || '#6b7280'
      const isHovered = hoveredNode?.id === node.id
      const isHighlighted = highlightedNodeIds.includes(node.id)

      const scale = isHovered ? 1.25 : (isHighlighted ? 1.15 : 1)
      const size = baseSize * scale

      if (isHovered || isHighlighted) {
        ctx.beginPath()
        ctx.arc(x, y, size + 15, 0, 2 * Math.PI)
        ctx.fillStyle = isHighlighted ? `${color}35` : `${color}25`
        ctx.fill()

        ctx.beginPath()
        ctx.arc(x, y, size + 8, 0, 2 * Math.PI)
        ctx.fillStyle = isHighlighted ? `${color}45` : `${color}35`
        ctx.fill()
      }

      ctx.shadowColor = isHovered || isHighlighted ? color : 'rgba(0,0,0,0.15)'
      ctx.shadowBlur = isHovered || isHighlighted ? 12 : 6
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = isHovered || isHighlighted ? 3 : 2

      ctx.beginPath()
      ctx.arc(x, y, size, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.fill()

      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0

      ctx.strokeStyle = isHovered || isHighlighted ? '#1f2937' : 'rgba(255,255,255,0.95)'
      ctx.lineWidth = isHovered || isHighlighted ? 3 : 2
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(x - size * 0.25, y - size * 0.25, size * 0.3, 0, 2 * Math.PI)
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.fill()

      const label = node.name || ''
      const fontSize = Math.max(11, 14 / globalScale)
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`
      const textWidth = ctx.measureText(label).width
      const padding = 6
      const labelY = y + size + fontSize / 2 + 10

      ctx.shadowColor = 'rgba(0,0,0,0.1)'
      ctx.shadowBlur = 4
      ctx.shadowOffsetY = 2

      ctx.fillStyle = isHovered || isHighlighted ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.92)'
      ctx.beginPath()
      ctx.roundRect(
        x - textWidth / 2 - padding,
        labelY - fontSize / 2 - padding / 2,
        textWidth + padding * 2,
        fontSize + padding,
        6
      )
      ctx.fill()

      if (isHovered || isHighlighted) {
        ctx.strokeStyle = color
        ctx.lineWidth = 2
      } else {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'
        ctx.lineWidth = 1
      }
      ctx.stroke()

      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = isHovered || isHighlighted ? '#111827' : '#374151'
      ctx.fillText(label, x, labelY)
    },
    [hoveredNode, highlightedNodeIds]
  )

  // Link drawing function
  const drawLink = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const start = link.source
      const end = link.target

      if (typeof start !== 'object' || typeof end !== 'object') return
      if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) {
        return
      }

      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.strokeStyle = 'rgba(156, 163, 175, 0.5)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      if (globalScale > 1.2 && link.label) {
        const midX = (start.x + end.x) / 2
        const midY = (start.y + end.y) / 2
        const fontSize = Math.max(10 / globalScale, 3)

        ctx.font = `${fontSize}px "Noto Sans SC", system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#6b7280'
        ctx.fillText(link.label, midX, midY)
      }
    },
    []
  )

  const handleNodeClick = useCallback(
    (node: any) => {
      if (onNodeClick) {
        onNodeClick(node as GraphNode)
      }

      if (graphRef.current) {
        graphRef.current.centerAt(node.x, node.y, 500)
        graphRef.current.zoom(2.5, 500)
      }
    },
    [onNodeClick]
  )

  const handleNodeHover = useCallback((node: any) => {
    setHoveredNode(node || null)
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'grab'
    }
  }, [])

  const findNodeByTarget = useCallback((target?: string): GraphNode | undefined => {
    if (!target) return undefined
    const normalized = target.trim().toLowerCase()
    if (!normalized) return undefined
    return rawGraphData.nodes.find((node) => node.id.toLowerCase() === normalized)
      || rawGraphData.nodes.find((node) => node.name.toLowerCase() === normalized)
      || rawGraphData.nodes.find((node) => node.name.toLowerCase().includes(normalized))
  }, [rawGraphData.nodes])

  const resolveNodeId = useCallback((value: unknown): string | undefined => {
    if (typeof value !== 'string' || value.trim().length === 0) return undefined
    const normalized = value.trim().toLowerCase()
    const direct = rawGraphData.nodes.find((node) => node.id.toLowerCase() === normalized)
    if (direct) return direct.id
    const byName = rawGraphData.nodes.find((node) => node.name.toLowerCase() === normalized)
    if (byName) return byName.id
    const fuzzy = rawGraphData.nodes.find((node) => node.name.toLowerCase().includes(normalized))
    return fuzzy?.id
  }, [rawGraphData.nodes])

  const findShortestPath = useCallback((sourceId: string, targetId: string): string[] => {
    if (sourceId === targetId) return [sourceId]

    const adjacency = new Map<string, string[]>()
    for (const node of rawGraphData.nodes) {
      adjacency.set(node.id, [])
    }

    for (const link of rawGraphData.links) {
      const source = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
      const target = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
      if (!adjacency.has(source)) adjacency.set(source, [])
      if (!adjacency.has(target)) adjacency.set(target, [])
      adjacency.get(source)?.push(target)
      adjacency.get(target)?.push(source)
    }

    const queue: string[] = [sourceId]
    const visited = new Set<string>([sourceId])
    const parent = new Map<string, string>()

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === targetId) break

      const neighbors = adjacency.get(current) || []
      for (const next of neighbors) {
        if (visited.has(next)) continue
        visited.add(next)
        parent.set(next, current)
        queue.push(next)
      }
    }

    if (!visited.has(targetId)) return []

    const path: string[] = [targetId]
    let cursor = targetId
    while (cursor !== sourceId) {
      const prev = parent.get(cursor)
      if (!prev) return []
      path.push(prev)
      cursor = prev
    }
    return path.reverse()
  }, [rawGraphData.links, rawGraphData.nodes])

  const focusNodeById = useCallback((nodeId: string, openPanel = false) => {
    if (!nodeId) return
    const sourceNode = rawGraphData.nodes.find((node) => node.id === nodeId)
    if (!sourceNode) return

    const hasVisibleNode = graphData.nodes.some((node) => node.id === nodeId)
    if (!hasVisibleNode && activeTypeFilters.length > 0) {
      setActiveTypeFilters([])
    }

    setHighlightedNodeIds((prev) => (prev.includes(nodeId) ? prev : [...prev, nodeId]))
    setHoveredNode(sourceNode)
    if (openPanel && onNodeClick) {
      onNodeClick(sourceNode)
    }

    const performFocus = () => {
      if (!graphRef.current) return
      const fgNodes = ((graphRef.current.graphData?.().nodes || []) as Array<GraphNode & { x?: number; y?: number }>)
      const visibleNode = fgNodes.find((node) => node.id === nodeId)
      if (!visibleNode || !Number.isFinite(visibleNode.x) || !Number.isFinite(visibleNode.y)) return
      graphRef.current.centerAt(visibleNode.x, visibleNode.y, 700)
      graphRef.current.zoom(2.3, 700)
    }

    window.setTimeout(performFocus, hasVisibleNode ? 0 : 120)
  }, [activeTypeFilters.length, graphData.nodes, onNodeClick, rawGraphData.nodes])

  const emitCommandResult = useCallback((
    payload: Omit<GraphCommandExecutionResult, 'executedAt' | 'issuedAt' | 'command' | 'target' | 'params'>
      & { undoCommand?: GraphCommandEvent },
    command: string,
    target?: string,
    params?: Record<string, unknown>,
    issuedAt?: number,
  ) => {
    onCommandExecuted?.({
      command,
      target,
      params,
      issuedAt,
      executedAt: Date.now(),
      ...payload,
    })
  }, [onCommandExecuted])

  useEffect(() => {
    if (!graphCommand?.command) return

    const command = graphCommand.command
    const target = graphCommand.target
    const params = graphCommand.params || {}
    const commandKey = `${graphCommand.issuedAt || 0}:${command}:${target || ''}:${JSON.stringify(params)}`
    if (lastCommandKeyRef.current === commandKey) return
    lastCommandKeyRef.current = commandKey

    if (command === 'focus_node') {
      const node = findNodeByTarget(target)
      if (!node) {
        emitCommandResult(
          {
            status: 'ignored',
            success: false,
            message: `未找到节点：${target || '空目标'}`,
          },
          command,
          target,
          params as Record<string, unknown>,
          graphCommand.issuedAt,
        )
        return
      }
      focusNodeById(node.id, true)
      emitCommandResult(
        {
          status: 'success',
          success: true,
          message: `已聚焦节点：${node.name}`,
          undoCommand: { command: 'fit_view' },
        },
        command,
        target,
        params as Record<string, unknown>,
        graphCommand.issuedAt,
      )
      return
    }

    if (command === 'filter_type') {
      const previousFilters = [...activeTypeFilters]
      const fromParams = Array.isArray((params as Record<string, unknown>).types)
        ? ((params as Record<string, unknown>).types as unknown[])
            .filter((value): value is string => typeof value === 'string')
        : []
      const fromTarget = typeof target === 'string'
        ? target.split(',').map((value) => value.trim()).filter(Boolean)
        : []
      const allTypes = [...new Set([...fromParams, ...fromTarget].map((value) => value.toLowerCase()))]
      const validTypes = allTypes.filter((value) => rawGraphData.nodes.some((node) => node.type === value))
      if (validTypes.length > 0) {
        setActiveTypeFilters(validTypes)
        setHighlightedNodeIds([])
        emitCommandResult(
          {
            status: 'success',
            success: true,
            message: `已过滤类型：${validTypes.join(', ')}`,
            undoCommand: previousFilters.length > 0
              ? { command: 'filter_type', params: { types: previousFilters } }
              : { command: 'clear_filters' },
          },
          command,
          target,
          params as Record<string, unknown>,
          graphCommand.issuedAt,
        )
      } else {
        emitCommandResult(
          {
            status: 'ignored',
            success: false,
            message: '未提供有效的节点类型过滤条件',
          },
          command,
          target,
          params as Record<string, unknown>,
          graphCommand.issuedAt,
        )
      }
      return
    }

    if (command === 'clear_filters') {
      const previousFilters = [...activeTypeFilters]
      setActiveTypeFilters([])
      setHighlightedNodeIds([])
      emitCommandResult(
        {
          status: 'success',
          success: true,
          message: '已清除过滤与高亮',
          undoCommand: previousFilters.length > 0
            ? { command: 'filter_type', params: { types: previousFilters } }
            : undefined,
        },
        command,
        target,
        params as Record<string, unknown>,
        graphCommand.issuedAt,
      )
      return
    }

    if (command === 'fit_view') {
      graphRef.current?.zoomToFit?.(600, 100)
      emitCommandResult(
        {
          status: 'success',
          success: true,
          message: '已自动适配图谱视图',
        },
        command,
        target,
        params as Record<string, unknown>,
        graphCommand.issuedAt,
      )
      return
    }

    if (command === 'highlight_path') {
      const payload = params as Record<string, unknown>
      let sourceValue = payload.source
      let targetValue = payload.target

      if ((!sourceValue || !targetValue) && typeof target === 'string' && target.includes('->')) {
        const [left, right] = target.split('->').map((value) => value.trim())
        if (!sourceValue) sourceValue = left
        if (!targetValue) targetValue = right
      }

      const sourceId = resolveNodeId(sourceValue)
      const targetId = resolveNodeId(targetValue)
      if (!sourceId || !targetId) {
        emitCommandResult(
          {
            status: 'ignored',
            success: false,
            message: '路径高亮失败：source/target 节点无法解析',
          },
          command,
          target,
          payload,
          graphCommand.issuedAt,
        )
        return
      }

      const path = findShortestPath(sourceId, targetId)
      if (path.length === 0) {
        emitCommandResult(
          {
            status: 'ignored',
            success: false,
            message: '路径高亮失败：未找到连通路径',
          },
          command,
          target,
          payload,
          graphCommand.issuedAt,
        )
        return
      }

      setHighlightedNodeIds(path)
      focusNodeById(path[0], true)
      emitCommandResult(
        {
          status: 'success',
          success: true,
          message: `已高亮路径，共 ${path.length} 个节点`,
          undoCommand: { command: 'fit_view' },
        },
        command,
        target,
        payload,
        graphCommand.issuedAt,
      )
      return
    }

    if (command === 'expand_node') {
      const node = findNodeByTarget(target)
      if (!node) {
        emitCommandResult(
          {
            status: 'ignored',
            success: false,
            message: `展开失败：未找到节点 ${target || ''}`,
          },
          command,
          target,
          params as Record<string, unknown>,
          graphCommand.issuedAt,
        )
        return
      }

      const neighborIds = rawGraphData.links.reduce<string[]>((acc, link) => {
        const source = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
        const targetId = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
        if (source === node.id) acc.push(targetId)
        if (targetId === node.id) acc.push(source)
        return acc
      }, [])
      setHighlightedNodeIds([node.id, ...new Set(neighborIds)])
      focusNodeById(node.id, true)
      emitCommandResult(
        {
          status: 'success',
          success: true,
          message: `已展开节点 ${node.name}，关联 ${new Set(neighborIds).size} 个邻居`,
          undoCommand: { command: 'fit_view' },
        },
        command,
        target,
        params as Record<string, unknown>,
        graphCommand.issuedAt,
      )
      return
    }

    if (command === 'open_panel') {
      const node = findNodeByTarget(target)
      if (node) {
        focusNodeById(node.id, true)
        emitCommandResult(
          {
            status: 'success',
            success: true,
            message: `已打开节点面板：${node.name}`,
            undoCommand: { command: 'fit_view' },
          },
          command,
          target,
          params as Record<string, unknown>,
          graphCommand.issuedAt,
        )
      } else {
        emitCommandResult(
          {
            status: 'ignored',
            success: false,
            message: `打开面板失败：未找到节点 ${target || ''}`,
          },
          command,
          target,
          params as Record<string, unknown>,
          graphCommand.issuedAt,
        )
      }
      return
    }

    emitCommandResult(
      {
        status: 'error',
        success: false,
        message: `未知图谱命令：${command}`,
      },
      command,
      target,
      params as Record<string, unknown>,
      graphCommand.issuedAt,
    )
  }, [
    activeTypeFilters,
    emitCommandResult,
    findNodeByTarget,
    findShortestPath,
    focusNodeById,
    graphCommand,
    rawGraphData.links,
    rawGraphData.nodes,
    resolveNodeId,
  ])

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-100" style={{ minWidth: '100vw', minHeight: '100vh' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-text-secondary font-medium">加载知识图谱中...</p>
        </div>
      </div>
    )
  }

  if (error && rawGraphData.nodes.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-100" style={{ minWidth: '100vw', minHeight: '100vh' }}>
        <div className="flex flex-col items-center gap-4 text-center p-8">
          <div className="text-7xl text-text-muted font-bold">!</div>
          <p className="text-red-500 font-semibold text-lg">{error}</p>
          <p className="text-text-muted">
            请确保 Neo4j 数据库已启动并运行后端服务
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-100 overflow-hidden"
      style={{ width: '100%', height: '100%', minWidth: '100vw', minHeight: '100vh' }}
    >
      {/* Legend */}
      <div className="absolute top-4 left-4 bg-bg-card backdrop-blur-md rounded-xl p-3 z-10 shadow-lg border border-border-primary">
        <h3 className="text-text-secondary font-semibold mb-2 text-xs uppercase tracking-wider">图例</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {Object.entries(nodeTypeLabels).map(([type, label]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full shadow-sm"
                style={{ backgroundColor: nodeColors[type] }}
              />
              <span className="text-text-secondary text-xs">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hovered node tooltip */}
      {hoveredNode && (
        <div
          className="absolute bottom-4 left-4 bg-bg-card backdrop-blur-md rounded-2xl px-5 py-4 z-10 shadow-xl border-2 transition-all duration-200"
          style={{ borderColor: `${hoveredNode.color}40` }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
              style={{ backgroundColor: hoveredNode.color }}
            >
              <span className="text-white text-lg">
                {hoveredNode.type === 'student' && 'S'}
                {hoveredNode.type === 'mbti' && 'M'}
                {hoveredNode.type === 'career' && 'C'}
                {hoveredNode.type === 'skill' && 'K'}
                {hoveredNode.type === 'course' && 'L'}
                {hoveredNode.type === 'learning_path' && 'P'}
              </span>
            </div>
            <div>
              <p className="text-text-primary font-semibold text-base">{hoveredNode.name}</p>
              <p className="text-text-muted text-xs">{nodeTypeLabels[hoveredNode.type]}</p>
            </div>
          </div>
          {hoveredNode.description && (
            <p className="mt-2 text-text-secondary text-sm border-t border-border-primary pt-2">
              {hoveredNode.description}
            </p>
          )}
          <p className="mt-2 text-text-muted text-xs">点击查看详情 →</p>
        </div>
      )}

      {/* Stats */}
      <div className="absolute top-4 right-4 bg-bg-card backdrop-blur-md rounded-xl px-4 py-2 z-10 shadow-lg border border-border-primary">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-text-muted">
            节点 <span className="text-text-primary font-semibold">{graphData.nodes.length}</span>
          </span>
          <span className="text-text-muted">|</span>
          <span className="text-text-muted">
            关系 <span className="text-text-primary font-semibold">{graphData.links?.length || 0}</span>
          </span>
        </div>
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-4 right-4 bg-bg-card backdrop-blur-md rounded-xl px-3 py-2 z-10 shadow-lg border border-border-primary">
        <p className="text-text-muted text-xs">
          拖拽节点移动 · 空白处平移 · 滚轮缩放
        </p>
      </div>

      {/* Force Graph */}
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={drawNode}
        linkCanvasObject={drawLink}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        nodeLabel={() => ''}
        linkLabel={() => ''}
        backgroundColor="transparent"
        linkDirectionalArrowLength={6}
        linkDirectionalArrowRelPos={0.85}
        linkDirectionalArrowColor={() => 'rgba(156, 163, 175, 0.6)'}
        cooldownTicks={200}
        cooldownTime={3000}
        d3VelocityDecay={0.4}
        d3AlphaDecay={0.02}
        d3AlphaMin={0.001}
        warmupTicks={100}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          if (!isFinite(node.x) || !isFinite(node.y)) return
          const size = (node.size || 10) + 15
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(node.x, node.y, size, 0, 2 * Math.PI)
          ctx.fill()
        }}
        minZoom={0.2}
        maxZoom={6}
        nodeRelSize={1}
        linkWidth={1.5}
        onNodeDrag={(node: any) => {
          node.fx = node.x
          node.fy = node.y
          if (graphRef.current) {
            graphRef.current.d3ReheatSimulation()
          }
        }}
        onNodeDragEnd={(node: any) => {
          node.fx = undefined
          node.fy = undefined
          if (graphRef.current) {
            graphRef.current.d3ReheatSimulation()
          }
        }}
        onEngineStop={() => {
          if (graphRef.current) {
            graphRef.current.zoomToFit(600, 100)
          }
        }}
        dagMode={undefined}
        dagLevelDistance={undefined}
      />
    </div>
  )
}

// Mock data for dev mode
function getMockData(): ForceGraphData {
  return {
    nodes: [
      { id: 'mbti-intj', name: 'INTJ 建筑师', type: 'mbti', color: nodeColors.mbti, size: nodeSizes.mbti },
      { id: 'mbti-intp', name: 'INTP 逻辑学家', type: 'mbti', color: nodeColors.mbti, size: nodeSizes.mbti },
      { id: 'mbti-entj', name: 'ENTJ 指挥官', type: 'mbti', color: nodeColors.mbti, size: nodeSizes.mbti },
      { id: 'career-ai-researcher', name: 'AI研究员', type: 'career', color: nodeColors.career, size: nodeSizes.career },
      { id: 'career-ml-engineer', name: '机器学习工程师', type: 'career', color: nodeColors.career, size: nodeSizes.career },
      { id: 'career-data-scientist', name: '数据科学家', type: 'career', color: nodeColors.career, size: nodeSizes.career },
      { id: 'skill-python', name: 'Python', type: 'skill', color: nodeColors.skill, size: nodeSizes.skill },
      { id: 'skill-ml', name: '机器学习', type: 'skill', color: nodeColors.skill, size: nodeSizes.skill },
      { id: 'skill-math', name: '数学基础', type: 'skill', color: nodeColors.skill, size: nodeSizes.skill },
      { id: 'skill-dl', name: '深度学习', type: 'skill', color: nodeColors.skill, size: nodeSizes.skill },
      { id: 'course-ml-coursera', name: '机器学习 (Coursera)', type: 'course', color: nodeColors.course, size: nodeSizes.course },
      { id: 'course-dl-ai', name: '深度学习专项课程', type: 'course', color: nodeColors.course, size: nodeSizes.course },
      { id: 'course-python', name: 'Python编程基础', type: 'course', color: nodeColors.course, size: nodeSizes.course },
    ],
    links: [
      { source: 'mbti-intj', target: 'career-ai-researcher', label: '适合', type: 'SUITS' },
      { source: 'mbti-intp', target: 'career-ai-researcher', label: '适合', type: 'SUITS' },
      { source: 'mbti-intj', target: 'career-data-scientist', label: '适合', type: 'SUITS' },
      { source: 'mbti-entj', target: 'career-ml-engineer', label: '适合', type: 'SUITS' },
      { source: 'career-ai-researcher', target: 'skill-ml', label: '需要', type: 'REQUIRES' },
      { source: 'career-ai-researcher', target: 'skill-dl', label: '需要', type: 'REQUIRES' },
      { source: 'career-ai-researcher', target: 'skill-math', label: '需要', type: 'REQUIRES' },
      { source: 'career-ml-engineer', target: 'skill-python', label: '需要', type: 'REQUIRES' },
      { source: 'career-ml-engineer', target: 'skill-ml', label: '需要', type: 'REQUIRES' },
      { source: 'career-data-scientist', target: 'skill-python', label: '需要', type: 'REQUIRES' },
      { source: 'career-data-scientist', target: 'skill-math', label: '需要', type: 'REQUIRES' },
      { source: 'course-ml-coursera', target: 'skill-ml', label: '教授', type: 'TEACHES' },
      { source: 'course-dl-ai', target: 'skill-dl', label: '教授', type: 'TEACHES' },
      { source: 'course-python', target: 'skill-python', label: '教授', type: 'TEACHES' },
    ],
  }
}
