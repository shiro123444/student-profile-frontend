import { useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

interface NotePreviewProps {
  content: string
  onWikiLinkClick?: (title: string) => void
  onTagClick?: (tag: string) => void
}

export default function NotePreview({ content, onWikiLinkClick, onTagClick }: NotePreviewProps) {
  // Pre-process: convert [[wiki-links]] and #tags to markdown links
  // [[title]] → [⟦title⟧](wikilink://title)
  // #tag → [#tag](notetag://tag)
  const processed = useMemo(() => {
    let text = content
    text = text.replace(/\[\[([^\]]+)\]\]/g, (_match, title: string) =>
      `[⟦${title}⟧](wikilink://${encodeURIComponent(title)})`)
    text = text.replace(/(?:^|\s)(#[\w\u4e00-\u9fff]+)/gm, (match, tag: string) =>
      match.replace(tag, `[${tag}](notetag://${encodeURIComponent(tag.slice(1))})`))
    return text
  }, [content])

  const handleLinkClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault()
    if (href.startsWith('wikilink://')) {
      const title = decodeURIComponent(href.replace('wikilink://', ''))
      onWikiLinkClick?.(title)
    } else if (href.startsWith('notetag://')) {
      const tag = decodeURIComponent(href.replace('notetag://', ''))
      onTagClick?.(tag)
    } else {
      window.open(href, '_blank', 'noopener')
    }
  }, [onWikiLinkClick, onTagClick])

  const components: Components = useMemo(() => ({
    a: ({ href, children, ...rest }) => {
      const url = href || ''
      if (url.startsWith('wikilink://')) {
        return (
          <span
            className="text-purple-400 underline cursor-pointer hover:text-purple-300 transition-colors"
            onClick={(e) => handleLinkClick(e as unknown as React.MouseEvent<HTMLAnchorElement>, url)}
            {...rest}
          >
            {children}
          </span>
        )
      }
      if (url.startsWith('notetag://')) {
        return (
          <span
            className="text-blue-400 font-medium cursor-pointer hover:text-blue-300 transition-colors"
            onClick={(e) => handleLinkClick(e as unknown as React.MouseEvent<HTMLAnchorElement>, url)}
            {...rest}
          >
            {children}
          </span>
        )
      }
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" {...rest}>
          {children}
        </a>
      )
    },
  }), [handleLinkClick])

  return (
    <div className="h-full overflow-auto px-6 py-4 prose prose-sm dark:prose-invert max-w-none
      prose-headings:text-text-primary prose-p:text-text-secondary prose-a:text-primary-500
      prose-code:bg-bg-tertiary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
      prose-pre:bg-bg-tertiary prose-pre:border prose-pre:border-border-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  )
}
