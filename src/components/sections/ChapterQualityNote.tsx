import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Hint } from '@/components/ui/hint'

/** 质量闸已定向重写过一次但仍有格式/长度问题：给读者一个低调的提示，别让人误以为是完美结果 */
export function ChapterQualityNote() {
  const { t } = useTranslation()
  return (
    <Hint
      tone="warning"
      role="note"
      className="flex items-center gap-1 text-xs"
      data-testid="chapter-quality-warn"
      title={t('results.qualityWarnHint')}
    >
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      {t('results.qualityWarn')}
    </Hint>
  )
}
