/**
 * 阅读工作台（总结模式的结果页）：目录 | 正文 | 对照栏，三栏各自独立滚动，页面本身不滚动。
 * - 正文栏是滚动容器：登记给 scrollTo 工具，并显式传给 scroll spy
 * - 对照栏：图谱 / 时间线 / 综述 / 原文，宽度可拖拽、可收起、浏览器级记忆
 * - 移动端：目录为左抽屉，对照栏为底部抽屉
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usableOrEmpty, usableSummaryChapters } from '@/utils/chapterResults'
import { useConfigStore } from '@/stores/configStore'
import { estimateRun } from '@/services/runEstimate'
import { RunEstimateLine } from '@/components/study/RunEstimateLine'
import { useTranslation } from 'react-i18next'
import { useViewportWidth } from '@/hooks/useViewportWidth'
import { containerWidth, fitColumns, isCompactWidth } from './columns'
import { useShallow } from 'zustand/react/shallow'
import { ChevronsLeft, ChevronUp, Layers, List, Minimize2, PanelRightOpen, Undo2 } from 'lucide-react'
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
  NAV_DEFAULT_WIDTH,
  NAV_MAX_WIDTH,
  NAV_MIN_WIDTH,
  useReadingFocusStore,
} from '@/stores/readingFocus'
import type { BookSummary } from '@/hooks/useBookProcessing'
import { CompanionDock, type DockTab } from './CompanionDock'
import { PeoplePanel } from './PeoplePanel'
import { GraphOptions } from './GraphOptions'
import { ResizeHandle } from './ResizeHandle'
import { NavRail } from './NavRail'
import { AskPanel } from '@/components/study/AskPanel'
import { DepthSwitch } from '@/components/study/DepthSwitch'
import { QuizPanel } from '@/components/study/QuizPanel'
import { StudyKitPanel } from '@/components/study/StudyKitPanel'
import { applyDepth } from '@/study/depth'
import { studyKeyOf } from '@/study/persistence'
import { useStudyStore } from '@/study/studyStore'
import { useWorkspaceLinking } from './useWorkspaceLinking'
import { NotesPanel } from '@/components/notes/NotesPanel'
import { SelectionToolbar } from '@/components/notes/SelectionToolbar'
import { StepRetryNote } from '@/components/sections/StepRetryNote'
import type { BookStepKind } from '@/hooks/useBookSteps'
import { notesKeyOf, useNotesStore } from '@/notes/notesStore'
import { mergeAliasedEntities } from '@/charts/linking/entityMerge'

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
  onCancelKeyCharts?: () => void
  onRetryStep?: (kind: BookStepKind) => void
  stepRunning?: BookStepKind | null
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
    onCancelKeyCharts,
    onRetryStep,
    stepRunning = null,
  } = props
  const { t } = useTranslation()
  // 窄于约 1000px 的窗口（小平板、缩小的桌面窗口）硬挤三栏会把正文压成窄条：改用紧凑布局（抽屉）
  const viewport = useViewportWidth()
  const narrow = !isMobile && viewport !== null && isCompactWidth(viewport)
  const compact = isMobile || narrow

  const {
    companionTab,
    companionOpen,
    companionWidth,
    focusMode,
    setCompanionTab,
    setCompanionOpen,
    setCompanionWidth,
    navWidth,
    navCollapsed,
    setNavWidth,
    setNavCollapsed,
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
      navWidth: s.navWidth,
      navCollapsed: s.navCollapsed,
      setNavWidth: s.setNavWidth,
      setNavCollapsed: s.setNavCollapsed,
      toggleFocusMode: s.toggleFocusMode,
    }))
  )

  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null)
  const notesKey = notesKeyOf(bookSummary)
  useEffect(() => {
    void useNotesStore.getState().bind(notesKey)
  }, [notesKey])
  const [showTop, setShowTop] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [dockSheetOpen, setDockSheetOpen] = useState(false)

  // 进来先有东西可读：章节卡是外部受控的，从历史/云缓存打开时 expandedChapters 为空，
  // 26 章全是只有标题的空壳。每本书自动展开第一个有可用总结的章节（只做一次，之后听用户的）
  const autoExpandedFor = useRef<string | null>(null)
  useEffect(() => {
    if (autoExpandedFor.current === bookSummary.title || expandedChapters.size > 0) return
    const first = usableSummaryChapters(bookSummary.chapters)[0]
    if (!first) return
    autoExpandedFor.current = bookSummary.title
    onChapterExpandChange(first.id, true)
  }, [bookSummary.title, bookSummary.chapters, expandedChapters, onChapterExpandChange])

  const chapters = bookSummary.chapters
  const chapterIds = useMemo(() => chapters.map((c) => c.id), [chapters])

  // 学习数据按书的内容指纹绑定；处理中章节还在变，等结果稳定再绑定
  const studyKey = studyKeyOf(bookSummary)
  useEffect(() => {
    if (!processing) void useStudyStore.getState().bind(bookSummary)
    // 只在指纹变化时重新绑定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyKey, processing])
  const kit = useStudyStore((s) => s.data.kit)
  const depth = useStudyStore((s) => s.depth)
  // 阅读深度只改"显示用"的章节总结；实体索引/缓存/导出仍用全文
  const displaySummary = useMemo(
    () => (depth === 'full' || !kit ? bookSummary : { ...bookSummary, chapters: applyDepth(bookSummary.chapters, kit, depth, { terms: t('study.depth.terms') }) }),
    [bookSummary, kit, depth, t]
  )
  const viewingIndex = chapterIds.indexOf(currentViewingChapter) + 1

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
  const expandChapter = useCallback((id: string) => onChapterExpandChange(id, true), [onChapterExpandChange])

  // 联动：实体表、正文标注、章节条、图表入参、悬浮卡片、跳转历史
  // 同一实体被图表拆成两个节点（KKR / Kohlberg Kravis Roberts）时按各章旁路合并后再给图表和联动用
  const mergedCharts = useMemo(() => mergeAliasedEntities(bookSummary.charts, bookSummary.chapters.map((c) => c.meta)), [bookSummary.charts, bookSummary.chapters])
  const linkSummary = useMemo(() => (mergedCharts === bookSummary.charts ? bookSummary : { ...bookSummary, charts: mergedCharts }), [bookSummary, mergedCharts])
  const link = useWorkspaceLinking({
    bookSummary: linkSummary,
    processing,
    bodyEl,
    currentChapterId: currentViewingChapter,
    navigateChapter: handleNavClick,
    expandChapter,
  })

  // 点「读原文」后：桌面端自动展开对照栏并切到原文页签
  useEffect(() => {
    if (!sourceKey || isMobile) return
    setCompanionTab('source')
    setCompanionOpen(true)
    // 紧凑布局里对照栏是抽屉，不打开的话点「读原文」没有任何反馈
    if (narrow) setDockSheetOpen(true)
  }, [sourceKey, isMobile, narrow, setCompanionTab, setCompanionOpen])

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

  // 生成关键图表要读全部章节总结 + 关联 + 全书总结：先估一下告诉用户（价格未知只给 token）
  const model = useConfigStore((s) => s.aiConfig.model)
  const chartsEstimate = useMemo(
    () => estimateRun([...usableSummaryChapters(chapters).map((c) => c.summary ?? ''), usableOrEmpty(bookSummary.connections), usableOrEmpty(bookSummary.overallSummary)], model),
    [chapters, bookSummary.connections, bookSummary.overallSummary, model]
  )

  const chartPanel = useCallback(
    (plugin: string, toolbarSlot?: ReactNode) => (
      <ErrorBoundary section={t('results.tabs.keyCharts')}>
        <ChartsPanel
          toolbarSlot={toolbarSlot}
          charts={mergedCharts}
          chartsError={bookSummary.chartsError}
          generating={chartsGenerating}
          onClearCache={clearCharts}
          onRegenerate={onRegenerateKeyCharts}
          onCancel={onCancelKeyCharts}
          estimateSlot={<RunEstimateLine tokens={chartsEstimate.inputTokens + chartsEstimate.outputTokens} costRMB={chartsEstimate.costRMB} />}
          canRegenerate={canRegenerate}
          onlyPlugin={plugin}
          pluginProps={link.pluginProps}
        />
      </ErrorBoundary>
    ),
    [t, mergedCharts, bookSummary.chartsError, chartsGenerating, clearCharts, onRegenerateKeyCharts, onCancelKeyCharts, chartsEstimate, canRegenerate, link.pluginProps]
  )

  // 选中正文 → 划线 / 批注；点「批注」后打开对照栏的笔记页签（紧凑布局里是抽屉）
  const openNotes = useCallback(() => {
    setCompanionTab('notes')
    setCompanionOpen(true)
    if (narrow) setDockSheetOpen(true)
  }, [setCompanionTab, setCompanionOpen, narrow])
  const selectionToolbar = <SelectionToolbar bodyEl={bodyEl} chapters={chapters} onOpenNotes={openNotes} />

  const tabs = useMemo<DockTab[]>(() => {
    const list: DockTab[] = [
      { id: 'graph', label: t('results.charts.entityGraph'), keepMounted: true, content: (
          chartPanel('entity-graph', <GraphOptions />)
        ),
      },
      { id: 'timeline', label: t('results.charts.timeline'), keepMounted: true, content: chartPanel('entity-timeline') },
      {
        id: 'people',
        label: t('people.tab'),
        content: (
          <PeoplePanel linking={link.linking} currentChapterId={currentViewingChapter} onOpenEntity={link.openEntity} />
        ),
      },
      { id: 'study', label: t('study.tabs.study'), content: <StudyKitPanel bookSummary={bookSummary} onJumpChapter={handleNavClick} /> },
      { id: 'quiz', label: t('study.tabs.quiz'), content: <QuizPanel bookSummary={bookSummary} currentChapterId={currentViewingChapter} onJumpChapter={handleNavClick} /> },
      { id: 'notes', label: t('notes.tab'), content: <NotesPanel bookTitle={bookSummary.title} chapters={bookSummary.chapters} onJumpChapter={handleNavClick} /> },
      { id: 'ask', label: t('study.tabs.ask'), content: <AskPanel bookSummary={bookSummary} onJumpChapter={handleNavClick} /> },
      {
        id: 'overall',
        label: t('results.tabs.overallSummary'),
        content: (
          <>
            <StepRetryNote kind="overall" text={bookSummary.overallSummary} running={stepRunning} onRetry={onRetryStep} />
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
          </>
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
  }, [t, chartPanel, bookSummary, clearOverall, onRetryStep, stepRunning, isMobile, source, link.linking, link.openEntity, currentViewingChapter, handleNavClick])

  const body = (
    <>
      {kit && <DepthSwitch chapters={chapters} className="mb-2" />}
    <Suspense
      fallback={<div className="py-12 text-center text-muted-foreground">{t('progress.loading')}</div>}
    >
      <ResultsSection
        variant="body"
        onRetryStep={onRetryStep}
        stepRunning={stepRunning}
        processingMode="summary"
        bookSummary={displaySummary}
        bookMindMap={null}
        file={file}
        expandedChapters={expandedChapters}
        onClearChapterCache={onClearChapterCache}
        onClearSpecificCache={onClearSpecificCache}
        onChapterExpandChange={onChapterExpandChange}
        onReadChapter={onReadChapter}
        onDownloadAllMarkdown={onDownloadAllMarkdown}
        totalChapters={totalChapters}
        chapterExtras={link.chapterExtras}
      />
    </Suspense>
    </>
  )

  // "返回上一位置"：跳转会打断阅读，这里给一条随时可回的退路
  const backChip = link.canBack ? (
    <Button
      variant="secondary"
      size="sm"
      className="fixed bottom-6 left-20 z-30 gap-1.5 rounded-full shadow-lg"
      onClick={link.back}
    >
      <Undo2 className="size-4" />
      {t('workspace.back')}
    </Button>
  ) : null

  const nav = (variant: 'sidebar' | 'sheet', headerAction?: ReactNode) => (
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
      headerAction={headerAction}
      className={variant === 'sidebar' ? 'static h-full' : undefined}
    />
  )

  if (compact) {
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
        <main ref={setBodyEl} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" {...link.bodyHandlers}>
          {body}
        </main>
        {link.floating}
        {selectionToolbar}
        {backChip}

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

  // 三栏：按容器宽度夹紧，保证正文列不被两侧挤没（偏好宽度不变，窗口变宽自动恢复）
  const fitted = fitColumns({
    container: containerWidth(viewport ?? 1440),
    navWidth,
    navCollapsed,
    companionWidth,
    companionOpen,
  })

  return (
    <div className="flex h-full min-h-0 w-full">
      {!focusMode && (
        <>
          {/* 目录：可拖宽、可折叠成竖向进度条。折叠时目录仍保持挂载（只是隐藏），展开不丢滚动位置 */}
          <aside
            className={`hidden shrink-0 md:flex md:flex-col ${navCollapsed ? 'mr-3' : ''}`}
            style={{ width: navCollapsed ? 14 : fitted.nav }}
          >
            {navCollapsed && <NavRail chapters={chapters} current={viewingIndex} onExpand={() => setNavCollapsed(false)} />}
            <div className={navCollapsed ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
              <div className="min-h-0 flex-1">
                {nav(
                  'sidebar',
                  // 收起目录和阅读进度同一行，不再单独占一行空白
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-mr-1.5 size-6 shrink-0"
                    onClick={() => setNavCollapsed(true)}
                    aria-label={t('workspace.nav.collapse')}
                    title={t('workspace.nav.collapse')}
                  >
                    <ChevronsLeft className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </aside>
          {!navCollapsed && (
            <ResizeHandle
              edge="right"
              width={fitted.nav}
              min={NAV_MIN_WIDTH}
              max={NAV_MAX_WIDTH}
              defaultWidth={NAV_DEFAULT_WIDTH}
              onChange={setNavWidth}
              label={t('workspace.nav.resize')}
              step={16}
              className="hidden md:block"
            />
          )}
        </>
      )}

      {link.floating}
      {selectionToolbar}
      {backChip}

      <main
        ref={setBodyEl}
        className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        {...link.bodyHandlers}
      >
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
          width={fitted.companion}
          min={COMPANION_MIN_WIDTH}
          max={COMPANION_MAX_WIDTH}
          defaultWidth={COMPANION_DEFAULT_WIDTH}
          onChange={setCompanionWidth}
          label={t('workspace.dock.resize')}
        />
      )}
      <aside
        className={focusMode || !companionOpen ? 'hidden' : 'min-h-0 shrink-0 pl-3'}
        style={{ width: fitted.companion + 12 }}
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
