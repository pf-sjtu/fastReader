/**
 * 处理 / 取消 / 重启与进度状态；具体流程委托 runBookPipeline
 */
import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import type { ChapterData } from '@/services/epubProcessor'
import { AIService } from '@/services/ai'
import { notificationService } from '@/services/notificationService'
import { useConfigStore } from '@/stores/configStore'
import type { BookMindMap, BookSummary } from '@/types/book'
import { clampConcurrency } from '@/utils/async'
import { isAbortError, waitForSettled, type GenerationCounter } from '@/utils/runGuard'
import { logger } from '@/lib/logger'
import { runBookPipeline, type PipelinePhase, type PipelineWarning } from '@/services/pipeline/bookPipeline'
import {
  createLocalPipelineCache,
  recordHistory,
  syncMindMapResult,
  syncSummaryResult,
} from '@/services/pipeline/persistence'

/** 重开时等待旧一轮退出的上限；超时后靠代际守卫丢弃旧结果 */
const RESTART_WAIT_MS = 5000
/** 主动中止会同时触发 cancel 回调与 AbortError 分支：固定 id 去重 */
const CANCELLED_TOAST_ID = 'processing-cancelled'

const PHASE_STEP_KEY: Record<Exclude<PipelinePhase, 'chapters'>, string> = {
  connections: 'progress.analyzingConnections',
  overall: 'progress.generatingOverallSummary',
  charts: 'progress.generatingKeyCharts',
  combined: 'progress.generatingCombinedMindMap',
}

const WARNING_KEY: Partial<Record<PipelineWarning, string>> = {
  connections: 'progress.postPhaseConnectionsFailed',
  overall: 'progress.postPhaseOverallFailed',
  charts: 'progress.postPhaseChartsFailed',
  combined: 'progress.postPhaseCombinedFailed',
}

export interface ProcessingRunDeps {
  generationRef: MutableRefObject<GenerationCounter>
  file: File | null
  extractedChapters: ChapterData[] | null
  selectedChapters: Set<string>
  bookData: { title: string; author: string } | null
  customPrompt: string
  getBookId: () => Promise<string | null>
  cloudCacheKeyRef: MutableRefObject<string | null>
  setBookSummary: Dispatch<SetStateAction<BookSummary | null>>
  setBookMindMap: Dispatch<SetStateAction<BookMindMap | null>>
  /** 重启前清空结果与阅读态 */
  clearResults: () => void
}

export function useProcessingRun(deps: ProcessingRunDeps) {
  const { t } = useTranslation()
  const { aiConfig, processingOptions, aiServiceOptions, addTokenUsage, resetTokenUsage } = useConfigStore(
    useShallow((s) => ({
      aiConfig: s.aiConfig,
      processingOptions: s.processingOptions,
      aiServiceOptions: s.aiServiceOptions,
      addTokenUsage: s.addTokenUsage,
      resetTokenUsage: s.resetTokenUsage,
    }))
  )
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [currentProcessingChapter, setCurrentProcessingChapter] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  /** 当前一轮的结束信号（restart 时等待旧一轮真正退出） */
  const runPromiseRef = useRef<Promise<void> | null>(null)

  const { generationRef, file, extractedChapters, selectedChapters, bookData, customPrompt } = deps
  const { getBookId, cloudCacheKeyRef, setBookSummary, setBookMindMap, clearResults } = deps

  /** 作废并中止进行中的一轮（换书时由组合入口调用，代数由调用方递增） */
  const resetRun = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setProcessing(false)
    setProgress(0)
    setCurrentStep('')
    setCurrentProcessingChapter('')
  }, [])

  const processBook = useCallback(async () => {
    if (!file || !extractedChapters || selectedChapters.size === 0) return
    const generation = generationRef.current.bump()
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal
    let finishRun: () => void = () => {}
    runPromiseRef.current = new Promise<void>((resolve) => (finishRun = resolve))
    const isCurrentRun = () => generationRef.current.isCurrent(generation) && !signal.aborted

    const mode = processingOptions.processingMode
    const title = bookData?.title || ''
    const author = bookData?.author || ''
    setProcessing(true)
    setProgress(0)
    setCurrentStep(t('progress.startProcessing'))

    try {
      resetTokenUsage()
      const ai = new AIService(aiConfig, () => useConfigStore.getState().promptConfig, {
        ...aiServiceOptions,
        // 被取代的旧一轮仍可能回报 token：只记当前代
        onTokenUsage: (n: number) => {
          if (generationRef.current.isCurrent(generation)) addTokenUsage(n)
        },
      })
      const chapters = extractedChapters.filter((ch) => selectedChapters.has(ch.id))
      const total = chapters.length
      const cache = await createLocalPipelineCache({
        bookId: (await getBookId()) ?? '',
        // 思考强度会改变输出：auto 之外的取值进入缓存键，切换后不会命中旧结果
        modelId: `${aiConfig.provider}:${aiConfig.model}${
          aiConfig.reasoningEffort && aiConfig.reasoningEffort !== 'auto' ? `@${aiConfig.reasoningEffort}` : ''
        }`,
        outputLanguage: processingOptions.outputLanguage,
        bookType: processingOptions.bookType,
        promptConfig: useConfigStore.getState().promptConfig,
        customPrompt,
      }).catch((e) => {
        logger.warn('[processBook] 本地缓存不可用:', e)
        return null
      })

      if (mode === 'summary') {
        setBookSummary({ title, author, chapters: [], connections: '', overallSummary: '' })
      } else {
        setBookMindMap({ title, author, chapters: [], combinedMindMap: null })
      }
      const stepFor = (done: number) =>
        t('progress.processingChapter', {
          current: Math.min(done + 1, total),
          total,
          title: chapters[Math.min(done, total - 1)]?.title ?? '',
        })

      // 章节 id → 序号：onChapterStart 每章都会查一次，预先建 Map 避免 O(n²)
      const chapterPosition = new Map(chapters.map((c, i) => [c.id, i]))

      const result = await runBookPipeline({
        chapters,
        mode,
        ai,
        bookTitle: title,
        bookType: processingOptions.bookType,
        outputLanguage: processingOptions.outputLanguage,
        customPrompt,
        concurrency: clampConcurrency(processingOptions.chapterConcurrency ?? 3),
        signal,
        cache,
        onPhase: (phase, p) => {
          if (!isCurrentRun()) return
          setProgress(p)
          if (phase === 'chapters') {
            setCurrentStep(t(mode === 'summary' ? 'progress.generatingSummaries' : 'progress.generatingMindMaps'))
          } else {
            setCurrentProcessingChapter('')
            setCurrentStep(t(PHASE_STEP_KEY[phase]))
          }
        },
        onChapterStart: (chapter, done) => {
          if (!isCurrentRun()) return
          setCurrentProcessingChapter(chapter.id)
          // 序号取章节自身位置（并发下 done 是已按序提交数，与当前章无关）
          const pos = chapterPosition.get(chapter.id) ?? -1
          setCurrentStep(
            t('progress.processingChapter', { current: (pos >= 0 ? pos : done) + 1, total, title: chapter.title })
          )
        },
        onChapter: (chapter, index, info) => {
          if (!isCurrentRun()) return
          const append = <B extends { chapters: typeof chapter[] }>(prev: B | null) =>
            prev ? { ...prev, chapters: [...prev.chapters, chapter] } : prev
          if (mode === 'summary') setBookSummary(append)
          else setBookMindMap(append)
          setProgress(info.progress)
          setCurrentStep(stepFor(index + 1))
        },
      })
      if (!isCurrentRun()) return
      setCurrentProcessingChapter('')
      result.warnings.forEach((w) => {
        const key = WARNING_KEY[w]
        if (key) toast.warning(t(key))
      })

      const davOn = useConfigStore.getState().webdavConfig.enabled
      if (mode === 'summary') {
        const summary: BookSummary = {
          title,
          author,
          chapters: result.chapters,
          connections: result.connections,
          overallSummary: result.overall,
          charts: result.charts ?? null,
          chartsError: result.chartsError ?? null,
        }
        setBookSummary(summary)
        if (summary.charts) cloudCacheKeyRef.current = file.name
        const sync = await syncSummaryResult(summary, file.name, processingOptions.chapterNamingMode, {
          webdavEnabled: davOn,
          hasUsableChapters: result.stats.usable > 0,
        })
        if (!isCurrentRun()) return
        if (sync.mdFailed) toast.warning(t('progress.syncFailed'))
        if (sync.chartsError) toast.warning(`${t('progress.chartsCloudSaveFailed')}: ${sync.chartsError}`)
      } else {
        const mindMap: BookMindMap = {
          title,
          author,
          chapters: result.chapters,
          combinedMindMap: result.combinedMindMap ?? null,
        }
        setBookMindMap(mindMap)
        const manifest = {
          mode,
          fileName: file.name,
          processedAt: new Date().toISOString(),
          model: aiConfig.model,
          chapterCount: result.chapters.length,
          processedChapters: result.stats.usable,
          failedChapters: result.stats.failed,
          isPartial: result.isPartial,
        }
        if (result.stats.usable > 0 && (await syncMindMapResult(mindMap, file.name, manifest)) && isCurrentRun()) {
          toast.warning(t('progress.syncFailed'))
        }
      }
      if (!isCurrentRun()) return

      setProgress(100)
      if (result.stats.usable === 0 && total > 0) {
        // 全部章节失败：不是成功完成，不记历史
        setCurrentStep(t('progress.allChaptersFailed'))
        toast.error(t('progress.allChaptersFailed'), { id: 'processing-result', duration: 5000 })
        if (processingOptions.enableNotification) {
          await notificationService.sendErrorNotification(t('progress.allChaptersFailed'))
        }
        return
      }
      setCurrentStep(t('progress.completed'))
      recordHistory({
        bookTitle: title || file.name.replace(/\.[^/.]+$/, ''),
        fileName: file.name,
        processingMode: mode,
        model: aiConfig.model,
        chapterCount: total,
      })
      toast.success(
        result.warnings.length > 0 ? t('progress.completedWithWarnings') : t('progress.processingCompleted')
      )
      if (processingOptions.enableNotification) {
        await notificationService.sendTaskCompleteNotification(t('progress.bookProcessing'), title)
      }
    } catch (error) {
      // 被更新一轮处理 / 换书取代：静默退出
      if (!generationRef.current.isCurrent(generation)) return
      if (isAbortError(error)) {
        setCurrentStep(t('progress.cancelled'))
        toast.info(t('progress.cancelledHint'), { id: CANCELLED_TOAST_ID, duration: 5000 })
      } else {
        const msg = error instanceof Error ? error.message : t('progress.processingError')
        toast.error(msg, { duration: 5000, position: 'top-center' })
        if (processingOptions.enableNotification) await notificationService.sendErrorNotification(msg)
      }
    } finally {
      if (generationRef.current.isCurrent(generation)) {
        if (abortRef.current === controller) abortRef.current = null
        setProcessing(false)
        setCurrentProcessingChapter('')
      }
      finishRun()
    }
  }, [
    file, extractedChapters, selectedChapters, bookData, customPrompt, aiConfig, processingOptions,
    aiServiceOptions, addTokenUsage, resetTokenUsage, t, generationRef, getBookId, cloudCacheKeyRef,
    setBookSummary, setBookMindMap,
  ])

  // 中止处理：取消进行中的 AI 请求，并发池不再出队
  const cancelProcessing = useCallback(() => {
    abortRef.current?.abort()
    setProcessing(false)
    setCurrentProcessingChapter('')
    setCurrentStep(t('progress.cancelled'))
    toast.info(t('progress.cancelledHint'), { id: CANCELLED_TOAST_ID })
  }, [t])

  /** 重新开始：中止进行中的任务，等旧一轮退出后清空结果并按当前配置再跑（缓存命中章节不再调用 AI） */
  const restartProcessing = useCallback(async () => {
    abortRef.current?.abort()
    const settled = await waitForSettled(runPromiseRef.current, RESTART_WAIT_MS)
    if (!settled) logger.warn('[restartProcessing] 旧一轮未在超时内退出，将由代际守卫丢弃其结果')
    clearResults()
    setProgress(0)
    setCurrentStep('')
    await processBook()
  }, [processBook, clearResults])

  return {
    processing,
    progress,
    currentStep,
    currentProcessingChapter,
    processBook,
    cancelProcessing,
    restartProcessing,
    resetRun,
  }
}
