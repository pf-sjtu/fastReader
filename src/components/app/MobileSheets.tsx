import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { TimelineNavigation } from '@/components/TimelineNavigation'
import { PreviewPanel } from '@/components/sections/PreviewPanel'
import type { BookProcessing } from './types'

type NavProps = Pick<React.ComponentProps<typeof TimelineNavigation>, 'chapters' | 'currentStepIndex' | 'processingMode' | 'processing' | 'currentProcessingChapter'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChapterClick: (chapterId: string) => void
}

/** 移动端：章节导航抽屉（导图模式的章节进度） */
export function MobileNavSheet({ open, onOpenChange, onChapterClick, ...nav }: NavProps) {
  const { t } = useTranslation()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[min(100%,20rem)] p-0 gap-0">
        <SheetHeader className="sr-only">
          <SheetTitle>{t('mobile.chapters')}</SheetTitle>
          <SheetDescription>{t('mobile.chaptersDescription')}</SheetDescription>
        </SheetHeader>
        <div className="h-full pt-2">
          <TimelineNavigation {...nav} onChapterClick={onChapterClick} variant="sheet" />
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface PreviewSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  book: Pick<
    BookProcessing,
    'rightPanelContent' | 'file' | 'fullBookData' | 'previewFontSize' | 'isPreviewFullscreen' | 'increasePreviewFontSize' | 'decreasePreviewFontSize' | 'togglePreviewFullscreen'
  >
}

/** 移动端：原文预览抽屉（关闭时保留 rightPanelContent，便于「预览」按钮再次打开） */
export function MobilePreviewSheet({ open, onOpenChange, book }: PreviewSheetProps) {
  const { t } = useTranslation()
  const { rightPanelContent: panel } = book
  return (
    <Sheet open={open && !!panel} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 gap-0 flex flex-col">
        <SheetHeader className="sr-only">
          <SheetTitle>{panel?.title || t('mobile.preview')}</SheetTitle>
          <SheetDescription>{t('mobile.previewDescription')}</SheetDescription>
        </SheetHeader>
        {panel && (
          <PreviewPanel
            chapter={panel.chapter}
            title={panel.title}
            fileName={book.file?.name || ''}
            bookData={book.fullBookData}
            fontSize={book.previewFontSize}
            isFullscreen={book.isPreviewFullscreen}
            onClose={() => onOpenChange(false)}
            onIncreaseFontSize={book.increasePreviewFontSize}
            onDecreaseFontSize={book.decreasePreviewFontSize}
            onToggleFullscreen={book.togglePreviewFullscreen}
            variant="sheet"
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
