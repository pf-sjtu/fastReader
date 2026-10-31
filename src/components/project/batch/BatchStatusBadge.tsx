// 批量队列项状态徽标：BatchProcessingDialog 与 BatchQueuePanel 共用
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { BatchQueueItem } from '../../../stores/batchQueueStore'

const VARIANTS: Record<BatchQueueItem['status'], { variant: 'default' | 'secondary' | 'destructive' | 'outline'; cls?: string }> = {
  pending: { variant: 'secondary' },
  processing: { variant: 'default', cls: 'bg-primary' },
  completed: { variant: 'default', cls: 'bg-success' },
  failed: { variant: 'destructive' },
  skipped: { variant: 'outline' },
}

export function BatchStatusBadge({ status, className = '' }: { status: BatchQueueItem['status']; className?: string }) {
  const { t } = useTranslation()
  const v = VARIANTS[status]
  if (!v) return null
  return (
    <Badge variant={v.variant} className={`${v.cls ?? ''} ${className}`.trim()}>
      {t(`batch.status.${status}`)}
    </Badge>
  )
}
