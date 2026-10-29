import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileText, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ChapterData, BookData, PdfProcessor } from '@/services/pdfProcessor'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useIsDarkMode } from './useTheme'

// pdfjs 体积大：动态 import，避免进入首屏 modulepreload
let pdfProcessorPromise: Promise<PdfProcessor> | null = null
function getPdfProcessor(): Promise<PdfProcessor> {
  pdfProcessorPromise ??= import('@/services/pdfProcessor').then((m) => new m.PdfProcessor())
  return pdfProcessorPromise
}

interface PdfReaderProps {
  chapter: ChapterData
  bookData?: BookData
  onClose: () => void
  className?: string
  showHeader?: boolean
}

interface PageContent {
  canvas?: HTMLCanvasElement
}

interface PdfPagerProps {
  /** 0 起始的当前页索引 */
  current: number
  total: number
  /** 对应原 PDF 的页码（有章节起始页时） */
  pdfPage?: number
  onPrevious: () => void
  onNext: () => void
  /** 紧凑模式：图标按钮 + 「n / total」，用于无头部的侧栏 / 抽屉预览 */
  compact?: boolean
}

/** 章节内翻页控件：带头部与无头部两种形态共用同一状态 */
function PdfPager({ current, total, pdfPage, onPrevious, onNext, compact = false }: PdfPagerProps) {
  const { t } = useTranslation()
  const isFirst = current === 0
  const isLast = current >= total - 1

  if (compact) {
    return (
      <nav
        aria-label={t('reader.pdf.pageInfo', { current: current + 1, total })}
        className="flex items-center justify-center gap-2"
      >
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={onPrevious}
          disabled={isFirst}
          aria-label={t('reader.pdf.previousPage')}
          title={t('reader.pdf.previousPage')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums min-w-[4.5rem] text-center" aria-live="polite">
          {current + 1} / {total}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={onNext}
          disabled={isLast}
          aria-label={t('reader.pdf.nextPage')}
          title={t('reader.pdf.nextPage')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </nav>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrevious}
        disabled={isFirst}
        className="flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        {t('reader.pdf.previousPage')}
      </Button>

      <div className="flex items-center gap-2" aria-live="polite">
        <span className="text-sm text-muted-foreground">
          {t('reader.pdf.pageInfo', { current: current + 1, total })}
        </span>
        {pdfPage !== undefined && (
          <Badge variant="outline" className="text-xs">
            {t('reader.pdf.pdfPageInfo', { page: pdfPage })}
          </Badge>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={isLast}
        className="flex items-center gap-1"
      >
        {t('reader.pdf.nextPage')}
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

export function PdfReader({ chapter, bookData, onClose, className, showHeader = true }: PdfReaderProps) {
  const { t } = useTranslation()
  const [chapterPages, setChapterPages] = useState<PageContent[]>([])
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [isLoadingPages, setIsLoadingPages] = useState(false)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const lastCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // 订阅主题：切换明暗后重新应用 canvas 边框 / 背景
  const isDarkMode = useIsDarkMode()

  // 加载章节的页面内容
  useEffect(() => {
    let cancelled = false
    const loadChapterPages = async () => {
      if (!chapter || !bookData?.pdfDocument) {
        setChapterPages([])
        return
      }

      setIsLoadingPages(true)
      try {
        const processor = await getPdfProcessor()
        const pages = await processor.getChapterPages(bookData.pdfDocument, chapter)
        if (cancelled) return
        setChapterPages(pages)
        setCurrentPageIndex(0)
      } catch (error) {
        if (cancelled) return
        console.error('加载PDF章节页面失败:', error)
        // 如果获取页面失败，设置空数组
        setChapterPages([])
      } finally {
        if (!cancelled) setIsLoadingPages(false)
      }
    }

    loadChapterPages()
    return () => {
      // 快速切章时丢弃旧结果
      cancelled = true
    }
  }, [chapter, bookData])

  // 渲染当前页面的canvas
  useEffect(() => {
    if (chapterPages[currentPageIndex]?.canvas && canvasContainerRef.current) {
      const canvas = chapterPages[currentPageIndex].canvas!
      canvasContainerRef.current.innerHTML = ''
      canvasContainerRef.current.appendChild(canvas)
      // 换页后回到页顶，避免停留在上一页的滚动位置（仅主题变化时不重置）
      if (lastCanvasRef.current !== canvas) {
        lastCanvasRef.current = canvas
        const viewport = canvasContainerRef.current.closest('[data-slot="scroll-area-viewport"]')
        if (viewport) viewport.scrollTop = 0
      }

      // 设置canvas样式
      canvas.style.maxWidth = '100%'
      canvas.style.height = 'auto'
      canvas.style.border = `1px solid ${isDarkMode ? '#475569' : '#e5e7eb'}`
      canvas.style.borderRadius = '8px'
      canvas.style.boxShadow = isDarkMode 
        ? '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
        : '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
      canvas.style.backgroundColor = isDarkMode ? '#1e293b' : '#ffffff'
    }
  }, [currentPageIndex, chapterPages, isDarkMode, isLoadingPages])

  const totalPages = chapterPages.length

  const goToPreviousPage = () => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex(currentPageIndex - 1)
    }
  }

  const goToNextPage = () => {
    if (currentPageIndex < totalPages - 1) {
      setCurrentPageIndex(currentPageIndex + 1)
    }
  }

  return (
    <div className={cn("w-full", className)}>
      {/* 主要阅读区域 */}
      <Card className='gap-0'>
        {showHeader && (
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {chapter.title}
                {chapter.startPage && chapter.endPage && (
                  <Badge variant="secondary" className="ml-2">
                    {t('reader.pdf.page', { startPage: chapter.startPage, endPage: chapter.endPage })}
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                >
                  {t('reader.pdf.close')}
                </Button>
              </div>
            </div>

            {/* 页面导航 */}
            {totalPages > 1 && (
              <div className="pt-2">
                <PdfPager
                  current={currentPageIndex}
                  total={totalPages}
                  pdfPage={chapter.startPage ? chapter.startPage + currentPageIndex : undefined}
                  onPrevious={goToPreviousPage}
                  onNext={goToNextPage}
                />
              </div>
            )}
          </CardHeader>
        )}

        <CardContent className={showHeader ? "" : "pt-3"}>
          {/* 无头部时限高，给下方翻页控件留位置，避免被外层侧栏滚动裁掉 */}
          <ScrollArea className={showHeader ? "h-[80vh]" : "h-[min(60vh,30rem)]"}>
            {isLoadingPages ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span>{t('reader.pdf.loadingPages')}</span>
              </div>
            ) : (
              <div className="flex justify-center">
                <div
                  ref={canvasContainerRef}
                  className="max-w-full"
                />
              </div>
            )}
          </ScrollArea>
          {/* 无头部（侧栏 / 抽屉预览）时翻页控件放在画布下方 */}
          {!showHeader && !isLoadingPages && totalPages > 1 && (
            <div className="pt-3">
              <PdfPager
                compact
                current={currentPageIndex}
                total={totalPages}
                onPrevious={goToPreviousPage}
                onNext={goToNextPage}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}