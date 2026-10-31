import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Minus, Maximize2, Minimize2, X } from 'lucide-react'
import { EpubReader } from '@/components/EpubReader'
import { PdfReader } from '@/components/PdfReader'
import { cn } from '@/lib/utils'
import type { ChapterData } from '@/services/epubProcessor'
import type { EpubBookData } from '@/types/chapter'
import type { BookData as PdfBookData } from '@/services/pdfProcessor'

interface PreviewPanelProps {
  chapter: ChapterData
  title: string
  fileName: string
  bookData: EpubBookData | PdfBookData | null
  fontSize: number
  isFullscreen: boolean
  onClose: () => void
  onIncreaseFontSize: () => void
  onDecreaseFontSize: () => void
  onToggleFullscreen: () => void
  /** sidebar: 桌面 sticky 侧栏；sheet: 移动端抽屉全高；dock: 嵌在对照栏页签内（全高、无边框、不带关闭钮） */
  variant?: 'sidebar' | 'sheet' | 'dock'
  className?: string
}

export function PreviewPanel({
  chapter,
  title,
  fileName,
  bookData,
  fontSize,
  isFullscreen,
  onClose,
  onIncreaseFontSize,
  onDecreaseFontSize,
  onToggleFullscreen,
  variant = 'sidebar',
  className
}: PreviewPanelProps) {
  const { t } = useTranslation()
  const cardRef = useRef<HTMLDivElement>(null)
  const isEpub = fileName.endsWith('.epub')
  const isSheet = variant === 'sheet'
  // sheet 与 dock 都是"撑满父容器、无边框"的版式；差别只在关闭钮与右侧留白
  const isFlush = variant !== 'sidebar'

  return (
    <Card
      ref={cardRef}
      className={cn(
        isFlush
          ? 'w-full h-full border-0 shadow-none rounded-none flex flex-col gap-0 py-0 bg-transparent'
          : 'w-80 lg:w-96 h-fit sticky top-4',
        className
      )}
    >
      <CardHeader className={cn('pb-3', isFlush && 'px-4 pt-4 shrink-0', isSheet && 'pr-12')}>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium truncate flex-1 min-w-0">
            {title}
          </CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            {/* 字体大小调节按钮 - 只在 EPUB 时显示 */}
            {isEpub && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDecreaseFontSize}
                  disabled={fontSize <= 12}
                  className="h-8 w-8 p-0"
                  title={t('reader.epub.decreaseFontSize')}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="text-xs font-medium px-1 min-w-[2.5rem] text-center">
                  {fontSize}px
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onIncreaseFontSize}
                  disabled={fontSize >= 24}
                  className="h-8 w-8 p-0"
                  title={t('reader.epub.increaseFontSize')}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </>
            )}

            {/* 全屏按钮 - 只在 EPUB 时显示（桌面侧栏更有用） */}
            {isEpub && !isSheet && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleFullscreen}
                className="h-8 w-8 p-0"
                title={isFullscreen ? t('reader.epub.exitFullscreen') : t('reader.epub.enterFullscreen')}
              >
                {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              </Button>
            )}

            {/* 关闭按钮 - Sheet 自带关闭，对照栏靠切页签，只有侧栏保留 */}
            {variant === 'sidebar' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="size-8"
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn('pt-0', isFlush && 'flex-1 min-h-0 px-4 pb-4 flex flex-col')}>
        <div
          className={cn(
            'overflow-y-auto overscroll-contain',
            isFlush ? 'flex-1 min-h-0' : 'max-h-[min(70vh,36rem)]'
          )}
        >
          {isEpub ? (
            <EpubReader
              chapter={chapter}
              bookData={bookData as EpubBookData}
              onClose={onClose}
              showHeader={false}
              externalFontSize={fontSize}
              externalFullscreen={isFullscreen}
              onToggleFullscreen={onToggleFullscreen}
            />
          ) : (
            <PdfReader
              chapter={chapter}
              bookData={bookData as PdfBookData}
              onClose={onClose}
              showHeader={false}
            />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
