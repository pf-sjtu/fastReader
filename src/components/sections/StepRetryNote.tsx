import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { isUsableText } from '@/utils/resultStatus'
import type { BookStepKind } from '@/hooks/useBookSteps'

interface Props {
  kind: BookStepKind
  /** 该步当前的文本：可用则不显示 */
  text: string | undefined
  running: BookStepKind | null
  onRetry?: (kind: BookStepKind) => void
}

/** 关联分析 / 全书总结失败或被清除时：只重跑这一步，不重付章节的钱 */
export function StepRetryNote({ kind, text, running, onRetry }: Props) {
  const { t } = useTranslation()
  if (!onRetry || isUsableText(text)) return null
  const busy = running === kind
  return (
    <div role="status" className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted px-3 py-2" data-testid={`step-retry-${kind}`}>
      <span className="text-xs text-muted-foreground">{t(kind === 'connections' ? 'results.step.connectionsMissing' : 'results.step.overallMissing')}</span>
      <Button size="sm" variant="outline" disabled={!!running} onClick={() => onRetry(kind)}>
        <RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} />
        {t('results.step.retry')}
      </Button>
    </div>
  )
}
