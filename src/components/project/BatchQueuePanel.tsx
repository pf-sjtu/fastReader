import { useState, useEffect, useCallback, useRef } from 'react'

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
  FolderOpen
} from 'lucide-react'
import { useBatchQueueStore, useBatchProcessingStatus, useBatchStats, type BatchQueueItem } from '../../stores/batchQueueStore'
import { batchProcessingEngine, type BatchProcessingResult } from '../../services/batchProcessingEngine'
import { cloudCacheService } from '../../services/cloudCacheService'

import { useConfigStore } from '../../stores/configStore'
import { toast } from 'sonner'

export function BatchQueuePanel() {
  // Store
  const {
    queue,
    clearQueue,
    startProcessing: startStoreProcessing,
    pauseProcessing: pauseStoreProcessing,
    resumeProcessing: resumeStoreProcessing,
    stopProcessing: stopStoreProcessing,
    updateItem,
    markItemCompleted,
    markItemFailed,
    markItemSkipped,
    nextItem
  } = useBatchQueueStore()
  const { isProcessing: isStoreProcessing, isPaused: isStorePaused, currentItem } = useBatchProcessingStatus()
  const stats = useBatchStats()

  // UI state
  const [isOpen, setIsOpen] = useState(false)

  const cachedFilesRef = useRef<Set<string>>(new Set())


  // No queue items - don't render
  if (queue.length === 0) {
    return null
  }

  // Process next item when processing is started
  const processNextItem = useCallback(async () => {
    const state = useBatchQueueStore.getState()
    const nextPending = state.queue.find((i) => i.status === 'pending')

    if (!nextPending) {
      // No more pending items
      stopStoreProcessing()
      toast('处理完成', {
        description: `批量处理已完成，成功 ${stats.completed} 个，失败 ${stats.failed} 个`
      })
      return
    }

    // Find the index of the next pending item
    const nextIndex = state.queue.findIndex((i) => i.id === nextPending.id)

    // Update item to processing
    updateItem(nextPending.id, { status: 'processing', progress: 0 })

    // Get processing config from store
    const config = useConfigStore.getState().processingOptions
    if (cachedFilesRef.current.size === 0) {
      cachedFilesRef.current = await cloudCacheService.fetchCacheFileNames()
    }

    const batchConfig = {
      sourcePath: '',
      maxFiles: 0,
      skipProcessed: true,
      order: 'sequential' as const,
      bookType: config.bookType,
      processingMode: config.processingMode,
      chapterDetectionMode: config.chapterDetectionMode,
      outputLanguage: config.outputLanguage
    }

    try {
      // Process the item using the engine
      const result = await batchProcessingEngine.processItem(nextPending, batchConfig, cachedFilesRef.current)


      if (result.success && !result.error?.includes('已跳过')) {
        markItemCompleted(nextPending.id, {
          chapterCount: result.metadata?.chapterCount || 0,
          processedChapters: result.metadata?.processedChapters || 0,
          startTime: result.metadata?.startTime || new Date().toISOString(),
          endTime: result.metadata?.endTime || new Date().toISOString(),
          costUSD: result.metadata?.costUSD || 0,
          costRMB: result.metadata?.costRMB || 0
        })
        toast.success(`处理完成: ${nextPending.fileName}`)
      } else if (result.error?.includes('已跳过')) {
        markItemSkipped(nextPending.id)
      } else {
        markItemFailed(nextPending.id, result.error || '处理失败')
        toast.error(`处理失败: ${nextPending.fileName}`, {
          description: result.error
        })
      }
    } catch (error) {
      markItemFailed(nextPending.id, error instanceof Error ? error.message : '未知错误')
      toast.error(`处理失败: ${nextPending.fileName}`, {
        description: error instanceof Error ? error.message : '未知错误'
      })
    }

    // Move to next item
    nextItem()
  }, [stats.completed, stats.failed, stopStoreProcessing, updateItem, markItemCompleted, markItemFailed, markItemSkipped, nextItem])

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

  // Handle start processing
  const handleStartProcessing = async () => {
    const pendingCount = queue.filter((i) => i.status === 'pending').length

    if (pendingCount === 0) {
      toast.info('没有待处理的文件')
      return
    }

    startStoreProcessing()
    cachedFilesRef.current = await cloudCacheService.fetchCacheFileNames()
    toast('开始处理', {
      description: `共 ${pendingCount} 个文件待处理`
    })

  }

  // Effect to process items when processing is active
  useEffect(() => {
    let isMounted = true

    const processQueue = async () => {
      while (isStoreProcessing && !isStorePaused && isMounted) {
        const state = useBatchQueueStore.getState()
        const hasPending = state.queue.some((i) => i.status === 'pending')

        if (!hasPending) {
          stopStoreProcessing()
          toast('处理完成', {
            description: `批量处理已完成，成功 ${stats.completed} 个，失败 ${stats.failed} 个`
          })
          break
        }

        await processNextItem()
      }
    }

    if (isStoreProcessing) {
      processQueue()
    }

    return () => {
      isMounted = false
    }
  }, [isStoreProcessing, isStorePaused, stats.completed, stats.failed, stopStoreProcessing, processNextItem])

  // Get status badge
  const getStatusBadge = (status: BatchQueueItem['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary" className="text-xs">等待</Badge>
      case 'processing':
        return <Badge variant="default" className="bg-blue-500 text-xs">处理中</Badge>
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

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted/70 transition-colors">
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
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2 space-y-3">
          {/* Progress bar */}
          <Progress value={progressPercent} className="h-1.5" />

          {/* Current item */}
          {currentItem && (
            <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-md">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
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
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="w-5 text-muted-foreground">{index + 1}.</span>
                  {getStatusBadge(item.status)}
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
