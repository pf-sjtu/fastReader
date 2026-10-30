// 章节预览：仅在对话框打开且有文件时解析；依赖变化/关闭时取消旧请求并丢弃过期结果
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings, Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { useProcessingOptions } from '../../../stores/configStore'
import { chapterPreviewService } from '../../../services/chapterPreviewService'

const MAX_PREVIEW = 20

interface ChapterPreviewProps {
  open: boolean
  file: File | null
}

export function ChapterPreview({ open, file }: ChapterPreviewProps) {
  const { t } = useTranslation()
  const { chapterDetectionMode, epubTocDepth, chapterNamingMode } = useProcessingOptions()
  const [chapters, setChapters] = useState<{ title: string; preview: string }[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !file) {
      setChapters([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    chapterPreviewService
      .previewChapters(file, chapterDetectionMode, epubTocDepth || 1, chapterNamingMode, MAX_PREVIEW, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setChapters(list)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        console.error('加载章节预览失败:', error)
        setChapters([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [open, file, chapterDetectionMode, epubTocDepth, chapterNamingMode])

  if (!file) return null

  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
      <div className="flex items-center gap-2 mb-3">
        <Settings className="h-4 w-4" />
        <Label className="text-sm font-medium">
          {t('config.chapterPreview')}
          {loading && <Loader2 className="h-3 w-3 animate-spin ml-2" />}
        </Label>
      </div>

      {chapters.length > 0 ? (
        <div className="space-y-2 max-h-60 overflow-y-auto overscroll-contain">
          {chapters.map((chapter, index) => (
            <div
              key={`${chapter.title}-${index}`}
              className="flex items-start gap-2 p-2 bg-card rounded border"
            >
              <span className="text-xs text-muted-foreground font-mono shrink-0 w-8">
                {(index + 1).toString().padStart(2, '0')}.
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{chapter.title}</div>
                <div className="text-xs text-muted-foreground truncate">{chapter.preview}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground text-center py-4">
          {loading ? t('config.loadingPreview') : t('config.noChaptersFound')}
        </div>
      )}
    </div>
  )
}
