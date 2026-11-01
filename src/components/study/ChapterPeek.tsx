import { useMemo, type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useStudyStore } from '@/study/studyStore'
import type { StudyChapter } from '@/study/schema'

/** 速读要点在悬浮卡里最多显示几条 / 退回章节总结时摘录多少字 */
const PEEK_POINTS = 3
const PREVIEW_CHARS = 140

interface PeekChapter {
  id: string
  title: string
  summary?: string
}

interface Props {
  chapterId: string
  /** 速读里没有标题时用它兜底（如实体卡只知道章节标题） */
  title?: string
  /** 没有速读时退回「章节总结摘录」要用的章节（可选） */
  chapters?: readonly PeekChapter[]
  children: ReactNode
}

/** 章节总结 → 一小段纯文本（去掉 Markdown 标记与空白） */
const previewOf =(summary?: string) =>
  (summary ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[#>*_`~-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_CHARS)

/**
 * 章节链接的悬浮卡：任何「指向某一章」的链接 / 标签都包一层它。
 * 内容优先用速读（一句话 + 要点 + 术语），看一眼就知道这章讲什么；
 * 还没生成速读时退回章节总结摘录；两者都没有就不弹（原样渲染 children）。
 */
export function ChapterPeek({ chapterId, title, chapters, children }: Props) {
  const kitChapter = useStudyStore((s) => s.data.kit?.chapters.find((c) => c.chapterId === chapterId) as StudyChapter | undefined)
  const fallback = useMemo(() => {
    const c = chapters?.find((x) => x.id === chapterId)
    return c ? { title: c.title, preview: previewOf(c.summary) } : null
  }, [chapters, chapterId])

  const heading = kitChapter?.chapterTitle ?? fallback?.title ?? title
  if (!kitChapter && !fallback?.preview) return <>{children}</>

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1.5 text-left">
        {heading && <p className="text-xs font-semibold">{heading}</p>}
        {kitChapter ? (
          <>
            <p className="text-xs font-medium leading-snug">{kitChapter.oneLiner}</p>
            {kitChapter.points.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-3.5 text-xs leading-relaxed opacity-85">
                {kitChapter.points.slice(0, PEEK_POINTS).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-xs leading-relaxed opacity-80">{fallback?.preview}…</p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
