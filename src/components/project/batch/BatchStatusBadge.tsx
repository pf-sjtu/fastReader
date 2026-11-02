import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/ui/status-badge'
import type { BatchQueueItem } from '../../../stores/batchQueueStore'

/**
 * 批量队列项状态徽标：BatchProcessingDialog / BatchQueueTab / BatchQueuePanel 共用。
 *
 * 外观由 `ui/status-badge.tsx` 统一（语义 → 颜色只有一张表，见 utils/statusTone.ts），
 * 本组件只负责把状态名翻成文案。
 */
export function BatchStatusBadge({ status, className = '' }: { status: BatchQueueItem['status']; className?: string }) {
  const { t } = useTranslation()
  return (
    <StatusBadge status={status} className={className}>
      {t(`batch.status.${status}`)}
    </StatusBadge>
  )
}
