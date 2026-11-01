/**
 * 关键图表：手动重新生成、云/历史加载后缺图自动补生成
 */
import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AIService } from '@/services/ai'
import { autoSyncService } from '@/services/autoSyncService'
import { useConfigStore } from '@/stores/configStore'
import type { BookSummary } from '@/types/book'
import { usableOrEmpty, usableSummaryChapters } from '@/utils/chapterResults'
import { isUsableText } from '@/utils/resultStatus'
import type { GenerationCounter } from '@/utils/runGuard'
import { logger } from '@/lib/logger'
import { saveChartsArtifact } from '@/services/pipeline/persistence'

export interface KeyChartsDeps {
  generationRef: MutableRefObject<GenerationCounter>
  bookSummary: BookSummary | null
  setBookSummary: Dispatch<SetStateAction<BookSummary | null>>
  /** 云端图表上传用文件名键（与 getCacheFilePath 入参一致） */
  resolveUploadKey: (explicit?: string | null) => string | null
  /** 成功生成后记录云端键 */
  onUploadKey: (key: string) => void
}

/** 云端上传：运行时读 store（避免闭包里 enabled 过期），不依赖 autoSync；返回失败原因 */
async function uploadCharts(
  summary: BookSummary,
  cacheName: string,
  isStale: () => boolean
): Promise<string | null> {
  const charts = summary.charts
  if (!charts) return null
  const saved = await autoSyncService.syncChartsJson(cacheName, charts)
  // 顺带 force 写 MD（内嵌图表兜底），失败不挡 JSON 成功态；已换书则不写
  if (!isStale()) {
    const { chapterNamingMode } = useConfigStore.getState().processingOptions
    await autoSyncService.syncSummary(summary, cacheName, chapterNamingMode, { force: true })
  }
  return saved.success ? null : saved.error || ''
}

export function useKeyCharts(deps: KeyChartsDeps) {
  const { t } = useTranslation()
  const { generationRef, bookSummary, setBookSummary, resolveUploadKey, onUploadKey } = deps
  const [chartsGenerating, setChartsGenerating] = useState(false)
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  /** 区分「用户点了取消」与真正的失败：前者不记 chartsError、不弹错误 */
  const userCancelRef = useRef(false)

  const resetCharts = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    busyRef.current = false
    setChartsGenerating(false)
  }, [])

  /** 用户取消本次生成（不影响已有图表） */
  const cancelKeyCharts = useCallback(() => {
    if (!abortRef.current) return
    userCancelRef.current = true
    abortRef.current.abort()
  }, [])

  const runKeyChartsGeneration = useCallback(
    async (source: BookSummary, options?: { silent?: boolean; cacheFileName?: string | null }) => {
      const silent = !!options?.silent
      if (!isUsableText(source.overallSummary)) {
        if (!silent) toast.error(t('results.charts.needOverall'))
        return
      }
      const usable = usableSummaryChapters(source.chapters ?? [])
      if (!usable.length) {
        if (!silent) toast.error(t('results.charts.needChapters'))
        return
      }
      if (busyRef.current) {
        if (!silent) toast.message(t('results.charts.busy'))
        return
      }
      // 换书会递增代数并 abort：旧结果不写回、不上传
      const generation = generationRef.current.current
      const isStale = () => !generationRef.current.isCurrent(generation)
      const controller = new AbortController()
      abortRef.current = controller
      userCancelRef.current = false
      busyRef.current = true
      setChartsGenerating(true)
      setBookSummary((prev) => (prev ? { ...prev, chartsError: null } : prev))
      const toastId = toast.loading(t('progress.generatingKeyCharts'))

      try {
        const { aiConfig, aiServiceOptions, processingOptions } = useConfigStore.getState()
        const ai = new AIService(aiConfig, () => useConfigStore.getState().promptConfig, {
          ...aiServiceOptions,
          onTokenUsage: (n: number) => {
            if (!isStale()) useConfigStore.getState().addTokenUsage(n)
          },
        })
        const charts = await ai.generateKeyCharts(
          source.title || '',
          usable,
          usableOrEmpty(source.connections),
          source.overallSummary,
          processingOptions.outputLanguage,
          { signal: controller.signal }
        )
        if (isStale()) {
          toast.dismiss(toastId)
          return
        }
        const nextSummary: BookSummary = { ...source, charts, chartsError: null }
        const cacheName = resolveUploadKey(options?.cacheFileName)
        if (cacheName) {
          onUploadKey(cacheName)
          void saveChartsArtifact(cacheName, charts).catch((e) => logger.warn('[charts] 本地副本失败:', e))
        }
        setBookSummary((prev) => (prev ? { ...prev, charts, chartsError: null } : nextSummary))

        const dav = useConfigStore.getState().webdavConfig
        let cloudErr: string | null
        if (!cacheName) cloudErr = t('progress.chartsNoFileName', { defaultValue: '缺少文件名，无法定位云端路径' })
        else if (!dav.enabled) cloudErr = t('progress.chartsWebdavDisabled', { defaultValue: 'WebDAV 未启用' })
        else {
          try {
            cloudErr = await uploadCharts(nextSummary, cacheName, isStale)
          } catch (e) {
            cloudErr = e instanceof Error ? e.message : String(e)
          }
        }

        if (cloudErr === null) {
          toast.success(
            silent ? t('results.charts.autoGeneratedSynced') : t('results.charts.regeneratedAndSynced'),
            { id: toastId }
          )
        } else {
          toast.success(silent ? t('results.charts.autoGenerated') : t('results.charts.regenerated'), {
            id: toastId,
          })
          if (dav.enabled || !cacheName) {
            toast.warning(
              `${t('progress.chartsCloudSaveFailed')}: ${cloudErr || t('progress.unknownReason', { defaultValue: '未知原因' })}`
            )
          }
        }
      } catch (err) {
        if (isStale()) {
          toast.dismiss(toastId)
          return
        }
        if (userCancelRef.current) {
          toast.message(t('results.charts.cancelled'), { id: toastId })
          return
        }
        const msg = err instanceof Error ? err.message : t('progress.unknownError', { defaultValue: '未知错误' })
        logger.error('[runKeyChartsGeneration] failed', err)
        setBookSummary((prev) => (prev ? { ...prev, chartsError: msg } : prev))
        toast.error(`${t('results.charts.failed')}: ${msg}`, { id: toastId })
      } finally {
        // 已换书时 reset 已复位；不能覆盖新一代可能已置起的标志
        if (!isStale()) {
          busyRef.current = false
          setChartsGenerating(false)
        }
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [t, generationRef, setBookSummary, resolveUploadKey, onUploadKey]
  )

  /** 手动重新生成（显式传入 cache 键，避免漏传导致跳过上传） */
  const regenerateKeyCharts = useCallback(async () => {
    if (!bookSummary) {
      toast.error(t('results.charts.needChapters'))
      return
    }
    const cacheFileName = resolveUploadKey(null)
    if (!cacheFileName) toast.warning(t('progress.chartsNoCacheKey'))
    await runKeyChartsGeneration(bookSummary, { silent: false, cacheFileName })
  }, [bookSummary, runKeyChartsGeneration, resolveUploadKey, t])

  // 打开已精读的书不自动调用 AI：缺图表时由对照栏的「生成」按钮让用户确认后再生成（规格 ux-audit）
  return { chartsGenerating, regenerateKeyCharts, cancelKeyCharts, resetCharts }
}
