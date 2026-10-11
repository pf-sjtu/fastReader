import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { List, Brain, Loader2, BookOpen, Filter, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { useConfigStore } from '@/stores/configStore'
import type { ChapterData } from '@/services/epubProcessor'
import { memo, useState, useMemo } from 'react'

interface ChapterSelectionSectionProps {
  extractedChapters: ChapterData[]
  bookData: { title: string; author: string } | null
  selectedChapters: Set<string>
  customPrompt: string
  processing: boolean
  extractingChapters: boolean
  onChapterSelect: (chapterId: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  /** 一次性设置选中集合（筛选/范围模式用，避免 1 次清空 + N 次单选） */
  onSetSelection: (chapterIds: string[]) => void
  onCustomPromptChange: (value: string) => void
  onViewChapterContent: (chapter: ChapterData) => void
  onStartProcessing: () => void
}

export const ChapterSelectionSection = memo(function ChapterSelectionSection({
  extractedChapters,
  bookData,
  selectedChapters,
  customPrompt,
  processing,
  extractingChapters,
  onChapterSelect,
  onSelectAll,
  onSetSelection,
  onCustomPromptChange,
  onViewChapterContent,
  onStartProcessing
}: ChapterSelectionSectionProps) {
  const { t } = useTranslation()
  const apiKey = useConfigStore(state => state.aiConfig.apiKey)

  // 全选模式：'all' = 全选所有, 'filter' = 按字符数筛选, 'range' = 定义首尾章节
  const [selectAllMode, setSelectAllMode] = useState<'all' | 'filter' | 'range'>('all')
  const [rawThreshold, setCharThreshold] = useState(0)
  const [startChapterId, setStartChapterId] = useState<string>('')
  const [endChapterId, setEndChapterId] = useState<string>('')

  // 计算每个章节的字符数
  const chapterCharCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    extractedChapters.forEach(chapter => {
      counts[chapter.id] = chapter.content?.length || 0
    })
    return counts
  }, [extractedChapters])

  // 计算字符数范围
  const { minChars, maxChars } = useMemo(() => {
    const counts = Object.values(chapterCharCounts)
    if (counts.length === 0) return { minChars: 0, maxChars: 0 }
    return {
      minChars: Math.min(...counts),
      maxChars: Math.max(...counts)
    }
  }, [chapterCharCounts])

  // 阈值不低于当前书的最小章节字符数（派生值，换书时无需 effect 同步）
  const charThreshold = minChars !== maxChars ? Math.max(rawThreshold, minChars) : rawThreshold

  // 格式化字符数为 k 单位（一位小数）
  const formatCharCount = (count: number): string => {
    const k = count / 1000
    return `${k.toFixed(1)}k`
  }

  // 处理全选模式变更
  const handleSelectAllModeChange = (mode: 'all' | 'filter' | 'range') => {
    setSelectAllMode(mode)

    if (mode === 'all') {
      // 全选所有章节
      onSelectAll(true)
    } else if (mode === 'filter') {
      // 按字符数筛选后全选
      applyThreshold(charThreshold)
    } else if (mode === 'range') {
      // 首尾章节模式：根据当前选择的首尾章节更新选中状态
      updateRangeSelection(startChapterId, endChapterId)
    }
  }

  // 选中字符数 >= 阈值的章节（一次性设置）
  const applyThreshold = (threshold: number) => {
    onSetSelection(
      extractedChapters
        .filter(chapter => (chapterCharCounts[chapter.id] || 0) >= threshold)
        .map(chapter => chapter.id)
    )
  }

  // 根据首尾章节ID更新选中状态
  const updateRangeSelection = (startId: string, endId: string) => {
    if (!startId || !endId) return

    const startIndex = extractedChapters.findIndex(ch => ch.id === startId)
    const endIndex = extractedChapters.findIndex(ch => ch.id === endId)

    if (startIndex === -1 || endIndex === -1) return

    const actualStart = Math.min(startIndex, endIndex)
    const actualEnd = Math.max(startIndex, endIndex)

    onSetSelection(extractedChapters.slice(actualStart, actualEnd + 1).map(ch => ch.id))
  }

  // 处理起始章节变更
  const handleStartChapterChange = (value: string) => {
    setStartChapterId(value)
    if (selectAllMode === 'range') {
      updateRangeSelection(value, endChapterId)
    }
  }

  // 处理结束章节变更
  const handleEndChapterChange = (value: string) => {
    setEndChapterId(value)
    if (selectAllMode === 'range') {
      updateRangeSelection(startChapterId, value)
    }
  }

  // 处理滑动条变更
  const handleThresholdChange = (value: number[]) => {
    setCharThreshold(value[0])
    // 如果当前是筛选模式，更新选中状态
    if (selectAllMode === 'filter') {
      applyThreshold(value[0])
    }
  }

  // 检查是否所有章节都被选中（用于判断全选状态）
  const allChaptersSelected = useMemo(() => {
    if (extractedChapters.length === 0) return false
    return extractedChapters.every(ch => selectedChapters.has(ch.id))
  }, [extractedChapters, selectedChapters])

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
          {bookData?.title} - {bookData?.author} | {t('chapters.totalChapters', { count: extractedChapters.length })} · {t('chapters.selectedChapters', { count: selectedChapters.size })}
        </CardDescription>
        <div className="flex flex-col gap-3 mt-2">
          {/* 全选模式单选组 */}
          {maxChars > 0 && (
            <RadioGroup
              value={selectAllMode}
              onValueChange={(value) => handleSelectAllModeChange(value as 'all' | 'filter' | 'range')}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" id="select-all" />
                  <Label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                    {t('chapters.selectModeAll')}
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <RadioGroupItem value="filter" id="char-filter" />
                  <Label htmlFor="char-filter" className="text-sm font-medium flex items-center gap-1 cursor-pointer">
                    <Filter className="h-3 w-3" />
                    {t('chapters.selectModeFilter')}
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <RadioGroupItem value="range" id="range-select" />
                  <Label htmlFor="range-select" className="text-sm font-medium cursor-pointer">
                    {t('chapters.selectModeRange')}
                  </Label>
                </div>
              </div>

              {/* 字符数滑动条 */}
              {selectAllMode === 'filter' && (
                <div className="flex items-center gap-3 px-1 mt-1">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatCharCount(minChars)}
                  </span>
                  <div className="flex-1 flex flex-col gap-1">
                    <Slider
                      value={[charThreshold]}
                      onValueChange={handleThresholdChange}
                      min={minChars}
                      max={maxChars}
                      step={Math.max(1, Math.floor((maxChars - minChars) / 100))}
                      className="flex-1"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{t('chapters.minChars')} <span className="font-medium text-primary">{formatCharCount(charThreshold)}</span></span>
                      <span>{formatCharCount(maxChars)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 首尾章节选择 */}
              {selectAllMode === 'range' && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-1 mt-1">
                  <div className="flex-1 min-w-0">
                    <Label className="text-xs text-muted-foreground mb-1 block">{t('chapters.startChapter')}</Label>
                    <Select value={startChapterId} onValueChange={handleStartChapterChange}>
                      <SelectTrigger className="w-full min-h-9">
                        <SelectValue placeholder={t('chapters.selectStartChapter')} />
                      </SelectTrigger>
                      <SelectContent>
                        {extractedChapters.map((chapter) => (
                          <SelectItem key={`start-${chapter.id}`} value={chapter.id}>
                            {chapter.title} ({formatCharCount(chapterCharCounts[chapter.id] || 0)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <ArrowRight className="h-4 w-4 text-muted-foreground hidden sm:block sm:mt-5 shrink-0" />

                  <div className="flex-1 min-w-0">
                    <Label className="text-xs text-muted-foreground mb-1 block">{t('chapters.endChapter')}</Label>
                    <Select value={endChapterId} onValueChange={handleEndChapterChange}>
                      <SelectTrigger className="w-full min-h-9">
                        <SelectValue placeholder={t('chapters.selectEndChapter')} />
                      </SelectTrigger>
                      <SelectContent>
                        {extractedChapters.map((chapter) => (
                          <SelectItem key={`end-${chapter.id}`} value={chapter.id}>
                            {chapter.title} ({formatCharCount(chapterCharCounts[chapter.id] || 0)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </RadioGroup>
          )}

          {/* 无字符数据时的简单全选 */}
          {maxChars === 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="select-all-simple"
                checked={allChaptersSelected}
                onCheckedChange={(checked) => onSelectAll(checked as boolean)}
              />
              <Label htmlFor="select-all-simple" className="text-sm font-medium">
                {t('chapters.selectAll')}
              </Label>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {extractedChapters.map((chapter) => {
            const charCount = chapterCharCounts[chapter.id] || 0

            return (
              <div
                key={chapter.id}
                className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
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
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatCharCount(charCount)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onViewChapterContent(chapter)}
                  aria-label={t('chapters.viewChapterContent', { title: chapter.title })}
                  title={t('chapters.viewChapterContent', { title: chapter.title })}
                >
                  <BookOpen className="h-3 w-3" />
                </Button>
              </div>
            )
          })}
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
})
