import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MindElixirInstance } from 'mind-elixir'
import { downloadSummaryMarkdown } from '@/utils/exportSummary'
import { exportMindMap } from '@/utils/mindmapExport'
import { useConfigStore } from '@/stores/configStore'
import type { BookSummary } from '@/types/book'

/** 结果导出：完整 Markdown / 思维导图（成功与失败都给 toast） */
export function useAppExports(bookSummary: BookSummary | null, fileName: string | undefined) {
  const { t } = useTranslation()
  const model = useConfigStore((s) => s.aiConfig.model)
  const { chapterDetectionMode, chapterNamingMode, epubTocDepth } = useConfigStore((s) => s.processingOptions)

  // 下载完整 Markdown（不依赖本地 File：历史/云缓存加载后也可导出）
  const downloadAllMarkdown = useCallback(() => {
    if (!bookSummary) {
      toast.error(t('download.noContent'))
      return
    }
    try {
      downloadSummaryMarkdown({ bookSummary, fileName, model, chapterDetectionMode, chapterNamingMode, epubTocDepth })
      toast.success(t('download.markdownDownloaded'))
    } catch (error) {
      console.error('Markdown 下载失败:', error)
      toast.error(t('download.downloadFailed'))
    }
  }, [bookSummary, fileName, model, chapterDetectionMode, chapterNamingMode, epubTocDepth, t])

  // 导出思维导图：按用户选择的格式导出（PNG/JPEG/WEBP/SVG/HTML/JSON/Markdown）
  const downloadMindMap = useCallback(
    (instance: MindElixirInstance, title: string, format: string) => {
      void (async () => {
        try {
          const { filename } = await exportMindMap(instance, title, format)
          toast.success(t('download.fileDownloaded', { filename }))
        } catch (error) {
          console.error('思维导图导出失败:', error)
          toast.error(t('download.downloadFailed'))
        }
      })()
    },
    [t]
  )

  return { downloadAllMarkdown, downloadMindMap }
}
