import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronUp, List, Eye } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { useShallow } from 'zustand/react/shallow'

import { scrollToTop } from '@/utils/index'
import { useConfigStore } from '@/stores/configStore'
import { useBookProcessing } from '@/hooks/useBookProcessing'
import { useLibraryOpen } from '@/hooks/useLibraryOpen'
import { useAppExports } from '@/hooks/useAppExports'
import { useBackToTop, useReadingFontAttr, useWebDAVAutoConnect } from '@/hooks/useAppShell'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import type { ProcessingHistoryRecord } from '@/stores/processingHistory'

import { BUILD_VERSION } from '@/buildInfo'
import { UnifiedStatusBar } from '@/components/UnifiedStatusBar'
import { ReaderWorkspace } from '@/components/workspace/ReaderWorkspace'
import { PreviewPanel } from '@/components/sections/PreviewPanel'
import { AppHeader } from '@/components/app/AppHeader'
import { ConfigStep } from '@/components/app/ConfigStep'
import { ClassicResults } from '@/components/app/ClassicResults'
import { MobileNavSheet, MobilePreviewSheet } from '@/components/app/MobileSheets'

// 重型面板懒加载，降低首屏解析体积
const WebDAVFileBrowser = lazy(() =>
  import('@/components/project/WebDAVFileBrowser').then((m) => ({ default: m.WebDAVFileBrowser }))
)
const BatchQueuePanel = lazy(() =>
  import('@/components/project/BatchQueuePanel').then((m) => ({ default: m.BatchQueuePanel }))
)

/** 懒加载面板的占位骨架（避免出现「点了没反应」的空白期） */
function PanelSkeleton() {
  return (
    <div className="space-y-2 py-2">
      <Skeleton variant="block" width="w-1/3" />
      <Skeleton width="w-2/3" />
      <Skeleton width="w-1/2" />
    </div>
  )
}

/**
 * 应用壳：持有「配置 / 结果」步骤状态，把 useBookProcessing 的结果分发给各视图。
 * 视图本身在 components/app/（配置步、经典结果、移动端抽屉、页头），副作用在 hooks/useApp*.ts。
 */
function App() {
  const { t } = useTranslation()
  // selector 订阅：tokenUsage 等高频字段变化不触发 App 重渲染
  const webdavConfig = useConfigStore(useShallow((s) => s.webdavConfig))
  const isMobile = useIsMobile()

  // 页面步骤状态 (1: 配置, 2: 结果)
  const [currentStepIndex, setCurrentStepIndex] = useState(1)
  // 配置页内的两段：书库 / 处理。选中书后自动切到「处理」，顶栏分段可随时回书库
  const [configSection, setConfigSection] = useState<'library' | 'process'>('library')
  const [navSheetOpen, setNavSheetOpen] = useState(false)
  const [previewSheetOpen, setPreviewSheetOpen] = useState(false)

  const book = useBookProcessing()
  const {
    file,
    processing,
    progress,
    currentStep,
    extractedChapters,
    selectedChapters,
    bookSummary,
    bookMindMap,
    rightPanelContent,
    processingMode,
    isWebDAVBrowserOpen,
    currentProcessingChapter,
    currentViewingChapterSummary,
    expandedChapters,
    chartsGenerating,
  } = book

  const showBackToTop = useBackToTop()
  useWebDAVAutoConnect(webdavConfig)
  useReadingFontAttr()
  const { downloadAllMarkdown, downloadMindMap } = useAppExports(bookSummary, file?.name)

  // 开始处理并切换到结果页
  const { processBook, cancelProcessing, restartProcessing, loadFromCloudCache, loadFromHistoryRecord } = book
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

  const { setSelectedChapters, handleViewChapterContent, handleChapterNavigation, setIsWebDAVBrowserOpen } = book
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

  const handleCloseWebDAVBrowser = useCallback(() => setIsWebDAVBrowserOpen(false), [setIsWebDAVBrowserOpen])

  const handleLoadFromCloudCache = useCallback(() => {
    void (async () => {
      const ok = await loadFromCloudCache()
      if (ok) setCurrentStepIndex(2)
    })()
  }, [loadFromCloudCache])

  // 书库：打开一本书 = 下载 + 走选文件流程；已精读的自动进入工作台
  const { openBook, openingPath, autoOpening } = useLibraryOpen({
    file,
    cloudCacheContent: book.cloudCacheContent,
    isCheckingCloudCache: book.isCheckingCloudCache,
    handleWebDAVFileSelect: book.handleWebDAVFileSelect,
    handleLoadFromCloudCache,
  })

  // 打开书就切到「处理」段，免得用户以为还在书库里
  const handleOpenBook = useCallback(
    (entry: Parameters<typeof openBook>[0]) => {
      setConfigSection('process')
      return openBook(entry)
    },
    [openBook]
  )

  // 文件就位（本地上传 / WebDAV / 书库打开）后自动切到「处理」段；清空后回书库。
  // 只在 file 变化时跑，所以用户手动点分段不会被抢回去。
  useEffect(() => {
    setConfigSection(file ? 'process' : 'library')
  }, [file])

  // 按当前配置重新处理（可先在配置页改设置再点）
  const handleRestartProcessing = useCallback(async () => {
    setCurrentStepIndex(2)
    await restartProcessing()
  }, [restartProcessing])

  // 从历史记录加载云端缓存
  const handleLoadFromHistory = useCallback(
    async (record: ProcessingHistoryRecord): Promise<boolean> => {
      const success = await loadFromHistoryRecord(record.fileName)
      if (success) setCurrentStepIndex(2)
      return success
    },
    [loadFromHistoryRecord]
  )

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

  const handleMobileChapterNavClick = useCallback(
    (chapterId: string) => {
      handleChapterNavigation(chapterId)
      setNavSheetOpen(false)
    },
    [handleChapterNavigation]
  )

  const mindmapNavChapters = useMemo(() => bookMindMap?.chapters || [], [bookMindMap])
  // 总结模式一旦有结果就进入阅读工作台（目录、scroll spy、对照栏都在工作台内部）；
  // 导图模式与"尚无结果"仍用经典布局
  const workspaceMode = currentStepIndex === 2 && processingMode === 'summary' && !!bookSummary
  const showMindmapNav =
    currentStepIndex === 2 && processingMode !== 'summary' && (processing || mindmapNavChapters.length > 0)
  const showMobileNavTrigger = isMobile && showMindmapNav

  // 移动端角标：导图模式 = 处理进度
  const processedNavCount = mindmapNavChapters.filter((ch) => ch.processed).length
  const totalNavCount = mindmapNavChapters.length

  const previewPanel = (variant: 'sidebar' | 'dock') =>
    rightPanelContent ? (
      <PreviewPanel
        chapter={rightPanelContent.chapter}
        title={rightPanelContent.title}
        fileName={file?.name || ''}
        bookData={book.fullBookData}
        fontSize={book.previewFontSize}
        isFullscreen={book.isPreviewFullscreen}
        onClose={book.handleCloseRightPanel}
        onIncreaseFontSize={book.increasePreviewFontSize}
        onDecreaseFontSize={book.decreasePreviewFontSize}
        onToggleFullscreen={book.togglePreviewFullscreen}
        variant={variant}
      />
    ) : null

  const desktopPreview = !isMobile && !workspaceMode ? previewPanel('sidebar') : null
  const dockPreview = !isMobile && workspaceMode ? previewPanel('dock') : null

  const statusBar = (
    <UnifiedStatusBar
      currentView={currentStepIndex === 1 ? 'config' : 'processing'}
      processing={processing}
      progress={progress}
      currentStep={currentStep}
      processingMode={processingMode}
      onToggleView={handleToggleView}
      onLoadFromHistory={handleLoadFromHistory}
      onCancelProcessing={cancelProcessing}
      onRestartProcessing={file && extractedChapters && selectedChapters.size > 0 ? handleRestartProcessing : undefined}
      onAbortToConfig={handleAbortToConfig}
      configSections={webdavConfig.enabled}
      configSection={configSection}
      onSelectConfigSection={setConfigSection}
    />
  )

  return (
    <div
      className={cn(
        'bg-background px-1.5 py-2.5 sm:p-4 flex justify-center gap-4 h-screen overflow-x-hidden scroll-container pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]',
        // 工作台自己管滚动（三栏各自滚），页面本身不滚；class 名保留以兼容仍用选择器的旧逻辑
        workspaceMode ? 'h-dvh overflow-y-hidden' : 'min-h-screen overflow-y-auto'
      )}
    >
      <Toaster />
      <ErrorBoundary section={t('errorBoundary.webdavBrowser')}>
        <Suspense fallback={<PanelSkeleton />}>
          <WebDAVFileBrowser
            isOpen={isWebDAVBrowserOpen}
            onClose={handleCloseWebDAVBrowser}
            onFileSelect={book.handleWebDAVFileSelect}
          />
        </Suspense>
      </ErrorBoundary>

      <div
        className={cn(
          'w-full flex-1 min-w-0 space-y-2.5 sm:space-y-4',
          // 工作台要更宽的画布给三栏；纵向 flex 让工作台吃掉剩余高度
          workspaceMode ? 'max-w-full 2xl:max-w-[110rem] min-[112.5rem]:max-w-[160rem] flex flex-col min-h-0 !space-y-0 gap-2' : 'max-w-full xl:max-w-7xl'
        )}
      >
        {/* 工作台里页头与状态栏合成一行（单层页头）；其余页面状态栏仍在页头下方 */}
        <AppHeader compact={workspaceMode}>{workspaceMode ? statusBar : null}</AppHeader>
        {!workspaceMode && statusBar}

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
              <Button variant="outline" size="sm" className="min-h-9 flex-1 justify-center gap-2" onClick={() => setNavSheetOpen(true)}>
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
              <Button variant="outline" size="sm" className="min-h-9 flex-1 justify-center gap-2" onClick={() => setPreviewSheetOpen(true)}>
                <Eye className="h-4 w-4" />
                {t('mobile.preview')}
              </Button>
            )}
          </div>
        )}

        {currentStepIndex === 1 ? (
          <ConfigStep
            book={book}
            webdavEnabled={webdavConfig.enabled}
            onOpenBook={handleOpenBook}
            openingPath={openingPath}
            autoOpening={autoOpening}
            section={webdavConfig.enabled ? configSection : 'process'}
            onSelectSection={setConfigSection}
            onLoadFromCloudCache={handleLoadFromCloudCache}
            onStartProcessing={handleStartProcessing}
            onSetSelection={handleSetSelection}
            preview={desktopPreview}
          />
        ) : workspaceMode && bookSummary ? (
          // 结果步骤（总结模式）：阅读工作台
          <div className="min-h-0 flex-1">
            <ErrorBoundary section={t('results.title')}>
              <ReaderWorkspace
                bookSummary={bookSummary}
                file={file}
                processing={processing}
                isMobile={isMobile}
                totalChapters={extractedChapters?.length || 0}
                currentProcessingChapter={currentProcessingChapter}
                currentViewingChapter={currentViewingChapterSummary}
                expandedChapters={expandedChapters}
                chartsGenerating={chartsGenerating}
                source={dockPreview}
                sourceKey={rightPanelContent?.chapter.id}
                onNavigateChapter={book.handleChapterSummaryNavigation}
                onViewingChapterChange={book.setCurrentViewingChapterSummary}
                onClearChapterCache={book.clearChapterCache}
                onClearSpecificCache={book.clearSpecificCache}
                onChapterExpandChange={book.handleChapterExpandChange}
                onReadChapter={handleReadChapter}
                onDownloadAllMarkdown={downloadAllMarkdown}
                onRegenerateKeyCharts={book.regenerateKeyCharts}
                onCancelKeyCharts={book.cancelKeyCharts}
                onRetryStep={book.retryBookStep}
                stepRunning={book.stepRunning}
              />
            </ErrorBoundary>
          </div>
        ) : (
          // 结果步骤（导图模式 / 尚无结果）：经典布局
          <ClassicResults
            book={book}
            isMobile={isMobile}
            currentStepIndex={currentStepIndex}
            navChapters={mindmapNavChapters}
            onChapterNavigate={handleChapterNavigation}
            onReadChapter={handleReadChapter}
            onDownloadAllMarkdown={downloadAllMarkdown}
            onDownloadMindMap={downloadMindMap}
            onBackToConfig={() => setCurrentStepIndex(1)}
            preview={desktopPreview}
          />
        )}

        <MobileNavSheet
          open={navSheetOpen}
          onOpenChange={setNavSheetOpen}
          chapters={mindmapNavChapters}
          currentStepIndex={currentStepIndex}
          processingMode={processingMode}
          processing={processing}
          currentProcessingChapter={currentProcessingChapter}
          onChapterClick={handleMobileChapterNavClick}
        />
        <MobilePreviewSheet open={isMobile && previewSheetOpen} onOpenChange={setPreviewSheetOpen} book={book} />

        {/* 页脚：构建号（YYYYMMDD.bN，提交前自动 bump）；典故已在页头副标题里，这里不重复 */}
        {!workspaceMode && (
          <footer className="pt-8 pb-2 text-center select-none">
            <p className="text-xs leading-none text-muted-foreground/40 select-all tabular-nums tracking-wide" title="build version">
              {BUILD_VERSION}
            </p>
          </footer>
        )}

        {/* 回到顶部按钮（工作台在正文栏内自带） */}
        {showBackToTop && !workspaceMode && (
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
