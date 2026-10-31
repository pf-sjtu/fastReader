import { useTranslation } from 'react-i18next'
import { formatCount } from '@/services/runEstimate'

/** 生成前的用量提示。价格未知（costRMB=null）时只给 token，不估金额 */
export function RunEstimateLine({ tokens, costRMB }: { tokens: number; costRMB: number | null }) {
  const { t } = useTranslation()
  if (tokens <= 0) return null
  return (
    <p className="text-xs text-muted-foreground" data-testid="study-estimate">
      {costRMB !== null
        ? t('study.estimate.withCost', { tokens: formatCount(tokens), cost: costRMB < 0.01 ? '<0.01' : costRMB.toFixed(2) })
        : t('study.estimate.noPrice', { tokens: formatCount(tokens) })}
    </p>
  )
}
