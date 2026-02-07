import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Upload, BookOpen, Brain, FileText, Loader2, Network, Trash2, List, ChevronUp, ArrowLeft, Download, Plus, Minus, Maximize2, Minimize2, CheckCircle } from 'lucide-react'
import { EpubProcessor, type ChapterData, type BookData as EpubBookData } from './services/epubProcessor'
import { PdfProcessor, type BookData as PdfBookData } from './services/pdfProcessor'
import { AIService } from './services/aiService'
import { CacheService } from './services/cacheService'
import { cloudCacheService, type ProcessingMetadata } from './services/cloudCacheService'
import { notificationService } from './services/notificationService'
import { webdavService } from './services/webdavService'
import { autoSyncService } from './services/autoSyncService'
import { ConfigDialog } from './components/project/ConfigDialog'
import { WebDAVFileBrowser } from './components/project/WebDAVFileBrowser'
import { BatchProcessingDialog } from './components/project/BatchProcessingDialog'
import { BatchQueuePanel } from './components/project/BatchQueuePanel'
import type { MindElixirData, Options } from 'mind-elixir'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { DarkModeToggle } from './components/DarkModeToggle'
import { FontSizeControl } from './components/FontSizeControl'
import { UnifiedStatusBar } from './components/UnifiedStatusBar'
import { MarkdownCard } from './components/MarkdownCard'
import { MindMapCard } from './components/MindMapCard'
import { TimelineNavigation } from './components/TimelineNavigation'
import { ChapterSummaryNavigation } from './components/ChapterSummaryNavigation'
import { EpubReader } from './components/EpubReader'
import { PdfReader } from './components/PdfReader'
import { UploadToWebDAVButton } from './components/UploadToWebDAVButton'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { scrollToTop } from './utils/index'
import { useWebDAVConfig, useConfigStore, useAIConfig, useProcessingOptions, usePromptConfig, useAIServiceOptions } from './stores/configStore'
import { metadataFormatter } from './services/metadataFormatter'
import { normalizeMarkdownTypography } from './lib/markdown'


const options = { direction: 1, alignment: 'nodes' } as Options

// 创建单例实例避免重复创建
const epubProcessorInstance = new EpubProcessor()
const pdfProcessorInstance = new PdfProcessor()

interface Chapter {
  id: string
  title: string
  content: string
  summary?: string
  mindMap?: MindElixirData
  processed: boolean
}

interface BookSummary {
  title: string
  author: string
  chapters: Chapter[]
  connections: string
  overallSummary: string
}

interface BookMindMap {
  title: string
  author: string
  chapters: Chapter[]
  combinedMindMap?: MindElixirData | null
}

const cacheService = new CacheService()

function App() {
  const { t } = useTranslation()
  const webdavConfig = useWebDAVConfig()
  const { tokenUsage, addTokenUsage, resetTokenUsage } = useConfigStore()
  const { model: currentModel } = useAIConfig()
  
  const [currentStepIndex, setCurrentStepIndex] = useState(1) // 1: 配置步骤, 2: 处理步骤
  const [file, setFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [extractingChapters, setExtractingChapters] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [bookSummary, setBookSummary] = useState<BookSummary | null>(null)
  const [bookMindMap, setBookMindMap] = useState<BookMindMap | null>(null)
  const [extractedChapters, setExtractedChapters] = useState<ChapterData[] | null>(null)
  
  // WebDAV相关状态
  const [isWebDAVBrowserOpen, setIsWebDAVBrowserOpen] = useState(false)
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [bookData, setBookData] = useState<{ title: string; author: string } | null>(null)
  const [fullBookData, setFullBookData] = useState<EpubBookData | PdfBookData | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [currentReadingChapter, setCurrentReadingChapter] = useState<ChapterData | null>(null)
  const [rightPanelContent, setRightPanelContent] = useState<{
    type: 'chapter' | 'content'
    chapter: ChapterData
    title: string
  } | null>(null)
  const [currentProcessingChapter, setCurrentProcessingChapter] = useState<string>('')
  const [currentViewingChapter, setCurrentViewingChapter] = useState<string>('')
  const [currentViewingChapterSummary, setCurrentViewingChapterSummary] = useState<string>('')
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())
  
  // 预览窗口控制状态
  const [previewFontSize, setPreviewFontSize] = useState(16)
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false)
  const previewCardRef = useRef<HTMLDivElement>(null)

  // 云端缓存相关状态
  const [cloudCacheMetadata, setCloudCacheMetadata] = useState<ProcessingMetadata | null>(null)
  const [isCheckingCloudCache, setIsCheckingCloudCache] = useState(false)
  const [cloudCacheContent, setCloudCacheContent] = useState<string | null>(null)

  // 使用zustand store管理配置
  const aiConfig = useAIConfig()
  const processingOptions = useProcessingOptions()
  const promptConfig = usePromptConfig()
  const aiServiceOptions = useAIServiceOptions()
  const { apiKey } = aiConfig
  const { processingMode, bookType, useSmartDetection, skipNonEssentialChapters } = processingOptions

  // 使用 useMemo 缓存提示词配置获取函数，避免每次 render 创建新函数
  const getPromptConfig = useCallback(() => useConfigStore.getState().promptConfig, [])

  // WebDAV自动连接测试 - 只在组件挂载时执行一次
  useEffect(() => {
    const initializeWebDAVIfNeeded = async () => {
      // 如果WebDAV已启用且配置完整但服务未初始化，自动测试连接
      if (webdavConfig.enabled &&
          webdavConfig.serverUrl &&
          webdavConfig.username &&
          webdavConfig.password &&
          !webdavService.isInitialized()) {

        try {
          const initResult = await webdavService.initialize(webdavConfig)
          if (initResult.success) {
            toast.success(t('webdav.autoConnected'))
          } else {
            console.error('App: WebDAV自动连接失败:', initResult.error)
            // 不显示错误提示，避免与配置页面的测试提示冲突
          }
        } catch (error) {
          console.error('App: WebDAV自动连接异常:', error)
        }
      }
    }

    // 延迟执行，避免组件初始化时的重复调用
    // 给WebDAVConfig组件留出时间处理配置变化
    const timer = setTimeout(initializeWebDAVIfNeeded, 3000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 只在组件挂载时执行

  // 请求通知权限
  useEffect(() => {
    if (processingOptions.enableNotification) {
      notificationService.requestPermission().then(hasPermission => {
        if (!hasPermission) {
          console.warn('浏览器通知权限被拒绝')
        }
      })
    }
  }, [processingOptions.enableNotification])

  // 监听滚动事件，控制回到顶部按钮显示
  useEffect(() => {
    const scrollContainer = document.querySelector('.scroll-container')
    if (!scrollContainer) return

    const handleScroll = () => {
      setShowBackToTop(scrollContainer.scrollTop > 300)
    }

    scrollContainer.addEventListener('scroll', handleScroll)
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [])

  // 处理文件上传
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0]
    if (!uploadedFile) return

    setFile(uploadedFile)
    setExtractedChapters(null)
    setBookData(null)
    setSelectedChapters(new Set())
    setBookSummary(null)
    setBookMindMap(null)
    setCurrentStepIndex(1)
  }, [])

  // 加载缓存数据
  const loadCachedData = useCallback(() => {
    if (!file) return

    // 加载总结缓存
    const summaryCache = cacheService.getSummary(file.name)
    if (summaryCache && summaryCache.chapters.length > 0) {
      // 需要从extractedChapters获取章节的完整信息
      const chapters: Chapter[] = summaryCache.chapters.map((cachedChapter: any) => {
        const extractedChapter = extractedChapters?.find(ch => ch.id === cachedChapter.id)
        return {
          id: cachedChapter.id,
          title: extractedChapter?.title || `Chapter ${cachedChapter.id}`,
          content: extractedChapter?.content || '',
          summary: cachedChapter.summary,
          processed: true
        }
      })
      
      const summary: BookSummary = {
        title: bookData?.title || '',
        author: bookData?.author || '',
        chapters,
        connections: summaryCache.connections || '',
        overallSummary: summaryCache.overallSummary || ''
      }
      setBookSummary(summary)
    }
    
    // 加载思维导图缓存
    const mindMapCache = cacheService.getMindMapData(file.name)
    if (mindMapCache && mindMapCache.chapters.length > 0) {
      // 需要从extractedChapters获取章节的完整信息
      const chapters: Chapter[] = mindMapCache.chapters.map((cachedChapter: any) => {
        const extractedChapter = extractedChapters?.find(ch => ch.id === cachedChapter.id)
        return {
          id: cachedChapter.id,
          title: extractedChapter?.title || `Chapter ${cachedChapter.id}`,
          content: extractedChapter?.content || '',
          mindMap: cachedChapter.mindMap,
          processed: true
        }
      })
      
      const mindMap: BookMindMap = {
        title: bookData?.title || '',
        author: bookData?.author || '',
        chapters,
        combinedMindMap: mindMapCache.combinedMindMap || null
      }
      setBookMindMap(mindMap)
    }
  }, [file, extractedChapters, bookData])

  // 检查云端缓存
  const checkCloudCache = useCallback(async (fileName: string) => {
    // 重置云端缓存状态
    setCloudCacheMetadata(null)
    setCloudCacheContent(null)

    // 检查 WebDAV 是否启用
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

  // 使用云端缓存加载内容
  const loadFromCloudCache = useCallback(() => {
    if (!cloudCacheContent) return

    // 解析云端内容
    const metadata = cloudCacheService.parseMetadata(cloudCacheContent)
    const cleanContent = cloudCacheService.stripMetadata(cloudCacheContent)

    // TODO: 解析内容并设置到状态
    // 目前只显示提示，实际渲染需要进一步解析 Markdown 结构
    toast.info('已加载云端缓存，可直接查看处理结果')

    // 提示用户可以跳过处理
    toast.info('发现云端缓存，可跳过处理直接查看结果', {
      description: '如需重新处理，请点击"提取章节"按钮'
    })
  }, [cloudCacheContent])

  // 当文件变化时加载缓存数据
  useEffect(() => {
    loadCachedData()
    if (file) {
      checkCloudCache(file.name)
    }
  }, [file]) // 只依赖file，移除函数依赖

  // 处理文件变化
  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0]
    if (!uploadedFile) return

    setFile(uploadedFile)
    setExtractedChapters(null)
    setBookData(null)
    setSelectedChapters(new Set())
    setBookSummary(null)
    setBookMindMap(null)
    setCurrentStepIndex(1)
    setRightPanelContent(null)
    // 清理完整书籍数据和相关状态
    setFullBookData(null)
    setCurrentReadingChapter(null)
    setCurrentProcessingChapter('')
    setCurrentViewingChapter('')
    setCurrentViewingChapterSummary('')
    setExpandedChapters(new Set())
    setCloudCacheMetadata(null)
    setCloudCacheContent(null)
    setCustomPrompt('')
  }, [])

  // 处理WebDAV文件选择
  const handleWebDAVFileSelect = useCallback(async (file: File) => {
    // 直接使用已经下载的File对象
    setFile(file)
    setExtractedChapters(null)
    setBookData(null)
    setSelectedChapters(new Set())
    setBookSummary(null)
    setBookMindMap(null)
    setCurrentStepIndex(1)
    setRightPanelContent(null)
    // 清理完整书籍数据和相关状态
    setFullBookData(null)
    setCurrentReadingChapter(null)
    setCurrentProcessingChapter('')
    setCurrentViewingChapter('')
    setCurrentViewingChapterSummary('')
    setExpandedChapters(new Set())
    setCloudCacheMetadata(null)
    setCloudCacheContent(null)
    setCustomPrompt('')

    toast.success(`已选择文件: ${file.name}`)
  }, [])

  // 获取文件MIME类型
  const getMimeType = (fileName: string): string => {
    const extension = fileName.toLowerCase().split('.').pop()
    switch (extension) {
      case 'pdf':
        return 'application/pdf'
      case 'epub':
        return 'application/epub+zip'
      case 'txt':
        return 'text/plain'
      case 'md':
        return 'text/markdown'
      default:
        return 'application/octet-stream'
    }
  }

  // 打开WebDAV文件浏览器
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

  // 章节导航处理（用于原文预览）
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

  // 章节总结导航处理（用于跳转到章节总结）
  const handleChapterSummaryNavigation = useCallback((chapterId: string) => {
    // 1. 先设置当前查看的章节
    setCurrentViewingChapterSummary(chapterId)

    // 2. 展开目标章节，折叠其他章节
    setExpandedChapters(new Set([chapterId]))

    // 3. 多次尝试滚动，确保元素可见且展开完成
    const scrollToChapter = (attempt = 1) => {
      setTimeout(() => {
        const element = document.getElementById(`chapter-summary-${chapterId}`)
        if (element) {
          // 检查元素是否真的展开了（内容区域可见）
          const contentElement = element.querySelector('[class*="CardContent"]')
          const isActuallyExpanded = contentElement &&
            contentElement.getAttribute('style') !== 'display: none' &&
            !contentElement.classList.contains('hidden')

          if (isActuallyExpanded) {
            // 使用 start 确保滚动到元素顶部，留出一些顶部空间
            const headerOffset = 80 // 导航栏高度偏移
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
      }, attempt * 200) // 每次尝试间隔200ms
    }
    
    // 开始第一次滚动尝试
    scrollToChapter()
  }, [])

  // 章节展开状态变化处理
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

  // 预览窗口字体大小控制
  const increasePreviewFontSize = useCallback(() => {
    setPreviewFontSize(prev => Math.min(prev + 2, 24))
  }, [])

  const decreasePreviewFontSize = useCallback(() => {
    setPreviewFontSize(prev => Math.max(prev - 2, 12))
  }, [])

  // 预览窗口全屏控制
  const togglePreviewFullscreen = useCallback(() => {
    if (!previewCardRef.current) return
    
    if (!isPreviewFullscreen) {
      // 进入全屏
      if (previewCardRef.current.requestFullscreen) {
        previewCardRef.current.requestFullscreen()
      } else if ((previewCardRef.current as any).webkitRequestFullscreen) {
        (previewCardRef.current as any).webkitRequestFullscreen()
      } else if ((previewCardRef.current as any).msRequestFullscreen) {
        (previewCardRef.current as any).msRequestFullscreen()
      }
    } else {
      // 退出全屏
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

  // 提取章节
  const extractChapters = useCallback(async () => {
    if (!file) return

    setExtractingChapters(true)
    try {
      let bookData: EpubBookData & { chapters: ChapterData[] } | PdfBookData & { chapters: ChapterData[] }
      let chapters: ChapterData[]

      if (file.name.endsWith('.epub')) {
        bookData = await epubProcessorInstance.extractBookData(
          file,
          processingOptions.useSmartDetection,
          processingOptions.skipNonEssentialChapters,
          processingOptions.maxSubChapterDepth,
          processingOptions.chapterNamingMode,
          processingOptions.chapterDetectionMode,
          processingOptions.epubTocDepth
        )
        chapters = bookData.chapters
      } else if (file.name.endsWith('.pdf')) {
        bookData = await pdfProcessorInstance.extractBookData(
          file,
          processingOptions.useSmartDetection,
          processingOptions.skipNonEssentialChapters,
          processingOptions.maxSubChapterDepth,
          processingOptions.chapterNamingMode,
          processingOptions.chapterDetectionMode,
          processingOptions.epubTocDepth
        )
        chapters = bookData.chapters
      } else {
        throw new Error(t('upload.unsupportedFormat'))
      }

      setFullBookData(bookData)
      setExtractedChapters(chapters)
      setBookData({
        title: bookData.title,
        author: bookData.author
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

  // 处理章节选择
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

  // 下载所有markdown文件
  const downloadAllMarkdown = useCallback(() => {
    if (!bookSummary || !file) return

    // 准备章节数据
    const chapters = bookSummary.chapters.map((chapter: any) => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary || ''
    }))

    // 准备书籍数据
    const bookData = {
      title: bookSummary.title,
      author: bookSummary.author,
      chapters: chapters,
      overallSummary: bookSummary.overallSummary,
      connections: bookSummary.connections
    }

    // 计算原始内容字符数
    const originalCharCount = bookSummary.chapters.reduce(
      (total: number, chapter: any) => total + (chapter.content?.length || 0),
      0
    )

    // 计算处理后内容字符数
    const processedCharCount = bookSummary.chapters.reduce(
      (total: number, chapter: any) => total + (chapter.summary?.length || 0),
      0
    )

    // 选中的章节
    const selectedChapters = bookSummary.chapters
      .map((_: any, index: number) => index + 1)
      .filter((_: any, index: number) => {
        return bookSummary.chapters[index]?.summary
      })

    // 生成元数据
    const metadata = metadataFormatter.generate({
      fileName: file.name,
      bookTitle: bookSummary.title,
      model: aiConfig.model,
      chapterDetectionMode: processingOptions.chapterDetectionMode,
      selectedChapters: selectedChapters,
      chapterCount: bookSummary.chapters.length,
      originalCharCount: originalCharCount,
      processedCharCount: processedCharCount
    })

    // 使用统一格式生成 Markdown
    let markdownContent = metadataFormatter.formatUnified(bookData, metadata, processingOptions.chapterNamingMode)

    // 应用预处理解决渲染问题
    markdownContent = normalizeMarkdownTypography(markdownContent)

    // 创建下载链接
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    // 使用原文件名，只改变后缀
    const baseFileName = file.name.replace(/\.[^/.]+$/, '')
    link.download = `${baseFileName}_总结.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast.success(t('download.downloadSuccess'))
  }, [bookSummary, file, t, aiConfig.model, processingOptions.chapterDetectionMode, processingOptions.chapterNamingMode])
  const processBook = useCallback(async () => {
    if (!file || !extractedChapters || selectedChapters.size === 0) return

    setProcessing(true)
    setProgress(0)
    setCurrentStepIndex(2)

    try {
      // 重置当前图书的token使用量
      resetTokenUsage()
      
      const aiService = new AIService(aiConfig, getPromptConfig, {
        onTokenUsage: addTokenUsage,
        ...aiServiceOptions
      })
      const selectedChapterData = extractedChapters.filter(ch => selectedChapters.has(ch.id))
      
      if (processingMode === 'summary') {
        // 步骤1: 生成章节总结
        setCurrentStep(t('progress.generatingSummaries'))
        setProgress(10)
        
        const processedChapters: Chapter[] = []
        
        // 初始化bookSummary以便实时显示
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
          
          const processedChapter = {
            id: chapter.id,
            title: chapter.title,
            content: chapter.content,
            summary,
            processed: true
          }
          
          processedChapters.push(processedChapter)
          
          // 实时更新bookSummary以显示新处理的章节
          setBookSummary(prev => ({
            ...prev,
            chapters: [...prev.chapters, processedChapter]
          }))
          
          setProgress(10 + (i + 1) * 30 / selectedChapterData.length)
        }
        
        setCurrentProcessingChapter('')

        // 步骤2: 生成章节关联分析
        setCurrentStep(t('progress.analyzingConnections'))
        setProgress(50)

        const connections = await aiService.analyzeConnections(
          processedChapters, 
          processingOptions.outputLanguage
        )

        // 步骤3: 生成全书总结
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
          const fileName = file.name.replace(/\.[^/.]+$/, '') // 移除文件扩展名
          await autoSyncService.syncSummary(summary, fileName, processingOptions.chapterNamingMode)
        } catch (error) {
          console.error('自动同步失败:', error)
          // 同步失败不影响主流程，只记录错误
        }
      } else if (processingMode === 'mindmap' || processingMode === 'combined-mindmap') {
        // 步骤1: 生成章节思维导图
        setCurrentStep(t('progress.generatingMindMaps'))
        setProgress(10)
        
        const processedChapters: Chapter[] = []
        
        // 初始化bookMindMap以便实时显示
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
          
          const processedChapter = {
            id: chapter.id,
            title: chapter.title,
            content: chapter.content,
            mindMap,
            processed: true
          }
          
          processedChapters.push(processedChapter)
          
          // 实时更新bookMindMap以显示新处理的章节
          setBookMindMap(prev => ({
            ...prev,
            chapters: [...prev.chapters, processedChapter]
          }))
          
          setProgress(10 + (i + 1) * 40 / selectedChapterData.length)
        }

        // 步骤2: 生成整书思维导图（如果是combined-mindmap模式）
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
          const fileName = file.name.replace(/\.[^/.]+$/, '') // 移除文件扩展名
          await autoSyncService.syncMindMap(mindMapResult, fileName)
        } catch (error) {
          console.error('自动同步失败:', error)
          // 同步失败不影响主流程，只记录错误
        }
      }
      
      setProgress(100)
      setCurrentStep(t('progress.completed'))
      
      toast.success(t('progress.processingCompleted'))
      
      // 自动切换到处理页面
      setCurrentStepIndex(2)
      
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
  }, [extractedChapters, selectedChapters, file, bookData, aiConfig, bookType, customPrompt, processingOptions, processingMode, t])

  // 清除章节缓存
  const clearChapterCache = useCallback((chapterId: string) => {
    if (!file) return
    
    const summary = cacheService.getSummary(file.name)
    if (summary && summary.chapters) {
      const chapter = summary.chapters.find(ch => ch.id === chapterId)
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
      const chapter = mindMap.chapters.find(ch => ch.id === chapterId)
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
      setBookSummary({
        ...bookSummary,
        connections: ''
      })
    } else if (cacheType === 'overall_summary' && bookSummary) {
      setBookSummary({
        ...bookSummary,
        overallSummary: ''
      })
    } else if (cacheType === 'combined_mindmap' && bookMindMap) {
      setBookMindMap({
        ...bookMindMap,
        combinedMindMap: null
      })
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:via-blue-950 dark:to-slate-900 p-4 flex justify-center gap-4 h-screen overflow-auto scroll-container">
      <Toaster />
      <WebDAVFileBrowser
        isOpen={isWebDAVBrowserOpen}
        onClose={() => setIsWebDAVBrowserOpen(false)}
        onFileSelect={handleWebDAVFileSelect}
      />
      <div className="max-w-full xl:max-w-7xl space-y-4 w-full flex-1">
        <div className="text-center space-y-2 relative">
          <div className="absolute top-0 right-0 flex items-center gap-2">
            <LanguageSwitcher />
            <DarkModeToggle />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 flex items-center justify-center gap-2">
            <BookOpen className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            {t('app.title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-300">{t('app.description')}</p>
        </div>

        {/* 统一状态栏 */}
        <UnifiedStatusBar
          currentView={currentStepIndex === 1 ? 'config' : 'processing'}
          processing={processing}
          progress={progress}
          currentStep={currentStep}
          currentModel={currentModel}
          tokenUsage={tokenUsage}
          onToggleView={() => setCurrentStepIndex(currentStepIndex === 1 ? 2 : 1)}
        />

        {/* 批量处理队列面板 */}
        <BatchQueuePanel />

        {currentStepIndex === 1 ? (
          <>
                        
            {/* 主内容区域：配置界面 + 右侧预览 */}
            <div className="flex gap-4">
              {/* 配置界面 */}
              <div className="flex-1 space-y-4">
                {/* 步骤1: 文件上传和配置 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="h-5 w-5" />
                      {t('upload.title')}
                    </CardTitle>
                    <CardDescription>
                      {t('upload.description')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="file">{t('upload.selectFile')}</Label>
                      <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-50 dark:bg-gray-800">
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 min-w-0 flex-1">
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {file?.name || t('upload.noFileSelected')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => document.getElementById('file')?.click()}
                            disabled={processing}
                            className="flex items-center gap-2"
                          >
                            <Upload className="h-4 w-4" />
                              {t('upload.localUpload')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={openWebDAVBrowser}
                              disabled={processing}
                            className="flex items-center gap-2"
                          >
                            <Network className="h-4 w-4" />
                            WebDAV
                          </Button>
                          <BatchProcessingDialog />
                        </div>
                      </div>
                      <Input
                        id="file"
                        type="file"
                        accept=".epub,.pdf"
                        onChange={handleFileChange}
                        disabled={processing}
                        className="hidden" // 隐藏原始input，通过按钮触发
                      />
                    </div>

                    <div className="flex items-center justify-end">
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={extractChapters}
                          disabled={!file || extractingChapters || processing}
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-2"
                        >
                          {extractingChapters ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {t('upload.extractingChapters')}
                            </>
                          ) : (
                            <>
                              <List className="h-4 w-4" />
                              {t('upload.extractChapters')}
                            </>
                          )}
                        </Button>
                        <ConfigDialog processing={processing} file={file} />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={clearBookCache}
                          disabled={processing}
                          className="flex items-center gap-1 text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('upload.clearCache')}
                        </Button>
                      </div>
                    </div>

                    {/* 云端缓存提示 */}
                    {isCheckingCloudCache && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在检查云端缓存...
                      </div>
                    )}
                    {cloudCacheMetadata && !isCheckingCloudCache && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                            发现云端缓存
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>处理时间: {new Date(cloudCacheMetadata.processedAt).toLocaleString()}</p>
                          <p>处理模型: {cloudCacheMetadata.model}</p>
                          <p>章节数: {cloudCacheMetadata.chapterCount}</p>
                          {cloudCacheMetadata.costUSD > 0 && (
                            <p>费用: ${cloudCacheMetadata.costUSD} / ¥{cloudCacheMetadata.costRMB}</p>
                          )}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-2 w-full"
                          onClick={loadFromCloudCache}
                        >
                          使用云端缓存
                        </Button>
                      </div>
                    )}
                    {cloudCacheContent === null && !isCheckingCloudCache && file && webdavConfig.enabled && webdavService.isInitialized() && (
                      <div className="text-xs text-muted-foreground">
                        云端暂无缓存，将进行新处理
                      </div>
                    )}
                  </CardContent>
                </Card>
                {/* 章节信息 */}
                {extractedChapters && bookData && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <List className="h-5 w-5" />
                        {t('chapters.title')}
                      </CardTitle>
                      <CardDescription>
                        {bookData.title} - {bookData.author} | {t('chapters.totalChapters', { count: extractedChapters.length })}，{t('chapters.selectedChapters', { count: selectedChapters.size })}
                      </CardDescription>
                      <div className="flex items-center gap-2 mt-2">
                        <Checkbox
                          id="select-all"
                          checked={selectedChapters.size === extractedChapters.length}
                          onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                        />
                        <Label htmlFor="select-all" className="text-sm font-medium">
                          {t('chapters.selectAll')}
                        </Label>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {extractedChapters.map((chapter) => (
                          <div key={chapter.id} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                            <Checkbox
                              id={`chapter-${chapter.id}`}
                              checked={selectedChapters.has(chapter.id)}
                              onCheckedChange={(checked) => handleChapterSelect(chapter.id, checked as boolean)}
                            />
                            <Label
                              htmlFor={`chapter-${chapter.id}`}
                              className="text-sm truncate cursor-pointer flex-1"
                              title={chapter.title}
                            >
                              {chapter.title}
                            </Label>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewChapterContent(chapter)}
                            >
                              <BookOpen className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>

                      {/* 自定义提示词输入框 */}
                      <div className="space-y-2">
                        <Label htmlFor="custom-prompt" className="text-sm font-medium">
                          {t('chapters.customPrompt')}
                        </Label>
                        <Textarea
                          id="custom-prompt"
                          placeholder={t('chapters.customPromptPlaceholder')}
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          className="min-h-20 resize-none"
                          disabled={processing || extractingChapters}
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t('chapters.customPromptDescription')}
                        </p>
                      </div>

                      <Button
                        onClick={() => {
                          if (!apiKey) {
                            toast.error(t('chapters.apiKeyRequired'), {
                              duration: 3000,
                              position: 'top-center',
                            })
                            return
                          }
                          processBook()
                        }}
                        disabled={!extractedChapters || processing || extractingChapters || selectedChapters.size === 0}
                        className="w-full"
                      >
                        {processing ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t('chapters.processing')}
                          </>
                        ) : (
                          <>
                            <Brain className="mr-2 h-4 w-4" />
                            {t('progress.startProcessing')}
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* 右侧预览区域 */}
              {rightPanelContent && (
                <Card ref={previewCardRef} className="w-80 lg:w-96 h-fit sticky top-4">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium truncate flex-1">
                        {rightPanelContent.title}
                      </CardTitle>
                      <div className="flex items-center gap-1">
                        {/* 字体大小调节按钮 - 只在 EPUB 时显示 */}
                        {file?.name.endsWith('.epub') && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={decreasePreviewFontSize}
                              disabled={previewFontSize <= 12}
                              className="h-6 w-6 p-0"
                              title={t('reader.epub.decreaseFontSize', '减小字体')}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="text-xs font-medium px-1 min-w-[2.5rem] text-center">
                              {previewFontSize}px
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={increasePreviewFontSize}
                              disabled={previewFontSize >= 24}
                              className="h-6 w-6 p-0"
                              title={t('reader.epub.increaseFontSize', '增大字体')}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        
                        {/* 全屏按钮 - 只在 EPUB 时显示 */}
                        {file?.name.endsWith('.epub') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={togglePreviewFullscreen}
                            className="h-6 w-6 p-0"
                            title={isPreviewFullscreen ? t('reader.epub.exitFullscreen', '退出全屏') : t('reader.epub.enterFullscreen', '进入全屏')}
                          >
                            {isPreviewFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                          </Button>
                        )}
                        
                        {/* 关闭按钮 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCloseRightPanel}
                          className="h-6 w-6 p-0"
                        >
                          ×
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="max-h-96 overflow-y-auto overscroll-contain">
                      {file?.name.endsWith('.epub') ? (
                        <EpubReader
                          chapter={rightPanelContent.chapter}
                          bookData={fullBookData}
                          onClose={handleCloseRightPanel}
                          showHeader={false}
                          externalFontSize={previewFontSize}
                          externalFullscreen={isPreviewFullscreen}
                          onToggleFullscreen={togglePreviewFullscreen}
                        />
                      ) : (
                        <PdfReader
                          chapter={rightPanelContent.chapter}
                          bookData={fullBookData}
                          onClose={handleCloseRightPanel}
                          showHeader={false}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        ) : (
          <>
            {/* 步骤2: 处理过程和结果显示 */}
            
            
            {/* 主内容区域：左侧章节总结导航 + 中间结果 + 右侧预览 */}
            <div className="flex gap-4">
              {/* 左侧章节总结导航 */}
              {processingMode === 'summary' ? (
                <ChapterSummaryNavigation
                  chapters={bookSummary?.chapters || []}
                  totalChapters={extractedChapters?.length || 0}
                  currentStepIndex={currentStepIndex}
                  processingMode={processingMode}
                  onChapterClick={handleChapterSummaryNavigation}
                  processing={processing}
                  currentProcessingChapter={currentProcessingChapter}
                  currentViewingChapter={currentViewingChapterSummary}
                />
              ) : (
                <TimelineNavigation
                  chapters={bookMindMap?.chapters || []}
                  currentStepIndex={currentStepIndex}
                  processingMode={processingMode}
                  onChapterClick={handleChapterNavigation}
                  processing={processing}
                  currentProcessingChapter={currentProcessingChapter}
                />
              )}

              {/* 中间结果展示 */}
              <div className="flex-1">
                {(bookSummary || bookMindMap) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <div className="truncate flex-1 w-1">
                          {processingMode === 'summary' ? (
                            <><BookOpen className="h-5 w-5 inline-block mr-2" />{t('results.summaryTitle', { title: bookSummary?.title })}</>
                          ) : processingMode === 'mindmap' ? (
                            <><Network className="h-5 w-5 inline-block mr-2" />{t('results.chapterMindMapTitle', { title: bookMindMap?.title })}</>
                          ) : (
                            <><Network className="h-5 w-5 inline-block mr-2" />{t('results.wholeMindMapTitle', { title: bookMindMap?.title })}</>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <FontSizeControl variant="compact" showLabel={false} />
                          {processingMode === 'summary' && bookSummary && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={downloadAllMarkdown}
                              className="flex items-center gap-2"
                            >
                              <Download className="h-4 w-4" />
                              {t('download.downloadAllMarkdown')}
                            </Button>
                          )}
                          {processingMode === 'summary' && bookSummary && (
                            <UploadToWebDAVButton 
                              bookSummary={bookSummary}
                              file={file}
                              chapterNamingMode={processingOptions.chapterNamingMode}
                            />
                          )}
                        </div>
                      </CardTitle>
                      <CardDescription>
                        {t('results.author', { author: bookSummary?.author || bookMindMap?.author })} | {t('results.chapterCount', { count: bookSummary?.chapters.length || bookMindMap?.chapters.length })}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {processingMode === 'summary' && bookSummary ? (
                        <Tabs defaultValue="chapters" className="w-full">
                          <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="chapters">{t('results.tabs.chapterSummary')}</TabsTrigger>
                            <TabsTrigger value="connections">{t('results.tabs.connections')}</TabsTrigger>
                            <TabsTrigger value="overall">{t('results.tabs.overallSummary')}</TabsTrigger>
                          </TabsList>

                          <TabsContent value="chapters" className="grid grid-cols-1 gap-4">
                            {bookSummary.chapters.map((chapter, index) => (
                              <MarkdownCard
                                key={chapter.id}
                                id={chapter.id}
                                title={chapter.title}
                                content={chapter.content}
                                markdownContent={chapter.summary || ''}
                                index={index}
                                defaultCollapsed={index > 0}
                                isExpanded={expandedChapters.has(chapter.id)}
                                onExpandChange={(isExpanded) => handleChapterExpandChange(chapter.id, isExpanded)}
                                onClearCache={() => clearChapterCache(chapter.id)}
                                onReadChapter={() => {
                                  // 根据章节ID找到对应的ChapterData
                                  const chapterData = extractedChapters?.find(ch => ch.id === chapter.id)
                                  if (chapterData) {
                                    handleViewChapterContent(chapterData)
                                  }
                                }}
                              />
                            ))}
                          </TabsContent>

                          <TabsContent value="connections">
                            <MarkdownCard
                              id="connections"
                              title={t('results.tabs.connections')}
                              content={bookSummary.connections}
                              markdownContent={bookSummary.connections}
                              index={0}
                              showClearCache={true}
                              showViewContent={false}
                              showCopyButton={true}
                              onClearCache={() => clearSpecificCache('connections')}
                            />
                          </TabsContent>

                          <TabsContent value="overall">
                            <MarkdownCard
                              id="overall"
                              title={t('results.tabs.overallSummary')}
                              content={bookSummary.overallSummary}
                              markdownContent={bookSummary.overallSummary}
                              index={0}
                              showClearCache={true}
                              showViewContent={false}
                              showCopyButton={true}
                              onClearCache={() => clearSpecificCache('overall_summary')}
                            />
                          </TabsContent>
                        </Tabs>
                      ) : processingMode === 'mindmap' && bookMindMap ? (
                        <Tabs defaultValue="chapters" className="w-full">
                          <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="chapters">{t('results.tabs.chapterMindMaps')}</TabsTrigger>
                            <TabsTrigger value="combined">{t('results.tabs.combinedMindMap')}</TabsTrigger>
                          </TabsList>

                          <TabsContent value="chapters" className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {bookMindMap.chapters.map((chapter, index) => (
                              chapter.mindMap && (
                                <MindMapCard
                                  key={chapter.id}
                                  id={chapter.id}
                                  title={chapter.title}
                                  content={chapter.content}
                                  mindMapData={chapter.mindMap}
                                  index={index}
                                  showCopyButton={false}
                                  onClearCache={() => clearChapterMindMapCache(chapter.id)}
                                  onOpenInMindElixir={openInMindElixir}
                                  onDownloadMindMap={downloadMindMap}
                                  mindElixirOptions={options}
                                />
                              )
                            ))}
                          </TabsContent>

                          <TabsContent value="combined">
                            {bookMindMap.combinedMindMap ? (
                              <MindMapCard
                                id="combined"
                                title={t('results.tabs.combinedMindMap')}
                                content=""
                                mindMapData={bookMindMap.combinedMindMap}
                                index={0}
                                onOpenInMindElixir={(mindmapData) => openInMindElixir(mindmapData, t('results.combinedMindMapTitle', { title: bookMindMap.title }))}
                                onDownloadMindMap={downloadMindMap}
                                onClearCache={() => clearSpecificCache('merged_mindmap')}
                                showClearCache={true}
                                showViewContent={false}
                                showCopyButton={false}
                                mindMapClassName="w-full h-[600px] mx-auto"
                                mindElixirOptions={options}
                              />
                            ) : (
                              <Card>
                                <CardContent>
                                  <div className="text-center text-gray-500 py-8">
                                    {t('results.generatingMindMap')}
                                  </div>
                                </CardContent>
                              </Card>
                            )}
                          </TabsContent>
                        </Tabs>
                      ) : processingMode === 'combined-mindmap' && bookMindMap ? (
                        bookMindMap.combinedMindMap ? (
                          <MindMapCard
                            id="whole-book"
                            title={t('results.tabs.combinedMindMap')}
                            content=""
                            mindMapData={bookMindMap.combinedMindMap}
                            index={0}
                            onOpenInMindElixir={(mindmapData) => openInMindElixir(mindmapData, t('results.combinedMindMapTitle', { title: bookMindMap.title }))}
                            onDownloadMindMap={downloadMindMap}
                            onClearCache={() => clearSpecificCache('combined_mindmap')}
                            showClearCache={true}
                            showViewContent={false}
                            showCopyButton={false}
                            mindMapClassName="w-full h-[600px] mx-auto"
                            mindElixirOptions={options}
                          />
                        ) : (
                          <Card>
                            <CardContent>
                              <div className="text-center text-gray-500 py-8">
                                {t('results.generatingMindMap')}
                              </div>
                            </CardContent>
                          </Card>
                        )
                      ) : null}
                    </CardContent>
                  </Card>
                )}

                {!bookSummary && !bookMindMap && !processing && (
                  <div className="text-center py-8">
                    <Brain className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">
                      {t('results.noResults')}
                    </p>
                  </div>
                )}
              </div>

              {/* 右侧预览区域 */}
              {rightPanelContent && (
                <Card className="w-80 lg:w-96 h-fit sticky top-4">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium truncate">
                        {rightPanelContent.title}
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCloseRightPanel}
                        className="h-6 w-6 p-0"
                      >
                        ×
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="max-h-96 overflow-y-auto overscroll-contain">
                      {file?.name.endsWith('.epub') ? (
                        <EpubReader
                          chapter={rightPanelContent.chapter}
                          bookData={fullBookData}
                          onClose={handleCloseRightPanel}
                          showHeader={false}
                        />
                      ) : (
                        <PdfReader
                          chapter={rightPanelContent.chapter}
                          bookData={fullBookData}
                          onClose={handleCloseRightPanel}
                          showHeader={false}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
        
        
        {/* 章节阅读器 */}
        {currentReadingChapter && (
          file.name.endsWith('.epub') ? (
            <EpubReader
              className="w-[800px] shrink-0 sticky top-0"
              chapter={currentReadingChapter}
              bookData={fullBookData}
              onClose={() => setCurrentReadingChapter(null)}
            />
          ) : (
            <PdfReader
              className="w-[800px] shrink-0 sticky top-0"
              chapter={currentReadingChapter}
              bookData={fullBookData}
              onClose={() => setCurrentReadingChapter(null)}
            />
          )
        )}

        {/* 回到顶部按钮 */}
        {showBackToTop && (
          <Button
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 z-50 rounded-full w-12 h-12 shadow-lg hover:shadow-xl transition-all duration-300 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            size="icon"
            aria-label={t('common.backToTop')}
          >
            <ChevronUp className="h-6 w-6" />
          </Button>
        )}
      </div>
    </div>
  )
}

export default App
