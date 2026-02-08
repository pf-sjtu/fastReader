import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { List, Brain, Loader2, BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { useConfigStore } from '@/stores/configStore'
import type { ChapterData } from '@/services/epubProcessor'

interface ChapterSelectionSectionProps {
  extractedChapters: ChapterData[]
  bookData: { title: string; author: string } | null
  selectedChapters: Set<string>
  customPrompt: string
  processing: boolean
  extractingChapters: boolean
  onChapterSelect: (chapterId: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  onCustomPromptChange: (value: string) => void
  onViewChapterContent: (chapter: ChapterData) => void
  onStartProcessing: () => void
}

export function ChapterSelectionSection({
  extractedChapters,
  bookData,
  selectedChapters,
  customPrompt,
  processing,
  extractingChapters,
  onChapterSelect,
  onSelectAll,
  onCustomPromptChange,
  onViewChapterContent,
  onStartProcessing
}: ChapterSelectionSectionProps) {
  const { t } = useTranslation()
  const { apiKey } = useConfigStore(state => state.aiConfig)

  const handleStartProcessing = () => {
    if (!apiKey) {
      toast.error(t('chapters.apiKeyRequired'), {
        duration: 3000,
        position: 'top-center',
      })
      return
    }
    onStartProcessing()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <List className="h-5 w-5" />
          {t('chapters.title')}
        </CardTitle>
        <CardDescription>
          {bookData?.title} - {bookData?.author} | {t('chapters.totalChapters', { count: extractedChapters.length })}，{t('chapters.selectedChapters', { count: selectedChapters.size })}
        </CardDescription>
        <div className="flex items-center gap-2 mt-2">
          <Checkbox
            id="select-all"
            checked={selectedChapters.size === extractedChapters.length && extractedChapters.length > 0}
            onCheckedChange={(checked) => onSelectAll(checked as boolean)}
          />
          <Label htmlFor="select-all" className="text-sm font-medium">
            {t('chapters.selectAll')}
          </Label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {extractedChapters.map((chapter) => (
            <div key={chapter.id} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <Checkbox
                id={`chapter-${chapter.id}`}
                checked={selectedChapters.has(chapter.id)}
                onCheckedChange={(checked) => onChapterSelect(chapter.id, checked as boolean)}
              />
              <Label
                htmlFor={`chapter-${chapter.id}`}
                className="text-sm truncate cursor-pointer flex-1"
                title={chapter.title}
              >
                {chapter.title}
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onViewChapterContent(chapter)}
              >
                <BookOpen className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        {/* 自定义提示词输入框 */}
        <div className="space-y-2">
          <Label htmlFor="custom-prompt" className="text-sm font-medium">
            {t('chapters.customPrompt')}
          </Label>
          <Textarea
            id="custom-prompt"
            placeholder={t('chapters.customPromptPlaceholder')}
            value={customPrompt}
            onChange={(e) => onCustomPromptChange(e.target.value)}
            className="min-h-20 resize-none"
            disabled={processing || extractingChapters}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('chapters.customPromptDescription')}
          </p>
        </div>

        <Button
          onClick={handleStartProcessing}
          disabled={extractedChapters.length === 0 || processing || extractingChapters || selectedChapters.size === 0}
          className="w-full"
        >
          {processing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('chapters.processing')}
            </>
          ) : (
            <>
              <Brain className="mr-2 h-4 w-4" />
              {t('progress.startProcessing')}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
