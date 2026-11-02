import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkdownCard, type RemarkPlugins } from '@/components/MarkdownCard'
import { MindMapCard } from '@/components/MindMapCard'
import { ChapterQualityNote } from './ChapterQualityNote'
import { ResultActions, ResultTitle } from './ResultTopBar'
import { StepRetryNote } from './StepRetryNote'
import type { BookStepKind } from '@/hooks/useBookSteps'
import { ChartsPanel } from '@/charts'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { isUsableText } from '@/utils/resultStatus'
import type { MindElixirInstance, Options } from 'mind-elixir'
import type { BookSummary, BookMindMap, ProcessingMode } from '@/hooks/useBookProcessing'

const mindElixirOptions = { direction: 1, alignment: 'nodes' } as Options

interface ResultsSectionProps {
  processingMode: ProcessingMode
  bookSummary: BookSummary | null
  bookMindMap: BookMindMap | null
  file: File | null
  expandedChapters: Set<string>
  onClearChapterCache: (chapterId: string) => void
  onClearSpecificCache: (cacheType: string) => void
  onChapterExpandChange: (chapterId: string, isExpanded: boolean) => void
  onReadChapter: (chapterId: string) => void
  onDownloadAllMarkdown: () => void
  onDownloadMindMap?: (instance: MindElixirInstance, title: string, format: string) => void
  onRegenerateKeyCharts?: () => void | Promise<void>
  chartsGenerating?: boolean
  /** 处理中尚无结果章节时，头部显示的预期总章数 */
  totalChapters?: number
  /**
   * full：全部页签（旧布局 / 导图模式）；
   * body：阅读工作台的正文栏——只留「章节总结 / 章节关联」，综述与图表在对照栏
   */
  variant?: 'full' | 'body'
  /**
   * 章节卡的联动扩展（工作台提供）：实体标注插件 + 「本章出场」条。
   * 对象本身必须 useMemo 稳定，否则每次渲染都会让所有章节卡重算 Markdown。
   */
  chapterExtras?: {
    remarkPlugins?: RemarkPlugins
    /** 按章节取插件（如只标注本章的划线）；同一章节必须返回稳定引用 */
    remarkPluginsFor?: (chapterId: string) => RemarkPlugins | undefined
    renderStrip?: (chapterId: string) => React.ReactNode
  }
  /** 关联分析 / 全书总结失败或缺失时的单步重试 */
  onRetryStep?: (kind: BookStepKind) => void
  stepRunning?: BookStepKind | null
}

export const ResultsSection = memo(function ResultsSection({
  onRetryStep,
  stepRunning,
  processingMode,
  bookSummary,
  bookMindMap,
  file,
  expandedChapters,
  onClearChapterCache,
  onClearSpecificCache,
  onChapterExpandChange,
  onReadChapter,
  onDownloadAllMarkdown,
  onDownloadMindMap,
  onRegenerateKeyCharts,
  chartsGenerating = false,
  totalChapters = 0,
  variant = 'full',
  chapterExtras,
}: ResultsSectionProps) {
  const isBody = variant === 'body'
  const { t } = useTranslation()
  // 受控 Tab，避免切换时整树 default 重置
  const [summaryTab, setSummaryTab] = useState('chapters')
  const [mindMapTab, setMindMapTab] = useState('chapters')

  // 稳定回调：MarkdownCard 为 memo 组件，内联箭头会让每张卡在任何父级更新时重渲染
  const handleExpandChange = useCallback(
    (isExpanded: boolean, chapterId: string) => onChapterExpandChange(chapterId, isExpanded),
    [onChapterExpandChange]
  )
  const clearConnections = useCallback(() => onClearSpecificCache('connections'), [onClearSpecificCache])
  const clearOverall = useCallback(() => onClearSpecificCache('overall_summary'), [onClearSpecificCache])
  const clearCharts = useCallback(() => onClearSpecificCache('key_charts'), [onClearSpecificCache])

  if (!bookSummary && !bookMindMap) {
    return null
  }

  return (
    <Card className="min-w-0 gap-2 sm:gap-4 py-2 sm:py-4">
      {/* 经典布局（导图模式）：书名与操作仍留在卡片头部。
          工作台的 body 变体由顶栏（ResultTitle）与正文列顶部（ResultActions）承担，这里不重复 */}
      {!isBody && (
        <CardHeader className="overflow-hidden px-2 sm:px-4">
          <CardTitle className="min-w-0">
            <ResultTitle
              processingMode={processingMode}
              bookSummary={bookSummary}
              bookMindMap={bookMindMap}
              totalChapters={totalChapters}
              className="truncate"
            />
          </CardTitle>
          <div className="-mt-1 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <ResultActions
              processingMode={processingMode}
              bookSummary={bookSummary}
              file={file}
              onDownloadAllMarkdown={onDownloadAllMarkdown}
              className="shrink-0"
            />
          </div>
        </CardHeader>
      )}
      {/* 内容区移动端几乎贴边；真正内边距留给章节卡本身 */}
      <CardContent className="min-w-0 px-1 sm:px-4">
        {processingMode === 'summary' && bookSummary ? (
          <Tabs
            value={summaryTab}
            onValueChange={setSummaryTab}
            // 工作台正文：限定舒适行宽（约 48rem≈中文 40 字/行）并居中，对照栏收起时也不会拉成超长行
            className={cn('w-full min-w-0', isBody && 'mx-auto max-w-3xl')}
          >
            <TabsList className={cn('grid w-full h-auto', isBody ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}>
              <TabsTrigger value="chapters" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                {t('results.tabs.chapterSummary')}
              </TabsTrigger>
              <TabsTrigger value="connections" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                {t('results.tabs.connections')}
              </TabsTrigger>
              {!isBody && (
                <>
                  <TabsTrigger value="overall" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                    {t('results.tabs.overallSummary')}
                  </TabsTrigger>
                  <TabsTrigger value="charts" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                    {t('results.tabs.keyCharts')}
                  </TabsTrigger>
                </>
              )}
            </TabsList>

            <TabsContent value="chapters" className="grid grid-cols-1 gap-2.5 sm:gap-4">
              {bookSummary.chapters.map((chapter, index) => (
                <MarkdownCard
                  key={chapter.id}
                  id={chapter.id}
                  title={chapter.title}
                  content={chapter.content}
                  markdownContent={chapter.summary || ''}
                  index={index}
                  defaultCollapsed={index > 0}
                  isExpanded={expandedChapters.has(chapter.id)}
                  onExpandChange={handleExpandChange}
                  onClearCache={onClearChapterCache}
                  onReadChapter={onReadChapter}
                  extraRemarkPlugins={chapterExtras?.remarkPlugins}
                  extraRemarkPluginsFor={chapterExtras?.remarkPluginsFor}
                  headerExtra={
                    chapter.quality === 'warn' || chapterExtras?.renderStrip ? (
                      <>
                        {chapter.quality === 'warn' && <ChapterQualityNote />}
                        {chapterExtras?.renderStrip?.(chapter.id)}
                      </>
                    ) : undefined
                  }
                />
              ))}
            </TabsContent>

            <TabsContent value="connections">
              <StepRetryNote kind="connections" text={bookSummary.connections} running={stepRunning ?? null} onRetry={onRetryStep} />
              <MarkdownCard
                id="connections"
                title={t('results.tabs.connections')}
                content={bookSummary.connections}
                markdownContent={bookSummary.connections}
                index={0}
                showIndex={false}
                showClearCache={true}
                showViewContent={false}
                showCopyButton={true}
                onClearCache={clearConnections}
              />
            </TabsContent>

            {!isBody && (
              <TabsContent value="overall">
                <MarkdownCard
                  id="overall"
                  title={t('results.tabs.overallSummary')}
                  content={bookSummary.overallSummary}
                  markdownContent={bookSummary.overallSummary}
                  index={0}
                  showIndex={false}
                  showClearCache={true}
                  showViewContent={false}
                  showCopyButton={true}
                  onClearCache={clearOverall}
                />
              </TabsContent>
            )}

            {/* forceMount：切走 Tab 不销毁关系图/cytoscape，避免布局抖动 */}
            {!isBody && (
              <TabsContent
                value="charts"
                forceMount
                className={cn(
                  'min-w-0 mt-2',
                  summaryTab !== 'charts' && 'hidden'
                )}
              >
                <ErrorBoundary section={t('results.tabs.keyCharts')}>
                  <ChartsPanel
                    charts={bookSummary.charts}
                    chartsError={bookSummary.chartsError}
                    generating={chartsGenerating}
                    onClearCache={clearCharts}
                    onRegenerate={onRegenerateKeyCharts}
                    canRegenerate={
                      isUsableText(bookSummary.overallSummary) &&
                      bookSummary.chapters.length > 0
                    }
                  />
                </ErrorBoundary>
              </TabsContent>
            )}
          </Tabs>
        ) : processingMode === 'mindmap' && bookMindMap ? (
          <Tabs
            // 整书导图页签可能消失（无 combinedMindMap）：此时回落到章节页签
            value={mindMapTab === 'combined' && !bookMindMap.combinedMindMap ? 'chapters' : mindMapTab}
            onValueChange={setMindMapTab}
            className="w-full min-w-0"
          >
            {/* mindmap 模式不产出整书导图（仅 combined-mindmap 模式产出）：有数据才显示该页签 */}
            <TabsList className={cn('grid w-full h-auto', bookMindMap.combinedMindMap ? 'grid-cols-2' : 'grid-cols-1')}>
              <TabsTrigger value="chapters" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                {t('results.tabs.chapterMindMaps')}
              </TabsTrigger>
              {bookMindMap.combinedMindMap && (
                <TabsTrigger value="combined" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                  {t('results.tabs.combinedMindMap')}
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="chapters" className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {bookMindMap.chapters.map((chapter, index) =>
                chapter.mindMap && (
                  <MindMapCard
                    key={chapter.id}
                    id={chapter.id}
                    title={chapter.title}
                    content={chapter.content}
                    mindMapData={chapter.mindMap}
                    index={index}
                    showCopyButton={false}
                    onClearCache={onClearChapterCache}
                    onDownloadMindMap={onDownloadMindMap}
                    showOpenInMindElixir={false}
                    mindElixirOptions={mindElixirOptions}
                  />
                )
              )}
            </TabsContent>

            {bookMindMap.combinedMindMap && (
              <TabsContent value="combined">
                <MindMapCard
                  id="combined"
                  title={t('results.tabs.combinedMindMap')}
                  content=""
                  mindMapData={bookMindMap.combinedMindMap}
                  index={0}
                  onDownloadMindMap={onDownloadMindMap}
                  onClearCache={() => onClearSpecificCache('merged_mindmap')}
                  showClearCache={true}
                  showViewContent={false}
                  showCopyButton={false}
                  showOpenInMindElixir={false}
                  mindMapClassName="w-full h-[min(60vh,600px)] min-h-[240px] mx-auto"
                  mindElixirOptions={mindElixirOptions}
                />
              </TabsContent>
            )}
          </Tabs>
        ) : processingMode === 'combined-mindmap' && bookMindMap ? (
          bookMindMap.combinedMindMap ? (
            <MindMapCard
              id="whole-book"
              title={t('results.tabs.combinedMindMap')}
              content=""
              mindMapData={bookMindMap.combinedMindMap}
              index={0}
              onDownloadMindMap={onDownloadMindMap}
              onClearCache={() => onClearSpecificCache('combined_mindmap')}
              showClearCache={true}
              showViewContent={false}
              showCopyButton={false}
              showOpenInMindElixir={false}
              mindMapClassName="w-full h-[min(60vh,600px)] min-h-[240px] mx-auto"
              mindElixirOptions={mindElixirOptions}
            />
          ) : (
            <Card>
              <CardContent>
                <div className="text-center text-muted-foreground py-8">
                  {t('results.generatingMindMap')}
                </div>
              </CardContent>
            </Card>
          )
        ) : null}
      </CardContent>
    </Card>
  )
})
