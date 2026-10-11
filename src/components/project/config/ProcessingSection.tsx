// 输出语言 / 处理模式 / 书籍类型分区
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useConfigStore, useProcessingOptions } from '../../../stores/configStore'
import type { SupportedLanguage } from '../../../services/prompts/utils'

// 语言以其自称显示（autonym），不随界面语言翻译
const OUTPUT_LANGUAGES: { value: SupportedLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' },
]

export function ProcessingSection({ processing }: { processing: boolean }) {
  const { t } = useTranslation()
  const { outputLanguage, processingMode, bookType } = useProcessingOptions()
  const setOutputLanguage = useConfigStore((s) => s.setOutputLanguage)
  const setProcessingMode = useConfigStore((s) => s.setProcessingMode)
  const setBookType = useConfigStore((s) => s.setBookType)

  return (
    <>
      <div className="p-3 bg-muted rounded-lg border">
        <div className="space-y-2">
          <Label htmlFor="output-language" className="text-sm font-medium">
            {t('config.outputLanguage')}
          </Label>
          <Select value={outputLanguage} onValueChange={(v: SupportedLanguage) => setOutputLanguage(v)} disabled={processing}>
            <SelectTrigger id="output-language">
              <SelectValue placeholder={t('config.selectOutputLanguage')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('config.outputLanguageAuto')}</SelectItem>
              {OUTPUT_LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-600">{t('config.outputLanguageDescription')}</p>
        </div>
      </div>

      <div className="p-3 bg-purple-50 dark:bg-purple-950/50 rounded-lg border dark:border-purple-800">
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="processing-mode" className="text-sm font-medium">
              {t('config.processingMode')}
            </Label>
            <Select
              value={processingMode}
              onValueChange={(v: 'summary' | 'mindmap' | 'combined-mindmap') => setProcessingMode(v)}
              disabled={processing}
            >
              <SelectTrigger id="processing-mode">
                <SelectValue placeholder={t('config.selectProcessingMode')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="summary">{t('config.summaryMode')}</SelectItem>
                <SelectItem value="mindmap">{t('config.mindmapMode')}</SelectItem>
                <SelectItem value="combined-mindmap">{t('config.combinedMindmapMode')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-600">{t('config.processingModeDescription')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="book-type" className="text-sm font-medium">
              {t('config.bookType')}
            </Label>
            <Select value={bookType} onValueChange={(v: 'fiction' | 'non-fiction') => setBookType(v)} disabled={processing}>
              <SelectTrigger id="book-type">
                <SelectValue placeholder={t('config.selectBookType')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="non-fiction">{t('config.socialType')}</SelectItem>
                <SelectItem value="fiction">{t('config.novelType')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-600">
              {t('config.bookTypeDescription', {
                type: processingMode === 'summary' ? t('config.summary') : t('config.mindmap'),
              })}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
