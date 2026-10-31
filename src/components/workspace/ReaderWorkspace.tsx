/**
 * 阅读工作台（总结模式的结果页）：目录 | 正文 | 对照栏，三栏各自独立滚动，页面本身不滚动。
 * - 正文栏是滚动容器：登记给 scrollTo 工具，并显式传给 scroll spy
 * - 对照栏：图谱 / 时间线 / 综述 / 原文，宽度可拖拽、可收起、浏览器级记忆
 * - 移动端：目录为左抽屉，对照栏为底部抽屉
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ChevronUp, Layers, List, Minimize2, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ChapterSummaryNavigation } from '@/components/ChapterSummaryNavigation'
import { MarkdownCard } from '@/components/MarkdownCard'
import { ChartsPanel } from '@/charts'
import { isUsableText } from '@/utils/resultStatus'
import { registerScrollContainer, scrollContainerToTop } from '@/utils/scrollTo'
import { useChapterScrollSpy } from '@/hooks/useChapterScrollSpy'
import {
  COMPANION_DEFAULT_WIDTH,
  COMPANION_MAX_WIDTH,
  COMPANION_MIN_WIDTH,
  useReadingFocusStore,
} from '@/stores/readingFocus'
import type { BookSummary } from '@/hooks/useBookProcessing'
import { CompanionDock, type DockTab } from './CompanionDock'
import { ResizeHandle } from './ResizeHandle'

const ResultsSection = lazy(() =>
  import('@/components/sections/ResultsSection').then((m) => ({ default: m.ResultsSection }))
)

export interface ReaderWorkspaceProps {
  bookSummary: BookSummary
  file: File | null
  processing: boolean
  isMobile: boolean
  totalChapters: number
  currentProcessingChapter?: string
  /** 当前阅读章（scroll spy 的唯一来源，由 useReaderPanel 持有） */
  currentViewingChapter: string
  expandedChapters: Set<string>
  chartsGenerating: boolean
  /** 桌面端对照栏「原文」页签的内容；null 表示尚未选择章节 */
  source: ReactNode | null
  /** 原文章节变化时自动展开对照栏并切到原文页签（通常传 rightPanelContent.chapter.id） */
  sourceKey?: string
  onNavigateChapter: (chapterId: string) => void
  onViewingChapterChange: (chapterId: string) => void
  onClearChapterCache: (chapterId: string) => void
  onClearSpecificCache: (cacheType: string) => void
  onChapterExpandChange: (chapterId: string, isExpanded: boolean) => void
  onReadChapter: (chapterId: string) => void
  onDownloadAllMarkdown: () => void
  onRegenerateKeyCharts?: () => void | Promise<void>
}

/** 键盘快捷键不应在输入框里触发 */
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function ReaderWorkspace(props: ReaderWorkspaceProps) {
  const {
    bookSummary,
    file,
    processing,
    isMobile,
    totalChapters,
    currentProcessingChapter,
    currentViewingChapter,
    expandedChapters,
    chartsGenerating,
    source,
    sourceKey,
    onNavigateChapter,
    onViewingChapterChange,
    onClearChapterCache,
    onClearSpecificCache,
    onChapterExpandChange,
    onReadChapter,
    onDownloadAllMarkdown,
    onRegenerateKeyCharts,
  } = props
  const { t } = useTranslation()

  const {
    companionTab,
    companionOpen,
    companionWidth,
    focusMode,
    setCompanionTab,
    setCompanionOpen,
    setCompanionWidth,
    toggleFocusMode,
  } = useReadingFocusStore(
    useShallow((s) => ({
      companionTab: s.companionTab,
      companionOpen: s.companionOpen,
      companionWidth: s.companionWidth,
      focusMode: s.focusMode,
      setCompanionTab: s.setCompanionTab,
      setCompanionOpen: s.setCompanionOpen,
      setCompanionWidth: s.setCompanionWidth,
      toggleFocusMode: s.toggleFocusMode,
    }))
  )

  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null)
  const [showTop, setShowTop] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [dockSheetOpen, setDockSheetOpen] = useState(false)

  const chapters = bookSummary.chapters
  const chapterIds = useMemo(() => chapters.map((c) => c.id), [chapters])

  // 正文栏 = 滚动容器：登记给命令式跳转，显式传给 spy
  useEffect(() => {
    registerScrollContainer(bodyEl)
    return () => registerScrollContainer(null, bodyEl)
  }, [bodyEl])

  const { lock: lockScrollSpy } = useChapterScrollSpy({
    chapterIds,
    enabled: true,
    container: bodyEl,
    onChapterChange: onViewingChapterChange,
  })

  useEffect(() => {
    if (!bodyEl) return
    const onScroll = () => setShowTop(bodyEl.scrollTop > 300)
    bodyEl.addEventListener('scroll', onScroll, { passive: true })
    return () => bodyEl.removeEventListener('scroll', onScroll)
  }, [bodyEl])

  const handleNavClick = useCallback(
    (chapterId: string) => {
      lockScrollSpy()
      onNavigateChapter(chapterId)
      setNavOpen(false)
    },
    [lockScrollSpy, onNavigateChapter]
  )

  // 点「读原文」后：桌面端自动展开对照栏并切到原文页签
  useEffect(() => {
    if (!sourceKey || isMobile) return
    setCompanionTab('source')
    setCompanionOpen(true)
  }, [sourceKey, isMobile, setCompanionTab, setCompanionOpen])

  // 快捷键 \：专注模式（只留正文）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      e.preventDefault()
      toggleFocusMode()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFocusMode])

  const clearCharts = useCallback(() => onClearSpecificCache('key_charts'), [onClearSpecificCache])
  const clearOverall = useCallback(() => onClearSpecificCache('overall_summary'), [onClearSpecificCache])
  const canRegenerate = isUsableText(bookSummary.overallSummary) && chapters.length > 0

  const chartPanel = useCallback(
    (plugin: string) => (
      <ErrorBoundary section={t('results.tabs.keyCharts')}>
        <ChartsPanel
          charts={bookSummary.charts}
          chartsError={bookSummary.chartsError}
          generating={chartsGenerating}
          onClearCache={clearCharts}
          onRegenerate={onRegenerateKeyCharts}
          canRegenerate={canRegenerate}
          onlyPlugin={plugin}
        />
      </ErrorBoundary>
    ),
    [t, bookSummary.charts, bookSummary.chartsError, chartsGenerating, clearCharts, onRegenerateKeyCharts, canRegenerate]
  )

  const tabs = useMemo<DockTab[]>(() => {
    const list: DockTab[] = [
      { id: 'graph', label: t('results.charts.entityGraph'), keepMounted: true, content: chartPanel('entity-graph') },
      { id: 'timeline', label: t('results.charts.timeline'), keepMounted: true, content: chartPanel('entity-timeline') },
      {
        id: 'overall',
        label: t('results.tabs.overallSummary'),
        content: (
          <MarkdownCard
            id="overall"
            title={t('results.tabs.overallSummary')}
            content={bookSummary.overallSummary}
            markdownContent={bookSummary.overallSummary}
            index={0}
            showClearCache
            showViewContent={false}
            showCopyButton
            onClearCache={clearOverall}
          />
        ),
      },
    ]
    // 移动端原文仍走 App 的右侧抽屉，不进对照栏
    if (!isMobile) {
      list.push({
        id: 'source',
        label: t('workspace.tabs.source'),
        content: source ?? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {t('workspace.source.empty')}
            </CardContent>
          </Card>
        ),
      })
    }
    return list
  }, [t, chartPanel, bookSummary.overallSummary, clearOverall, isMobile, source])

  const body = (
    <Suspense
      fallback={<div className="py-12 text-center text-muted-foreground">{t('progress.loading')}</div>}
    >
      <ResultsSection
        variant="body"
        processingMode="summary"
        bookSummary={bookSummary}
        bookMindMap={null}
        file={file}
        expandedChapters={expandedChapters}
        onClearChapterCache={onClearChapterCache}
        onClearSpecificCache={onClearSpecificCache}
        onChapterExpandChange={onChapterExpandChange}
        onReadChapter={onReadChapter}
        onDownloadAllMarkdown={onDownloadAllMarkdown}
        totalChapters={totalChapters}
      />
    </Suspense>
  )

  const nav = (variant: 'sidebar' | 'sheet') => (
    <ChapterSummaryNavigation
      chapters={chapters}
      totalChapters={totalChapters}
      currentStepIndex={2}
      processingMode="summary"
      onChapterClick={handleNavClick}
      processing={processing}
      currentProcessingChapter={currentProcessingChapter}
      currentViewingChapter={currentViewingChapter}
      variant={variant}
      className={variant === 'sidebar' ? 'static h-full' : undefined}
    />
  )

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="min-h-10 flex-1 gap-2" onClick={() => setNavOpen(true)}>
            <List className="h-4 w-4" />
            {t('mobile.chapters')}
          </Button>
          <Button variant="outline" size="sm" className="min-h-10 flex-1 gap-2" onClick={() => setDockSheetOpen(true)}>
            <Layers className="h-4 w-4" />
            {t('workspace.mobile.dock')}
          </Button>
        </div>
        <main ref={setBodyEl} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {body}
        </main>

        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-[min(100%,20rem)] gap-0 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t('mobile.chapters')}</SheetTitle>
              <SheetDescription>{t('mobile.chaptersDescription')}</SheetDescription>
            </SheetHeader>
            <div className="h-full pt-2">{nav('sheet')}</div>
          </SheetContent>
        </Sheet>

        <Sheet open={dockSheetOpen} onOpenChange={setDockSheetOpen}>
          <SheetContent side="bottom" className="h-[80dvh] gap-0 rounded-t-xl p-3">
            <SheetHeader className="sr-only">
              <SheetTitle>{t('workspace.mobile.dock')}</SheetTitle>
              <SheetDescription>{t('workspace.mobile.dockDescription')}</SheetDescription>
            </SheetHeader>
            <CompanionDock tabs={tabs} active={companionTab} onActiveChange={setCompanionTab} className="pt-4" />
          </SheetContent>
        </Sheet>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      {!focusMode && <aside className="hidden w-52 shrink-0 pr-3 md:block">{nav('sidebar')}</aside>}

      <main ref={setBodyEl} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {body}
        {focusMode && (
          <Button
            variant="outline"
            size="sm"
            className="fixed right-4 top-4 z-20 gap-1.5 bg-background/90 backdrop-blur"
            onClick={toggleFocusMode}
          >
            <Minimize2 className="h-3.5 w-3.5" />
            {t('workspace.focus.exit')}
          </Button>
        )}
      </main>

      {/* 对照栏：收起时保持挂载（只是隐藏），图谱不必重新布局 */}
      {!focusMode && companionOpen && (
        <ResizeHandle
          width={companionWidth}
          min={COMPANION_MIN_WIDTH}
          max={COMPANION_MAX_WIDTH}
          defaultWidth={COMPANION_DEFAULT_WIDTH}
          onChange={setCompanionWidth}
          label={t('workspace.dock.resize')}
        />
      )}
      <aside
        className={focusMode || !companionOpen ? 'hidden' : 'min-h-0 shrink-0 pl-3'}
        style={{ width: companionWidth + 12 }}
      >
        <CompanionDock
          tabs={tabs}
          active={companionTab}
          onActiveChange={setCompanionTab}
          onCollapse={() => setCompanionOpen(false)}
        />
      </aside>
      {!focusMode && !companionOpen && (
        <div className="shrink-0 pl-2">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => setCompanionOpen(true)}
            title={t('workspace.dock.expand')}
            aria-label={t('workspace.dock.expand')}
          >
            <PanelRightOpen className="h-4 w-4" />
          </Button>
        </div>
      )}

      {showTop && (
        <Button
          size="icon"
          className="fixed bottom-6 left-6 z-30 size-11 rounded-full shadow-lg"
          onClick={() => scrollContainerToTop(bodyEl)}
          aria-label={t('common.backToTop')}
        >
          <ChevronUp className="h-5 w-5" />
        </Button>
      )}
    </div>
  )
}
