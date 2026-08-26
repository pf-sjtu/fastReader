import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { EpubProcessor, type ChapterData, type BookData as EpubBookData } from '@/services/epubProcessor'
import { PdfProcessor, type BookData as PdfBookData } from '@/services/pdfProcessor'
import { AIService } from '@/services/aiService'
import { CacheService } from '@/services/cacheService'
import { cloudCacheService, type ProcessingMetadata } from '@/services/cloudCacheService'
import { autoSyncService } from '@/services/autoSyncService'
import { notificationService } from '@/services/notificationService'
import { webdavService } from '@/services/webdavService'
import type { MindElixirData } from 'mind-elixir'
import { useConfigStore } from '@/stores/configStore'
import { useProcessingHistoryStore } from '@/stores/processingHistory'
import { toast } from 'sonner'
import { matchesDefaultUnselectTitle } from '@/services/constants'
import { detectBookFormat } from '@/utils/file'
import { clampConcurrency, mapPoolOrdered } from '@/utils/async'
import { logger } from '@/lib/logger'
import {
  deserializeCharts,
  serializeCharts,
  type BookCharts,
} from '@/charts'

const epubProcessor = new EpubProcessor()
const pdfProcessor = new PdfProcessor()
const cacheService = new CacheService()

export interface Chapter {
  id: string
  title: string
  content: string
  summary?: string
  mindMap?: MindElixirData
  processed: boolean
}

export interface BookSummary {
  title: string
  author: string
  chapters: Chapter[]
  connections: string
  overallSummary: string
  /** 关键图表结构化数据（实体关系 + 时间线等） */
  charts?: BookCharts | null
  chartsError?: string | null
}

export interface BookMindMap {
  title: string
  author: string
  chapters: Chapter[]
  combinedMindMap?: MindElixirData | null
}

export interface RightPanelContent {
  type: 'chapter' | 'content'
  chapter: ChapterData
  title: string
}

export type ProcessingMode = 'summary' | 'mindmap' | 'combined-mindmap'

export function useBookProcessing() {
  const { t } = useTranslation()
  const {
    tokenUsage,
    addTokenUsage,
    resetTokenUsage,
    aiConfig,
    processingOptions,
    promptConfig,
    aiServiceOptions,
    webdavConfig
  } = useConfigStore()

  // 处理状态
  const [processing, setProcessing] = useState(false)
  const [extractingChapters, setExtractingChapters] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [currentProcessingChapter, setCurrentProcessingChapter] = useState('')
  const abortControllerRef = useRef<AbortController | null>(null)
  /** 处理代数：重启/新开跑时递增，防止旧任务完成后覆盖新状态 */
  const processGenerationRef = useRef(0)

  // 数据状态
  const [file, setFile] = useState<File | null>(null)
  const [extractedChapters, setExtractedChapters] = useState<ChapterData[] | null>(null)
  const [bookData, setBookData] = useState<{ title: string; author: string } | null>(null)
  const [fullBookData, setFullBookData] = useState<EpubBookData | PdfBookData | null>(null)
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [customPrompt, setCustomPrompt] = useState('')

  // 结果状态
  const [bookSummary, setBookSummary] = useState<BookSummary | null>(null)
  const [bookMindMap, setBookMindMap] = useState<BookMindMap | null>(null)
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())

  // 云端缓存状态
  const [cloudCacheMetadata, setCloudCacheMetadata] = useState<ProcessingMetadata | null>(null)
  const [isCheckingCloudCache, setIsCheckingCloudCache] = useState(false)
  const [cloudCacheContent, setCloudCacheContent] = useState<string | null>(null)
  /** 同名 .json 关键图表原文（检查云缓存时并行拉取） */
  const [cloudChartsJson, setCloudChartsJson] = useState<string | null>(null)
  const [cloudChartsFileFound, setCloudChartsFileFound] = useState(false)
  /** 加载存档后自动补生成图表 */
  const [chartsGenerating, setChartsGenerating] = useState(false)
  const chartsAutoGenRef = useRef(false)
  /** 标记：刚从云/历史加载且缺图表，待 bookSummary 落地后自动生成 */
  const pendingAutoChartsRef = useRef(false)
  /**
   * 云端存档文件名键（与 getCacheFilePath 入参一致，通常是 epub 原名或历史记录 fileName）。
   * 历史加载时本地可能没有 File，必须靠此 ref 才能自动上传图表 JSON。
   */
  const cloudCacheKeyRef = useRef<string | null>(null)

  // 右侧面板状态
  const [rightPanelContent, setRightPanelContent] = useState<RightPanelContent | null>(null)
  const [currentViewingChapter, setCurrentViewingChapter] = useState('')
  const [currentViewingChapterSummary, setCurrentViewingChapterSummary] = useState('')

  // 预览状态
  const [previewFontSize, setPreviewFontSize] = useState(16)
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false)
  const previewCardRef = useRef<HTMLDivElement>(null)

  // WebDAV浏览器状态
  const [isWebDAVBrowserOpen, setIsWebDAVBrowserOpen] = useState(false)

  const { processingMode, bookType, chapterNamingMode } = processingOptions

  // 获取提示词配置
  const getPromptConfig = useCallback(() => useConfigStore.getState().promptConfig, [])

  // 重置所有状态
  const resetState = useCallback(() => {
    setExtractedChapters(null)
    setBookData(null)
    setSelectedChapters(new Set())
    setBookSummary(null)
    setBookMindMap(null)
    setRightPanelContent(null)
    setFullBookData(null)
    setCurrentProcessingChapter('')
    setCurrentViewingChapter('')
    setCurrentViewingChapterSummary('')
    setExpandedChapters(new Set())
    setCloudCacheMetadata(null)
    setCloudCacheContent(null)
    setCloudChartsJson(null)
    setCloudChartsFileFound(false)
    setChartsGenerating(false)
    chartsAutoGenRef.current = false
    pendingAutoChartsRef.current = false
    setCustomPrompt('')
    resetTokenUsage()
  }, [resetTokenUsage])

  // 提取章节（可传入 file，避免 setState 异步导致闭包拿到旧文件）
  const extractChapters = useCallback(async (overrideFile?: File) => {
    const targetFile = overrideFile || file
    if (!targetFile) return

    setExtractingChapters(true)
    try {
      let bookDataResult: (EpubBookData | PdfBookData) & { chapters: ChapterData[] }
      let chapters: ChapterData[]

      const format = detectBookFormat(targetFile)
      if (format === 'epub') {
        bookDataResult = await epubProcessor.extractBookData(
          targetFile,
          processingOptions.useSmartDetection,
          processingOptions.skipNonEssentialChapters,
          processingOptions.maxSubChapterDepth,
          processingOptions.chapterNamingMode,
          processingOptions.chapterDetectionMode,
          processingOptions.epubTocDepth
        )
        chapters = bookDataResult.chapters
      } else if (format === 'pdf') {
        bookDataResult = await pdfProcessor.extractBookData(
          targetFile,
          processingOptions.useSmartDetection,
          processingOptions.skipNonEssentialChapters,
          processingOptions.maxSubChapterDepth,
          processingOptions.chapterNamingMode,
          processingOptions.chapterDetectionMode,
          processingOptions.epubTocDepth
        )
        chapters = bookDataResult.chapters
      } else {
        const hint = targetFile.name
          ? `不支持的文件格式: ${targetFile.name}（仅支持 .epub / .pdf）`
          : '不支持的文件格式（仅支持 .epub / .pdf）'
        throw new Error(t('upload.unsupportedFormat', { defaultValue: hint }))
      }

      setFullBookData(bookDataResult)
      setExtractedChapters(chapters)
      setBookData({
        title: bookDataResult.title,
        author: bookDataResult.author
      })

      // 默认勾选正文类；忽略类关键词（作者简介/致谢/版权等）默认不勾选
      const defaultSelected = chapters
        .filter((ch) => !matchesDefaultUnselectTitle(ch.title))
        .map((ch) => ch.id)
      setSelectedChapters(
        new Set(defaultSelected.length > 0 ? defaultSelected : chapters.map((ch) => ch.id))
      )

      toast.success(t('upload.chaptersExtracted', { count: chapters.length }))
    } catch (error) {
      console.error('提取章节错误:', error)
      toast.error(error instanceof Error ? error.message : t('upload.extractError'))
    } finally {
      setExtractingChapters(false)
    }
  }, [file, processingOptions, t])

  // 设置文件后自动检查云缓存并提取章节
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    resetState()
    setFile(selectedFile)

    // 先查云缓存（有缓存时仍自动取章，用户可选择直接用缓存）
    if (webdavConfig.enabled && webdavService.isInitialized()) {
      await checkCloudCache(selectedFile.name)
    }

    await extractChapters(selectedFile)
  }, [resetState, webdavConfig.enabled, extractChapters])

  // 检查云端缓存（MD + 同名 JSON）
  const checkCloudCache = useCallback(async (fileName: string) => {
    setCloudCacheMetadata(null)
    setCloudCacheContent(null)
    setCloudChartsJson(null)
    setCloudChartsFileFound(false)
    cloudCacheKeyRef.current = fileName

    if (!webdavConfig.enabled || !webdavService.isInitialized()) {
      return false
    }

    setIsCheckingCloudCache(true)
    try {
      const result = await cloudCacheService.readCache(fileName)

      if (result.success && result.content) {
        setCloudCacheMetadata(result.metadata || null)
        setCloudCacheContent(result.content)
        setCloudChartsJson(result.chartsJson ?? null)
        setCloudChartsFileFound(!!result.chartsFileFound)
        setIsCheckingCloudCache(false)
        return true
      }

      setIsCheckingCloudCache(false)
      return false
    } catch (error) {
      console.error('[App] 检查云端缓存失败:', error)
      setIsCheckingCloudCache(false)
      return false
    }
  }, [webdavConfig.enabled])

  /**
   * 解析关键图表：优先同名 JSON → MD 内嵌段 → 本地 key_charts
   */
  const resolveChartsFromCloudSources = useCallback(
    (
      mdContent: string,
      chartsJson: string | null | undefined,
      cacheFileKey?: string | null
    ): BookCharts | null => {
      // 1) 同名 .json
      if (chartsJson?.trim()) {
        const fromJson = deserializeCharts(chartsJson)
        if (fromJson) return fromJson
        console.warn('[charts] 云端 JSON 解析失败，尝试 MD 内嵌')
      }
      // 2) MD ## 关键图表
      const parsed = cloudCacheService.parseUnifiedContent(mdContent)
      if (parsed.charts) {
        const fromMd = deserializeCharts(JSON.stringify(parsed.charts))
        if (fromMd) return fromMd
      }
      // 3) 本地缓存
      if (cacheFileKey) {
        const local = cacheService.getString(cacheFileKey, 'key_charts')
        if (local) {
          const fromLocal = deserializeCharts(local)
          if (fromLocal) return fromLocal
        }
      }
      return null
    },
    []
  )

  // 从云端缓存加载（写入结果态，与历史加载对齐）
  // 异步：加载时再拉一次同名 JSON，避免仅依赖可能过期的 state
  const loadFromCloudCache = useCallback(async (): Promise<boolean> => {
    if (!cloudCacheContent) return false

    try {
      const parsed = cloudCacheService.parseUnifiedContent(cloudCacheContent)
      if (!parsed.chapters.length && !parsed.overallSummary) {
        toast.error(t('cloudCache.parseError') || t('history.cacheParseError'))
        return false
      }

      const cacheKey =
        file?.name ||
        cloudCacheKeyRef.current ||
        cloudCacheMetadata?.fileName ||
        null
      if (cacheKey) {
        cloudCacheKeyRef.current = cacheKey
      }

      // 优先现场读取同名 JSON（不依赖 check 阶段写入的 state）
      let chartsJson = cloudChartsJson
      let chartsFileFound = cloudChartsFileFound
      if (cacheKey) {
        try {
          const fresh = await cloudCacheService.readChartsJson(cacheKey)
          if (fresh.found) {
            chartsFileFound = true
            if (fresh.content?.trim()) {
              chartsJson = fresh.content
              setCloudChartsJson(fresh.content)
            }
          }
          setCloudChartsFileFound(fresh.found)
          console.log(
            `[loadFromCloudCache] charts JSON path try: found=${fresh.found}, len=${fresh.content?.length ?? 0}`
          )
        } catch (e) {
          console.warn('[loadFromCloudCache] 再读图表 JSON 失败:', e)
        }
      }

      const charts = resolveChartsFromCloudSources(
        cloudCacheContent,
        chartsJson,
        cacheKey
      )

      const summary: BookSummary = {
        title: parsed.title || file?.name.replace(/\.[^/.]+$/, '') || '',
        author: parsed.author || '',
        chapters: parsed.chapters.map((ch, index) => ({
          id: `cloud-${index}`,
          title: ch.title,
          content: '',
          summary: ch.summary,
          processed: true
        })),
        connections: parsed.connections,
        overallSummary: parsed.overallSummary,
        charts,
        chartsError: null,
      }

      setBookSummary(summary)

      // 本地缓存：章节/关联/全书/图表一并落盘
      if (file) {
        summary.chapters.forEach((ch) => {
          if (ch.summary) {
            cacheService.setCache(file.name, 'summary', ch.summary, ch.id)
          }
        })
        if (summary.connections) {
          cacheService.setCache(file.name, 'connections', summary.connections)
        }
        if (summary.overallSummary) {
          cacheService.setCache(file.name, 'overall_summary', summary.overallSummary)
        }
        if (charts) {
          cacheService.setCache(file.name, 'key_charts', serializeCharts(charts))
        }

        useProcessingHistoryStore.getState().addRecord({
          bookTitle: summary.title,
          fileName: file.name,
          processingMode,
          model: cloudCacheMetadata?.model || aiConfig.model,
          chapterCount: parsed.chapters.length
        })
      }

      if (charts) {
        // 已有图表：禁止自动再生成
        pendingAutoChartsRef.current = false
        toast.success(t('cloudCache.loadedWithCharts', '已加载云端缓存（含关键图表）'))
      } else if (chartsFileFound) {
        // JSON 文件在但解析失败：不自动重跑，避免覆盖好文件
        pendingAutoChartsRef.current = false
        toast.success(t('cloudCache.loaded'))
        toast.warning(
          t(
            'cloudCache.chartsParseFailed',
            '云端图表 JSON 存在但解析失败，可手动点「重新生成图表」'
          )
        )
      } else {
        toast.success(t('cloudCache.loaded'))
        const canAuto =
          !!summary.overallSummary &&
          !summary.overallSummary.startsWith('【全书总结失败】') &&
          summary.chapters.length > 0
        // 仅当确认云端无 JSON 文件时才自动生成
        pendingAutoChartsRef.current = canAuto
      }
      return true
    } catch (e) {
      console.error('加载云端缓存失败:', e)
      toast.error(t('cloudCache.parseError') || t('history.cacheParseError'))
      return false
    }
  }, [
    cloudCacheContent,
    cloudChartsJson,
    cloudChartsFileFound,
    cloudCacheMetadata,
    file,
    processingMode,
    aiConfig.model,
    t,
    resolveChartsFromCloudSources,
  ])

  // 章节选择处理
  const handleChapterSelect = useCallback((chapterId: string, checked: boolean) => {
    setSelectedChapters(prev => {
      const newSet = new Set(prev)
      if (checked) {
        newSet.add(chapterId)
      } else {
        newSet.delete(chapterId)
      }
      return newSet
    })
  }, [])

  // 全选/取消全选
  const handleSelectAll = useCallback((checked: boolean) => {
    if (!extractedChapters) return

    if (checked) {
      setSelectedChapters(new Set(extractedChapters.map(ch => ch.id)))
    } else {
      setSelectedChapters(new Set())
    }
  }, [extractedChapters])

  // 查看章节内容
  const handleViewChapterContent = useCallback((chapter: ChapterData) => {
    setRightPanelContent({
      type: 'content',
      chapter,
      title: chapter.title
    })
    setCurrentViewingChapter(chapter.id)
  }, [])

  // 关闭右侧面板
  const handleCloseRightPanel = useCallback(() => {
    setRightPanelContent(null)
    setCurrentViewingChapter('')
  }, [])

  // 章节展开状态变化
  const handleChapterExpandChange = useCallback((chapterId: string, isExpanded: boolean) => {
    setExpandedChapters(prev => {
      const newSet = new Set(prev)
      if (isExpanded) {
        newSet.add(chapterId)
      } else {
        newSet.delete(chapterId)
      }
      return newSet
    })
  }, [])

  /**
   * 进度条权重（与文案「第 x/n 章」对齐）：
   * - 章节循环占绝大部分（summary 0–80%，mindmap 0–85%）
   * - 后处理（关联/全书总结/整书导图）占剩余
   * 旧公式「10 + done*30/total」在 15/16 章时只有约 36%，易误解。
   */
  const chapterPhaseProgress = (done: number, total: number, phaseMax: number) => {
    if (total <= 0) return 0
    return Math.min(phaseMax, Math.round((done / total) * phaseMax))
  }

  // 处理书籍
  const processBook = useCallback(async () => {
    if (!file || !extractedChapters || selectedChapters.size === 0) return

    // 新开跑：作废旧任务
    const generation = ++processGenerationRef.current
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller
    const isCurrentRun = () =>
      generation === processGenerationRef.current && !controller.signal.aborted
    const throwIfAborted = () => {
      if (!isCurrentRun()) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        throw err
      }
    }

    setProcessing(true)
    setProgress(0)
    setCurrentStep(t('progress.startProcessing'))

    try {
      resetTokenUsage()

      const aiService = new AIService(aiConfig, getPromptConfig, {
        onTokenUsage: addTokenUsage,
        ...aiServiceOptions
      })
      const selectedChapterData = extractedChapters.filter(ch => selectedChapters.has(ch.id))
      const totalChapters = selectedChapterData.length
      let postPhaseWarning = false

      // 章节并行上限（可配置，默认 3）；结果按选择顺序有序提交，不扰乱呈现
      const chapterConcurrency = clampConcurrency(
        processingOptions.chapterConcurrency ?? 3
      )

      if (processingMode === 'summary') {
        // 章节总结：0–80%；关联/全书为后处理（失败不丢章）
        const CHAPTER_PHASE_MAX = 80
        setCurrentStep(t('progress.generatingSummaries'))
        setProgress(0)

        const initialSummary: BookSummary = {
          title: bookData?.title || '',
          author: bookData?.author || '',
          chapters: [],
          connections: '',
          overallSummary: ''
        }
        setBookSummary(initialSummary)

        let orderedDone = 0
        let anyChapterFailed = false

        const processedChapters = await mapPoolOrdered(
          selectedChapterData,
          async (chapter) => {
            throwIfAborted()
            setCurrentProcessingChapter(chapter.id)
            setCurrentStep(
              t('progress.processingChapter', {
                current: orderedDone + 1,
                total: totalChapters,
                title: chapter.title,
              })
            )

            let summary: string
            try {
              summary = await aiService.summarizeChapter(
                chapter.title,
                chapter.content,
                bookType,
                processingOptions.outputLanguage,
                customPrompt
              )
            } catch (chapterErr) {
              throwIfAborted()
              logger.error(`[processBook] 章节失败: ${chapter.title}`, chapterErr)
              summary = `【处理失败】${chapterErr instanceof Error ? chapterErr.message : '未知错误'}`
              anyChapterFailed = true
            }

            throwIfAborted()
            return {
              id: chapter.id,
              title: chapter.title,
              content: chapter.content,
              summary,
              processed: true,
            } as Chapter
          },
          {
            concurrency: chapterConcurrency,
            onOrderedResult: (processedChapter, index) => {
              orderedDone = index + 1
              setBookSummary((prev) => ({
                ...prev!,
                chapters: [...(prev?.chapters ?? []), processedChapter],
              }))
              setProgress(
                chapterPhaseProgress(orderedDone, totalChapters, CHAPTER_PHASE_MAX)
              )
              setCurrentStep(
                t('progress.processingChapter', {
                  current: Math.min(orderedDone + 1, totalChapters),
                  total: totalChapters,
                  title:
                    selectedChapterData[
                      Math.min(orderedDone, totalChapters - 1)
                    ]?.title ?? processedChapter.title,
                })
              )
            },
          }
        )

        if (anyChapterFailed) postPhaseWarning = true
        setCurrentProcessingChapter('')

        // —— 后处理：关联 + 全书总结（独立容错，失败仍保留章节结果）——
        let connections = ''
        let overallSummary = ''

        try {
          throwIfAborted()
          setCurrentStep(t('progress.analyzingConnections'))
          setProgress(85)
          connections = await aiService.analyzeConnections(
            processedChapters,
            processingOptions.outputLanguage
          )
        } catch (postErr) {
          throwIfAborted()
          console.error('[processBook] 关联分析失败:', postErr)
          connections = `【关联分析失败】${postErr instanceof Error ? postErr.message : '未知错误'}`
          postPhaseWarning = true
          toast.warning(t('progress.postPhaseConnectionsFailed') || '章节已完成，但关联分析失败')
        }

        try {
          throwIfAborted()
          setCurrentStep(t('progress.generatingOverallSummary'))
          setProgress(90)
          overallSummary = await aiService.generateOverallSummary(
            bookData?.title || '',
            processedChapters,
            connections,
            processingOptions.outputLanguage
          )
        } catch (postErr) {
          throwIfAborted()
          console.error('[processBook] 全书总结失败:', postErr)
          overallSummary = `【全书总结失败】${postErr instanceof Error ? postErr.message : '未知错误'}`
          postPhaseWarning = true
          toast.warning(t('progress.postPhaseOverallFailed') || '章节已完成，但全书总结失败')
        }

        // —— 关键图表（仅全书总结成功时自动抽取，soft-fail）——
        let charts: BookCharts | null = null
        let chartsError: string | null = null
        const overallOk =
          overallSummary &&
          !overallSummary.startsWith('【全书总结失败】') &&
          overallSummary.trim().length > 0

        if (overallOk) {
          try {
            throwIfAborted()
            setCurrentStep(t('progress.generatingKeyCharts') || '正在生成关键图表…')
            setProgress(96)
            charts = await aiService.generateKeyCharts(
              bookData?.title || '',
              processedChapters,
              connections.startsWith('【关联分析失败】') ? '' : connections,
              overallSummary,
              processingOptions.outputLanguage
            )
            // 本地必存
            cacheService.setCache(file.name, 'key_charts', serializeCharts(charts))
          } catch (postErr) {
            throwIfAborted()
            console.error('[processBook] 关键图表失败:', postErr)
            chartsError = postErr instanceof Error ? postErr.message : '未知错误'
            postPhaseWarning = true
            toast.warning(t('progress.postPhaseChartsFailed') || '章节已完成，但关键图表生成失败')
          }
        }

        throwIfAborted()

        const summary: BookSummary = {
          title: bookData?.title || '',
          author: bookData?.author || '',
          chapters: processedChapters,
          connections,
          overallSummary,
          charts,
          chartsError,
        }

        setBookSummary(summary)

        // 保存缓存
        processedChapters.forEach(chapter => {
          if (chapter.summary && !chapter.summary.startsWith('【处理失败】')) {
            cacheService.setCache(file.name, 'summary', chapter.summary, chapter.id)
          }
        })
        if (connections && !connections.startsWith('【关联分析失败】')) {
          cacheService.setCache(file.name, 'connections', connections)
        }
        if (overallSummary && !overallSummary.startsWith('【全书总结失败】')) {
          cacheService.setCache(file.name, 'overall_summary', overallSummary)
        }

        // 云端 MD：仍受 autoSync 开关控制（用完整 file.name，与读取路径一致）
        try {
          await autoSyncService.syncSummary(summary, file.name, chapterNamingMode)
        } catch (error) {
          console.error('自动同步失败:', error)
          toast.warning(t('progress.syncFailed') || '结果已生成，但云端同步失败')
        }

        // 关键图表 JSON：WebDAV 开启则强制落盘（读 store，不依赖闭包 / autoSync）
        const davOn = useConfigStore.getState().webdavConfig.enabled
        if (charts && davOn) {
          cloudCacheKeyRef.current = file.name
          try {
            logger.debug('[processBook] → syncChartsJson', file.name)
            const chartsSaved = await autoSyncService.syncChartsJson(file.name, charts)
            logger.debug('[processBook] ← syncChartsJson', chartsSaved)
            if (!chartsSaved.success) {
              logger.warn('[processBook] 图表 JSON 未保存到云端:', chartsSaved.error)
              toast.warning(
                t(
                  'progress.chartsCloudSaveFailed',
                  '关键图表已生成，但云端 JSON 保存失败（可点重新生成或云端上传）'
                ) + (chartsSaved.error ? `: ${chartsSaved.error}` : '')
              )
            }
          } catch (e) {
            logger.warn('[processBook] 图表 JSON 保存异常:', e)
            toast.warning(
              t(
                'progress.chartsCloudSaveFailed',
                '关键图表已生成，但云端 JSON 保存失败（可点重新生成或云端上传）'
              )
            )
          }
        } else {
          logger.debug('[processBook] skip charts upload', { hasCharts: !!charts, davOn })
        }
      } else if (processingMode === 'mindmap' || processingMode === 'combined-mindmap') {
        // 章节导图：0–85%；整书导图 85–100%
        const CHAPTER_PHASE_MAX = processingMode === 'combined-mindmap' ? 85 : 95
        setCurrentStep(t('progress.generatingMindMaps'))
        setProgress(0)

        const initialMindMap: BookMindMap = {
          title: bookData?.title || '',
          author: bookData?.author || '',
          chapters: [],
          combinedMindMap: null
        }
        setBookMindMap(initialMindMap)

        let orderedDone = 0
        let anyChapterFailed = false

        const processedChapters = await mapPoolOrdered(
          selectedChapterData,
          async (chapter) => {
            throwIfAborted()
            setCurrentProcessingChapter(chapter.id)
            setCurrentStep(
              t('progress.processingChapter', {
                current: orderedDone + 1,
                total: totalChapters,
                title: chapter.title,
              })
            )

            let mindMap: MindElixirData | null = null
            try {
              mindMap = await aiService.generateChapterMindMap(
                chapter.title,
                chapter.content,
                processingOptions.outputLanguage
              )
            } catch (chapterErr) {
              throwIfAborted()
              logger.error(`[processBook] 导图章节失败: ${chapter.title}`, chapterErr)
              anyChapterFailed = true
            }

            throwIfAborted()
            return {
              id: chapter.id,
              title: chapter.title,
              content: chapter.content,
              mindMap: mindMap ?? undefined,
              processed: mindMap != null,
            } as Chapter
          },
          {
            concurrency: chapterConcurrency,
            onOrderedResult: (processedChapter, index) => {
              orderedDone = index + 1
              setBookMindMap((prev) => ({
                ...prev!,
                chapters: [...(prev?.chapters ?? []), processedChapter],
              }))
              setProgress(
                chapterPhaseProgress(orderedDone, totalChapters, CHAPTER_PHASE_MAX)
              )
              setCurrentStep(
                t('progress.processingChapter', {
                  current: Math.min(orderedDone + 1, totalChapters),
                  total: totalChapters,
                  title:
                    selectedChapterData[
                      Math.min(orderedDone, totalChapters - 1)
                    ]?.title ?? processedChapter.title,
                })
              )
            },
          }
        )

        if (anyChapterFailed) postPhaseWarning = true
        setCurrentProcessingChapter('')

        // 生成整书思维导图（容错）
        let combinedMindMap: MindElixirData | null = null

        if (processingMode === 'combined-mindmap') {
          try {
            throwIfAborted()
            setCurrentStep(t('progress.generatingCombinedMindMap'))
            setProgress(90)

            const chaptersForCombined = processedChapters.map((ch) => ({
              ...ch,
              summary:
                ch.summary ||
                (ch.mindMap && typeof ch.mindMap === 'object' && 'nodeData' in ch.mindMap
                  ? String((ch.mindMap as { nodeData?: { topic?: string } }).nodeData?.topic || '')
                  : '') ||
                ch.title
            }))

            combinedMindMap = await aiService.generateCombinedMindMap(
              bookData?.title || '',
              chaptersForCombined,
              processingOptions.outputLanguage
            )
          } catch (postErr) {
            throwIfAborted()
            console.error('[processBook] 整书导图失败:', postErr)
            postPhaseWarning = true
            toast.warning(t('progress.postPhaseCombinedFailed') || '章节导图已完成，但整书导图失败')
          }
        }

        throwIfAborted()

        const mindMapResult: BookMindMap = {
          title: bookData?.title || '',
          author: bookData?.author || '',
          chapters: processedChapters,
          combinedMindMap
        }

        setBookMindMap(mindMapResult)

        processedChapters.forEach(chapter => {
          if (chapter.mindMap) {
            cacheService.setCache(file.name, 'mindmap', chapter.mindMap, chapter.id)
          }
        })
        if (combinedMindMap) {
          cacheService.setCache(file.name, 'combined_mindmap', combinedMindMap)
        }

        try {
          const fileName = file.name.replace(/\.[^/.]+$/, '')
          await autoSyncService.syncMindMap(mindMapResult, fileName)
        } catch (error) {
          console.error('自动同步失败:', error)
          toast.warning(t('progress.syncFailed') || '结果已生成，但云端同步失败')
        }
      } else {
        throw new Error(`未知处理模式: ${processingMode}`)
      }

      if (!isCurrentRun()) return

      setProgress(100)
      setCurrentStep(t('progress.completed'))

      try {
        useProcessingHistoryStore.getState().addRecord({
          bookTitle: bookData?.title || file.name.replace(/\.[^/.]+$/, ''),
          fileName: file.name,
          processingMode,
          model: aiConfig.model,
          chapterCount: selectedChapterData.length
        })
      } catch (e) {
        console.error('记录处理历史失败:', e)
      }

      if (postPhaseWarning) {
        toast.success(t('progress.completedWithWarnings') || '处理完成（部分后处理失败，章节结果已保留）')
      } else {
        toast.success(t('progress.processingCompleted'))
      }

      if (processingOptions.enableNotification) {
        await notificationService.sendTaskCompleteNotification(
          t('progress.bookProcessing'),
          bookData?.title
        )
      }
    } catch (error) {
      // 被更新一轮处理取代：静默退出
      if (generation !== processGenerationRef.current) {
        return
      }
      if (error instanceof Error && error.name === 'AbortError') {
        setCurrentStep(t('progress.cancelled'))
        toast.info(t('progress.cancelledHint') || '已中止。可返回配置修改设置后重新开始，或直接重新处理。', {
          duration: 5000,
        })
      } else {
        toast.error(error instanceof Error ? error.message : t('progress.processingError'), {
          duration: 5000,
          position: 'top-center',
        })

        if (processingOptions.enableNotification) {
          await notificationService.sendErrorNotification(
            error instanceof Error ? error.message : t('progress.processingError')
          )
        }
      }
    } finally {
      if (generation === processGenerationRef.current) {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null
        }
        setProcessing(false)
        setCurrentProcessingChapter('')
      }
    }
  }, [
    file, extractedChapters, selectedChapters, bookData, aiConfig,
    processingOptions, processingMode, bookType, chapterNamingMode,
    customPrompt, t, getPromptConfig, addTokenUsage, resetTokenUsage,
    aiServiceOptions
  ])

  // 中止处理（当前章请求仍可能跑完，之后不再进入下一章）
  const cancelProcessing = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setProcessing(false)
    setCurrentProcessingChapter('')
    setCurrentStep(t('progress.cancelled'))
    toast.info(t('progress.cancelledHint') || '已请求中止，当前章节结束后停止。可改设置后重新处理。')
  }, [t])

  /**
   * 重新开始处理：中止进行中的任务，清空结果后按当前配置再跑。
   * 调用方应先切到结果页（或保持在结果页）。
   */
  const restartProcessing = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      // 等一拍让旧 processBook 退出，避免双跑
      await new Promise((r) => setTimeout(r, 50))
    }
    setBookSummary(null)
    setBookMindMap(null)
    setProgress(0)
    setCurrentStep('')
    setExpandedChapters(new Set())
    setCurrentViewingChapterSummary('')
    await processBook()
  }, [processBook])

  // 清除章节缓存
  const clearChapterCache = useCallback((chapterId: string) => {
    if (!file) return

    const summary = cacheService.getSummary(file.name)
    if (summary && summary.chapters) {
      const chapter = summary.chapters.find((ch: any) => ch.id === chapterId)
      if (chapter) {
        chapter.processed = false
        chapter.summary = undefined
        cacheService.setCache(file.name, 'summary', summary)
        setBookSummary(summary)
        toast.success(t('cache.chapterCleared'))
      }
    }
  }, [file, t])

  // 清除章节思维导图缓存
  const clearChapterMindMapCache = useCallback((chapterId: string) => {
    if (!file) return

    const mindMap = cacheService.getCache(file.name, 'mindmap')
    if (mindMap && mindMap.chapters) {
      const chapter = mindMap.chapters.find((ch: any) => ch.id === chapterId)
      if (chapter) {
        chapter.processed = false
        chapter.mindMap = undefined
        cacheService.setCache(file.name, 'mindmap', mindMap)
        setBookMindMap(mindMap)
        toast.success(t('cache.chapterCleared'))
      }
    }
  }, [file, t])

  // 清除特定缓存（不依赖本地 File：历史/云端加载后也能清内存与 localStorage）
  const clearSpecificCache = useCallback((cacheType: string) => {
    const cacheKey =
      file?.name || cloudCacheKeyRef.current || cloudCacheMetadata?.fileName || null

    if (cacheKey) {
      cacheService.clearSpecificCache(
        cacheKey,
        cacheType as
          | 'connections'
          | 'overall_summary'
          | 'key_charts'
          | 'combined_mindmap'
          | 'merged_mindmap'
          | 'selected_chapters'
      )
      // 兼容：云端键与 epub 名不一致时多清一次
      if (file?.name && cloudCacheKeyRef.current && file.name !== cloudCacheKeyRef.current) {
        cacheService.clearSpecificCache(
          cloudCacheKeyRef.current,
          cacheType as
            | 'connections'
            | 'overall_summary'
            | 'key_charts'
            | 'combined_mindmap'
            | 'merged_mindmap'
            | 'selected_chapters'
        )
      }
    }

    if (cacheType === 'connections' && bookSummary) {
      setBookSummary({ ...bookSummary, connections: '' })
    } else if (cacheType === 'overall_summary' && bookSummary) {
      setBookSummary({ ...bookSummary, overallSummary: '' })
    } else if (cacheType === 'key_charts') {
      // 始终清内存态，否则 UI 看起来「按钮无反应」
      if (bookSummary) {
        setBookSummary({ ...bookSummary, charts: null, chartsError: null })
      }
      setCloudChartsJson(null)
      setCloudChartsFileFound(false)
      // 避免立刻被「缺图自动生成」又写回来
      pendingAutoChartsRef.current = false
      chartsAutoGenRef.current = false
    } else if (cacheType === 'combined_mindmap' && bookMindMap) {
      setBookMindMap({ ...bookMindMap, combinedMindMap: null })
    } else if (cacheType === 'merged_mindmap' && bookMindMap) {
      setBookMindMap({ ...bookMindMap, combinedMindMap: null })
    }

    toast.success(t('cache.specificCleared', '已清除缓存'))
  }, [file, bookSummary, bookMindMap, cloudCacheMetadata?.fileName, t])

  /** 解析云端图表上传用的文件名键（与 getCacheFilePath 入参一致） */
  const resolveChartsUploadKey = useCallback(
    (explicit?: string | null): string | null => {
      const candidates = [
        explicit,
        file?.name,
        cloudCacheKeyRef.current,
        cloudCacheMetadata?.fileName,
      ]
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim()
      }
      return null
    },
    [file?.name, cloudCacheMetadata?.fileName]
  )

  /**
   * 生成关键图表（可传入 summary 快照，避免 setState 异步导致用旧数据）
   * @param silent 自动补全时少弹成功 toast
   */
  const runKeyChartsGeneration = useCallback(
    async (
      source: BookSummary,
      options?: { silent?: boolean; cacheFileName?: string | null }
    ) => {
      console.log('[runKeyChartsGeneration] start', {
        silent: !!options?.silent,
        optionKey: options?.cacheFileName,
        fileName: file?.name,
        refKey: cloudCacheKeyRef.current,
        metaKey: cloudCacheMetadata?.fileName,
        webdavEnabled: useConfigStore.getState().webdavConfig.enabled,
      })

      if (!source.overallSummary || source.overallSummary.startsWith('【全书总结失败】')) {
        if (!options?.silent) {
          toast.error(t('results.charts.needOverall', '请先完成全书总结后再生成图表'))
        }
        return
      }
      if (!source.chapters?.length) {
        if (!options?.silent) {
          toast.error(t('results.charts.needChapters', '缺少章节摘要'))
        }
        return
      }
      if (chartsAutoGenRef.current) {
        console.warn('[runKeyChartsGeneration] skipped: already running')
        if (!options?.silent) {
          toast.message(t('results.charts.busy', '关键图表正在生成中，请稍候…'))
        }
        return
      }
      chartsAutoGenRef.current = true
      setChartsGenerating(true)
      setBookSummary((prev) =>
        prev ? { ...prev, chartsError: null } : prev
      )

      const toastId = toast.loading(
        t('progress.generatingKeyCharts') || '正在生成关键图表…'
      )

      try {
        const aiService = new AIService(aiConfig, getPromptConfig, {
          onTokenUsage: addTokenUsage,
          ...aiServiceOptions,
        })

        console.log('[runKeyChartsGeneration] calling AI generateKeyCharts…')
        const charts = await aiService.generateKeyCharts(
          source.title || '',
          source.chapters,
          source.connections?.startsWith('【关联分析失败】')
            ? ''
            : source.connections || '',
          source.overallSummary,
          processingOptions.outputLanguage
        )
        console.log('[runKeyChartsGeneration] AI done', {
          nodes: charts?.entityGraph?.nodes?.length ?? 0,
          events: charts?.entityTimeline?.events?.length ?? 0,
        })

        const nextSummary: BookSummary = {
          ...source,
          charts,
          chartsError: null,
        }

        const cacheName = resolveChartsUploadKey(options?.cacheFileName)
        if (cacheName) {
          cloudCacheKeyRef.current = cacheName
          cacheService.setCache(cacheName, 'key_charts', serializeCharts(charts))
        }
        setBookSummary((prev) => {
          // 若用户已换书，勿覆盖
          if (prev && prev.title === source.title) {
            return { ...prev, charts, chartsError: null }
          }
          if (!prev) return nextSummary
          return { ...prev, charts, chartsError: null }
        })

        // 云端上传：运行时读 store，避免闭包里 enabled 过期；不依赖 autoSync 开关
        let chartsCloudOk = false
        let chartsCloudErr: string | undefined
        const dav = useConfigStore.getState().webdavConfig
        console.log('[runKeyChartsGeneration] upload gate', {
          cacheName,
          enabled: dav.enabled,
          hasServer: !!dav.serverUrl,
          hasUser: !!dav.username,
        })

        if (!cacheName) {
          chartsCloudErr = '缺少文件名，无法定位云端路径'
          console.warn('[runKeyChartsGeneration] skip upload: no cacheName', {
            optionKey: options?.cacheFileName,
            fileName: file?.name,
            refKey: cloudCacheKeyRef.current,
            metaKey: cloudCacheMetadata?.fileName,
          })
        } else if (!dav.enabled) {
          chartsCloudErr = 'WebDAV 未启用'
          console.warn('[runKeyChartsGeneration] skip upload: WebDAV disabled')
        } else {
          try {
            console.log(
              '[runKeyChartsGeneration] → syncChartsJson start, cacheName=',
              cacheName
            )
            const chartsOnly = await autoSyncService.syncChartsJson(cacheName, charts)
            chartsCloudOk = chartsOnly.success
            chartsCloudErr = chartsOnly.error
            console.log('[runKeyChartsGeneration] ← syncChartsJson result', chartsOnly)
            if (!chartsCloudOk) {
              console.warn('[runKeyChartsGeneration] JSON 保存失败:', chartsOnly.error)
            }
            // 顺带 force 写 MD（内嵌图表兜底），失败不挡 JSON 成功态
            const mdOk = await autoSyncService.syncSummary(
              nextSummary,
              cacheName,
              chapterNamingMode,
              { force: true }
            )
            console.log('[runKeyChartsGeneration] syncSummary force=', mdOk)
          } catch (syncErr) {
            chartsCloudErr =
              syncErr instanceof Error ? syncErr.message : String(syncErr)
            console.warn('[runKeyChartsGeneration] 云端同步异常:', syncErr)
          }
        }

        if (chartsCloudOk) {
          toast.success(
            options?.silent
              ? t('results.charts.autoGeneratedSynced', '已自动生成关键图表并保存到云端')
              : t('results.charts.regeneratedAndSynced', '关键图表已更新并保存到云端'),
            { id: toastId }
          )
        } else {
          toast.success(
            options?.silent
              ? t('results.charts.autoGenerated', '已自动生成关键图表')
              : t('results.charts.regenerated', '关键图表已更新'),
            { id: toastId }
          )
          // 只要启用了 WebDAV 或缺 key，都提示原因（便于对照 console）
          if (dav.enabled || !cacheName) {
            toast.warning(
              t('progress.chartsCloudSaveFailed', '关键图表已生成，但云端 JSON 保存失败') +
                `: ${chartsCloudErr || '未知原因'}`
            )
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误'
        console.error('[runKeyChartsGeneration] failed', err)
        setBookSummary((prev) =>
          prev ? { ...prev, chartsError: msg } : prev
        )
        toast.error(t('results.charts.failed', '关键图表生成失败') + `: ${msg}`, {
          id: toastId,
        })
      } finally {
        chartsAutoGenRef.current = false
        setChartsGenerating(false)
        console.log('[runKeyChartsGeneration] end')
      }
    },
    [
      t,
      aiConfig,
      getPromptConfig,
      addTokenUsage,
      aiServiceOptions,
      processingOptions.outputLanguage,
      file,
      chapterNamingMode,
      cloudCacheMetadata?.fileName,
      resolveChartsUploadKey,
    ]
  )

  /** 手动重新生成（显式传入 cache 键，避免漏传导致跳过上传） */
  const regenerateKeyCharts = useCallback(async () => {
    if (!bookSummary) {
      toast.error(t('results.charts.needChapters', '缺少章节摘要'))
      return
    }
    const cacheFileName = resolveChartsUploadKey(null)
    console.log('[regenerateKeyCharts] click', { cacheFileName })
    if (!cacheFileName) {
      toast.warning(
        t(
          'progress.chartsNoCacheKey',
          '无法确定云端文件名：请先选择原书文件，或从云端/历史加载后再重新生成'
        )
      )
    }
    await runKeyChartsGeneration(bookSummary, {
      silent: false,
      cacheFileName,
    })
  }, [bookSummary, runKeyChartsGeneration, resolveChartsUploadKey, t])

  // 清除书籍缓存
  const clearBookCache = useCallback(() => {
    if (!file) return

    cacheService.clearBookCache(file.name)
    setBookSummary(null)
    setBookMindMap(null)
    toast.success(t('cache.bookCleared'))
  }, [file, t])

  // 预览字体大小控制
  const increasePreviewFontSize = useCallback(() => {
    setPreviewFontSize(prev => Math.min(prev + 2, 24))
  }, [])

  const decreasePreviewFontSize = useCallback(() => {
    setPreviewFontSize(prev => Math.max(prev - 2, 12))
  }, [])

  // 预览全屏控制
  const togglePreviewFullscreen = useCallback(() => {
    if (!previewCardRef.current) return

    if (!isPreviewFullscreen) {
      if (previewCardRef.current.requestFullscreen) {
        previewCardRef.current.requestFullscreen()
      } else if ((previewCardRef.current as any).webkitRequestFullscreen) {
        (previewCardRef.current as any).webkitRequestFullscreen()
      } else if ((previewCardRef.current as any).msRequestFullscreen) {
        (previewCardRef.current as any).msRequestFullscreen()
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen()
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen()
      }
    }
  }, [isPreviewFullscreen])

  // 监听全屏状态变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsPreviewFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('msfullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('msfullscreenchange', handleFullscreenChange)
    }
  }, [])

  // 文件变化时检查云端缓存
  useEffect(() => {
    if (file) {
      checkCloudCache(file.name)
    }
  }, [file, checkCloudCache])

  // WebDAV文件选择处理
  const handleWebDAVFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile)
    resetState()
    setFile(selectedFile)
    toast.success(t('webdav.fileSelected', { name: selectedFile.name }))

    // 与本地上传一致：自动查缓存并提取章节
    if (webdavConfig.enabled && webdavService.isInitialized()) {
      await checkCloudCache(selectedFile.name)
    }
    await extractChapters(selectedFile)
  }, [resetState, t, webdavConfig.enabled, extractChapters, checkCloudCache])

  // 打开WebDAV浏览器
  const openWebDAVBrowser = useCallback(() => {
    if (!webdavConfig.enabled) {
      toast.error(t('webdav.enableFirst'))
      return
    }

    if (!webdavService.isInitialized()) {
      toast.error(t('webdav.notInitialized'))
      return
    }

    setIsWebDAVBrowserOpen(true)
  }, [webdavConfig.enabled])

  // 章节总结导航（滚动容器为 .scroll-container，非 window）
  const handleChapterSummaryNavigation = useCallback((chapterId: string) => {
    setCurrentViewingChapterSummary(chapterId)
    setExpandedChapters(new Set([chapterId]))

    const scrollToChapter = (attempt = 1) => {
      setTimeout(() => {
        const element = document.getElementById(`chapter-summary-${chapterId}`)
        if (!element) return

        const container = document.querySelector('.scroll-container') as HTMLElement | null
        const headerOffset = 80

        if (container) {
          const containerRect = container.getBoundingClientRect()
          const elRect = element.getBoundingClientRect()
          const top = container.scrollTop + (elRect.top - containerRect.top) - headerOffset
          container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        } else {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }

        // 折叠动画未完成时重试
        if (attempt < 3) {
          scrollToChapter(attempt + 1)
        }
      }, attempt * 200)
    }

    scrollToChapter()
  }, [])

  // 章节导航（用于思维导图）
  const handleChapterNavigation = useCallback((chapterId: string) => {
    const chapter = extractedChapters?.find(ch => ch.id === chapterId)
    if (chapter) {
      setRightPanelContent({
        type: 'content',
        chapter,
        title: chapter.title
      })
      setCurrentViewingChapter(chapterId)
    }
  }, [extractedChapters])

  // 从历史记录加载云端缓存
  const loadFromHistoryRecord = useCallback(async (fileName: string): Promise<boolean> => {
    try {
      const config = useConfigStore.getState().webdavConfig
      if (!config.enabled) {
        toast.error(t('history.webdavRequired'))
        return false
      }

      // 历史记录里的 fileName 即云端缓存键（可能没有本地 File）
      cloudCacheKeyRef.current = fileName

      // 确保 WebDAV 已初始化
      if (!webdavService.isInitialized()) {
        const initResult = await webdavService.initialize(config)
        if (!initResult.success) {
          toast.error(t('history.webdavInitFailed'))
          return false
        }
      }

      // 读取云端缓存
      const result = await cloudCacheService.readCache(fileName)
      if (!result.success || !result.content) {
        toast.error(t('history.cacheNotFound'))
        return false
      }

      // 解析缓存内容
      const parsed = cloudCacheService.parseUnifiedContent(result.content)
      if (!parsed.chapters.length && !parsed.overallSummary) {
        toast.error(t('history.cacheParseError'))
        return false
      }

      // readCache 已并行拉取同名 JSON
      const charts = resolveChartsFromCloudSources(
        result.content,
        result.chartsJson,
        fileName
      )
      const chartsFileFound = !!result.chartsFileFound

      // 转换为 BookSummary 格式
      const summary: BookSummary = {
        title: parsed.title || fileName.replace(/\.[^/.]+$/, ''),
        author: parsed.author,
        chapters: parsed.chapters.map((ch, index) => ({
          id: `history-${index}`,
          title: ch.title,
          content: '',
          summary: ch.summary,
          processed: true
        })),
        connections: parsed.connections,
        overallSummary: parsed.overallSummary,
        charts,
        chartsError: null,
      }

      // 重置状态并设置结果
      resetState()
      setBookSummary(summary)
      setCloudCacheContent(result.content)
      setCloudChartsJson(result.chartsJson ?? null)
      setCloudChartsFileFound(chartsFileFound)

      // 历史加载同样写入本地图表缓存
      summary.chapters.forEach((ch) => {
        if (ch.summary) {
          cacheService.setCache(fileName, 'summary', ch.summary, ch.id)
        }
      })
      if (summary.connections) {
        cacheService.setCache(fileName, 'connections', summary.connections)
      }
      if (summary.overallSummary) {
        cacheService.setCache(fileName, 'overall_summary', summary.overallSummary)
      }
      if (charts) {
        cacheService.setCache(fileName, 'key_charts', serializeCharts(charts))
        pendingAutoChartsRef.current = false
      } else if (chartsFileFound) {
        // 有文件但解析失败：不自动覆盖
        pendingAutoChartsRef.current = false
        toast.warning(
          t(
            'cloudCache.chartsParseFailed',
            '云端图表 JSON 存在但解析失败，可手动点「重新生成图表」'
          )
        )
      } else {
        const canAuto =
          !!summary.overallSummary &&
          !summary.overallSummary.startsWith('【全书总结失败】') &&
          summary.chapters.length > 0
        pendingAutoChartsRef.current = canAuto
      }

      // 更新历史位置（移到最顶部）
      useProcessingHistoryStore.getState().addRecord({
        bookTitle: summary.title,
        fileName,
        processingMode: useConfigStore.getState().processingOptions.processingMode,
        model: result.metadata?.model || 'unknown',
        chapterCount: parsed.chapters.length
      })

      return true
    } catch (error) {
      console.error('从历史加载失败:', error)
      toast.error(t('history.loadError'))
      return false
    }
  }, [t, resetState, resolveChartsFromCloudSources])

  // 云/历史加载后：有 MD 无图表则自动生成
  useEffect(() => {
    if (!pendingAutoChartsRef.current || !bookSummary) return
    if (bookSummary.charts) {
      pendingAutoChartsRef.current = false
      return
    }
    if (chartsGenerating || chartsAutoGenRef.current) return
    const canAuto =
      !!bookSummary.overallSummary &&
      !bookSummary.overallSummary.startsWith('【全书总结失败】') &&
      bookSummary.chapters.length > 0
    if (!canAuto) {
      pendingAutoChartsRef.current = false
      return
    }
    pendingAutoChartsRef.current = false
    const cacheFileName =
      file?.name || cloudCacheKeyRef.current || cloudCacheMetadata?.fileName || null
    console.log('[autoCharts] 触发自动生成, cacheFileName=', cacheFileName)
    void runKeyChartsGeneration(bookSummary, {
      silent: true,
      cacheFileName,
    })
  }, [
    bookSummary,
    chartsGenerating,
    runKeyChartsGeneration,
    file?.name,
    cloudCacheMetadata?.fileName,
  ])

  return {
    // 状态
    file,
    processing,
    extractingChapters,
    progress,
    currentStep,
    currentProcessingChapter,
    extractedChapters,
    bookData,
    selectedChapters,
    customPrompt,
    bookSummary,
    bookMindMap,
    expandedChapters,
    cloudCacheMetadata,
    isCheckingCloudCache,
    cloudCacheContent,
    cloudChartsFileFound,
    chartsGenerating,
    rightPanelContent,
    currentViewingChapter,
    currentViewingChapterSummary,
    previewFontSize,
    isPreviewFullscreen,
    previewCardRef,
    isWebDAVBrowserOpen,
    tokenUsage,
    processingMode,

    // 动作
    handleFileSelect,
    extractChapters,
    processBook,
    cancelProcessing,
    restartProcessing,
    handleChapterSelect,
    handleSelectAll,
    handleViewChapterContent,
    handleCloseRightPanel,
    handleChapterExpandChange,
    clearChapterCache,
    clearChapterMindMapCache,
    clearSpecificCache,
    regenerateKeyCharts,
    clearBookCache,
    increasePreviewFontSize,
    decreasePreviewFontSize,
    togglePreviewFullscreen,
    loadFromCloudCache,
    handleWebDAVFileSelect,
    openWebDAVBrowser,
    handleChapterSummaryNavigation,
    handleChapterNavigation,
    loadFromHistoryRecord,

    // 设置器
    setCustomPrompt,
    setIsWebDAVBrowserOpen,
    setBookSummary,
    setBookMindMap,
    setCurrentViewingChapterSummary,
    fullBookData
  }
}
