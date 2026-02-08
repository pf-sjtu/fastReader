import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'

interface ChapterSummaryNavigationProps {
  chapters: Array<{
    id: string
    title: string
    content?: string // 章节原始内容，用于预览
    processed: boolean
  }>
  totalChapters: number // 总章节数
  currentStepIndex: number
  processingMode: 'summary' | 'mindmap' | 'combined-mindmap'
  onChapterClick: (chapterId: string) => void
  processing: boolean
  currentProcessingChapter?: string
  currentViewingChapter?: string
}

export const ChapterSummaryNavigation = memo(function ChapterSummaryNavigation({
  chapters,
  totalChapters,
  currentStepIndex,
  processingMode,
  onChapterClick,
  processing,
  currentProcessingChapter,
  currentViewingChapter
}: ChapterSummaryNavigationProps) {
  // 只在总结模式且步骤2时显示
  if (currentStepIndex !== 2 || processingMode !== 'summary' || chapters.length === 0) {
    return null
  }

  const getProgressPercentage = () => {
    const processedCount = chapters.filter(ch => ch.processed).length
    return chapters.length > 0 ? (processedCount / chapters.length) * 100 : 0
  }

  const getChapterStatus = (chapter: typeof chapters[0]) => {
    if (chapter.id === currentProcessingChapter) return 'processing'
    if (chapter.processed) return 'completed'
    return 'pending'
  }

  return (
    <Card className="w-20 h-fit sticky top-4">
      <CardContent className="p-3">
        <div className="space-y-3">
          {/* 进度条 */}
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
            <div 
              className="bg-blue-600 dark:bg-blue-400 h-1 rounded-full transition-all duration-300"
              style={{ width: `${getProgressPercentage()}%` }}
            />
          </div>

          {/* 章节序号导航 */}
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {chapters.map((chapter, index) => {
              const status = getChapterStatus(chapter)
              const isViewing = chapter.id === currentViewingChapter
              
              return (
                <div key={chapter.id} className="flex justify-center">
                  <Button
                    variant={isViewing ? "default" : "ghost"}
                    size="sm"
                    onClick={() => chapter.processed && onChapterClick(chapter.id)}
                    disabled={!chapter.processed}
                    className={`w-10 h-10 p-0 text-xs font-medium ${
                      isViewing 
                        ? 'bg-blue-600 text-white hover:bg-blue-700' 
                        : status === 'completed'
                        ? 'hover:bg-gray-100 dark:hover:bg-gray-700'
                        : 'cursor-default'
                    }`}
                  >
                    <div className="flex items-center justify-center w-full h-full">
                      {status === 'completed' && (
                        <div className="flex items-center justify-center">
                          <span className="text-sm">{index + 1}</span>
                        </div>
                      )}
                      {status === 'processing' && (
                        <Loader2 className="h-3 w-3 text-blue-600 dark:text-blue-400 animate-spin" />
                      )}
                      {status === 'pending' && (
                        <span className="text-sm text-gray-400 dark:text-gray-500">{index + 1}</span>
                      )}
                    </div>
                  </Button>
                </div>
              )
            })}
          </div>

          {/* 统计信息 */}
          <div className="text-center">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {chapters.filter(ch => ch.processed).length}/{chapters.length}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})
