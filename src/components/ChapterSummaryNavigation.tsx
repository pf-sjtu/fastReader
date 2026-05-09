import { memo } from 'react'
import { Loader2 } from 'lucide-react'

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
}

export const ChapterSummaryNavigation = memo(function ChapterSummaryNavigation({
  chapters,
  currentStepIndex,
  processingMode,
  onChapterClick,
  currentProcessingChapter,
  currentViewingChapter
}: ChapterSummaryNavigationProps) {
  if (currentStepIndex !== 2 || processingMode !== 'summary' || chapters.length === 0) {
    return null
  }

  const processedCount = chapters.filter(ch => ch.processed).length
  const progressPct = chapters.length > 0 ? (processedCount / chapters.length) * 100 : 0

  return (
    <div
      className="w-52 sticky top-4 flex flex-col bg-card border rounded-lg overflow-hidden"
      style={{ maxHeight: 'calc(100vh - 8rem)' }}
    >
      {/* 进度头部 */}
      <div className="px-3 py-2.5 border-b shrink-0 space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>进度</span>
          <span>{processedCount}/{chapters.length}</span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* 时间轴章节列表 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-3">
        {chapters.map((chapter, index) => {
          const isProcessing = chapter.id === currentProcessingChapter
          const isViewing = chapter.id === currentViewingChapter
          const isLast = index === chapters.length - 1

          return (
            <div key={chapter.id} className="flex min-h-0">
              {/* 时间轴轨道 */}
              <div className="flex flex-col items-center shrink-0 mr-2.5">
                {isProcessing ? (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-primary/30 flex items-center justify-center shrink-0">
                    <Loader2 className="h-2 w-2 text-primary animate-spin" />
                  </div>
                ) : chapter.processed ? (
                  <button
                    onClick={() => onChapterClick(chapter.id)}
                    className={`block w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors ${
                      isViewing
                        ? 'bg-primary border-primary'
                        : 'bg-background border-primary/40 hover:border-primary'
                    }`}
                  />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-border shrink-0" />
                )}
                {!isLast && <div className="w-px flex-1 bg-border" />}
              </div>

              {/* 章节标签 */}
              <div className="pb-3 min-w-0 flex-1">
                <button
                  onClick={() => chapter.processed && onChapterClick(chapter.id)}
                  disabled={!chapter.processed}
                  className={`text-left text-xs leading-snug truncate w-full transition-colors ${
                    isViewing
                      ? 'text-foreground font-semibold'
                      : chapter.processed
                      ? 'text-muted-foreground hover:text-foreground'
                      : 'text-muted-foreground/40'
                  }`}
                >
                  {chapter.title}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
