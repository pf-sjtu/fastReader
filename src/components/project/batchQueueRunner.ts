// 批量队列执行逻辑：与 BatchQueuePanel 组件分离，全部经 store.getState() 读写，便于测试且不受组件闭包影响
import { toast } from 'sonner'
import { useBatchQueueStore } from '../../stores/batchQueueStore'
import { useConfigStore } from '../../stores/configStore'
import { batchProcessingEngine } from '../../services/batchProcessingEngine'
import { cloudCacheService } from '../../services/cloudCacheService'

/** 云端缓存文件名集合；null 表示尚未获取（需先确认云端状态） */
export type CachedNamesRef = { current: Set<string> | null }

/** 致命错误（如无法确认云端缓存状态）：停止整个队列，避免后续逐本失败或覆盖已有结果 */
function stopQueueOnFatal(reason: string) {
  batchProcessingEngine.stop()
  useBatchQueueStore.getState().stopProcessing()
  toast.error('批量处理已停止', { description: reason })
}

/**
 * 处理队列中下一个 pending 项。全部通过 store.getState() 读写，不依赖组件闭包（避免读到旧 stats）。
 * @returns false 表示应停止循环（无待处理项或遇到致命错误）
 */
export async function processNextPendingItem(cachedNames: CachedNamesRef): Promise<boolean> {
  const store = useBatchQueueStore.getState()
  const nextPending = store.queue.find((i) => i.status === 'pending')
  if (!nextPending) return false

  if (!cachedNames.current) {
    const status = await cloudCacheService.fetchCacheFileNamesStatus()
    if (status.status === 'unknown') {
      stopQueueOnFatal(status.error)
      return false
    }
    cachedNames.current = status.names
  }

  store.updateItem(nextPending.id, { status: 'processing', progress: 0 })

  const config = useConfigStore.getState().processingOptions
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
    const result = await batchProcessingEngine.processItem(nextPending, batchConfig, cachedNames.current)
    const { markItemCompleted, markItemFailed, markItemSkipped } = useBatchQueueStore.getState()

    if (result.fatal) {
      markItemFailed(nextPending.id, result.error || '处理失败')
      stopQueueOnFatal(result.error || '处理失败')
      return false
    }

    if (result.success && !result.error?.includes('已跳过')) {
      markItemCompleted(nextPending.id, {
        chapterCount: result.metadata?.chapterCount || 0,
        processedChapters: result.metadata?.processedChapters || 0,
        skippedChapters: result.metadata?.skippedChapters || 0,
        startTime: result.metadata?.startTime || new Date().toISOString(),
        endTime: result.metadata?.endTime || new Date().toISOString(),
        costUSD: result.metadata?.costUSD || 0,
        costRMB: result.metadata?.costRMB || 0,
        isPartial: result.metadata?.isPartial || false
      })

      if (result.metadata?.isPartial) {
        toast.warning(`处理完成但不完整: ${nextPending.fileName}`, {
          description: `有 ${result.metadata.skippedChapters ?? 0} 章因内容过滤被跳过`
        })
      } else {
        toast.success(`处理完成: ${nextPending.fileName}`)
      }
    } else if (result.error?.includes('已跳过')) {
      markItemSkipped(nextPending.id)
    } else {
      markItemFailed(nextPending.id, result.error || '处理失败')
      toast.error(`处理失败: ${nextPending.fileName}`, {
        description: result.error
      })
    }
  } catch (error) {
    useBatchQueueStore.getState().markItemFailed(nextPending.id, error instanceof Error ? error.message : '未知错误')
    toast.error(`处理失败: ${nextPending.fileName}`, {
      description: error instanceof Error ? error.message : '未知错误'
    })
  }

  // 处理期间被用户停止：不再继续（也不报「完成」）
  const stillProcessing = useBatchQueueStore.getState().isProcessing
  useBatchQueueStore.getState().nextItem()
  return stillProcessing
}

function finishQueue() {
  useBatchQueueStore.getState().stopProcessing()
  const { completed, failed } = useBatchQueueStore.getState().stats
  toast('处理完成', {
    description: `批量处理已完成，成功 ${completed} 个，失败 ${failed} 个`
  })
}

const hasPending = () => useBatchQueueStore.getState().queue.some((i) => i.status === 'pending')

/** 队列主循环：每轮从 store 读取最新 isProcessing/isPaused，暂停/停止后在当前项结束时退出 */
export async function runBatchQueue(cachedNames: CachedNamesRef): Promise<void> {
  for (;;) {
    const state = useBatchQueueStore.getState()
    if (!state.isProcessing || state.isPaused) return
    if (!hasPending()) {
      finishQueue()
      return
    }
    if (!(await processNextPendingItem(cachedNames))) return
    // store.nextItem() 在最后一项后会自动置 isProcessing=false，这里补上完成提示
    if (!hasPending()) {
      finishQueue()
      return
    }
  }
}

