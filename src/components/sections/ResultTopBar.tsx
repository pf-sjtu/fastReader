import { useTranslation } from 'react-i18next'
import { BookOpen, Download, MoreHorizontal, Network } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
    <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 ${className}`} data-slot="result-title">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="t-title min-w-0 break-words">{title}</span>
      <span className="t-note min-w-0 break-words">
        {t('results.author', { author: bookSummary?.author || bookMindMap?.author })} |{' '}
        {t('results.chapterCount', { count })}
      </span>
    </div>
  )
}

/** 操作区：字号 / MD / 学习包 / 上传云端 */
export function ResultActions({
  processingMode, bookSummary, file, onDownloadAllMarkdown, className = '', workspaceStatus,
}: {
  processingMode: ProcessingMode
  bookSummary: BookSummary | null
  file: File | null
  onDownloadAllMarkdown: () => void
  className?: string
  workspaceStatus?: ReactNode
}) {
  const { t } = useTranslation()
  if (workspaceStatus !== undefined) return (
    <div className={`flex shrink-0 items-center gap-1 ${className}`} data-slot="result-actions">
      {/* 初始化已保存的字号；菜单内容只在打开时挂载。 */}
      <div className="hidden" aria-hidden="true"><FontSizeControl variant="compact" showLabel={false} /></div>
      {processingMode === 'summary' && bookSummary && <>
        <Button variant="ghost" size="xs" onClick={onDownloadAllMarkdown} title={t('download.downloadAllMarkdown')} aria-label={t('download.downloadAllMarkdown')} className="hidden @[390px]:inline-flex">
          <Download className="size-4" /><span className="hidden @[540px]:inline">MD</span>
        </Button>
        <div className="hidden @[430px]:block"><ExportPackButton bookSummary={bookSummary} compact /></div>
      </>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('workspace.dock.more')} title={t('workspace.dock.more')}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="space-y-2 p-3">
          <FontSizeControl variant="compact" />
          {processingMode === 'summary' && bookSummary && <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="xs" onClick={onDownloadAllMarkdown}><Download className="size-4" /> MD</Button>
            <ExportPackButton bookSummary={bookSummary} />
            <UploadToWebDAVButton bookSummary={bookSummary} file={file} chapterNamingMode="numbered" />
          </div>}
          {workspaceStatus}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
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
