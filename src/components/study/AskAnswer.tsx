import { memo, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { prepareMarkdownForRender } from '@/lib/markdown'
import { CITE_SCHEME, linkifyCitations } from '@/study/retrieve'
import { ChapterPeek } from './ChapterPeek'

const REMARK_PLUGINS = [remarkGfm, remarkCjkFriendly]

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

/**
 * 问书的答案：渲染 Markdown，并把「【章节标题】」画成章节标签——
 * 点击跳到该章，悬浮 / 聚焦时显示该章的速读（没有速读时退回总结摘录），看一眼就能判断依据对不对。
 */
export const AskAnswer = memo(function AskAnswer({ answer, chapters, onJumpChapter }: Props) {
  const source = useMemo(() => prepareMarkdownForRender(linkifyCitations(answer, chapters)), [answer, chapters])

  const components = useMemo<Components>(
    () => ({
      a({ href, children }: { href?: string; children?: ReactNode }) {
        if (href?.startsWith(CITE_SCHEME)) {
          // micromark 只检查 % 后面是不是字母数字，不检查是不是十六进制：cite:%zz 会让 decodeURIComponent 抛异常
          const raw = href.slice(CITE_SCHEME.length)
          const id = (() => {
            try {
              return decodeURIComponent(raw)
            } catch {
              return raw
            }
          })()
          return (
            <ChapterPeek chapterId={id} chapters={chapters}>
              <button
                type="button"
                onClick={() => onJumpChapter(id)}
                className="mx-0.5 inline-block max-w-full whitespace-normal break-words rounded-md border bg-muted px-1.5 py-0.5 align-baseline text-xs leading-snug text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {children}
              </button>
            </ChapterPeek>
          )
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        )
      },
      // 外链图片会在渲染时自动发请求，模型输出（可能被书中文字注入）借此能把对话内容带出去：只显示替代文字，不加载
      img: ({ alt }: { alt?: string }) => <span className="text-muted-foreground">{alt ? `[${alt}]` : ''}</span>,
    }),
    [chapters, onJumpChapter]
  )

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
