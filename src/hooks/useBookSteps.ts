/**
 * 书级步骤的单步重试：关联分析 / 全书总结失败（或被清除）后，只重跑这一步，
 * 不动章节总结、不重新付章节的钱。成功后回写 bookSummary 并同步云端 MD。
 */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AIService } from '@/services/ai'
import { autoSyncService } from '@/services/autoSyncService'
import { buildEntityTable } from '@/services/prompts/chapterMeta'
import { useConfigStore } from '@/stores/configStore'
import type { BookSummary } from '@/types/book'
import { usableOrEmpty, promptChapters } from '@/utils/chapterResults'
import { isUsableText } from '@/utils/resultStatus'
import type { GenerationCounter } from '@/utils/runGuard'
import { logger } from '@/lib/logger'

export type BookStepKind = 'connections' | 'overall'

interface Deps {
  generationRef: { current: GenerationCounter }
  bookSummary: BookSummary | null
  setBookSummary: Dispatch<SetStateAction<BookSummary | null>>
  /** 云端上传用文件名键；拿不到就只更新本地 */
  resolveUploadKey: (explicit?: string | null) => string | null
}

export function useBookSteps({ generationRef, bookSummary, setBookSummary, resolveUploadKey }: Deps) {
  const { t } = useTranslation()
  const [running, setRunning] = useState<BookStepKind | null>(null)
  const busyRef = useRef(false)

  const retryBookStep = useCallback(
    async (kind: BookStepKind) => {
      if (!bookSummary || busyRef.current) return
      const usable = promptChapters(bookSummary.chapters ?? [])
      if (!usable.length) {
        toast.error(t('results.charts.needChapters'))
        return
      }
      if (kind === 'overall' && !isUsableText(bookSummary.connections)) {
        // 全书总结要读关联分析：关联本身没有时先提示，别拿占位文案喂模型
        toast.message(t('results.step.needConnections'))
        return
      }
      const generation = generationRef.current.current
      const isStale = () => !generationRef.current.isCurrent(generation)
      busyRef.current = true
      setRunning(kind)
      const toastId = toast.loading(t('results.step.running'))
      try {
        const { aiConfig, aiServiceOptions, processingOptions } = useConfigStore.getState()
        const ai = new AIService(aiConfig, () => useConfigStore.getState().promptConfig, {
          ...aiServiceOptions,
          onTokenUsage: (n: number) => {
            if (!isStale()) useConfigStore.getState().addTokenUsage(n)
          },
        })
        const entityTable = buildEntityTable(bookSummary.chapters.map((c) => c.meta))
        const opts = entityTable ? { entityTable } : undefined
        const lang = processingOptions.outputLanguage
        const text =
          kind === 'connections'
            ? await ai.analyzeConnections(usable, lang, opts)
            : await ai.generateOverallSummary(bookSummary.title || '', usable, usableOrEmpty(bookSummary.connections), lang, opts)
        if (isStale()) {
          toast.dismiss(toastId)
          return
        }
        if (!isUsableText(text)) throw new Error(t('results.step.emptyResult'))
        const next: BookSummary = kind === 'connections' ? { ...bookSummary, connections: text } : { ...bookSummary, overallSummary: text }
        setBookSummary((prev) => (prev ? { ...prev, ...(kind === 'connections' ? { connections: text } : { overallSummary: text }) } : next))
        const cacheName = resolveUploadKey(null)
        const dav = useConfigStore.getState().webdavConfig
        if (cacheName && dav.enabled) {
          const synced = await autoSyncService.syncSummary(next, cacheName, processingOptions.chapterNamingMode, { force: true })
          if (!synced) toast.warning(t('progress.syncFailed'))
        }
        toast.success(t('results.step.done'), { id: toastId })
      } catch (err) {
        if (isStale()) {
          toast.dismiss(toastId)
          return
        }
        logger.error('[retryBookStep] failed', err)
        toast.error(`${t('results.step.failed')}: ${err instanceof Error ? err.message : t('progress.unknownError', { defaultValue: '未知错误' })}`, { id: toastId })
      } finally {
        busyRef.current = false
        setRunning(null)
      }
    },
    [bookSummary, generationRef, setBookSummary, resolveUploadKey, t]
  )

  return { retryBookStep, stepRunning: running }
}
