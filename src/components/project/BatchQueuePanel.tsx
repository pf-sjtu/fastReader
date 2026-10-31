import { useShallow } from 'zustand/react/shallow'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronDown, ChevronUp, Play, Pause, Square, Trash2, Loader2, CheckCircle, XCircle, DollarSign, FolderOpen, X } from 'lucide-react'
import { useBatchQueueStore, useBatchProcessingStatus, useBatchStats } from '../../stores/batchQueueStore'
import { runBatchQueue } from './batchQueueRunner'
import { BatchStatusBadge } from './batch/BatchStatusBadge'
import { useBatchQueueControls } from './batch/useBatchQueueControls'
import { toast } from 'sonner'

export function BatchQueuePanel() {
  const { t } = useTranslation()
  const { queue, removeFromQueue } = useBatchQueueStore(
    useShallow((s) => ({ queue: s.queue, removeFromQueue: s.removeFromQueue }))
  )
  const { isProcessing: isStoreProcessing, isPaused: isStorePaused, currentItem } = useBatchProcessingStatus()
  const stats = useBatchStats()
  const controls = useBatchQueueControls()
  const [isOpen, setIsOpen] = useState(false)

  const cachedFilesRef = useRef<Set<string> | null>(null)
  // 循环是否在跑：暂停后立即继续时，旧循环处理完当前项会自行接着跑，不能再开第二个循环并发处理
  const loopRunningRef = useRef(false)

  // 处理循环只随 isProcessing / isPaused 启停；完成项数变化不会重启循环
  useEffect(() => {
    if (!isStoreProcessing || isStorePaused || loopRunningRef.current) return
    loopRunningRef.current = true
    // 每次启动循环都重新确认云端缓存（队列也可能由 BatchProcessingDialog 启动）
    cachedFilesRef.current = null
    void runBatchQueue(cachedFilesRef).finally(() => {
      loopRunningRef.current = false
    })
  }, [isStoreProcessing, isStorePaused])

  // 无人值守：队列里还有待处理项、上一个执行者的租约已过期（关页/崩溃/断网 > 2 分钟）时，
  // 当前页面自动接管并继续跑。用户主动「暂停」的队列不会被接管。
  const hasPending = queue.some((i) => i.status === 'pending' || i.status === 'processing')
  useEffect(() => {
    if (!hasPending || isStoreProcessing || isStorePaused) return
    const check = () => {
      const s = useBatchQueueStore.getState()
      if (!s.runner || s.isPaused || s.isProcessing) return
      if (s.runner.clientId === s.clientId || !s.isRunnerStale()) return
      void controls.start().then((started) => {
        if (started) toast.info(t('batch.toast.takenOver'))
      })
    }
    check()
    const timer = window.setInterval(check, 30_000)
    return () => window.clearInterval(timer)
    // controls 每次渲染都是新对象，只在队列/状态变化时重新挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending, isStoreProcessing, isStorePaused, t])

  // Progress percentage
  const progressPercent = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0

  // No queue items - don't render
  if (queue.length === 0) {
    return null
  }

  return (

    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full text-left flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center gap-3">
            <FolderOpen className="h-4 w-4" />
            <span className="font-medium text-sm">{t('batch.panelTitle')}</span>
            <Badge variant="secondary">{queue.length}</Badge>
            <Badge variant="default" className="bg-success">
              {stats.completed}
            </Badge>
            {stats.failed > 0 && (
              <Badge variant="destructive">{stats.failed}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {progressPercent}%
            </span>
            {isOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </div>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2 space-y-3">
          {/* Progress bar */}
          <Progress value={progressPercent} className="h-1.5" />

          {/* Current item */}
          {currentItem && (
            <div className="p-2 bg-muted rounded-md">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="font-medium truncate flex-1">{currentItem.fileName}</span>
                <BatchStatusBadge status={currentItem.status} className="text-xs" />
              </div>
              {currentItem.progress > 0 && currentItem.progress < 100 && (
                <Progress value={currentItem.progress} className="h-1 mt-1" />
              )}
            </div>
          )}

          {/* Queue list (compact) */}
          <ScrollArea className="h-48">
            <div className="space-y-1">
              {queue.map((item, index) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs ${
                    item.status === 'processing'
                      ? 'bg-accent'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="w-5 text-muted-foreground">{index + 1}.</span>
                  <BatchStatusBadge status={item.status} className="text-xs" />
                  {item.status === 'completed' && item.metadata?.isPartial && (
                    <Badge variant="outline" className="text-xs">{t('batch.partial')}</Badge>
                  )}
                  <span className="truncate flex-1">{item.fileName}</span>
                  {item.status === 'completed' && (
                    <CheckCircle className="h-3.5 w-3.5 text-success" />
                  )}

                  {item.status === 'failed' && (
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                  )}
                  {item.error && (
                    <span className="text-destructive max-w-[100px] truncate">{item.error}</span>
                  )}
                  {item.status !== 'processing' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
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
          </ScrollArea>

          {/* Stats */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <div className="flex items-center gap-3">
              <span>{t('batch.statLine.completed', { count: stats.completed })}</span>
              <span>{t('batch.statLine.failed', { count: stats.failed })}</span>
              <span>{t('batch.statLine.skipped', { count: stats.skipped })}</span>
            </div>
            {stats.totalCostRMB > 0 && (
              <div className="flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" />
                <span>¥{(stats.totalCostRMB || 0).toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {isStoreProcessing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={controls.togglePause}
                >
                  {isStorePaused ? (
                    <>
                      <Play className="h-3.5 w-3.5 mr-1" />
                      {t('batch.resume')}
                    </>
                  ) : (
                    <>
                      <Pause className="h-3.5 w-3.5 mr-1" />
                      {t('batch.pause')}
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={controls.stop}
                >
                  <Square className="h-3.5 w-3.5 mr-1" />
                  {t('batch.stop')}
                </Button>
              </>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                onClick={() => void controls.start()}
              >
                <Play className="h-3.5 w-3.5 mr-1" />
                {t('batch.startProcessing')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={controls.clear}
              aria-label={t('batch.clearQueue')}
              title={t('batch.clearQueue')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export default BatchQueuePanel
