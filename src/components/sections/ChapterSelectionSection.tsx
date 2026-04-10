import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { List, Brain, Loader2, BookOpen, Filter } from 'lucide-react'
import { toast } from 'sonner'
import { useConfigStore } from '@/stores/configStore'
import type { ChapterData } from '@/services/epubProcessor'
import { useState, useMemo, useEffect } from 'react'

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

  // 全选模式：'all' = 全选所有, 'filter' = 按字符数筛选
  const [selectAllMode, setSelectAllMode] = useState<'all' | 'filter'>('all')
  const [charThreshold, setCharThreshold] = useState<number[]>([0])

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

  // 初始化滑块值
  useEffect(() => {
    if (minChars !== maxChars && charThreshold[0] < minChars) {
      setCharThreshold([minChars])
    }
  }, [minChars, maxChars])

  // 格式化字符数为 k 单位（一位小数）
  const formatCharCount = (count: number): string => {
    const k = count / 1000
    return `${k.toFixed(1)}k`
  }

  // 处理全选模式变更
  const handleSelectAllModeChange = (mode: 'all' | 'filter') => {
    setSelectAllMode(mode)

    if (mode === 'all') {
      // 全选所有章节
      onSelectAll(true)
    } else {
      // 按字符数筛选后全选
      const threshold = charThreshold[0]
      // 先取消全选
      onSelectAll(false)
      // 然后选择满足条件的章节
      extractedChapters.forEach(chapter => {
        const count = chapterCharCounts[chapter.id] || 0
        if (count >= threshold) {
          onChapterSelect(chapter.id, true)
        }
      })
    }
  }

  // 处理滑动条变更
  const handleThresholdChange = (value: number[]) => {
    setCharThreshold(value)
    // 如果当前是筛选模式，更新选中状态
    if (selectAllMode === 'filter') {
      const threshold = value[0]
      onSelectAll(false)
      extractedChapters.forEach(chapter => {
        const count = chapterCharCounts[chapter.id] || 0
        if (count >= threshold) {
          onChapterSelect(chapter.id, true)
        }
      })
    }
  }

  // 检查是否所有章节都被选中（用于判断全选状态）
  const allChaptersSelected = useMemo(() => {
    if (extractedChapters.length === 0) return false
    return extractedChapters.every(ch => selectedChapters.has(ch.id))
  }, [extractedChapters, selectedChapters])

  // 检查是否满足筛选条件的章节都被选中
  const filteredChaptersSelected = useMemo(() => {
    if (extractedChapters.length === 0) return false
    const filteredChapters = extractedChapters.filter(ch => (chapterCharCounts[ch.id] || 0) >= charThreshold[0])
    if (filteredChapters.length === 0) return false
    return filteredChapters.every(ch => selectedChapters.has(ch.id))
  }, [extractedChapters, selectedChapters, charThreshold, chapterCharCounts])

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
        <div className="flex flex-col gap-3 mt-2">
          {/* 全选模式单选组 */}
          {maxChars > 0 && (
            <RadioGroup
              value={selectAllMode}
              onValueChange={(value) => handleSelectAllModeChange(value as 'all' | 'filter')}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" id="select-all" />
                  <Label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                    全选所有章节
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <RadioGroupItem value="filter" id="char-filter" />
                  <Label htmlFor="char-filter" className="text-sm font-medium flex items-center gap-1 cursor-pointer">
                    <Filter className="h-3 w-3" />
                    按照字符数筛选
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
                      value={charThreshold}
                      onValueChange={handleThresholdChange}
                      min={minChars}
                      max={maxChars}
                      step={Math.max(1, Math.floor((maxChars - minChars) / 100))}
                      className="flex-1"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>最小字符数: <span className="font-medium text-primary">{formatCharCount(charThreshold[0])}</span></span>
                      <span>{formatCharCount(maxChars)}</span>
                    </div>
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
}
