import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useStudyStore } from '@/study/studyStore'

/** 「章节总结完成后自动生成速读与全书自测」开关：速读 / 自测两个页签共用 */
export function AutoStudyToggle() {
  const { t } = useTranslation()
  const auto = useStudyStore((s) => s.auto)
  const setAuto = useStudyStore((s) => s.setAuto)
  return (
    <div className="flex items-center gap-2" title={t('study.auto.hint')}>
      <Switch id="study-auto" checked={auto} onCheckedChange={setAuto} />
      <Label htmlFor="study-auto" className="text-xs font-normal text-muted-foreground">
        {t('study.auto.label')}
      </Label>
    </div>
  )
}
