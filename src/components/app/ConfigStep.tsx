import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
import { LibraryView } from '@/components/library/LibraryView'
import { FileUploadCard } from '@/components/sections/FileUploadCard'
import { ChapterSelectionSection } from '@/components/sections/ChapterSelectionSection'
import { webdavService } from '@/services/webdavService'
import type { BookProcessing } from './types'

interface ConfigStepProps {
  book: BookProcessing
  webdavEnabled: boolean
  /** 书库里的一本书被打开（下载 + 走选文件流程） */
  onOpenBook: React.ComponentProps<typeof LibraryView>['onOpenBook']
  openingPath: string | null
  /** 已精读的书正在自动进入工作台：显示骨架屏，不闪一下「文件上传与配置」卡 */
  autoOpening?: boolean
  onLoadFromCloudCache: () => void
  onStartProcessing: () => void
  onSetSelection: (chapterIds: string[]) => void
  /** 桌面端右侧的原文预览栏 */
  preview: ReactNode
}

/** 步骤 1「配置」：书库 → 选文件 → 选章节 → 开始处理 */
/** 进入工作台前的过渡：与工作台三栏同构的骨架，让「点一下 → 进入阅读」看起来是一件事 */
function OpeningSkeleton({ name }: { name: string }) {
  const { t } = useTranslation()
  return (
    <Card role="status" aria-live="polite">
      <CardContent className="space-y-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
          <span className="min-w-0 truncate">{t('library.opening', { title: name })}</span>
        </div>
        <div className="space-y-2" aria-hidden="true">
          <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded-md bg-muted" />
        </div>
      </CardContent>
    </Card>
  )
}

export function ConfigStep({ book, webdavEnabled, onOpenBook, openingPath, autoOpening = false, onLoadFromCloudCache, onStartProcessing, onSetSelection, preview }: ConfigStepProps) {
  const { file, extractedChapters, bookData } = book
  if (autoOpening && file) {
    return (
      <div className="min-w-0">
        <OpeningSkeleton name={file.name} />
      </div>
    )
  }
  return (
    <div className="flex flex-col md:flex-row gap-3 md:gap-4 min-w-0">
      <div className="flex-1 space-y-4 min-w-0">
        {webdavEnabled && !file && <LibraryView onOpenBook={onOpenBook} openingPath={openingPath} />}
        <FileUploadCard
          file={file}
          processing={book.processing}
          extractingChapters={book.extractingChapters}
          isCheckingCloudCache={book.isCheckingCloudCache}
          cloudCacheMetadata={book.cloudCacheMetadata}
          cloudCacheContent={book.cloudCacheContent}
          cloudChartsFileFound={book.cloudChartsFileFound}
          cloudCacheIsPartial={book.cloudCacheIsPartial}
          cloudCacheStatusUnknown={book.cloudCacheStatusUnknown}
          webdavEnabled={webdavEnabled}
          webdavInitialized={webdavService.isInitialized()}
          onFileSelect={book.handleFileSelect}
          onExtractChapters={book.extractChapters}
          onClearCache={book.clearBookCache}
          onOpenWebDAVBrowser={book.openWebDAVBrowser}
          onLoadFromCloudCache={onLoadFromCloudCache}
        />

        {extractedChapters && bookData && (
          <ChapterSelectionSection
            extractedChapters={extractedChapters}
            bookData={bookData}
            selectedChapters={book.selectedChapters}
            customPrompt={book.customPrompt}
            processing={book.processing}
            extractingChapters={book.extractingChapters}
            onChapterSelect={book.handleChapterSelect}
            onSelectAll={book.handleSelectAll}
            onSetSelection={onSetSelection}
            onCustomPromptChange={book.setCustomPrompt}
            onViewChapterContent={book.handleViewChapterContent}
            onStartProcessing={onStartProcessing}
          />
        )}
      </div>

      {preview}
    </div>
  )
}
