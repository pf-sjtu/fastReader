/**
 * 单书处理组合入口：组合 useBookFile / useProcessingRun / useKeyCharts / useReaderPanel，
 * 返回值保持与拆分前兼容（S1）。
 */
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cloudCacheService } from '@/services/cloudCacheService'
import { webdavService } from '@/services/webdavService'
import { useConfigStore } from '@/stores/configStore'
import type { BookMindMap, BookSummary } from '@/types/book'
import { clearChapterResult } from '@/utils/chapterResults'
import { createGenerationCounter } from '@/utils/runGuard'
import { logger } from '@/lib/logger'
import type { CacheKind } from '@/services/pipeline/cacheKeys'
import {
  buildCloudBook,
  persistLoadedBook,
  refreshChartsJson,
  type CloudSnapshot,
  type LoadedCloudBook,
} from '@/services/pipeline/cloudLoad'
import { clearBookEntries, clearChapterEntries, clearKindEntries } from '@/services/pipeline/persistence'
import { baseName } from '@/services/library/libraryIndex'
import { useBookFile } from './useBookFile'
import { useKeyCharts } from './useKeyCharts'
import { useBookSteps } from './useBookSteps'
import { useProcessingRun } from './useProcessingRun'
import { useReaderPanel } from './useReaderPanel'

// 类型已迁到 src/types/book.ts，这里保留导出兼容既有引用
export type { Chapter, BookSummary, BookMindMap, ProcessingMode } from '@/types/book'
export type { RightPanelContent } from './useReaderPanel'

type SpecificCacheType =
  | 'connections'
  | 'overall_summary'
  | 'key_charts'
  | 'combined_mindmap'
  | 'merged_mindmap'
  | 'selected_chapters'

const stripExt = (name: string) => name.replace(/\.[^/.]+$/, '')

/** 本地缓存清除失败只记日志（UI 状态已清） */
function runClear(task: Promise<unknown>) {
  void task.catch((e) => logger.warn('[useBookProcessing] 清除本地缓存失败:', e))
}

export function useBookProcessing() {
  const { t } = useTranslation()
  const tokenUsage = useConfigStore((s) => s.tokenUsage)
  const resetTokenUsage = useConfigStore((s) => s.resetTokenUsage)
  const processingMode = useConfigStore((s) => s.processingOptions.processingMode)
  const webdavEnabled = useConfigStore((s) => s.webdavConfig.enabled)

  /** 处理代数：换书 / 重启 / 新开跑时递增，旧任务的异步回调据此丢弃结果 */
  const generationRef = useRef(createGenerationCounter())
  const [customPrompt, setCustomPrompt] = useState('')
  const [bookSummary, setBookSummary] = useState<BookSummary | null>(null)
  const [bookMindMap, setBookMindMap] = useState<BookMindMap | null>(null)

  const book = useBookFile(generationRef)
  const reader = useReaderPanel(book.extractedChapters)
  const { file, cloud, cloudCacheKeyRef, getBookId } = book

  /** 云端键候选：显式 > 本地文件名 > 云端/历史键 > 元数据文件名 */
  const resolveUploadKey = useCallback(
    (explicit?: string | null): string | null => {
      for (const c of [explicit, file?.name, cloudCacheKeyRef.current, cloud.metadata?.fileName]) {
        if (typeof c === 'string' && c.trim()) return c.trim()
      }
      return null
    },
    [file?.name, cloud.metadata?.fileName, cloudCacheKeyRef]
  )
  const onUploadKey = useCallback((key: string) => {
    cloudCacheKeyRef.current = key
  }, [cloudCacheKeyRef])

  const charts = useKeyCharts({ generationRef, bookSummary, setBookSummary, resolveUploadKey, onUploadKey })
  const steps = useBookSteps({ generationRef, bookSummary, setBookSummary, resolveUploadKey })

  const { resetPanel, setExpandedChapters, setCurrentViewingChapterSummary } = reader
  const clearResults = useCallback(() => {
    setBookSummary(null)
    setBookMindMap(null)
    setExpandedChapters(new Set())
    setCurrentViewingChapterSummary('')
  }, [setExpandedChapters, setCurrentViewingChapterSummary])

  const run = useProcessingRun({
    generationRef,
    file,
    extractedChapters: book.extractedChapters,
    selectedChapters: book.selectedChapters,
    bookData: book.bookData,
    customPrompt,
    getBookId,
    cloudCacheKeyRef,
    setBookSummary,
    setBookMindMap,
    clearResults,
  })

  const { resetFile } = book
  const { resetRun } = run
  const { resetCharts } = charts
  // 重置所有状态：作废进行中的任务（处理 / 提取 / 查缓存 / 图表），释放旧书资源
  const resetState = useCallback(() => {
    generationRef.current.bump()
    resetRun()
    resetCharts()
    resetFile()
    resetPanel()
    setBookSummary(null)
    setBookMindMap(null)
    setCustomPrompt('')
    resetTokenUsage()
  }, [resetRun, resetCharts, resetFile, resetPanel, resetTokenUsage])

  const { setFile, checkCloudCache, extractChapters } = book
  // 设置文件后检查云缓存并提取章节（有缓存时仍取章，用户可选择直接用缓存）
  const handleFileSelect = useCallback(
    async (selectedFile: File) => {
      resetState()
      setFile(selectedFile)
      await checkCloudCache(selectedFile.name)
      await extractChapters(selectedFile)
    },
    [resetState, setFile, checkCloudCache, extractChapters]
  )

  const handleWebDAVFileSelect = useCallback(
    async (selectedFile: File) => {
      toast.success(t('webdav.fileSelected', { name: selectedFile.name }))
      await handleFileSelect(selectedFile)
    },
    [t, handleFileSelect]
  )

  /**
   * 后台补 epub：结果已经在屏上时，把源文件接上去（只设置文件 + 提取章节，**不清空**已有结果）。
   * 用于「最近处理」打开：云端缓存里只有总结，没有原文，读者想看原文时得先把 epub 拉下来。
   * 失败只记日志：原文是附加能力，不该影响已经显示的结果。
   */
  const attachSourceInBackground = useCallback(
    async (sourceFile: File, expectedGeneration?: number) => {
      // 代数必须在**下载开始时**捕获：取「此刻的代数再与自己比」是恒真的空转守卫，
      // 换书后迟到的 A 书会把 B 书的 file 覆盖掉（章节提取另有守卫，file 没有）。
      const generation = expectedGeneration ?? generationRef.current.current
      if (!generationRef.current.isCurrent(generation)) return
      setFile(sourceFile)
      await extractChapters(sourceFile)
    },
    [setFile, extractChapters, generationRef]
  )

  /** 取当前代数（后台任务开始时存下来，完成时回验是否仍是这一轮） */
  const captureGeneration = useCallback(() => generationRef.current.current, [])
  /** 代数是否仍是当前代（后台任务完成时回验） */
  const isGenerationCurrent = useCallback(
    (generation: number) => generationRef.current.isCurrent(generation),
    []
  )

  const { setIsWebDAVBrowserOpen } = reader
  const openWebDAVBrowser = useCallback(() => {
    if (!webdavEnabled) {
      toast.error(t('webdav.enableFirst'))
      return
    }
    if (!webdavService.isInitialized()) {
      toast.error(t('webdav.notInitialized'))
      return
    }
    setIsWebDAVBrowserOpen(true)
  }, [webdavEnabled, t, setIsWebDAVBrowserOpen])

  /** 云 / 历史加载共用：写结果态、提示、本地落盘 */
  const applyLoadedBook = useCallback(
    async (loaded: LoadedCloudBook, fileName: string | null, model: string) => {
      setBookSummary(loaded.summary)
      if (loaded.notices.includes('chartsParseFailed')) toast.warning(t('cloudCache.chartsParseFailed'))
      if (loaded.notices.includes('partial')) toast.warning(t('cloudCache.partialLoaded'))
      await persistLoadedBook(loaded, {
        fileName,
        mode: useConfigStore.getState().processingOptions.processingMode,
        fallbackModel: model,
      })
    },
    [t]
  )

  const { setCloud } = book
  // 从检查阶段读到的云端缓存加载
  const loadFromCloudCache = useCallback(async (): Promise<boolean> => {
    if (!cloud.content) return false
    const generation = generationRef.current.current
    const isStale = () => !generationRef.current.isCurrent(generation)
    try {
      const key = file?.name || cloudCacheKeyRef.current || cloud.metadata?.fileName || null
      if (key) cloudCacheKeyRef.current = key
      let snapshot: CloudSnapshot = { ...cloud, content: cloud.content }
      if (key) snapshot = await refreshChartsJson(key, snapshot)
      if (isStale()) return false
      setCloud((prev) => ({ ...prev, chartsJson: snapshot.chartsJson ?? null, chartsFileFound: !!snapshot.chartsFileFound }))

      const loaded = await buildCloudBook(snapshot, {
        fileName: key,
        fallbackTitle: file ? stripExt(file.name) : '',
        idPrefix: 'cloud',
      })
      if (isStale()) return false
      if (!loaded) {
        toast.error(t('cloudCache.parseError'))
        return false
      }
      toast.success(t(loaded.summary.charts ? 'cloudCache.loadedWithCharts' : 'cloudCache.loaded'))
      await applyLoadedBook(loaded, key, useConfigStore.getState().aiConfig.model)
      return true
    } catch (e) {
      logger.error('加载云端缓存失败:', e)
      toast.error(t('cloudCache.parseError'))
      return false
    }
  }, [cloud, file, cloudCacheKeyRef, setCloud, applyLoadedBook, t])

  /**
   * 按文件名从云端缓存恢复结果（**不需要本地文件**）。
   *
   * 「最近处理」与书库里「已精读」的书都走这里：先进结果，epub 随后在后台补——
   * 云缓存里只有总结与图表，epub 才是原文，但下载大文件不该挡在结果前面。
   */
  const loadCloudCacheByFileName = useCallback(
    async (
      fileName: string,
      opts?: { idPrefix?: 'history' | 'cloud'; fallbackTitle?: string; onError?: (key: string) => void }
    ): Promise<boolean> => {
      const generation = generationRef.current.current
      const isStale = () => !generationRef.current.isCurrent(generation)
      const fail = (key: string) => {
        opts?.onError?.(key)
        return false
      }
      try {
        const config = useConfigStore.getState().webdavConfig
        if (!config.enabled) return fail('history.webdavRequired')
        if (!webdavService.isInitialized()) {
          const init = await webdavService.initialize(config)
          if (isStale()) return false
          if (!init.success) return fail('history.webdavInitFailed')
        }
        const result = await cloudCacheService.readCache(fileName)
        if (isStale()) return false
        if (!result.success || !result.content) return fail('history.cacheNotFound')
        const snapshot: CloudSnapshot = {
          content: result.content,
          metadata: result.metadata,
          chartsJson: result.chartsJson,
          chartsFileFound: result.chartsFileFound,
        }
        const loaded = await buildCloudBook(snapshot, {
          fileName,
          fallbackTitle: opts?.fallbackTitle ?? stripExt(fileName),
          idPrefix: opts?.idPrefix ?? 'history',
        })
        if (isStale()) return false
        if (!loaded) return fail('history.cacheParseError')
        // 作废旧任务、释放旧书资源后写入结果；fileName 即云端缓存键
        resetState()
        cloudCacheKeyRef.current = fileName
        setCloud({
          metadata: loaded.metadata,
          content: result.content,
          isPartial: loaded.partial,
          statusUnknown: false,
          chartsJson: loaded.chartsJson,
          chartsFileFound: loaded.chartsFileFound,
        })
        await applyLoadedBook(loaded, fileName, 'unknown')
        return true
      } catch (error) {
        if (isStale()) return false
        logger.error('从云缓存加载失败:', error)
        return fail('history.loadError')
      }
    },
    [resetState, cloudCacheKeyRef, setCloud, applyLoadedBook]
  )

  // 从历史记录加载云端缓存
  const loadFromHistoryRecord = useCallback(
    async (fileName: string): Promise<boolean> => {
      const ok = await loadCloudCacheByFileName(fileName, {
        onError: (key) => toast.error(t(key)),
      })
      return ok
    },
    [t, loadCloudCacheByFileName]
  )

  /**
   * 「最近处理」打开：先把云端缓存里的结果加载出来（立刻能看），随后**在后台**把 epub 拉下来，
   * 让「原文」页签可用——用户不用等下载，大文件也不挡路。
   *
   * 为什么分两步：云缓存里只有总结与图表，epub 才是原文。先进结果再补原文，
   * 是「先给能给的，再补缺的」。
   */
  const loadFromHistoryWithSource = useCallback(
    async (
      fileName: string,
      opts?: { sourcePath?: string | null; fallbackTitle?: string; onError?: (key: string) => void }
    ): Promise<boolean> => {
      const ok = await loadCloudCacheByFileName(fileName, {
        idPrefix: 'history',
        fallbackTitle: opts?.fallbackTitle,
        onError: opts?.onError ?? ((key) => toast.error(t(key))),
      })
      if (!ok) return false
      // 后台补 epub：失败不影响已经显示的结果
      const path = opts?.sourcePath
      if (!path) return true
      void (async () => {
        try {
          const name = baseName(path)
          // 下载开始时记下代数：下载期间用户可能已经换书，回来时必须丢弃
          const generation = captureGeneration()
          const r = await webdavService.downloadFileAsFile(path, name)
          if (!r.success || !r.data) return
          if (!isGenerationCurrent(generation)) return
          await attachSourceInBackground(r.data, generation)
        } catch (e) {
          logger.warn('后台补原文失败:', e)
        }
      })()
      return true
    },
    [t, loadCloudCacheByFileName, attachSourceInBackground, captureGeneration, isGenerationCurrent]
  )

  const cacheFileNames = useCallback(
    () => [file?.name, cloudCacheKeyRef.current, cloud.metadata?.fileName],
    [file?.name, cloudCacheKeyRef, cloud.metadata?.fileName]
  )

  // 清除章节缓存：只删该章（按新键前缀），只重置该章状态
  const clearChapterCache = useCallback(
    (chapterId: string) => {
      runClear(getBookId().then((id) => clearChapterEntries(id, 'summary', chapterId)))
      setBookSummary((prev) => (prev ? clearChapterResult(prev, chapterId, 'summary') : prev))
      toast.success(t('cache.chapterCleared'))
    },
    [getBookId, t]
  )

  const clearChapterMindMapCache = useCallback(
    (chapterId: string) => {
      runClear(getBookId().then((id) => clearChapterEntries(id, 'mindmap', chapterId)))
      setBookMindMap((prev) => (prev ? clearChapterResult(prev, chapterId, 'mindmap') : prev))
      toast.success(t('cache.chapterCleared'))
    },
    [getBookId, t]
  )

  // 章节勾选状态由 useBookFile 的 useState 提供，setter 稳定，可安全作为依赖
  const setSelectedChapters = book.setSelectedChapters

  // 清除特定缓存（不依赖本地 File：历史/云端加载后也能清内存与本地副本）
  const clearSpecificCache = useCallback(
    (cacheType: string) => {
      const type = cacheType as SpecificCacheType

      // 「章节选择」不是磁盘缓存：它只存在于内存里，清它等于重置勾选。
      // 旧实现把 kind 置 null 后什么都没清，却仍弹「已清除」——假成功。
      if (type === 'selected_chapters') {
        setSelectedChapters(new Set())
        toast.success(t('cache.specificCleared'))
        return
      }

      const kind: CacheKind = type === 'merged_mindmap' ? 'combined_mindmap' : type
      runClear(getBookId().then((id) => clearKindEntries(id, kind, cacheFileNames())))

      if (type === 'connections') setBookSummary((p) => (p ? { ...p, connections: '' } : p))
      else if (type === 'overall_summary') setBookSummary((p) => (p ? { ...p, overallSummary: '' } : p))
      else if (type === 'key_charts') {
        // 始终清内存态，否则 UI 看起来「按钮无反应」
        setBookSummary((p) => (p ? { ...p, charts: null, chartsError: null } : p))
        setCloud((prev) => ({ ...prev, chartsJson: null, chartsFileFound: false }))
      } else if (kind === 'combined_mindmap') {
        setBookMindMap((p) => (p ? { ...p, combinedMindMap: null } : p))
      }
      toast.success(t('cache.specificCleared'))
    },
    [getBookId, cacheFileNames, setCloud, setSelectedChapters, t]
  )

  // 清除整书缓存
  const clearBookCache = useCallback(() => {
    if (!file) return
    runClear(getBookId().then((id) => clearBookEntries(id, cacheFileNames())))
    setBookSummary(null)
    setBookMindMap(null)
    toast.success(t('cache.bookCleared'))
  }, [file, getBookId, cacheFileNames, t])

  return {
    // 状态
    file,
    processing: run.processing,
    extractingChapters: book.extractingChapters,
    progress: run.progress,
    currentStep: run.currentStep,
    currentProcessingChapter: run.currentProcessingChapter,
    extractedChapters: book.extractedChapters,
    bookData: book.bookData,
    selectedChapters: book.selectedChapters,
    customPrompt,
    bookSummary,
    bookMindMap,
    expandedChapters: reader.expandedChapters,
    cloudCacheMetadata: cloud.metadata,
    isCheckingCloudCache: book.isCheckingCloudCache,
    cloudCacheContent: cloud.content,
    cloudCacheIsPartial: cloud.isPartial,
    cloudCacheStatusUnknown: cloud.statusUnknown,
    cloudChartsFileFound: cloud.chartsFileFound,
    chartsGenerating: charts.chartsGenerating,
    stepRunning: steps.stepRunning,
    rightPanelContent: reader.rightPanelContent,
    currentViewingChapter: reader.currentViewingChapter,
    currentViewingChapterSummary: reader.currentViewingChapterSummary,
    previewFontSize: reader.previewFontSize,
    isPreviewFullscreen: reader.isPreviewFullscreen,
    previewCardRef: reader.previewCardRef,
    isWebDAVBrowserOpen: reader.isWebDAVBrowserOpen,
    tokenUsage,
    processingMode,

    // 动作
    handleFileSelect,
    extractChapters,
    processBook: run.processBook,
    cancelProcessing: run.cancelProcessing,
    restartProcessing: run.restartProcessing,
    handleChapterSelect: book.handleChapterSelect,
    handleSelectAll: book.handleSelectAll,
    handleViewChapterContent: reader.handleViewChapterContent,
    handleCloseRightPanel: reader.handleCloseRightPanel,
    handleChapterExpandChange: reader.handleChapterExpandChange,
    clearChapterCache,
    clearChapterMindMapCache,
    clearSpecificCache,
    regenerateKeyCharts: charts.regenerateKeyCharts,
    retryBookStep: steps.retryBookStep,
    cancelKeyCharts: charts.cancelKeyCharts,
    clearBookCache,
    increasePreviewFontSize: reader.increasePreviewFontSize,
    decreasePreviewFontSize: reader.decreasePreviewFontSize,
    togglePreviewFullscreen: reader.togglePreviewFullscreen,
    loadFromCloudCache,
    handleWebDAVFileSelect,
    openWebDAVBrowser,
    handleChapterSummaryNavigation: reader.handleChapterSummaryNavigation,
    handleChapterNavigation: reader.handleChapterNavigation,
    loadFromHistoryRecord,
    loadFromHistoryWithSource,
    loadCloudCacheByFileName,
    attachSourceInBackground,
    captureGeneration,
    isGenerationCurrent,

    // 设置器
    setCustomPrompt,
    setSelectedChapters: book.setSelectedChapters,
    setIsWebDAVBrowserOpen,
    setBookSummary,
    setBookMindMap,
    setCurrentViewingChapterSummary,
    fullBookData: book.fullBookData,
  }
}
