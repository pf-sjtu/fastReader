import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, BookOpen, Network } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FontSizeControl } from '@/components/FontSizeControl'
import { MarkdownCard } from '@/components/MarkdownCard'
import { MindMapCard } from '@/components/MindMapCard'
import { UploadToWebDAVButton } from '@/components/UploadToWebDAVButton'
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
  onOpenInMindElixir?: (mindMapData: MindElixirData, title?: string) => void
  onDownloadMindMap?: (mindMapData: MindElixirData, title?: string) => void
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
  onOpenInMindElixir,
  onDownloadMindMap
}: ResultsSectionProps) {
  const { t } = useTranslation()

  if (!bookSummary && !bookMindMap) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="truncate flex-1 w-1">
            {processingMode === 'summary' ? (
              <><BookOpen className="h-5 w-5 inline-block mr-2" />{t('results.summaryTitle', { title: bookSummary?.title })}</>
            ) : processingMode === 'mindmap' ? (
              <><Network className="h-5 w-5 inline-block mr-2" />{t('results.chapterMindMapTitle', { title: bookMindMap?.title })}</>
            ) : (
              <><Network className="h-5 w-5 inline-block mr-2" />{t('results.wholeMindMapTitle', { title: bookMindMap?.title })}</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <FontSizeControl variant="compact" showLabel={false} />
            {processingMode === 'summary' && bookSummary && (
              <Button
                variant="outline"
                size="sm"
                onClick={onDownloadAllMarkdown}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                {t('download.downloadAllMarkdown')}
              </Button>
            )}
            {processingMode === 'summary' && bookSummary && (
              <UploadToWebDAVButton
                bookSummary={bookSummary}
                file={file}
                chapterNamingMode="numbered"
              />
            )}
          </div>
        </CardTitle>
        <CardDescription>
          {t('results.author', { author: bookSummary?.author || bookMindMap?.author })} | {t('results.chapterCount', { count: bookSummary?.chapters.length || bookMindMap?.chapters.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {processingMode === 'summary' && bookSummary ? (
          <Tabs defaultValue="chapters" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="chapters">{t('results.tabs.chapterSummary')}</TabsTrigger>
              <TabsTrigger value="connections">{t('results.tabs.connections')}</TabsTrigger>
              <TabsTrigger value="overall">{t('results.tabs.overallSummary')}</TabsTrigger>
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
          </Tabs>
        ) : processingMode === 'mindmap' && bookMindMap ? (
          <Tabs defaultValue="chapters" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="chapters">{t('results.tabs.chapterMindMaps')}</TabsTrigger>
              <TabsTrigger value="combined">{t('results.tabs.combinedMindMap')}</TabsTrigger>
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
                    onOpenInMindElixir={onOpenInMindElixir}
                    onDownloadMindMap={onDownloadMindMap}
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
                  onOpenInMindElixir={(mindmapData) => onOpenInMindElixir?.(mindmapData, t('results.combinedMindMapTitle', { title: bookMindMap.title }))}
                  onDownloadMindMap={onDownloadMindMap}
                  onClearCache={() => onClearSpecificCache('merged_mindmap')}
                  showClearCache={true}
                  showViewContent={false}
                  showCopyButton={false}
                  mindMapClassName="w-full h-[600px] mx-auto"
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
              onOpenInMindElixir={(mindmapData) => onOpenInMindElixir?.(mindmapData, t('results.combinedMindMapTitle', { title: bookMindMap.title }))}
              onDownloadMindMap={onDownloadMindMap}
              onClearCache={() => onClearSpecificCache('combined_mindmap')}
              showClearCache={true}
              showViewContent={false}
              showCopyButton={false}
              mindMapClassName="w-full h-[600px] mx-auto"
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
