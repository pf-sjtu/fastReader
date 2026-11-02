import { useTranslation } from 'react-i18next'
import { BookOpen, Download, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FontSizeControl } from '@/components/FontSizeControl'
import { ExportPackButton } from '@/components/study/ExportPackButton'
import { UploadToWebDAVButton } from '@/components/UploadToWebDAVButton'
import type { BookSummary, BookMindMap, ProcessingMode } from '@/hooks/useBookProcessing'

/**
 * 结果页的「书名 + 作者」与「操作区」两块内容。
 *
 * 为什么从结果卡头部挪出来：工作台是三栏布局，正文列只有中间那么宽，
 * 书名与作者挤在卡片头部会被 `truncate` 截掉（「作者: Tom…」）。现在：
 * - 书名与作者 → 顶栏（AppHeader 那一行的空白处，宽度是整屏）
 * - 字号 / MD / 学习包 / 上传云端 → 正文列顶部（与「全文 / 要点 / 一句话」同一行）
 * 经典布局（导图模式）仍把两块都放在卡片头部。
 */

/** 书名 + 作者（顶栏用） */
export function ResultTitle({
  processingMode,
  bookSummary,
  bookMindMap,
  totalChapters = 0,
  className = '',
}: {
  processingMode: ProcessingMode
  bookSummary: BookSummary | null
  bookMindMap: BookMindMap | null
  totalChapters?: number
  className?: string
}) {
  const { t } = useTranslation()
  const title =
    processingMode === 'summary'
      ? t('results.summaryTitle', { title: bookSummary?.title })
      : processingMode === 'mindmap'
        ? t('results.chapterMindMapTitle', { title: bookMindMap?.title })
        : t('results.wholeMindMapTitle', { title: bookMindMap?.title })
  const Icon = processingMode === 'summary' ? BookOpen : Network
  const count = bookSummary?.chapters.length || bookMindMap?.chapters.length || totalChapters

  return (
    // 书名完整优先：title 允许换行，但不压缩（挤压时换行而不是被截断）
    <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 ${className}`} data-slot="result-title">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {/* 书名允许换行而不是截断；过长时也不撑破顶栏（父级 min-w-0 + break-words） */}
      <span className="t-title min-w-0 break-words">{title}</span>
      {/* 作者与章数：不截断（原先 truncate 会把「作者: Tom…」切掉），窄时换行 */}
      <span className="t-note min-w-0 break-words">
        {t('results.author', { author: bookSummary?.author || bookMindMap?.author })} |{' '}
        {t('results.chapterCount', { count })}
      </span>
    </div>
  )
}

/** 操作区：字号 / MD / 学习包 / 上传云端 */
export function ResultActions({
  processingMode,
  bookSummary,
  file,
  onDownloadAllMarkdown,
  className = '',
}: {
  processingMode: ProcessingMode
  bookSummary: BookSummary | null
  file: File | null
  onDownloadAllMarkdown: () => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} data-slot="result-actions">
      <FontSizeControl variant="compact" showLabel={false} />
      {processingMode === 'summary' && bookSummary && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={onDownloadAllMarkdown}
            className="flex min-h-8 items-center gap-1.5 text-xs"
            title={t('download.downloadAllMarkdown')}
          >
            <Download className="h-3.5 w-3.5" />
            MD
          </Button>
          <ExportPackButton bookSummary={bookSummary} />
          <UploadToWebDAVButton bookSummary={bookSummary} file={file} chapterNamingMode="numbered" />
        </>
      )}
    </div>
  )
}
