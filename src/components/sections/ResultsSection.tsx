import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, BookOpen, Network } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FontSizeControl } from '@/components/FontSizeControl'
import { MarkdownCard, type RemarkPlugins } from '@/components/MarkdownCard'
import { MindMapCard } from '@/components/MindMapCard'
import { UploadToWebDAVButton } from '@/components/UploadToWebDAVButton'
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
    renderStrip?: (chapterId: string) => React.ReactNode
  }
}

export const ResultsSection = memo(function ResultsSection({
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
      <CardHeader className="overflow-hidden px-2 sm:px-4">
        <CardTitle className="min-w-0">
          <div className="truncate text-[15px] sm:text-base font-brand font-semibold">
            {processingMode === 'summary' ? (
              <><BookOpen className="h-5 w-5 inline-block mr-2" />{t('results.summaryTitle', { title: bookSummary?.title })}</>
            ) : processingMode === 'mindmap' ? (
              <><Network className="h-5 w-5 inline-block mr-2" />{t('results.chapterMindMapTitle', { title: bookMindMap?.title })}</>
            ) : (
              <><Network className="h-5 w-5 inline-block mr-2" />{t('results.wholeMindMapTitle', { title: bookMindMap?.title })}</>
            )}
          </div>
        </CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between -mt-1 min-w-0">
          <CardDescription className="truncate min-w-0">
            {t('results.author', { author: bookSummary?.author || bookMindMap?.author })} | {t('results.chapterCount', { count: bookSummary?.chapters.length || bookMindMap?.chapters.length || totalChapters })}
          </CardDescription>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <FontSizeControl variant="compact" showLabel={false} />
            {processingMode === 'summary' && bookSummary && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDownloadAllMarkdown}
                  className="flex items-center gap-1.5 h-8 min-h-8 text-xs"
                  title={t('download.downloadAllMarkdown')}
                >
                  <Download className="h-3.5 w-3.5" />
                  MD
                </Button>
                <UploadToWebDAVButton
                  bookSummary={bookSummary}
                  file={file}
                  chapterNamingMode="numbered"
                />
              </>
            )}
          </div>
        </div>
      </CardHeader>
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
                  headerExtra={chapterExtras?.renderStrip?.(chapter.id)}
                />
              ))}
            </TabsContent>

            <TabsContent value="connections">
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
