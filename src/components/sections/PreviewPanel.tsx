import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Minus, Maximize2, Minimize2 } from 'lucide-react'
import { EpubReader } from '@/components/EpubReader'
import { PdfReader } from '@/components/PdfReader'
import type { ChapterData } from '@/services/epubProcessor'
import type { BookData as EpubBookData } from '@/services/epubProcessor'
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
  onToggleFullscreen
}: PreviewPanelProps) {
  const { t } = useTranslation()
  const cardRef = useRef<HTMLDivElement>(null)
  const isEpub = fileName.endsWith('.epub')

  return (
    <Card ref={cardRef} className="w-80 lg:w-96 h-fit sticky top-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium truncate flex-1">
            {title}
          </CardTitle>
          <div className="flex items-center gap-1">
            {/* 字体大小调节按钮 - 只在 EPUB 时显示 */}
            {isEpub && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDecreaseFontSize}
                  disabled={fontSize <= 12}
                  className="h-6 w-6 p-0"
                  title={t('reader.epub.decreaseFontSize', '减小字体')}
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
                  className="h-6 w-6 p-0"
                  title={t('reader.epub.increaseFontSize', '增大字体')}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </>
            )}

            {/* 全屏按钮 - 只在 EPUB 时显示 */}
            {isEpub && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleFullscreen}
                className="h-6 w-6 p-0"
                title={isFullscreen ? t('reader.epub.exitFullscreen', '退出全屏') : t('reader.epub.enterFullscreen', '进入全屏')}
              >
                {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              </Button>
            )}

            {/* 关闭按钮 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0"
            >
              ×
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="max-h-96 overflow-y-auto overscroll-contain">
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
