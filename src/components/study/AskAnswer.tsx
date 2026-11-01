import { memo, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { prepareMarkdownForRender } from '@/lib/markdown'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CITE_SCHEME, linkifyCitations } from '@/study/retrieve'

const REMARK_PLUGINS = [remarkGfm, remarkCjkFriendly]
/** 悬浮卡里摘录的章节总结长度 */
const PREVIEW_CHARS = 140

interface Chapter {
  id: string
  title: string
  summary?: string
}

interface Props {
  answer: string
  chapters: readonly Chapter[]
  onJumpChapter: (chapterId: string) => void
}

/** 章节总结 → 悬浮卡里的一小段纯文本（去掉 Markdown 标记与空白） */
const previewOf = (summary?: string) =>
  (summary ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[#>*_`~-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_CHARS)

/**
 * 问书的答案：渲染 Markdown，并把「【章节标题】」画成章节标签——
 * 点击跳到该章，悬浮 / 聚焦时显示章节标题与总结摘录，看一眼就能判断依据对不对。
 */
export const AskAnswer = memo(function AskAnswer({ answer, chapters, onJumpChapter }: Props) {
  const source = useMemo(() => prepareMarkdownForRender(linkifyCitations(answer, chapters)), [answer, chapters])

  const components = useMemo<Components>(() => {
    const byId = new Map(chapters.map((c) => [c.id, c]))
    return {
      a({ href, children }: { href?: string; children?: ReactNode }) {
        if (href?.startsWith(CITE_SCHEME)) {
          const id = decodeURIComponent(href.slice(CITE_SCHEME.length))
          const chapter = byId.get(id)
          const preview = previewOf(chapter?.summary)
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onJumpChapter(id)}
                  className="mx-0.5 inline-flex max-w-[12rem] items-center truncate rounded-full border bg-muted px-1.5 align-baseline text-xs text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {children}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs space-y-1 text-left">
                <p className="text-xs font-semibold">{chapter?.title ?? id}</p>
                {preview && <p className="text-xs leading-relaxed opacity-80">{preview}…</p>}
              </TooltipContent>
            </Tooltip>
          )
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        )
      },
    }
  }, [chapters, onJumpChapter])

  return (
    <div className="prose prose-sm max-w-none break-words prose-headings:my-2 prose-headings:text-sm prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-blockquote:my-1.5">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={components}
        // 默认只放行 http(s) 等协议；cite: 是我们自己的章节引用，其余照旧过滤
        urlTransform={(url) => (url.startsWith(CITE_SCHEME) ? url : defaultUrlTransform(url))}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
})
