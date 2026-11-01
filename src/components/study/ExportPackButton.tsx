/**
 * 离线学习包导出按钮（openspec 任务 7.2）。
 *
 * 笔记与自测都从 store 现取：它们本来就是「当前这本书」的数据，这样 `ResultsSection`
 * 只需多一行，不必把数据从 ReaderWorkspace 一路穿透五层组件（那要改 5 个文件的 prop 链）。
 *
 * 没有章节总结时按钮不可用 —— 空包里的目录、笔记、自测都不成立。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useNotesStore } from '@/notes/notesStore'
import { buildPackHtml, downloadPackHtml, packLabels } from '@/study/exportPack'
import { useStudyStore } from '@/study/studyStore'
import type { BookSummary } from '@/types/book'
import { logger } from '@/lib/logger'

export function ExportPackButton({ bookSummary }: { bookSummary: BookSummary }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const notes = useNotesStore((s) => s.notes)
  const study = useStudyStore((s) => s.data)
  const hasSummary = bookSummary.chapters.some((chapter) => chapter.summary?.trim())

  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const labels = packLabels(t)
      const result = await buildPackHtml({
        book: {
          title: bookSummary.title,
          author: bookSummary.author,
          chapters: bookSummary.chapters,
          connections: bookSummary.connections,
          overallSummary: bookSummary.overallSummary,
        },
        charts: bookSummary.charts,
        notes,
        quiz: study.quiz,
        answers: study.answers,
        labels,
      })
      downloadPackHtml(result.html, result.filename)
      toast.success(t('study.pack.done', { filename: result.filename }))
      if (result.failed.length) {
        toast.message(t('study.pack.imagesFailed', { count: result.failed.length }))
      }
    } catch (error) {
      logger.error('学习包导出失败:', error)
      toast.error(t('study.pack.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={busy || !hasSummary}
      className="flex items-center gap-1.5 h-8 min-h-8 text-xs"
      title={busy ? t('study.pack.building') : t('study.pack.title')}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
      {t('study.pack.button')}
    </Button>
  )
}
