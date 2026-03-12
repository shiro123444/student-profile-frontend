import { useState, useRef, useCallback, useEffect } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type { NoteGraph } from '../../services/api'

interface NoteGraphViewProps {
  graph: NoteGraph | null
  activeNoteId?: string | null
  onNodeClick?: (noteId: string) => void
}

// Folder → color mapping
const folderColors = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
]

function getFolderColor(folder: string, folders: string[]): string {
  const idx = folders.indexOf(folder)
  return folderColors[idx % folderColors.length]
}

export default function NoteGraphView({ graph, activeNoteId, onNodeClick }: NoteGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ReturnType<typeof ForceGraph2D> extends React.ComponentType<infer P> ? P : never>(null)

  const folders = graph ? [...new Set(graph.nodes.map(n => n.folder))] : []

  const graphData = graph ? {
    nodes: graph.nodes.map(n => ({
      id: n.id,
      name: n.title || '无标题',
      folder: n.folder,
      linkCount: n.link_count,
      color: getFolderColor(n.folder, folders),
      size: Math.max(4, Math.min(12, 4 + (n.link_count || 0) * 2)),
    })),
    links: graph.edges.map(e => ({ source: e.source, target: e.target })),
  } : { nodes: [], links: [] }

  const handleNodeClick = useCallback((node: { id?: string | number }) => {
    if (node.id && onNodeClick) onNodeClick(String(node.id))
  }, [onNodeClick])

  // Auto-resize
  const [dimensions, setDimensions] = useState({ width: 400, height: 300 })
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        暂无笔记关系图谱
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <ForceGraph2D
        ref={graphRef as never}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeLabel="name"
        nodeRelSize={1}
        nodeVal={(node: { size?: number }) => node.size || 5}
        nodeColor={(node: { id?: string | number; color?: string }) =>
          String(node.id) === activeNoteId ? '#ffffff' : (node.color || '#8b5cf6')
        }
        nodeCanvasObject={(node: { x?: number; y?: number; name?: string; color?: string; size?: number; id?: string | number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const x = node.x || 0
          const y = node.y || 0
          const size = node.size || 5
          const isActive = String(node.id) === activeNoteId

          // Node circle
          ctx.beginPath()
          ctx.arc(x, y, size, 0, 2 * Math.PI)
          ctx.fillStyle = isActive ? '#8b5cf6' : (node.color || '#8b5cf6')
          ctx.fill()
          if (isActive) {
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 2
            ctx.stroke()
          }

          // Label
          if (globalScale > 0.8) {
            const label = node.name || ''
            const fontSize = Math.max(10, 12 / globalScale)
            ctx.font = `${fontSize}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.fillStyle = 'rgba(255,255,255,0.8)'
            ctx.fillText(label.length > 10 ? label.slice(0, 10) + '…' : label, x, y + size + 2)
          }
        }}
        linkColor={() => 'rgba(139, 92, 246, 0.2)'}
        linkWidth={1}
        onNodeClick={handleNodeClick}
        backgroundColor="transparent"
        cooldownTicks={100}
      />
      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
        {folders.slice(0, 5).map(folder => (
          <span key={folder} className="flex items-center gap-1 text-[10px] text-text-muted">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getFolderColor(folder, folders) }} />
            {folder || '/'}
          </span>
        ))}
      </div>
    </div>
  )
}
