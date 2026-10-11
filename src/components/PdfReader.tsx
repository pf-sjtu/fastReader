import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileText, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ChapterData, BookData, PdfProcessor } from '@/services/pdfProcessor'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

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

export function PdfReader({ chapter, bookData, onClose, className, showHeader = true }: PdfReaderProps) {
  const { t } = useTranslation()
  const [chapterPages, setChapterPages] = useState<PageContent[]>([])
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [isLoadingPages, setIsLoadingPages] = useState(false)
  const canvasContainerRef = useRef<HTMLDivElement>(null)

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

      // 检测当前主题
      const isDarkMode = document.documentElement.classList.contains('dark')
      
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
  }, [currentPageIndex, chapterPages])

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
              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToPreviousPage}
                  disabled={currentPageIndex === 0}
                  className="flex items-center gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('reader.pdf.previousPage')}
                </Button>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {t('reader.pdf.pageInfo', { current: currentPageIndex + 1, total: totalPages })}
                  </span>
                  {chapter.startPage && (
                    <Badge variant="outline" className="text-xs">
                      {t('reader.pdf.pdfPageInfo', { page: (chapter.startPage || 1) + currentPageIndex })}
                    </Badge>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToNextPage}
                  disabled={currentPageIndex === totalPages - 1}
                  className="flex items-center gap-1"
                >
                  {t('reader.pdf.nextPage')}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardHeader>
        )}

        <CardContent className={showHeader ? "" : "pt-3"}>
          <ScrollArea className={showHeader ? "h-[80vh]" : "h-[60vh]"}>
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
        </CardContent>
      </Card>
    </div>
  )
}