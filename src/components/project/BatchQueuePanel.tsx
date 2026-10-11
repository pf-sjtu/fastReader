import { useShallow } from 'zustand/react/shallow'
import { useState, useEffect, useRef } from 'react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  Square,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
  DollarSign,
  FolderOpen,
  X
} from 'lucide-react'

import { useBatchQueueStore, useBatchProcessingStatus, useBatchStats, type BatchQueueItem } from '../../stores/batchQueueStore'
import { batchProcessingEngine, assertBatchModeSupported } from '../../services/batchProcessingEngine'
import { cloudCacheService } from '../../services/cloudCacheService'

import { useConfigStore } from '../../stores/configStore'
import { runBatchQueue } from './batchQueueRunner'
import { toast } from 'sonner'

export function BatchQueuePanel() {
  // Store
  const { queue, clearQueue, startProcessing: startStoreProcessing, pauseProcessing: pauseStoreProcessing, resumeProcessing: resumeStoreProcessing, stopProcessing: stopStoreProcessing, removeFromQueue } = useBatchQueueStore(
    useShallow((s) => ({
      queue: s.queue,
      clearQueue: s.clearQueue,
      startProcessing: s.startProcessing,
      pauseProcessing: s.pauseProcessing,
      resumeProcessing: s.resumeProcessing,
      stopProcessing: s.stopProcessing,
      removeFromQueue: s.removeFromQueue,
    }))
  )

  const { isProcessing: isStoreProcessing, isPaused: isStorePaused, currentItem } = useBatchProcessingStatus()
  const stats = useBatchStats()

  // UI state
  const [isOpen, setIsOpen] = useState(false)

  const cachedFilesRef = useRef<Set<string> | null>(null)
  // 循环是否在跑：暂停后立即继续时，旧循环处理完当前项会自行接着跑，不能再开第二个循环并发处理
  const loopRunningRef = useRef(false)

  // Handle pause/resume
  const handleTogglePause = () => {
    if (isStorePaused) {
      resumeStoreProcessing()
      batchProcessingEngine.resume()
      toast('已继续处理', {
        description: '批量处理已继续'
      })
    } else {
      pauseStoreProcessing()
      batchProcessingEngine.pause()
      toast('已暂停处理', {
        description: '批量处理已暂停'
      })
    }
  }

  // Handle stop
  const handleStop = () => {
    batchProcessingEngine.stop()
    stopStoreProcessing()
    toast('已停止处理', {
      description: '批量处理已停止'
    })
  }

  // Handle clear
  const handleClear = () => {
    batchProcessingEngine.stop()
    stopStoreProcessing()
    clearQueue()
    toast('已清空队列', {
      description: '批量处理队列已清空'
    })
  }

  const handleRemoveItem = (item: BatchQueueItem) => {
    if (item.status === 'processing') {
      return
    }

    removeFromQueue(item.id)
  }


  // Handle start processing
  const handleStartProcessing = async () => {
    const pendingCount = queue.filter((i) => i.status === 'pending').length

    if (pendingCount === 0) {
      toast.info('没有待处理的文件')
      return
    }

    try {
      assertBatchModeSupported(useConfigStore.getState().processingOptions.processingMode)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return
    }

    // 先确认云端缓存状态再开始：列目录失败不能当成「没有缓存」而重跑覆盖
    const status = await cloudCacheService.fetchCacheFileNamesStatus()
    if (status.status === 'unknown') {
      toast.error('无法确认云端缓存状态，未开始批量处理', { description: status.error })
      return
    }

    batchProcessingEngine.resetStopFlag()
    startStoreProcessing()
    toast('开始处理', {
      description: `共 ${pendingCount} 个文件待处理`
    })
  }

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

  // Get status badge
  const getStatusBadge = (status: BatchQueueItem['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary" className="text-xs">等待</Badge>
      case 'processing':
        return <Badge variant="default" className="bg-primary text-xs">处理中</Badge>
      case 'completed':
        return <Badge variant="default" className="bg-green-500 text-xs">完成</Badge>
      case 'failed':
        return <Badge variant="destructive" className="text-xs">失败</Badge>
      case 'skipped':
        return <Badge variant="outline" className="text-xs">跳过</Badge>
    }
  }

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
            <span className="font-medium text-sm">批量处理队列</span>
            <Badge variant="secondary">{queue.length}</Badge>
            <Badge variant="default" className="bg-green-500">
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
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                <span className="font-medium truncate flex-1">{currentItem.fileName}</span>
                {getStatusBadge(currentItem.status)}
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
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                    item.status === 'processing'
                      ? 'bg-accent'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="w-5 text-muted-foreground">{index + 1}.</span>
                  {getStatusBadge(item.status)}
                  {item.status === 'completed' && item.metadata?.isPartial && (
                    <Badge variant="outline" className="text-xs">不完整</Badge>
                  )}
                  <span className="truncate flex-1">{item.fileName}</span>
                  {item.status === 'completed' && (
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  )}

                  {item.status === 'failed' && (
                    <XCircle className="h-3 w-3 text-red-500" />
                  )}
                  {item.error && (
                    <span className="text-red-500 max-w-[100px] truncate">{item.error}</span>
                  )}
                  {item.status !== 'processing' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleRemoveItem(item)}
                      aria-label={`移出队列 ${item.fileName}`}
                      title="移出队列"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}

                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Stats */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <div className="flex items-center gap-3">
              <span>完成: {stats.completed}</span>
              <span>失败: {stats.failed}</span>
              <span>跳过: {stats.skipped}</span>
            </div>
            {stats.totalCostRMB > 0 && (
              <div className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
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
                  onClick={handleTogglePause}
                >
                  {isStorePaused ? (
                    <>
                      <Play className="h-3 w-3 mr-1" />
                      继续
                    </>
                  ) : (
                    <>
                      <Pause className="h-3 w-3 mr-1" />
                      暂停
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={handleStop}
                >
                  <Square className="h-3 w-3 mr-1" />
                  停止
                </Button>
              </>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                onClick={handleStartProcessing}
              >
                <Play className="h-3 w-3 mr-1" />
                开始处理
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              aria-label="清空队列"
              title="清空队列"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export default BatchQueuePanel
