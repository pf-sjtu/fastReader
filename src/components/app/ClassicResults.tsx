import { lazy, Suspense, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain } from 'lucide-react'
import type { MindElixirInstance } from 'mind-elixir'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TimelineNavigation } from '@/components/TimelineNavigation'
import type { BookProcessing } from './types'

// 重型面板懒加载，降低首屏解析体积
const ResultsSection = lazy(() => import('@/components/sections/ResultsSection').then((m) => ({ default: m.ResultsSection })))

interface ClassicResultsProps {
  book: BookProcessing
  isMobile: boolean
  currentStepIndex: number
  /** 导图章节（由 App 用 useMemo 稳定引用，避免 TimelineNavigation 无谓重渲染） */
  navChapters: NonNullable<BookProcessing['bookMindMap']>['chapters']
  onChapterNavigate: (chapterId: string) => void
  onReadChapter: (chapterId: string) => void
  onDownloadAllMarkdown: () => void
  onDownloadMindMap: (instance: MindElixirInstance, title: string, format: string) => void
  onBackToConfig: () => void
  /** 桌面端右侧的原文预览栏 */
  preview: ReactNode
}

/** 步骤 2 的经典布局：导图模式或尚无结果时使用（总结模式有结果后走阅读工作台） */
export function ClassicResults({
  book,
  isMobile,
  currentStepIndex,
  navChapters,
  onChapterNavigate,
  onReadChapter,
  onDownloadAllMarkdown,
  onDownloadMindMap,
  onBackToConfig,
  preview,
}: ClassicResultsProps) {
  const { t } = useTranslation()
  const { bookSummary, bookMindMap, processingMode } = book

  return (
    <div className="flex flex-col md:flex-row gap-3 md:gap-4 min-w-0">
      {/* 桌面：左侧导航 */}
      {!isMobile && processingMode !== 'summary' && (
        <TimelineNavigation
          chapters={navChapters}
          currentStepIndex={currentStepIndex}
          processingMode={processingMode}
          onChapterClick={onChapterNavigate}
          processing={book.processing}
          currentProcessingChapter={book.currentProcessingChapter}
          variant="sidebar"
        />
      )}

      {/* 中间结果展示 */}
      <div className="flex-1 min-w-0">
        {bookSummary || bookMindMap ? (
          <ErrorBoundary section={t('results.title')}>
            <Suspense
              fallback={
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">{t('progress.loading')}</CardContent>
                </Card>
              }
            >
              <ResultsSection
                processingMode={processingMode}
                bookSummary={bookSummary}
                bookMindMap={bookMindMap}
                file={book.file}
                expandedChapters={book.expandedChapters}
                onClearChapterCache={book.clearChapterCache}
                onClearSpecificCache={book.clearSpecificCache}
                onChapterExpandChange={book.handleChapterExpandChange}
                onReadChapter={onReadChapter}
                onDownloadAllMarkdown={onDownloadAllMarkdown}
                onDownloadMindMap={onDownloadMindMap}
                onRegenerateKeyCharts={book.regenerateKeyCharts}
                chartsGenerating={book.chartsGenerating}
                totalChapters={book.selectedChapters.size}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Brain className="h-12 w-12 text-muted-foreground/70 mx-auto mb-4" />
              <p className="text-muted-foreground">{t('results.noResults')}</p>
              <Button variant="outline" className="mt-4" onClick={onBackToConfig}>
                {t('common.backToConfig')}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {preview}
    </div>
  )
}
