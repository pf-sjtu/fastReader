import type { ReactNode } from 'react'
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
  onLoadFromCloudCache: () => void
  onStartProcessing: () => void
  onSetSelection: (chapterIds: string[]) => void
  /** 桌面端右侧的原文预览栏 */
  preview: ReactNode
}

/** 步骤 1「配置」：书库 → 选文件 → 选章节 → 开始处理 */
export function ConfigStep({ book, webdavEnabled, onOpenBook, openingPath, onLoadFromCloudCache, onStartProcessing, onSetSelection, preview }: ConfigStepProps) {
  const { file, extractedChapters, bookData } = book
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
