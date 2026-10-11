// 批量队列的开始 / 暂停 / 停止 / 清空：BatchQueuePanel 与 BatchProcessingDialog 共用（含提示文案）
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useBatchQueueStore } from '../../../stores/batchQueueStore'
import { useConfigStore } from '../../../stores/configStore'
import { batchProcessingEngine, assertBatchModeSupported } from '../../../services/batchProcessingEngine'
import { cloudCacheService } from '../../../services/cloudCacheService'

export function useBatchQueueControls() {
  const { t } = useTranslation()
  const store = useBatchQueueStore.getState

  /** 检查模式是否支持批量；不支持时提示并返回 false */
  const checkMode = (): boolean => {
    try {
      assertBatchModeSupported(useConfigStore.getState().processingOptions.processingMode || 'summary')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  /** 开始处理队列中待处理项：先确认云端缓存状态（列目录失败不能当成「没有缓存」而重跑覆盖） */
  const start = async (): Promise<boolean> => {
    const pending = store().queue.filter((i) => i.status === 'pending').length
    if (pending === 0) {
      toast.info(t('batch.noPending'))
      return false
    }
    if (!checkMode()) return false
    const status = await cloudCacheService.fetchCacheFileNamesStatus()
    if (status.status === 'unknown') {
      toast.error(t('batch.cacheUnknownNotStarted'), { description: status.error })
      return false
    }
    batchProcessingEngine.resetStopFlag()
    store().startProcessing()
    toast(t('batch.toast.started'), { description: t('batch.toast.startedDesc', { count: pending }) })
    return true
  }

  const togglePause = () => {
    if (store().isPaused) {
      store().resumeProcessing()
      batchProcessingEngine.resume()
      toast(t('batch.toast.resumed'), { description: t('batch.toast.resumedDesc') })
    } else {
      store().pauseProcessing()
      batchProcessingEngine.pause()
      toast(t('batch.toast.paused'), { description: t('batch.toast.pausedDesc') })
    }
  }

  const stop = () => {
    batchProcessingEngine.stop()
    store().stopProcessing()
    toast(t('batch.toast.stopped'), { description: t('batch.toast.stoppedDesc') })
  }

  const clear = () => {
    batchProcessingEngine.stop()
    store().stopProcessing()
    store().clearQueue()
    toast(t('batch.toast.cleared'), { description: t('batch.toast.clearedDesc') })
  }

  return { checkMode, start, togglePause, stop, clear }
}
