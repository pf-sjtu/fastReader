// 批量处理「队列」页：统计、进度、队列列表
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Trash2, Loader2, CheckCircle, XCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { useBatchQueueStore, useBatchProcessingStatus, useBatchStats } from '../../../stores/batchQueueStore'
import { BatchStatusBadge } from './BatchStatusBadge'

export function BatchQueueTab({ onClearQueue }: { onClearQueue: () => void }) {
  const { t } = useTranslation()
  const { queue, removeFromQueue } = useBatchQueueStore(useShallow((s) => ({ queue: s.queue, removeFromQueue: s.removeFromQueue })))
  const { isProcessing, isPaused, currentItem } = useBatchProcessingStatus()
  const stats = useBatchStats()
  const [expanded, setExpanded] = useState(true)

  const tiles = [
    { value: stats.total, label: t('batch.stats.total'), cls: '' },
    { value: stats.completed, label: t('batch.stats.completed'), cls: 'text-success' },
    { value: stats.failed, label: t('batch.stats.failed'), cls: 'text-destructive' },
    { value: stats.skipped, label: t('batch.stats.skipped'), cls: 'text-warning' },
    { value: `¥${(stats.totalCostRMB || 0).toFixed(2)}`, label: t('batch.stats.cost'), cls: 'text-primary' },
  ]

  return (
    <div className="h-full flex flex-col space-y-4 overflow-hidden">
      <div className="grid grid-cols-5 gap-2 p-3 bg-muted/50 rounded-lg flex-shrink-0">
        {tiles.map((tile) => (
          <div key={tile.label} className="text-center">
            <div className={`text-2xl font-bold ${tile.cls}`}>{tile.value}</div>
            <div className="text-xs text-muted-foreground">{tile.label}</div>
          </div>
        ))}
      </div>

      {isProcessing && (
        <div className="space-y-2 flex-shrink-0">
          <div className="flex items-center justify-between text-sm">
            <span>
              {isPaused ? t('batch.paused') : t('batch.status.processing')}
              {currentItem && ` - ${currentItem.fileName}`}
            </span>
            <span>
              {stats.completed}/{stats.total}
            </span>
          </div>
          <Progress value={(stats.completed / (stats.total || 1)) * 100} className="h-2" />
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden border rounded-lg">
        <div className="flex items-center justify-between p-2 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-label={expanded ? t('common.collapse') : t('common.expand')}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <span className="text-sm font-medium">{t('batch.queueTitle', { count: queue.length })}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClearQueue} disabled={queue.length === 0}>
            <Trash2 className="h-4 w-4 mr-1" />
            {t('batch.clear')}
          </Button>
        </div>
        {expanded && (
          <ScrollArea className="flex-1">
            {queue.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">{t('batch.queueEmpty')}</div>
            ) : (
              // 窄屏下行内容过宽时在此横向滚动
              <div className="overflow-x-auto">
                <div className="min-w-[18rem]">
                  {queue.map((item, index) => (
                    <div key={item.id} className={`flex items-center gap-2 px-3 py-2 border-b ${item.status === 'processing' ? 'bg-accent' : ''}`}>
                      <span className="w-6 text-xs text-muted-foreground">{index + 1}.</span>
                      <BatchStatusBadge status={item.status} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.fileName}</div>
                        {item.error && <div className="text-xs text-destructive truncate">{item.error}</div>}
                        {item.metadata && (
                          <div className="text-xs text-muted-foreground">
                            {t('batch.chapterCount', { count: item.metadata.chapterCount })}
                            {item.metadata.costRMB ? ` • ¥${item.metadata.costRMB.toFixed(2)}` : ''}
                          </div>
                        )}
                      </div>
                      {item.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                      {item.status === 'completed' && <CheckCircle className="h-4 w-4 text-success" />}
                      {item.status === 'failed' && <XCircle className="h-4 w-4 text-destructive" />}
                      {item.status !== 'processing' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => removeFromQueue(item.id)}
                          aria-label={t('batch.removeItemNamed', { name: item.fileName })}
                          title={t('batch.removeItem')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
