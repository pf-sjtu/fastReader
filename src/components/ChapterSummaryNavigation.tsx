import { memo, useEffect, useMemo, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface ChapterSummaryNavigationProps {
  chapters: Array<{
    id: string
    title: string
    content?: string
    processed: boolean
  }>
  totalChapters: number
  currentStepIndex: number
  processingMode: 'summary' | 'mindmap' | 'combined-mindmap'
  onChapterClick: (chapterId: string) => void
  processing: boolean
  currentProcessingChapter?: string
  currentViewingChapter?: string
  /** sidebar: 桌面侧栏；sheet: 移动端抽屉内全高 */
  variant?: 'sidebar' | 'sheet'
  className?: string
}

export const ChapterSummaryNavigation = memo(function ChapterSummaryNavigation({
  chapters,
  currentStepIndex,
  processingMode,
  onChapterClick,
  processing,
  currentProcessingChapter,
  currentViewingChapter,
  variant = 'sidebar',
  className
}: ChapterSummaryNavigationProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const processedCount = chapters.filter(ch => ch.processed).length
  const viewingIndex = currentViewingChapter
    ? chapters.findIndex(ch => ch.id === currentViewingChapter)
    : -1

  // 处理中：处理进度；处理完成：阅读进度（当前章序号 / 总数）
  const isReadingMode = !processing
  const progressCurrent = isReadingMode
    ? (viewingIndex >= 0 ? viewingIndex + 1 : 0)
    : processedCount
  const progressTotal = chapters.length
  const progressPct = progressTotal > 0 ? (progressCurrent / progressTotal) * 100 : 0
  const isSheet = variant === 'sheet'

  const progressLabel = isReadingMode
    ? t('nav.readingProgress', '阅读进度')
    : t('nav.processingProgress', '处理进度')

  const indexById = useMemo(() => {
    const map = new Map<string, number>()
    chapters.forEach((ch, i) => map.set(ch.id, i))
    return map
  }, [chapters])

  // 目录列表自动滚到当前章，保持可见
  useEffect(() => {
    if (!currentViewingChapter) return
    const el = itemRefs.current.get(currentViewingChapter)
    if (!el || !listRef.current) return

    const list = listRef.current
    const listRect = list.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const padding = 12

    if (elRect.top < listRect.top + padding) {
      list.scrollBy({ top: elRect.top - listRect.top - padding, behavior: 'smooth' })
    } else if (elRect.bottom > listRect.bottom - padding) {
      list.scrollBy({ top: elRect.bottom - listRect.bottom + padding, behavior: 'smooth' })
    }
  }, [currentViewingChapter])

  if (currentStepIndex !== 2 || processingMode !== 'summary' || chapters.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-card overflow-hidden',
        isSheet
          ? 'w-full h-full border-0 rounded-none'
          : 'w-52 sticky top-4 border rounded-lg',
        className
      )}
      style={isSheet ? undefined : { maxHeight: 'calc(100vh - 8rem)' }}
    >
      {/* 进度头部：处理中=处理进度，完成后=阅读进度 */}
      <div className="px-3 py-2.5 border-b shrink-0 space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{progressLabel}</span>
          <span className="tabular-nums">
            {progressCurrent}/{progressTotal}
          </span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* 时间轴章节列表 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-3"
      >
        {chapters.map((chapter, index) => {
          const isProcessing = chapter.id === currentProcessingChapter
          const isViewing = chapter.id === currentViewingChapter
          const isLast = index === chapters.length - 1
          const chapterIndex = indexById.get(chapter.id) ?? index
          // 已读：在当前章之前且已处理；未读：当前之后
          const isRead =
            chapter.processed &&
            viewingIndex >= 0 &&
            chapterIndex < viewingIndex
          const isUnread =
            chapter.processed &&
            (!isViewing) &&
            (viewingIndex < 0 || chapterIndex > viewingIndex)

          return (
            <div
              key={chapter.id}
              ref={(node) => {
                if (node) itemRefs.current.set(chapter.id, node)
                else itemRefs.current.delete(chapter.id)
              }}
              data-chapter-id={chapter.id}
            >
              {/* 节点 + 文字同行，垂直居中对齐 */}
              <div className="flex items-center">
                {isProcessing ? (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-primary/30 flex items-center justify-center shrink-0">
                    <Loader2 className="h-2 w-2 text-primary animate-spin" />
                  </div>
                ) : chapter.processed ? (
                  <button
                    type="button"
                    onClick={() => onChapterClick(chapter.id)}
                    aria-label={chapter.title}
                    aria-current={isViewing ? 'true' : undefined}
                    className={cn(
                      'block w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors',
                      isViewing && 'bg-primary border-primary shadow-[0_0_0_2px] shadow-primary/25',
                      isRead && 'bg-muted-foreground/15 border-muted-foreground/25 hover:border-muted-foreground/40',
                      isUnread && 'bg-background border-muted-foreground/55 hover:border-primary/60',
                      !isViewing && !isRead && !isUnread && 'bg-background border-primary/40 hover:border-primary'
                    )}
                  />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-border shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => chapter.processed && onChapterClick(chapter.id)}
                  disabled={!chapter.processed}
                  aria-current={isViewing ? 'true' : undefined}
                  className={cn(
                    'ml-2.5 text-left text-xs leading-snug truncate min-w-0 flex-1 transition-colors',
                    isViewing && 'text-primary font-semibold',
                    // 已读：更浅
                    isRead && !isViewing && 'text-muted-foreground/45 hover:text-muted-foreground/70',
                    // 未读：稍深
                    isUnread && 'text-foreground/75 hover:text-foreground',
                    !chapter.processed && 'text-muted-foreground/35',
                    chapter.processed && !isViewing && !isRead && !isUnread && 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {chapter.title}
                </button>
              </div>
              {/* 连接线独立于节点下方 */}
              {!isLast && (
                <div
                  className={cn(
                    'ml-[7px] w-px h-3',
                    isRead || isViewing ? 'bg-primary/20' : 'bg-border'
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
