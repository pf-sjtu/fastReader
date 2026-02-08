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
import { toast } from 'sonner'

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
    setCustomPrompt('')
    resetTokenUsage()
  }, [resetTokenUsage])

  // 设置文件
  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile)
    resetState()
  }, [resetState])

  // 提取章节
  const extractChapters = useCallback(async () => {
    if (!file) return

    setExtractingChapters(true)
    try {
      let bookDataResult: (EpubBookData | PdfBookData) & { chapters: ChapterData[] }
      let chapters: ChapterData[]

      if (file.name.endsWith('.epub')) {
        bookDataResult = await epubProcessor.extractBookData(
          file,
          processingOptions.useSmartDetection,
          processingOptions.skipNonEssentialChapters,
          processingOptions.maxSubChapterDepth,
          processingOptions.chapterNamingMode,
          processingOptions.chapterDetectionMode,
          processingOptions.epubTocDepth
        )
        chapters = bookDataResult.chapters
      } else if (file.name.endsWith('.pdf')) {
        bookDataResult = await pdfProcessor.extractBookData(
          file,
          processingOptions.useSmartDetection,
          processingOptions.skipNonEssentialChapters,
          processingOptions.maxSubChapterDepth,
          processingOptions.chapterNamingMode,
          processingOptions.chapterDetectionMode,
          processingOptions.epubTocDepth
        )
        chapters = bookDataResult.chapters
      } else {
        throw new Error(t('upload.unsupportedFormat'))
      }

      setFullBookData(bookDataResult)
      setExtractedChapters(chapters)
      setBookData({
        title: bookDataResult.title,
        author: bookDataResult.author
      })

      // 默认选择所有章节
      setSelectedChapters(new Set(chapters.map(ch => ch.id)))

      toast.success(t('upload.chaptersExtracted', { count: chapters.length }))
    } catch (error) {
      console.error('提取章节错误:', error)
      toast.error(error instanceof Error ? error.message : t('upload.extractError'))
    } finally {
      setExtractingChapters(false)
    }
  }, [file, processingOptions, t])

  // 检查云端缓存
  const checkCloudCache = useCallback(async (fileName: string) => {
    setCloudCacheMetadata(null)
    setCloudCacheContent(null)

    if (!webdavConfig.enabled || !webdavService.isInitialized()) {
      return false
    }

    setIsCheckingCloudCache(true)
    try {
      const result = await cloudCacheService.readCache(fileName)

      if (result.success && result.content) {
        setCloudCacheMetadata(result.metadata || null)
        setCloudCacheContent(result.content)
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

  // 从云端缓存加载
  const loadFromCloudCache = useCallback(() => {
    if (!cloudCacheContent) return

    toast.info('已加载云端缓存，可直接查看处理结果')
    toast.info('发现云端缓存，可跳过处理直接查看结果', {
      description: '如需重新处理，请点击"提取章节"按钮'
    })
  }, [cloudCacheContent])

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

  // 处理书籍
  const processBook = useCallback(async () => {
    if (!file || !extractedChapters || selectedChapters.size === 0) return

    setProcessing(true)
    setProgress(0)

    try {
      resetTokenUsage()

      const aiService = new AIService(aiConfig, getPromptConfig, {
        onTokenUsage: addTokenUsage,
        ...aiServiceOptions
      })
      const selectedChapterData = extractedChapters.filter(ch => selectedChapters.has(ch.id))

      if (processingMode === 'summary') {
        // 生成章节总结
        setCurrentStep(t('progress.generatingSummaries'))
        setProgress(10)

        const processedChapters: Chapter[] = []

        const initialSummary: BookSummary = {
          title: bookData?.title || '',
          author: bookData?.author || '',
          chapters: [],
          connections: '',
          overallSummary: ''
        }
        setBookSummary(initialSummary)

        for (let i = 0; i < selectedChapterData.length; i++) {
          const chapter = selectedChapterData[i]
          setCurrentProcessingChapter(chapter.id)
          setCurrentStep(t('progress.processingChapter', {
            current: i + 1,
            total: selectedChapterData.length,
            title: chapter.title
          }))

          const summary = await aiService.summarizeChapter(
            chapter.title,
            chapter.content,
            bookType,
            processingOptions.outputLanguage,
            customPrompt
          )

          const processedChapter: Chapter = {
            id: chapter.id,
            title: chapter.title,
            content: chapter.content,
            summary,
            processed: true
          }

          processedChapters.push(processedChapter)

          setBookSummary(prev => ({
            ...prev!,
            chapters: [...prev!.chapters, processedChapter]
          }))

          setProgress(10 + (i + 1) * 30 / selectedChapterData.length)
        }

        setCurrentProcessingChapter('')

        // 生成章节关联分析
        setCurrentStep(t('progress.analyzingConnections'))
        setProgress(50)

        const connections = await aiService.analyzeConnections(
          processedChapters,
          processingOptions.outputLanguage
        )

        // 生成全书总结
        setCurrentStep(t('progress.generatingOverallSummary'))
        setProgress(70)

        const overallSummary = await aiService.generateOverallSummary(
          bookData?.title || '',
          processedChapters,
          connections,
          processingOptions.outputLanguage
        )

        const summary: BookSummary = {
          title: bookData?.title || '',
          author: bookData?.author || '',
          chapters: processedChapters,
          connections,
          overallSummary
        }

        setBookSummary(summary)

        // 保存缓存
        processedChapters.forEach(chapter => {
          if (chapter.summary) {
            cacheService.setCache(file.name, 'summary', chapter.summary, chapter.id)
          }
        })
        if (connections) {
          cacheService.setCache(file.name, 'connections', connections)
        }
        if (overallSummary) {
          cacheService.setCache(file.name, 'overall_summary', overallSummary)
        }

        // 自动同步到WebDAV
        try {
          const fileName = file.name.replace(/\.[^/.]+$/, '')
          await autoSyncService.syncSummary(summary, fileName, chapterNamingMode)
        } catch (error) {
          console.error('自动同步失败:', error)
        }
      } else if (processingMode === 'mindmap' || processingMode === 'combined-mindmap') {
        // 生成章节思维导图
        setCurrentStep(t('progress.generatingMindMaps'))
        setProgress(10)

        const processedChapters: Chapter[] = []

        const initialMindMap: BookMindMap = {
          title: bookData?.title || '',
          author: bookData?.author || '',
          chapters: [],
          combinedMindMap: null
        }
        setBookMindMap(initialMindMap)

        for (let i = 0; i < selectedChapterData.length; i++) {
          const chapter = selectedChapterData[i]
          setCurrentStep(t('progress.processingChapter', {
            current: i + 1,
            total: selectedChapterData.length,
            title: chapter.title
          }))

          const mindMap = await aiService.generateChapterMindMap(
            chapter.content,
            processingOptions.outputLanguage,
            customPrompt
          )

          const processedChapter: Chapter = {
            id: chapter.id,
            title: chapter.title,
            content: chapter.content,
            mindMap,
            processed: true
          }

          processedChapters.push(processedChapter)

          setBookMindMap(prev => ({
            ...prev!,
            chapters: [...prev!.chapters, processedChapter]
          }))

          setProgress(10 + (i + 1) * 40 / selectedChapterData.length)
        }

        // 生成整书思维导图
        let combinedMindMap: MindElixirData | null = null

        if (processingMode === 'combined-mindmap') {
          setCurrentStep(t('progress.generatingCombinedMindMap'))
          setProgress(60)

          combinedMindMap = await aiService.generateCombinedMindMap(
            bookData?.title || '',
            processedChapters,
            customPrompt
          )
        }

        const mindMapResult: BookMindMap = {
          title: bookData?.title || '',
          author: bookData?.author || '',
          chapters: processedChapters,
          combinedMindMap
        }

        setBookMindMap(mindMapResult)

        // 保存缓存
        processedChapters.forEach(chapter => {
          if (chapter.mindMap) {
            cacheService.setCache(file.name, 'mindmap', chapter.mindMap, chapter.id)
          }
        })
        if (combinedMindMap) {
          cacheService.setCache(file.name, 'combined_mindmap', combinedMindMap)
        }

        // 自动同步到WebDAV
        try {
          const fileName = file.name.replace(/\.[^/.]+$/, '')
          await autoSyncService.syncMindMap(mindMapResult, fileName)
        } catch (error) {
          console.error('自动同步失败:', error)
        }
      }

      setProgress(100)
      setCurrentStep(t('progress.completed'))

      toast.success(t('progress.processingCompleted'))

      // 发送任务完成通知
      if (processingOptions.enableNotification) {
        await notificationService.sendTaskCompleteNotification(
          t('progress.bookProcessing') || '书籍处理',
          bookData?.title
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('progress.processingError'), {
        duration: 5000,
        position: 'top-center',
      })

      // 发送错误通知
      if (processingOptions.enableNotification) {
        await notificationService.sendErrorNotification(
          error instanceof Error ? error.message : t('progress.processingError')
        )
      }
    } finally {
      setProcessing(false)
    }
  }, [
    file, extractedChapters, selectedChapters, bookData, aiConfig,
    processingOptions, processingMode, bookType, chapterNamingMode,
    customPrompt, t, getPromptConfig, addTokenUsage, resetTokenUsage,
    aiServiceOptions
  ])

  // 取消处理
  const cancelProcessing = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setProcessing(false)
    setCurrentStep(t('progress.cancelled'))
  }, [t])

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

  // 清除特定缓存
  const clearSpecificCache = useCallback((cacheType: string) => {
    if (!file) return

    cacheService.clearCache(file.name, cacheType as any)

    if (cacheType === 'connections' && bookSummary) {
      setBookSummary({ ...bookSummary, connections: '' })
    } else if (cacheType === 'overall_summary' && bookSummary) {
      setBookSummary({ ...bookSummary, overallSummary: '' })
    } else if (cacheType === 'combined_mindmap' && bookMindMap) {
      setBookMindMap({ ...bookMindMap, combinedMindMap: null })
    }

    toast.success(t('cache.specificCleared'))
  }, [file, bookSummary, bookMindMap, t])

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
  const handleWebDAVFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile)
    resetState()
    toast.success(`已选择文件: ${selectedFile.name}`)
  }, [resetState])

  // 打开WebDAV浏览器
  const openWebDAVBrowser = useCallback(() => {
    if (!webdavConfig.enabled) {
      toast.error('请先在设置中启用并配置WebDAV')
      return
    }

    if (!webdavService.isInitialized()) {
      toast.error('WebDAV服务未初始化，请先测试连接')
      return
    }

    setIsWebDAVBrowserOpen(true)
  }, [webdavConfig.enabled])

  // 章节总结导航
  const handleChapterSummaryNavigation = useCallback((chapterId: string) => {
    setCurrentViewingChapterSummary(chapterId)
    setExpandedChapters(new Set([chapterId]))

    const scrollToChapter = (attempt = 1) => {
      setTimeout(() => {
        const element = document.getElementById(`chapter-summary-${chapterId}`)
        if (element) {
          const contentElement = element.querySelector('[class*="CardContent"]')
          const isActuallyExpanded = contentElement &&
            contentElement.getAttribute('style') !== 'display: none' &&
            !contentElement.classList.contains('hidden')

          if (isActuallyExpanded) {
            const headerOffset = 80
            const elementPosition = element.getBoundingClientRect().top
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset

            window.scrollTo({
              top: offsetPosition,
              behavior: 'smooth'
            })
          } else if (attempt < 3) {
            scrollToChapter(attempt + 1)
          } else {
            element.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
              inline: 'nearest'
            })
          }
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
    handleChapterSelect,
    handleSelectAll,
    handleViewChapterContent,
    handleCloseRightPanel,
    handleChapterExpandChange,
    clearChapterCache,
    clearChapterMindMapCache,
    clearSpecificCache,
    clearBookCache,
    increasePreviewFontSize,
    decreasePreviewFontSize,
    togglePreviewFullscreen,
    loadFromCloudCache,
    handleWebDAVFileSelect,
    openWebDAVBrowser,
    handleChapterSummaryNavigation,
    handleChapterNavigation,

    // 设置器
    setCustomPrompt,
    setIsWebDAVBrowserOpen,
    setBookSummary,
    setBookMindMap,
    fullBookData
  }
}
