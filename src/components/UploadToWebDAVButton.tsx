import React, { useState } from 'react'
import { Upload, Cloud, Check, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Alert, AlertDescription } from './ui/alert'
import { useWebDAVConfig, useAIConfig, useProcessingOptions } from '../stores/configStore'
import { webdavService } from '../services/webdavService'
import { cloudCacheService } from '../services/cloudCacheService'
import { metadataFormatter } from '../services/metadataFormatter'
import { toast } from 'sonner'
import type { BookSummary } from '../hooks/useBookProcessing'
import { logger } from '../lib/logger'

interface UploadToWebDAVButtonProps {
  bookSummary: BookSummary
  file: File | null
  className?: string
  chapterNamingMode?: 'auto' | 'numbered'
}

export const UploadToWebDAVButton: React.FC<UploadToWebDAVButtonProps> = ({
  bookSummary,
  file,
  className = "",
  chapterNamingMode = 'auto'
}) => {
  const { t } = useTranslation()
  const webdavConfig = useWebDAVConfig()
  const aiConfig = useAIConfig()
  const processingOptions = useProcessingOptions()
  const [isUploading, setIsUploading] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'exists' | 'uploaded' | 'error'>('idle')
  const [fileName, setFileName] = useState('')

  // 生成处理元数据
  const generateMetadata = () => {
    if (!bookSummary || !file) return null

    // 计算原始内容字符数
    const originalCharCount = bookSummary.chapters.reduce(
      (total: number, chapter: BookSummary['chapters'][number]) => total + (chapter.content?.length || 0),
      0
    )

    // 计算处理后内容字符数
    const processedCharCount = bookSummary.chapters.reduce(
      (total: number, chapter: BookSummary['chapters'][number]) => total + (chapter.summary?.length || 0),
      0
    )

    // 选中的章节：有 summary 就算选中
    const selectedChapters = bookSummary.chapters
      .map((_: unknown, index: number) => index + 1)
      .filter((_: unknown, index: number) => bookSummary.chapters[index]?.summary)

    return metadataFormatter.generate({
      fileName: file.name,
      bookTitle: bookSummary.title,
      model: aiConfig.model,
      chapterDetectionMode: processingOptions.chapterDetectionMode,
      epubTocDepth: processingOptions.epubTocDepth,
      selectedChapters: selectedChapters,
      chapterCount: bookSummary.chapters.length,
      originalCharCount: originalCharCount,
      processedCharCount: processedCharCount
    })
  }

  // 生成markdown内容 - 使用统一格式
  const generateMarkdownContent = () => {
    if (!bookSummary || !file) return ''

    const chapters = bookSummary.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary || ''
    }))

    const bookData = {
      title: bookSummary.title,
      author: bookSummary.author,
      chapters: chapters,
      overallSummary: bookSummary.overallSummary,
      connections: bookSummary.connections,
      charts: bookSummary.charts
        ? (bookSummary.charts as unknown as Record<string, unknown>)
        : null,
    }

    const metadata = generateMetadata()
    return metadataFormatter.formatUnified(bookData, metadata || undefined, chapterNamingMode)
  }

  // 云端文件名与云缓存读取共用同一规则（{sanitizedName}-完整摘要.md）
  const generateFileName = () => (file ? cloudCacheService.getCacheFileName(file.name) : '')

  // 上传文件到WebDAV
  const uploadToWebDAV = async (forceOverwrite = false) => {
    if (!webdavConfig.enabled) {
      toast.error(t('webdav.notEnabled'))
      return
    }

    if (!bookSummary || !file) {
      toast.error(t('webdav.noContent'))
      return
    }

    setIsUploading(true)
    setUploadStatus('idle')

    try {
      const markdownContent = generateMarkdownContent()
      const fileName = generateFileName()
      const remotePath = `${webdavConfig.syncPath}/${fileName}`

      // 检查是否需要覆盖确认
      if (!forceOverwrite) {
        const status = await webdavService.existsStatus(remotePath)
        if (status === 'unknown') {
          // 无法确认是否已有同名文件：不冒险覆盖
          toast.error(t('upload.existsUnknown'))
          setIsUploading(false)
          return
        }
        if (status === 'exists') {
          setFileName(fileName)
          setShowConfirmDialog(true)
          setIsUploading(false)
          return
        }
      }

      logger.debug('开始上传到 WebDAV:', remotePath, 'len=', markdownContent.length)
      const uploadResult = await webdavService.uploadFile(remotePath, markdownContent)
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || t('upload.failed'))
      }

      const verifyStatus = await webdavService.existsStatus(remotePath)
      if (verifyStatus === 'missing') {
        throw new Error(t('upload.verifyMissing'))
      }
      if (verifyStatus === 'unknown') {
        toast.warning(t('upload.verifyUnknown'))
      }

      // 有关键图表则上传同名 JSON（{name}-完整摘要.json）
      let chartsNote = ''
      if (bookSummary.charts) {
        const chartsUp = await cloudCacheService.uploadChartsJson(file.name, bookSummary.charts)
        chartsNote = chartsUp.success ? t('upload.chartsIncluded') : t('upload.chartsFailed')
        if (!chartsUp.success) {
          console.warn('图表 JSON 上传失败:', chartsUp.error)
        }
      }

      setUploadStatus('uploaded')
      toast.success(t('upload.success', { fileName, note: chartsNote }))
    } catch (error) {
      console.error('上传失败:', error)
      setUploadStatus('error')
      toast.error(t('upload.failedWithError', { error: error instanceof Error ? error.message : t('common.unknownError') }))
    } finally {
      setIsUploading(false)
    }
  }

  // 确认覆盖上传
  const confirmOverwrite = async () => {
    setShowConfirmDialog(false)
    await uploadToWebDAV(true)
  }

  // 书目或同步目录变化时检查云端是否已有同名文件（三态：unknown 不能当成不存在）。
  // 依赖派生出的远程路径而不是 bookSummary 对象：处理中摘要对象频繁变化，不应反复探测
  const remotePath = webdavConfig.enabled && bookSummary && file ? `${webdavConfig.syncPath}/${generateFileName()}` : null
  React.useEffect(() => {
    if (!remotePath) return
    let cancelled = false
    webdavService
      .existsStatus(remotePath)
      .then((status) => {
        if (cancelled) return
        setUploadStatus(status === 'exists' ? 'exists' : 'idle')
        if (status === 'exists') setFileName(remotePath.slice(remotePath.lastIndexOf('/') + 1))
      })
      .catch((error) => {
        console.error('检查文件存在失败:', error)
        if (!cancelled) setUploadStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [remotePath])

  // WebDAV 未启用，或没有本地源文件（书是从云缓存/历史/书库打开的：云端文件名与元数据都以源文件为准，
  // 且内容本就来自云端）时不显示按钮，免得点了只得到一句「暂无内容可上传」
  if (!webdavConfig.enabled || !file) {
    return null
  }

  // 根据状态显示不同的按钮
  const renderButton = () => {
    if (isUploading) {
      return (
        <Button variant="outline" size="sm" disabled className={className}>
          <Upload className="h-4 w-4 mr-1 animate-spin" />
          {t('upload.uploading')}
        </Button>
      )
    }

    if (uploadStatus === 'uploaded') {
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => uploadToWebDAV()}
          className={`${className} border-success/40 hover:border-success/60 hover:bg-success/10`}
          title={t('upload.reupload')}
        >
          <Check className="h-4 w-4 mr-1 text-success" />
          {t('upload.uploaded')}
        </Button>
      )
    }

    if (uploadStatus === 'exists') {
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => uploadToWebDAV()}
          className={`${className} border hover:border-foreground/20 hover:bg-accent`}
          title={t('upload.clickToOverwrite')}
        >
          <Cloud className="h-4 w-4 mr-1 text-primary" />
          {t('upload.exists')}
        </Button>
      )
    }

    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => uploadToWebDAV()}
        className={className}
        title={t('upload.uploadToWebDAV')}
      >
        <Upload className="h-4 w-4 mr-1" />
        {t('upload.upload')}
      </Button>
    )
  }

  return (
    <>
      {renderButton()}

      {/* 覆盖确认对话框 */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-warning" />
              {t('upload.confirmOverwrite')}
            </DialogTitle>
          </DialogHeader>
          <Alert className="mt-2">
            <AlertDescription className="space-y-2">
              <DialogDescription className="text-foreground">
                {fileName ? t('upload.existsQuestionNamed', { fileName }) : t('upload.existsQuestion')}
              </DialogDescription>
              {fileName && (
                <div className="text-sm text-muted-foreground">
                  {t('upload.remotePath', { path: `${webdavConfig.syncPath}/${fileName}` })}
                </div>
              )}
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              disabled={isUploading}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={confirmOverwrite}
              disabled={isUploading}
            >
              <Upload className={`h-4 w-4 mr-1 ${isUploading ? 'animate-spin' : ''}`} />
              {isUploading ? t('upload.uploading') : t('upload.overwrite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
