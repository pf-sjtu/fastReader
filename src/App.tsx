import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { BookOpen, Brain, ChevronUp } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import type { MindElixirData } from 'mind-elixir'

import { webdavService } from '@/services/webdavService'
import { metadataFormatter } from '@/services/metadataFormatter'
import { normalizeMarkdownTypography } from '@/lib/markdown'
import { scrollToTop } from '@/utils/index'
import { useConfigStore } from '@/stores/configStore'
import { useBookProcessing } from '@/hooks/useBookProcessing'

import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { DarkModeToggle } from '@/components/DarkModeToggle'
import { UnifiedStatusBar } from '@/components/UnifiedStatusBar'
import { WebDAVFileBrowser } from '@/components/project/WebDAVFileBrowser'
import { BatchQueuePanel } from '@/components/project/BatchQueuePanel'
import { ChapterSummaryNavigation } from '@/components/ChapterSummaryNavigation'
import { TimelineNavigation } from '@/components/TimelineNavigation'
import { EpubReader } from '@/components/EpubReader'
import { PdfReader } from '@/components/PdfReader'

import { FileUploadCard } from '@/components/sections/FileUploadCard'
import { ChapterSelectionSection } from '@/components/sections/ChapterSelectionSection'
import { PreviewPanel } from '@/components/sections/PreviewPanel'
import { ResultsSection } from '@/components/sections/ResultsSection'

function App() {
  const { t } = useTranslation()
  const { aiConfig, processingOptions, webdavConfig } = useConfigStore()

  // 页面步骤状态 (1: 配置, 2: 结果)
  const [currentStepIndex, setCurrentStepIndex] = useState(1)
  const [showBackToTop, setShowBackToTop] = useState(false)

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
    rightPanelContent,
    currentViewingChapterSummary,
    previewFontSize,
    isPreviewFullscreen,
    previewCardRef,
    isWebDAVBrowserOpen,
    tokenUsage,
    processingMode,
    fullBookData,

    // 动作
    handleFileSelect,
    extractChapters,
    processBook,
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

  // WebDAV 自动连接
  useEffect(() => {
    const initializeWebDAVIfNeeded = async () => {
      if (webdavConfig.enabled &&
          webdavConfig.serverUrl &&
          webdavConfig.username &&
          webdavConfig.password &&
          !webdavService.isInitialized()) {
        try {
          const initResult = await webdavService.initialize(webdavConfig)
          if (initResult.success) {
            toast.success(t('webdav.autoConnected'))
          }
        } catch (error) {
          console.error('App: WebDAV自动连接异常:', error)
        }
      }
    }

    const timer = setTimeout(initializeWebDAVIfNeeded, 3000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 下载所有 Markdown
  const downloadAllMarkdown = useCallback(() => {
    if (!bookSummary || !file) return

    const chapters = bookSummary.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary || ''
    }))

    const bookDataForExport = {
      title: bookSummary.title,
      author: bookSummary.author,
      chapters: chapters,
      overallSummary: bookSummary.overallSummary,
      connections: bookSummary.connections
    }

    const originalCharCount = bookSummary.chapters.reduce(
      (total: number, chapter) => total + (chapter.content?.length || 0), 0
    )

    const processedCharCount = bookSummary.chapters.reduce(
      (total: number, chapter) => total + (chapter.summary?.length || 0), 0
    )

    const selectedChapterIndices = bookSummary.chapters
      .map((_, index) => index + 1)
      .filter((_, index) => bookSummary.chapters[index]?.summary)

    const metadata = metadataFormatter.generate({
      fileName: file.name,
      bookTitle: bookSummary.title,
      model: aiConfig.model,
      chapterDetectionMode: processingOptions.chapterDetectionMode,
      selectedChapters: selectedChapterIndices,
      chapterCount: bookSummary.chapters.length,
      originalCharCount: originalCharCount,
      processedCharCount: processedCharCount
    })

    let markdownContent = metadataFormatter.formatUnified(bookDataForExport, metadata, processingOptions.chapterNamingMode)
    markdownContent = normalizeMarkdownTypography(markdownContent)

    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const baseFileName = file.name.replace(/\.[^/.]+$/, '')
    link.download = `${baseFileName}_总结.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast.success(t('download.downloadSuccess'))
  }, [bookSummary, file, aiConfig.model, processingOptions.chapterDetectionMode, processingOptions.chapterNamingMode, t])

  // 在 MindElixir 中打开
  const openInMindElixir = useCallback((mindMapData: MindElixirData, title?: string) => {
    // 实际实现需要在 MindMapCard 中处理
    console.log('Open in MindElixir:', title)
  }, [])

  // 下载思维导图
  const downloadMindMap = useCallback((mindMapData: MindElixirData, title?: string) => {
    const blob = new Blob([JSON.stringify(mindMapData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${title || 'mindmap'}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [])

  // 开始处理并切换到结果页
  const handleStartProcessing = useCallback(async () => {
    setCurrentStepIndex(2)
    await processBook()
  }, [processBook])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:via-blue-950 dark:to-slate-900 p-4 flex justify-center gap-4 h-screen overflow-auto scroll-container">
      <Toaster />
      <WebDAVFileBrowser
        isOpen={isWebDAVBrowserOpen}
        onClose={() => setIsWebDAVBrowserOpen(false)}
        onFileSelect={handleWebDAVFileSelect}
      />

      <div className="max-w-full xl:max-w-7xl space-y-4 w-full flex-1">
        {/* Header */}
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
          currentModel={aiConfig.model}
          tokenUsage={tokenUsage}
          onToggleView={() => setCurrentStepIndex(currentStepIndex === 1 ? 2 : 1)}
        />

        {/* 批量处理队列面板 */}
        <BatchQueuePanel />

        {currentStepIndex === 1 ? (
          // 配置步骤
          <div className="flex gap-4">
            {/* 配置界面 */}
            <div className="flex-1 space-y-4">
              <FileUploadCard
                file={file}
                processing={processing}
                extractingChapters={extractingChapters}
                isCheckingCloudCache={isCheckingCloudCache}
                cloudCacheMetadata={cloudCacheMetadata}
                cloudCacheContent={cloudCacheContent}
                webdavEnabled={webdavConfig.enabled}
                webdavInitialized={webdavService.isInitialized()}
                onFileSelect={handleFileSelect}
                onExtractChapters={extractChapters}
                onClearCache={clearBookCache}
                onOpenWebDAVBrowser={openWebDAVBrowser}
                onLoadFromCloudCache={loadFromCloudCache}
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
                  onCustomPromptChange={setCustomPrompt}
                  onViewChapterContent={handleViewChapterContent}
                  onStartProcessing={handleStartProcessing}
                />
              )}
            </div>

            {/* 右侧预览区域 */}
            {rightPanelContent && (
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
              />
            )}
          </div>
        ) : (
          // 结果步骤
          <div className="flex gap-4">
            {/* 左侧导航 */}
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
              {(bookSummary || bookMindMap) ? (
                <ResultsSection
                  processingMode={processingMode}
                  bookSummary={bookSummary}
                  bookMindMap={bookMindMap}
                  file={file}
                  expandedChapters={expandedChapters}
                  currentViewingChapterSummary={currentViewingChapterSummary}
                  onClearChapterCache={clearChapterCache}
                  onClearSpecificCache={clearSpecificCache}
                  onChapterExpandChange={handleChapterExpandChange}
                  onReadChapter={(chapterId) => {
                    const chapter = extractedChapters?.find(ch => ch.id === chapterId)
                    if (chapter) handleViewChapterContent(chapter)
                  }}
                  onDownloadAllMarkdown={downloadAllMarkdown}
                  onOpenInMindElixir={openInMindElixir}
                  onDownloadMindMap={downloadMindMap}
                />
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

            {/* 右侧预览区域 */}
            {rightPanelContent && (
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
              />
            )}
          </div>
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
