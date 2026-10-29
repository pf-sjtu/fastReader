import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { BookOpen, Brain, ChevronUp, List, Eye } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import type { MindElixirInstance } from 'mind-elixir'
import { useShallow } from 'zustand/react/shallow'

import { webdavService } from '@/services/webdavService'
import { scrollToTop } from '@/utils/index'
import { downloadSummaryMarkdown } from '@/utils/exportSummary'
import { exportMindMap } from '@/utils/mindmapExport'
import { useConfigStore } from '@/stores/configStore'
import { useBookProcessing } from '@/hooks/useBookProcessing'
import { useChapterScrollSpy } from '@/hooks/useChapterScrollSpy'
import { useIsMobile } from '@/hooks/use-mobile'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import type { ProcessingHistoryRecord } from '@/stores/processingHistory'

import { BUILD_VERSION } from '@/buildInfo'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { DarkModeToggle } from '@/components/DarkModeToggle'
import { UnifiedStatusBar } from '@/components/UnifiedStatusBar'
import { SyncStatusIndicator } from '@/components/SyncStatusIndicator'
import { ChapterSummaryNavigation } from '@/components/ChapterSummaryNavigation'
import { TimelineNavigation } from '@/components/TimelineNavigation'

import { FileUploadCard } from '@/components/sections/FileUploadCard'
import { ChapterSelectionSection } from '@/components/sections/ChapterSelectionSection'
import { PreviewPanel } from '@/components/sections/PreviewPanel'

// 重型面板懒加载，降低首屏解析体积
const ResultsSection = lazy(() =>
  import('@/components/sections/ResultsSection').then((m) => ({ default: m.ResultsSection }))
)
const WebDAVFileBrowser = lazy(() =>
  import('@/components/project/WebDAVFileBrowser').then((m) => ({ default: m.WebDAVFileBrowser }))
)
const BatchQueuePanel = lazy(() =>
  import('@/components/project/BatchQueuePanel').then((m) => ({ default: m.BatchQueuePanel }))
)

/** 懒加载面板的占位骨架（避免出现「点了没反应」的空白期） */
function PanelSkeleton() {
  return (
    <div className="space-y-2 py-2" aria-hidden="true">
      <div className="h-8 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  )
}

function App() {
  const { t } = useTranslation()
  // selector 订阅：tokenUsage 等高频字段变化不触发 App 重渲染
  const { aiConfig, processingOptions, webdavConfig } = useConfigStore(
    useShallow((s) => ({
      aiConfig: s.aiConfig,
      processingOptions: s.processingOptions,
      webdavConfig: s.webdavConfig,
    }))
  )
  const isMobile = useIsMobile()

  // 页面步骤状态 (1: 配置, 2: 结果)
  const [currentStepIndex, setCurrentStepIndex] = useState(1)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [navSheetOpen, setNavSheetOpen] = useState(false)
  const [previewSheetOpen, setPreviewSheetOpen] = useState(false)

  // 使用 book processing hook
  const {
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
    cloudCacheIsPartial,
    cloudCacheStatusUnknown,
    rightPanelContent,
    currentViewingChapterSummary,
    previewFontSize,
    isPreviewFullscreen,
    isWebDAVBrowserOpen,
    processingMode,
    fullBookData,

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
    clearSpecificCache,
    regenerateKeyCharts,
    chartsGenerating,
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
    setSelectedChapters,
    setIsWebDAVBrowserOpen,
    setCurrentViewingChapterSummary,
  } = useBookProcessing()

  // 监听滚动事件
  useEffect(() => {
    const scrollContainer = document.querySelector('.scroll-container')
    if (!scrollContainer) return

    const handleScroll = () => {
      setShowBackToTop(scrollContainer.scrollTop > 300)
    }

    scrollContainer.addEventListener('scroll', handleScroll)
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [])

  // WebDAV 自动连接：配置一变就（重新）连接，而不是只在挂载后 3 秒试一次
  useEffect(() => {
    if (
      !webdavConfig.enabled ||
      !webdavConfig.serverUrl ||
      !webdavConfig.username ||
      !webdavConfig.password?.hasSecret ||
      webdavService.isInitialized()
    ) {
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const initResult = await webdavService.initialize(webdavConfig)
        if (!cancelled && initResult.success) {
          toast.success(t('webdav.autoConnected'))
        }
      } catch (error) {
        console.error('App: WebDAV 自动连接异常:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [webdavConfig, t])

  // 下载完整 Markdown（不依赖本地 File：历史/云缓存加载后也可导出）
  const downloadAllMarkdown = useCallback(() => {
    if (!bookSummary) {
      toast.error(t('download.noContent'))
      return
    }
    try {
      downloadSummaryMarkdown({
        bookSummary,
        fileName: file?.name,
        model: aiConfig.model,
        chapterDetectionMode: processingOptions.chapterDetectionMode,
        chapterNamingMode: processingOptions.chapterNamingMode,
        epubTocDepth: processingOptions.epubTocDepth,
      })
      toast.success(t('download.markdownDownloaded'))
    } catch (error) {
      console.error('Markdown 下载失败:', error)
      toast.error(t('download.downloadFailed'))
    }
  }, [
    bookSummary,
    file,
    aiConfig.model,
    processingOptions.chapterDetectionMode,
    processingOptions.chapterNamingMode,
    processingOptions.epubTocDepth,
    t,
  ])

  // 导出思维导图：按用户选择的格式导出（PNG/JPEG/WEBP/SVG/HTML/JSON/Markdown）
  const downloadMindMap = useCallback((instance: MindElixirInstance, title: string, format: string) => {
    void (async () => {
      try {
        const { filename } = await exportMindMap(instance, title, format)
        toast.success(t('download.fileDownloaded', { filename }))
      } catch (error) {
        console.error('思维导图导出失败:', error)
        toast.error(t('download.downloadFailed'))
      }
    })()
  }, [t])

  // 开始处理并切换到结果页
  const handleStartProcessing = useCallback(async () => {
    setCurrentStepIndex(2)
    await processBook()
  }, [processBook])

  // 中止后返回配置改设置
  const handleAbortToConfig = useCallback(() => {
    cancelProcessing()
    setCurrentStepIndex(1)
  }, [cancelProcessing])

  // 处理中「返回配置」的二次确认在 UnifiedStatusBar 内完成，这里只负责切换视图
  const handleToggleView = useCallback(() => {
    setCurrentStepIndex((step) => (step === 1 ? 2 : 1))
  }, [])

  const handleSetSelection = useCallback(
    (chapterIds: string[]) => setSelectedChapters(new Set(chapterIds)),
    [setSelectedChapters]
  )

  const handleReadChapter = useCallback(
    (chapterId: string) => {
      const chapter = extractedChapters?.find((ch) => ch.id === chapterId)
      if (chapter) handleViewChapterContent(chapter)
    },
    [extractedChapters, handleViewChapterContent]
  )

  const handleCloseWebDAVBrowser = useCallback(
    () => setIsWebDAVBrowserOpen(false),
    [setIsWebDAVBrowserOpen]
  )

  const handleLoadFromCloudCache = useCallback(() => {
    void (async () => {
      const ok = await loadFromCloudCache()
      if (ok) setCurrentStepIndex(2)
    })()
  }, [loadFromCloudCache])

  // 按当前配置重新处理（可先在配置页改设置再点）
  const handleRestartProcessing = useCallback(async () => {
    setCurrentStepIndex(2)
    await restartProcessing()
  }, [restartProcessing])

  // 从历史记录加载云端缓存
  const handleLoadFromHistory = useCallback(async (record: ProcessingHistoryRecord): Promise<boolean> => {
    const success = await loadFromHistoryRecord(record.fileName)
    if (success) {
      setCurrentStepIndex(2)
    }
    return success
  }, [loadFromHistoryRecord])

  // 移动端：打开原文预览时自动弹出预览 Sheet
  useEffect(() => {
    if (isMobile && rightPanelContent) {
      setPreviewSheetOpen(true)
    } else if (!rightPanelContent) {
      setPreviewSheetOpen(false)
    }
  }, [isMobile, rightPanelContent])

  // 切换步骤时关闭移动端抽屉
  useEffect(() => {
    setNavSheetOpen(false)
  }, [currentStepIndex])

  const handleMobileChapterNavClick = useCallback((chapterId: string) => {
    handleChapterNavigation(chapterId)
    setNavSheetOpen(false)
  }, [handleChapterNavigation])

  // 关闭 Sheet 时保留 rightPanelContent，便于「预览」按钮再次打开
  const handlePreviewSheetOpenChange = useCallback((open: boolean) => {
    setPreviewSheetOpen(open)
  }, [])

  const summaryNavChapters = useMemo(() => bookSummary?.chapters || [], [bookSummary])
  const mindmapNavChapters = useMemo(() => bookMindMap?.chapters || [], [bookMindMap])
  const showSummaryNav =
    currentStepIndex === 2 &&
    processingMode === 'summary' &&
    summaryNavChapters.length > 0
  const showMindmapNav =
    currentStepIndex === 2 &&
    processingMode !== 'summary' &&
    (processing || mindmapNavChapters.length > 0)
  const showMobileNavTrigger = isMobile && (showSummaryNav || showMindmapNav)

  const summaryChapterIds = useMemo(
    () => summaryNavChapters.map((ch) => ch.id),
    [summaryNavChapters]
  )

  // 目录跟随主内容滚动：更新当前阅读章节
  const { lock: lockScrollSpy } = useChapterScrollSpy({
    chapterIds: summaryChapterIds,
    enabled: showSummaryNav,
    idPrefix: 'chapter-summary-',
    containerSelector: '.scroll-container',
    onChapterChange: setCurrentViewingChapterSummary,
  })

  const handleSummaryNavClick = useCallback(
    (chapterId: string) => {
      lockScrollSpy()
      handleChapterSummaryNavigation(chapterId)
    },
    [lockScrollSpy, handleChapterSummaryNavigation]
  )

  const handleMobileChapterSummaryClick = useCallback(
    (chapterId: string) => {
      lockScrollSpy()
      handleChapterSummaryNavigation(chapterId)
      setNavSheetOpen(false)
    },
    [lockScrollSpy, handleChapterSummaryNavigation]
  )

  // 移动端角标：处理中=处理进度，完成后=阅读进度
  const viewingNavIndex = currentViewingChapterSummary
    ? summaryNavChapters.findIndex((ch) => ch.id === currentViewingChapterSummary)
    : -1
  const processedNavCount = showSummaryNav
    ? processing
      ? summaryNavChapters.filter((ch) => ch.processed).length
      : viewingNavIndex >= 0
        ? viewingNavIndex + 1
        : 0
    : mindmapNavChapters.filter((ch) => ch.processed).length
  const totalNavCount = showSummaryNav
    ? summaryNavChapters.length
    : mindmapNavChapters.length

  const desktopPreview = !isMobile && rightPanelContent ? (
    <PreviewPanel
      chapter={rightPanelContent.chapter}
      title={rightPanelContent.title}
      fileName={file?.name || ''}
      bookData={fullBookData}
      fontSize={previewFontSize}
      isFullscreen={isPreviewFullscreen}
      onClose={handleCloseRightPanel}
      onIncreaseFontSize={increasePreviewFontSize}
      onDecreaseFontSize={decreasePreviewFontSize}
      onToggleFullscreen={togglePreviewFullscreen}
      variant="sidebar"
    />
  ) : null

  return (
    <div className="min-h-screen bg-background px-1.5 py-2.5 sm:p-4 flex justify-center gap-4 h-screen overflow-y-auto overflow-x-hidden scroll-container pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <Toaster />
      <ErrorBoundary section={t('errorBoundary.webdavBrowser')}>
        <Suspense fallback={<PanelSkeleton />}>
          <WebDAVFileBrowser
            isOpen={isWebDAVBrowserOpen}
            onClose={handleCloseWebDAVBrowser}
            onFileSelect={handleWebDAVFileSelect}
          />
        </Suspense>
      </ErrorBoundary>

      <div className="max-w-full xl:max-w-7xl space-y-2.5 sm:space-y-4 w-full flex-1 min-w-0">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:block sm:relative sm:space-y-2 sm:text-center">
          <div className="flex items-center justify-between gap-2 sm:absolute sm:top-0 sm:right-0 sm:justify-end">
            <div className="sm:hidden flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 truncate">
                <BookOpen className="h-6 w-6 text-primary shrink-0" />
                <span className="truncate">{t('app.title')}</span>
              </h1>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <SyncStatusIndicator />
              <LanguageSwitcher />
              <DarkModeToggle />
            </div>
          </div>
          <div className="hidden sm:block text-center space-y-2">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 flex items-center justify-center gap-2">
              <BookOpen className="h-8 w-8 text-primary" />
              {t('app.title')}
            </h1>
            <p className="text-gray-600 dark:text-gray-300">{t('app.description')}</p>
          </div>
          <p className="sm:hidden text-sm text-gray-600 dark:text-gray-300">{t('app.description')}</p>
        </div>

        {/* 统一状态栏 */}
        <UnifiedStatusBar
          currentView={currentStepIndex === 1 ? 'config' : 'processing'}
          processing={processing}
          progress={progress}
          currentStep={currentStep}
          processingMode={processingMode}
          onToggleView={handleToggleView}
          onLoadFromHistory={handleLoadFromHistory}
          onCancelProcessing={cancelProcessing}
          onRestartProcessing={
            file && extractedChapters && selectedChapters.size > 0
              ? handleRestartProcessing
              : undefined
          }
          onAbortToConfig={handleAbortToConfig}
        />

        {/* 批量处理队列面板 */}
        <ErrorBoundary section={t('errorBoundary.batchQueue')}>
          <Suspense fallback={<PanelSkeleton />}>
            <BatchQueuePanel />
          </Suspense>
        </ErrorBoundary>

        {/* 移动端：章节导航 / 预览 触发条 */}
        {(showMobileNavTrigger || (isMobile && rightPanelContent)) && (
          <div className="flex items-center gap-2 md:hidden">
            {showMobileNavTrigger && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-9 flex-1 justify-center gap-2"
                onClick={() => setNavSheetOpen(true)}
              >
                <List className="h-4 w-4" />
                {t('mobile.chapters')}
                {totalNavCount > 0 && (
                  <Badge variant="secondary" className="text-xs font-normal">
                    {processedNavCount}/{totalNavCount}
                  </Badge>
                )}
              </Button>
            )}
            {isMobile && rightPanelContent && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-9 flex-1 justify-center gap-2"
                onClick={() => setPreviewSheetOpen(true)}
              >
                <Eye className="h-4 w-4" />
                {t('mobile.preview')}
              </Button>
            )}
          </div>
        )}

        {currentStepIndex === 1 ? (
          // 配置步骤
          <div className="flex flex-col md:flex-row gap-3 md:gap-4 min-w-0">
            <div className="flex-1 space-y-4 min-w-0">
              <FileUploadCard
                file={file}
                processing={processing}
                extractingChapters={extractingChapters}
                isCheckingCloudCache={isCheckingCloudCache}
                cloudCacheMetadata={cloudCacheMetadata}
                cloudCacheContent={cloudCacheContent}
                cloudChartsFileFound={cloudChartsFileFound}
                cloudCacheIsPartial={cloudCacheIsPartial}
                cloudCacheStatusUnknown={cloudCacheStatusUnknown}
                webdavEnabled={webdavConfig.enabled}
                webdavInitialized={webdavService.isInitialized()}
                onFileSelect={handleFileSelect}
                onExtractChapters={extractChapters}
                onClearCache={clearBookCache}
                onOpenWebDAVBrowser={openWebDAVBrowser}
                onLoadFromCloudCache={handleLoadFromCloudCache}
              />

              {extractedChapters && bookData && (
                <ChapterSelectionSection
                  extractedChapters={extractedChapters}
                  bookData={bookData}
                  selectedChapters={selectedChapters}
                  customPrompt={customPrompt}
                  processing={processing}
                  extractingChapters={extractingChapters}
                  onChapterSelect={handleChapterSelect}
                  onSelectAll={handleSelectAll}
                  onSetSelection={handleSetSelection}
                  onCustomPromptChange={setCustomPrompt}
                  onViewChapterContent={handleViewChapterContent}
                  onStartProcessing={handleStartProcessing}
                />
              )}
            </div>

            {desktopPreview}
          </div>
        ) : (
          // 结果步骤
          <div className="flex flex-col md:flex-row gap-3 md:gap-4 min-w-0">
            {/* 桌面：左侧导航 */}
            {!isMobile && processingMode === 'summary' && (
              <ChapterSummaryNavigation
                chapters={summaryNavChapters}
                totalChapters={extractedChapters?.length || 0}
                currentStepIndex={currentStepIndex}
                processingMode={processingMode}
                onChapterClick={handleSummaryNavClick}
                processing={processing}
                currentProcessingChapter={currentProcessingChapter}
                currentViewingChapter={currentViewingChapterSummary}
                variant="sidebar"
              />
            )}
            {!isMobile && processingMode !== 'summary' && (
              <TimelineNavigation
                chapters={mindmapNavChapters}
                currentStepIndex={currentStepIndex}
                processingMode={processingMode}
                onChapterClick={handleChapterNavigation}
                processing={processing}
                currentProcessingChapter={currentProcessingChapter}
                variant="sidebar"
              />
            )}

            {/* 中间结果展示 */}
            <div className="flex-1 min-w-0">
              {(bookSummary || bookMindMap) ? (
                <ErrorBoundary section={t('results.title')}>
                  <Suspense
                    fallback={
                      <Card>
                        <CardContent className="py-12 text-center text-muted-foreground">
                          {t('progress.loading')}
                        </CardContent>
                      </Card>
                    }
                  >
                    <ResultsSection
                      processingMode={processingMode}
                      bookSummary={bookSummary}
                      bookMindMap={bookMindMap}
                      file={file}
                      expandedChapters={expandedChapters}
                      onClearChapterCache={clearChapterCache}
                      onClearSpecificCache={clearSpecificCache}
                      onChapterExpandChange={handleChapterExpandChange}
                      onReadChapter={handleReadChapter}
                      onDownloadAllMarkdown={downloadAllMarkdown}
                      onDownloadMindMap={downloadMindMap}
                      onRegenerateKeyCharts={regenerateKeyCharts}
                      chartsGenerating={chartsGenerating}
                      totalChapters={selectedChapters.size}
                    />
                  </Suspense>
                </ErrorBoundary>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Brain className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">
                      {t('results.noResults')}
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setCurrentStepIndex(1)}
                    >
                      {t('common.backToConfig')}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            {desktopPreview}
          </div>
        )}

        {/* 移动端：章节导航 Sheet */}
        <Sheet open={navSheetOpen} onOpenChange={setNavSheetOpen}>
          <SheetContent side="left" className="w-[min(100%,20rem)] p-0 gap-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t('mobile.chapters')}</SheetTitle>
              <SheetDescription>{t('mobile.chaptersDescription')}</SheetDescription>
            </SheetHeader>
            <div className="h-full pt-2">
              {processingMode === 'summary' ? (
                <ChapterSummaryNavigation
                  chapters={summaryNavChapters}
                  totalChapters={extractedChapters?.length || 0}
                  currentStepIndex={currentStepIndex}
                  processingMode={processingMode}
                  onChapterClick={handleMobileChapterSummaryClick}
                  processing={processing}
                  currentProcessingChapter={currentProcessingChapter}
                  currentViewingChapter={currentViewingChapterSummary}
                  variant="sheet"
                />
              ) : (
                <TimelineNavigation
                  chapters={mindmapNavChapters}
                  currentStepIndex={currentStepIndex}
                  processingMode={processingMode}
                  onChapterClick={handleMobileChapterNavClick}
                  processing={processing}
                  currentProcessingChapter={currentProcessingChapter}
                  variant="sheet"
                />
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* 移动端：原文预览 Sheet */}
        <Sheet
          open={isMobile && previewSheetOpen && !!rightPanelContent}
          onOpenChange={handlePreviewSheetOpenChange}
        >
          <SheetContent
            side="right"
            className="w-full sm:max-w-md p-0 gap-0 flex flex-col"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{rightPanelContent?.title || t('mobile.preview')}</SheetTitle>
              <SheetDescription>{t('mobile.previewDescription')}</SheetDescription>
            </SheetHeader>
            {rightPanelContent && (
              <PreviewPanel
                chapter={rightPanelContent.chapter}
                title={rightPanelContent.title}
                fileName={file?.name || ''}
                bookData={fullBookData}
                fontSize={previewFontSize}
                isFullscreen={isPreviewFullscreen}
                onClose={() => handlePreviewSheetOpenChange(false)}
                onIncreaseFontSize={increasePreviewFontSize}
                onDecreaseFontSize={decreasePreviewFontSize}
                onToggleFullscreen={togglePreviewFullscreen}
                variant="sheet"
              />
            )}
          </SheetContent>
        </Sheet>

        {/* 构建号：YYYYMMDD.bN，提交前自动 bump */}
        <p
          className="pt-6 pb-1 text-center text-[10px] leading-none text-muted-foreground/40 select-all tabular-nums tracking-wide"
          title="build version"
        >
          {BUILD_VERSION}
        </p>

        {/* 回到顶部按钮 */}
        {showBackToTop && (
          <Button
            onClick={scrollToTop}
            className="fixed z-50 rounded-full w-12 h-12 shadow-lg hover:shadow-xl transition-all duration-300 bg-primary hover:bg-primary/90 text-primary-foreground right-[max(1.5rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))]"
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
