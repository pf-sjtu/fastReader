/**
 * 阅读面板 / 预览 / 章节导航等纯 UI 状态
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChapterData } from '@/services/epubProcessor'
import { scrollToChapterWithRetry } from '@/utils/scrollTo'

export interface RightPanelContent {
  type: 'chapter' | 'content'
  chapter: ChapterData
  title: string
}

interface VendorFullscreenElement {
  webkitRequestFullscreen?: () => void
  msRequestFullscreen?: () => void
}

interface VendorFullscreenDocument {
  webkitExitFullscreen?: () => void
  msExitFullscreen?: () => void
}

const toggleInSet = (prev: Set<string>, id: string, on: boolean) => {
  const next = new Set(prev)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

export function useReaderPanel(extractedChapters: ChapterData[] | null) {
  const [rightPanelContent, setRightPanelContent] = useState<RightPanelContent | null>(null)
  const [currentViewingChapter, setCurrentViewingChapter] = useState('')
  const [currentViewingChapterSummary, setCurrentViewingChapterSummary] = useState('')
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())
  const [previewFontSize, setPreviewFontSize] = useState(16)
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false)
  const [isWebDAVBrowserOpen, setIsWebDAVBrowserOpen] = useState(false)
  const previewCardRef = useRef<HTMLDivElement>(null)

  const resetPanel = useCallback(() => {
    setRightPanelContent(null)
    setCurrentViewingChapter('')
    setCurrentViewingChapterSummary('')
    setExpandedChapters(new Set())
  }, [])

  const openChapter = useCallback((chapter: ChapterData) => {
    setRightPanelContent({ type: 'content', chapter, title: chapter.title })
    setCurrentViewingChapter(chapter.id)
  }, [])

  const handleCloseRightPanel = useCallback(() => {
    setRightPanelContent(null)
    setCurrentViewingChapter('')
  }, [])

  const handleChapterExpandChange = useCallback((chapterId: string, isExpanded: boolean) => {
    setExpandedChapters((prev) => toggleInSet(prev, chapterId, isExpanded))
  }, [])

  const increasePreviewFontSize = useCallback(() => setPreviewFontSize((p) => Math.min(p + 2, 24)), [])
  const decreasePreviewFontSize = useCallback(() => setPreviewFontSize((p) => Math.max(p - 2, 12)), [])

  // 预览全屏（兼容带厂商前缀的旧 API）
  const togglePreviewFullscreen = useCallback(() => {
    const el = previewCardRef.current as (HTMLDivElement & VendorFullscreenElement) | null
    if (!el) return
    if (!isPreviewFullscreen) {
      if (el.requestFullscreen) el.requestFullscreen()
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
      else if (el.msRequestFullscreen) el.msRequestFullscreen()
    } else {
      const doc = document as Document & VendorFullscreenDocument
      if (doc.exitFullscreen) doc.exitFullscreen()
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen()
      else if (doc.msExitFullscreen) doc.msExitFullscreen()
    }
  }, [isPreviewFullscreen])

  useEffect(() => {
    const onChange = () => setIsPreviewFullscreen(!!document.fullscreenElement)
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange']
    events.forEach((e) => document.addEventListener(e, onChange))
    return () => events.forEach((e) => document.removeEventListener(e, onChange))
  }, [])

  const handleChapterSummaryNavigation = useCallback((chapterId: string) => {
    setCurrentViewingChapterSummary(chapterId)
    setExpandedChapters(new Set([chapterId]))
    scrollToChapterWithRetry(chapterId)
  }, [])

  // 章节导航（用于思维导图）
  const handleChapterNavigation = useCallback(
    (chapterId: string) => {
      const chapter = extractedChapters?.find((ch) => ch.id === chapterId)
      if (chapter) openChapter(chapter)
    },
    [extractedChapters, openChapter]
  )

  return {
    rightPanelContent,
    currentViewingChapter,
    currentViewingChapterSummary,
    expandedChapters,
    previewFontSize,
    isPreviewFullscreen,
    previewCardRef,
    isWebDAVBrowserOpen,
    resetPanel,
    handleViewChapterContent: openChapter,
    handleCloseRightPanel,
    handleChapterExpandChange,
    increasePreviewFontSize,
    decreasePreviewFontSize,
    togglePreviewFullscreen,
    handleChapterSummaryNavigation,
    handleChapterNavigation,
    setIsWebDAVBrowserOpen,
    setCurrentViewingChapterSummary,
    setExpandedChapters,
  }
}
