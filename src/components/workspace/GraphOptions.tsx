import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useReadingFocusStore } from '@/stores/readingFocus'

/** 图谱页签顶部的两个联动开关：与正文同色 / 截至本章（渐进，防剧透） */
export function GraphOptions() {
  const { t } = useTranslation()
  const id = useId()
  const colorize = useReadingFocusStore((s) => s.colorizeGraph)
  const progressive = useReadingFocusStore((s) => s.progressiveGraph)
  const setColorize = useReadingFocusStore((s) => s.setColorizeGraph)
  const setProgressive = useReadingFocusStore((s) => s.setProgressiveGraph)

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="flex items-center gap-1.5">
        <Checkbox id={`${id}-colorize`} checked={colorize} onCheckedChange={(v) => setColorize(v === true)} />
        <Label htmlFor={`${id}-colorize`} className="min-h-6 cursor-pointer text-xs">
          {t('graphToolbar.colorize')}
        </Label>
      </div>
      <div className="flex items-center gap-1.5">
        <Checkbox id={`${id}-progressive`} checked={progressive} onCheckedChange={(v) => setProgressive(v === true)} />
        <Label htmlFor={`${id}-progressive`} className="min-h-6 cursor-pointer text-xs">
          {t('graphToolbar.progressive')}
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('graphToolbar.progressiveNote')}
              className="rounded text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            {t('graphToolbar.progressiveNote')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
