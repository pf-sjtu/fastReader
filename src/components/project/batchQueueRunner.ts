// 批量队列执行逻辑：与 BatchQueuePanel 组件分离，全部经 store.getState() 读写，便于测试且不受组件闭包影响
import { toast } from 'sonner'
import i18n from '../../i18n'
import { useBatchQueueStore } from '../../stores/batchQueueStore'
import { useConfigStore } from '../../stores/configStore'
import { batchProcessingEngine, type BatchProcessingResult } from '../../services/batchProcessingEngine'
import { cloudCacheService } from '../../services/cloudCacheService'

/** 每本书最多自动重试的次数（无人值守批量：瞬时错误自动再排一次队） */
export const MAX_ITEM_RETRIES = 2

/**
 * 是否值得自动重试：网络 / 超时 / 限流 / 上游 5xx / 空内容属于瞬时问题；
 * 解析失败、格式不支持、没有可用章节这类重跑也不会好，直接判失败。
 */
export function isRetryableFailure(message: string | undefined): boolean {
  if (!message) return true
  const text = message.toLowerCase()
  const permanent = ['不支持', '没有可用', '未找到', '无章节', 'not supported', 'unsupported', 'invalid epub', '解析失败']
  if (permanent.some((p) => text.includes(p.toLowerCase()))) return false
  const transient = ['timeout', '超时', 'network', 'fetch', '429', 'rate', '限流', '502', '503', '504', '500', 'econn', '空内容', 'aborted']
  return transient.some((p) => text.includes(p))
}

/** 失败时：有重试额度且属于瞬时错误 → 放回队尾；否则记为失败 */
function failOrRetry(id: string, reason: string, name: string) {
  const store = useBatchQueueStore.getState()
  const item = store.queue.find((i) => i.id === id)
  const attempts = item?.attempts ?? 0
  if (attempts < MAX_ITEM_RETRIES && isRetryableFailure(reason)) {
    store.requeueItem(id, reason)
    toast.warning(i18n.t('batch.toast.itemRetrying', { name, attempt: attempts + 1, max: MAX_ITEM_RETRIES }), {
      description: reason,
    })
    return
  }
  store.markItemFailed(id, reason)
  toast.error(i18n.t('batch.toast.itemFailed', { name }), { description: reason })
}

/** 云端缓存文件名集合；null 表示尚未获取（需先确认云端状态） */
export type CachedNamesRef = { current: Set<string> | null }

/** 是否为「已有缓存而跳过」：读引擎的结构化 skipped 字段，不再匹配错误文案 */
export function isSkippedResult(result: BatchProcessingResult): boolean {
  return result.skipped === true
}

/** 致命错误（如无法确认云端缓存状态）：停止整个队列，避免后续逐本失败或覆盖已有结果 */
function stopQueueOnFatal(reason: string) {
  batchProcessingEngine.stop()
  useBatchQueueStore.getState().stopProcessing()
  toast.error(i18n.t('batch.toast.stoppedFatal'), { description: reason })
}

/**
 * 处理队列中下一个 pending 项。全部通过 store.getState() 读写，不依赖组件闭包（避免读到旧 stats）。
 * @returns false 表示应停止循环（无待处理项或遇到致命错误）
 */
export async function processNextPendingItem(cachedNames: CachedNamesRef): Promise<boolean> {
  const store = useBatchQueueStore.getState()

  // 共享队列的执行租约：租约已被他人接管时本机必须停手，避免两边同时写结果
  if (store.runner && store.runner.clientId !== store.clientId) {
    batchProcessingEngine.stop()
    store.stopProcessing()
    toast.error(i18n.t('batch.runnerTakenOver'))
    return false
  }
  store.heartbeatRunner()

  const nextPending = store.queue.find((i) => i.status === 'pending')
  if (!nextPending) {
    store.releaseRunner()
    return false
  }

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

    const failReason = result.error || i18n.t('batch.itemFailed')
    if (result.fatal) {
      markItemFailed(nextPending.id, failReason)
      stopQueueOnFatal(failReason)
      return false
    }

    if (isSkippedResult(result)) {
      markItemSkipped(nextPending.id)
    } else if (result.success) {
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
        toast.warning(i18n.t('batch.toast.itemPartial', { name: nextPending.fileName }), {
          description: i18n.t('batch.toast.itemPartialDesc', { count: result.metadata.skippedChapters ?? 0 })
        })
      } else {
        toast.success(i18n.t('batch.toast.itemDone', { name: nextPending.fileName }))
      }
    } else {
      failOrRetry(nextPending.id, failReason, nextPending.fileName)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : i18n.t('common.unknownError')
    failOrRetry(nextPending.id, message, nextPending.fileName)
  }

  // 处理期间被用户停止：不再继续（也不报「完成」）
  const stillProcessing = useBatchQueueStore.getState().isProcessing
  useBatchQueueStore.getState().nextItem()
  return stillProcessing
}

function finishQueue() {
  useBatchQueueStore.getState().stopProcessing()
  const { completed, failed } = useBatchQueueStore.getState().stats
  toast(i18n.t('batch.toast.finished'), {
    description: i18n.t('batch.toast.finishedDesc', { completed, failed })
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

