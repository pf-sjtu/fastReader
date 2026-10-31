import { useTranslation } from 'react-i18next'
import { ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface NavRailProps {
  /** 当前阅读章序号（1 起；0 = 尚未定位） */
  current: number
  total: number
  onExpand: () => void
}

/** 目录折叠后的竖向进度条：一眼看到读到哪，点按钮展开目录 */
export function NavRail({ current, total, onExpand }: NavRailProps) {
  const { t } = useTranslation()
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0
  return (
    <div className="flex h-full w-6 flex-col items-center gap-2 py-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        onClick={onExpand}
        aria-label={t('workspace.nav.expand')}
        title={t('workspace.nav.expand')}
      >
        <ChevronsRight className="size-4" />
      </Button>
      <div
        role="progressbar"
        aria-label={t('workspace.nav.progress')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current}
        className="relative w-1.5 min-h-8 flex-1 overflow-hidden rounded-full bg-border"
      >
        <div className="absolute inset-x-0 top-0 rounded-full bg-primary transition-[height]" style={{ height: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground [writing-mode:vertical-rl]">
        {current}/{total}
      </span>
    </div>
  )
}
