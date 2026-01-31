import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Loader2, BookOpen, Network } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkdownCard } from '@/components/MarkdownCard'
import { MindMapCard } from '@/components/MindMapCard'
import { UploadToWebDAVButton } from '@/components/UploadToWebDAVButton'
import type { MindElixirData } from 'mind-elixir'

interface Chapter {
  id: string
  title: string
  content: string
  summary?: string
  mindMap?: MindElixirData
  processed: boolean
}

interface BookSummary {
  title: string
  author: string
  chapters: Chapter[]
  connections: string
  overallSummary: string
}

interface BookMindMap {
  title: string
  author: string
  chapters: Chapter[]
  combinedMindMap?: MindElixirData | null
}

interface ProcessingSectionProps {
  processing: boolean
  progress: number
  currentStep: string
  processingMode: 'summary' | 'mindmap' | 'combined-mindmap'
  bookSummary: BookSummary | null
  bookMindMap: BookMindMap | null
  onClearCache: (chapterId: string) => void
  onReadChapter: (chapter: Chapter) => void
}

export function ProcessingSection({
  processing,
  progress,
  currentStep,
  processingMode,
  bookSummary,
  bookMindMap,
  onClearCache,
  onReadChapter
}: ProcessingSectionProps) {
  const { t } = useTranslation()

  if (processing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('progress.processing')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span>{currentStep}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!bookSummary && !bookMindMap) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {processingMode === 'summary' ? (
              <>
                <BookOpen className="h-5 w-5" />
                {t('results.summaryTitle', { title: bookSummary?.title })}
              </>
            ) : (
              <>
                <Network className="h-5 w-5" />
                {t('results.chapterMindMapTitle', { title: bookMindMap?.title })}
              </>
            )}
          </div>
          {processingMode === 'summary' && bookSummary && (
            <UploadToWebDAVButton bookSummary={bookSummary} />
          )}
        </CardTitle>
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
                  onClearCache={onClearCache}
                  onReadChapter={() => onReadChapter(chapter)}
                />
              ))}
            </TabsContent>
            <TabsContent value="connections">
              <MarkdownCard
                id="connections"
                title={t('results.tabs.connections')}
                content=""
                markdownContent={bookSummary.connections}
                index={0}
                showClearCache={false}
                showReadButton={false}
              />
            </TabsContent>
            <TabsContent value="overall">
              <MarkdownCard
                id="overall"
                title={t('results.tabs.overallSummary')}
                content=""
                markdownContent={bookSummary.overallSummary}
                index={0}
                showClearCache={false}
                showReadButton={false}
              />
            </TabsContent>
          </Tabs>
        ) : bookMindMap ? (
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
                    onClearCache={onClearCache}
                  />
                )
              )}
            </TabsContent>
            <TabsContent value="combined">
              {bookMindMap.combinedMindMap ? (
                <MindMapCard
                  id="combined"
                  title={t('results.combinedMindMapTitle', { title: bookMindMap.title })}
                  content=""
                  mindMapData={bookMindMap.combinedMindMap}
                  index={0}
                  showClearCache={false}
                  showViewContent={false}
                />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t('results.noCombinedMindMap')}
                </div>
              )}
            </TabsContent>
          </Tabs>
        ) : null}
      </CardContent>
    </Card>
  )
}
