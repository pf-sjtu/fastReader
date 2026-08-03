import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, BookOpen, Network } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FontSizeControl } from '@/components/FontSizeControl'
import { MarkdownCard } from '@/components/MarkdownCard'
import { MindMapCard } from '@/components/MindMapCard'
import { UploadToWebDAVButton } from '@/components/UploadToWebDAVButton'
import { ChartsPanel } from '@/charts'
import type { MindElixirData, Options } from 'mind-elixir'
import type { Chapter, BookSummary, BookMindMap, ProcessingMode } from '@/hooks/useBookProcessing'

const mindElixirOptions = { direction: 1, alignment: 'nodes' } as Options

interface ResultsSectionProps {
  processingMode: ProcessingMode
  bookSummary: BookSummary | null
  bookMindMap: BookMindMap | null
  file: File | null
  expandedChapters: Set<string>
  currentViewingChapterSummary: string
  onClearChapterCache: (chapterId: string) => void
  onClearSpecificCache: (cacheType: string) => void
  onChapterExpandChange: (chapterId: string, isExpanded: boolean) => void
  onReadChapter: (chapterId: string) => void
  onDownloadAllMarkdown: () => void
  onDownloadMindMap?: (mindMapData: MindElixirData, title?: string) => void
  onRegenerateKeyCharts?: () => void | Promise<void>
  chartsGenerating?: boolean
}

export function ResultsSection({
  processingMode,
  bookSummary,
  bookMindMap,
  file,
  expandedChapters,
  currentViewingChapterSummary,
  onClearChapterCache,
  onClearSpecificCache,
  onChapterExpandChange,
  onReadChapter,
  onDownloadAllMarkdown,
  onDownloadMindMap,
  onRegenerateKeyCharts,
  chartsGenerating = false,
}: ResultsSectionProps) {
  const { t } = useTranslation()
  // 受控 Tab，避免切换时整树 default 重置
  const [summaryTab, setSummaryTab] = useState('chapters')

  if (!bookSummary && !bookMindMap) {
    return null
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="overflow-hidden">
        <CardTitle className="min-w-0">
          <div className="truncate text-base sm:text-lg">
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
            {t('results.author', { author: bookSummary?.author || bookMindMap?.author })} | {t('results.chapterCount', { count: bookSummary?.chapters.length || bookMindMap?.chapters.length })}
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
      <CardContent className="min-w-0">
        {processingMode === 'summary' && bookSummary ? (
          <Tabs
            value={summaryTab}
            onValueChange={setSummaryTab}
            className="w-full min-w-0"
          >
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto">
              <TabsTrigger value="chapters" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                {t('results.tabs.chapterSummary')}
              </TabsTrigger>
              <TabsTrigger value="connections" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                {t('results.tabs.connections')}
              </TabsTrigger>
              <TabsTrigger value="overall" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                {t('results.tabs.overallSummary')}
              </TabsTrigger>
              <TabsTrigger value="charts" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                {t('results.tabs.keyCharts', '关键图表')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chapters" className="grid grid-cols-1 gap-4">
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
                  onExpandChange={(isExpanded) => onChapterExpandChange(chapter.id, isExpanded)}
                  onClearCache={() => onClearChapterCache(chapter.id)}
                  onReadChapter={() => onReadChapter(chapter.id)}
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
                showClearCache={true}
                showViewContent={false}
                showCopyButton={true}
                onClearCache={() => onClearSpecificCache('connections')}
              />
            </TabsContent>

            <TabsContent value="overall">
              <MarkdownCard
                id="overall"
                title={t('results.tabs.overallSummary')}
                content={bookSummary.overallSummary}
                markdownContent={bookSummary.overallSummary}
                index={0}
                showClearCache={true}
                showViewContent={false}
                showCopyButton={true}
                onClearCache={() => onClearSpecificCache('overall_summary')}
              />
            </TabsContent>

            {/* forceMount：切走 Tab 不销毁关系图/cytoscape，避免布局抖动 */}
            <TabsContent
              value="charts"
              forceMount
              className={cn(
                'min-w-0 mt-2',
                summaryTab !== 'charts' && 'hidden'
              )}
            >
              <ChartsPanel
                charts={bookSummary.charts}
                chartsError={bookSummary.chartsError}
                generating={chartsGenerating}
                onClearCache={() => onClearSpecificCache('key_charts')}
                onRegenerate={onRegenerateKeyCharts}
                canRegenerate={
                  !!bookSummary.overallSummary &&
                  !bookSummary.overallSummary.startsWith('【全书总结失败】') &&
                  bookSummary.chapters.length > 0
                }
              />
            </TabsContent>
          </Tabs>
        ) : processingMode === 'mindmap' && bookMindMap ? (
          <Tabs defaultValue="chapters" className="w-full min-w-0">
            <TabsList className="grid w-full grid-cols-2 h-auto">
              <TabsTrigger value="chapters" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                {t('results.tabs.chapterMindMaps')}
              </TabsTrigger>
              <TabsTrigger value="combined" className="text-xs sm:text-sm px-1 sm:px-3 py-2">
                {t('results.tabs.combinedMindMap')}
              </TabsTrigger>
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
                    onClearCache={() => onClearChapterCache(chapter.id)}
                    onDownloadMindMap={onDownloadMindMap}
                    showOpenInMindElixir={false}
                    mindElixirOptions={mindElixirOptions}
                  />
                )
              )}
            </TabsContent>

            <TabsContent value="combined">
              {bookMindMap.combinedMindMap ? (
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
              ) : (
                <Card>
                  <CardContent>
                    <div className="text-center text-gray-500 py-8">
                      {t('results.generatingMindMap')}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
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
                <div className="text-center text-gray-500 py-8">
                  {t('results.generatingMindMap')}
                </div>
              </CardContent>
            </Card>
          )
        ) : null}
      </CardContent>
    </Card>
  )
}
