import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, Circle, Loader2, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface TimelineNavigationProps {
  chapters: Array<{
    id: string
    title: string
    content?: string // 章节原始内容，用于预览
    processed: boolean
    processing?: boolean
  }>
  currentStepIndex: number
  processingMode: 'summary' | 'mindmap' | 'combined-mindmap'
  onChapterClick: (chapterId: string) => void
  processing: boolean
  currentProcessingChapter?: string
}

export const TimelineNavigation = memo(function TimelineNavigation({
  chapters,
  currentStepIndex,
  processingMode,
  onChapterClick,
  processing,
  currentProcessingChapter
}: TimelineNavigationProps) {
  const { t } = useTranslation()

  if (currentStepIndex !== 2 || (!processing && chapters.length === 0)) {
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
    <Card className="w-64 h-fit sticky top-4">
      <CardContent className="p-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {processingMode === 'summary' ? '章节总结' : '思维导图'}
            </h3>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {chapters.filter(ch => ch.processed).length}/{chapters.length}
            </div>
          </div>
          
          {/* 进度条 */}
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div 
              className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-300"
              style={{ width: `${getProgressPercentage()}%` }}
            />
          </div>

          {/* 时间轴导航 */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {chapters.map((chapter, index) => {
              const status = getChapterStatus(chapter)
              
              return (
                <div key={chapter.id} className="flex items-center gap-2">
                  {/* 连接线 */}
                  {index < chapters.length - 1 && (
                    <div className="absolute left-4 mt-8 w-0.5 h-6 bg-gray-300 dark:bg-gray-600" />
                  )}
                  
                  {/* 状态图标 */}
                  <div className="relative z-10">
                    {status === 'completed' && (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    )}
                    {status === 'processing' && (
                      <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
                    )}
                    {status === 'pending' && (
                      <Circle className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                    )}
                  </div>
                  
                  {/* 章节按钮 */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => chapter.processed && onChapterClick(chapter.id)}
                    disabled={!chapter.processed}
                    className="flex-1 justify-start h-auto p-2 text-xs"
                  >
                    <div className="w-full text-left">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {index + 1}. {chapter.title}
                      </div>
                      {/* 添加内容预览 */}
                      {chapter.content && (
                        <div className="text-gray-500 dark:text-gray-400 text-xs truncate mt-1">
                          {chapter.content.substring(0, 20)}...
                        </div>
                      )}
                      {status === 'processing' && (
                        <div className="text-blue-600 dark:text-blue-400 text-xs">
                          处理中...
                        </div>
                      )}
                    </div>
                  </Button>
                </div>
              )
            })}
          </div>

          {/* 快速操作 */}
          {processingMode === 'summary' && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  // 滚动到第一个已完成的章节
                  const firstCompleted = chapters.find(ch => ch.processed)
                  if (firstCompleted) {
                    onChapterClick(firstCompleted.id)
                  }
                }}
                disabled={!chapters.some(ch => ch.processed)}
              >
                <BookOpen className="h-3 w-3 mr-1" />
                查看第一个章节
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
})
