import React, { useState } from 'react'
import { Upload, Cloud, Check, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
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

interface UploadToWebDAVButtonProps {
  bookSummary: any
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
      (total: number, chapter: any) => total + (chapter.content?.length || 0),
      0
    )

    // 计算处理后内容字符数
    const processedCharCount = bookSummary.chapters.reduce(
      (total: number, chapter: any) => total + (chapter.summary?.length || 0),
      0
    )

    // 选中的章节
    const selectedChapters = bookSummary.chapters
      .map((_: any, index: number) => index + 1)
      .filter((_: any, index: number) => {
        // 如果有 summary 就算选中
        return bookSummary.chapters[index]?.summary
      })

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

    // 准备章节数据
    const chapters = bookSummary.chapters.map((chapter: any) => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary || ''
    }))

    // 准备书籍数据
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

    // 生成元数据
    const metadata = generateMetadata()

    // 使用统一格式生成 Markdown
    return metadataFormatter.formatUnified(bookData, metadata || undefined, chapterNamingMode)
  }

  // 生成文件名
  const generateFileName = () => {
    if (!file) return ''
    // 获取原文件名（不含扩展名）
    const originalName = file.name.replace(/\.[^/.]+$/, '')
    // 清理文件名中的特殊字符，但保留中文、日文、韩文等多语言字符
    const sanitizedName = originalName
      .replace(/[<>:"/\\|?*]/g, '') // 移除 Windows 不允许的字符
      .replace(/\s+/g, ' ') // 将多个空格合并为单个空格
      .trim()
    return `${sanitizedName}-完整摘要.md`
  }

  // 检查文件是否已存在
  const checkFileExists = async () => {
    if (!webdavConfig.enabled) return false
    
    try {
      const fileName = generateFileName()
      const remotePath = `${webdavConfig.syncPath}/${fileName}`
      const exists = await webdavService.fileExists(remotePath)
      
      if (exists) {
        setUploadStatus('exists')
        setFileName(fileName)
      } else {
        setUploadStatus('idle')
      }
      
      return exists
    } catch (error) {
      console.error('检查文件存在失败:', error)
      setUploadStatus('error')
      return false
    }
  }

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
      if (!forceOverwrite && await webdavService.fileExists(remotePath)) {
        console.log('设置文件名到状态:', fileName)
        setFileName(fileName)
        setShowConfirmDialog(true)
        setIsUploading(false)
        return
      }

      // 上传 MD
      console.log('🚀 开始上传到WebDAV:', remotePath, 'len=', markdownContent.length)
      const uploadResult = await webdavService.uploadFile(remotePath, markdownContent)
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || '上传失败')
      }

      const verifyResult = await webdavService.fileExists(remotePath)
      if (!verifyResult) {
        throw new Error('文件上传后验证失败：文件在服务器上未找到')
      }

      // 有关键图表则上传同名 JSON（{name}-完整摘要.json）
      let chartsNote = ''
      if (bookSummary.charts) {
        const chartsUp = await cloudCacheService.uploadChartsJson(
          file.name,
          bookSummary.charts
        )
        chartsNote = chartsUp.success
          ? '（含关键图表 JSON）'
          : '（图表 JSON 上传失败，摘要 MD 已成功）'
        if (!chartsUp.success) {
          console.warn('图表 JSON 上传失败:', chartsUp.error)
        }
      }

      setUploadStatus('uploaded')
      toast.success(`文件已上传到WebDAV: ${fileName}${chartsNote}`)
      
    } catch (error) {
      console.error('上传失败:', error)
      setUploadStatus('error')
      toast.error('上传失败: ' + (error instanceof Error ? error.message : '未知错误'))
    } finally {
      setIsUploading(false)
    }
  }

  // 确认覆盖上传
  const confirmOverwrite = async () => {
    setShowConfirmDialog(false)
    await uploadToWebDAV(true)
  }

  // 组件挂载时检查文件状态
  React.useEffect(() => {
    if (webdavConfig.enabled && bookSummary) {
      checkFileExists()
    }
  }, [webdavConfig.enabled, bookSummary?.title, bookSummary?.author]) // 只依赖关键属性，避免重复检查

  // 如果WebDAV未启用，不显示按钮
  if (!webdavConfig.enabled) {
    return null
  }

  // 根据状态显示不同的按钮
  const renderButton = () => {
    if (isUploading) {
      return (
        <Button variant="outline" size="sm" disabled className={className}>
          <Upload className="h-4 w-4 mr-1 animate-spin" />
          {t('upload.uploading', { defaultValue: '上传中...' })}
        </Button>
      )
    }

    if (uploadStatus === 'uploaded') {
      return (
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => uploadToWebDAV()} 
          className={`${className} border-green-200 hover:border-green-300 hover:bg-green-50`}
          title={t('upload.reupload', { defaultValue: '重新上传' })}
        >
          <Check className="h-4 w-4 mr-1 text-green-600" />
          {t('upload.uploaded', { defaultValue: '已上传' })}
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
          title={t('upload.clickToOverwrite', { defaultValue: '点击覆盖上传' })}
        >
          <Cloud className="h-4 w-4 mr-1 text-primary" />
          {t('upload.exists', { defaultValue: '云端已存在' })}
        </Button>
      )
    }

    return (
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => uploadToWebDAV()}
        className={className}
        title={t('upload.uploadToWebDAV', { defaultValue: '上传到WebDAV' })}
      >
        <Upload className="h-4 w-4 mr-1" />
        {t('upload.upload', { defaultValue: '上传' })}
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
              <AlertCircle className="h-5 w-5 text-yellow-600" />
              {t('upload.confirmOverwrite', { defaultValue: '确认覆盖文件' })}
            </DialogTitle>
          </DialogHeader>
          <Alert className="mt-2">
            <AlertDescription className="space-y-2">
              <div>
                {fileName ? `文件 "${fileName}" 在WebDAV云端已存在，是否要覆盖它？` : '文件在WebDAV云端已存在，是否要覆盖它？'}
              </div>
              {fileName && (
                <div className="text-sm text-muted-foreground">
                  远程路径: {webdavConfig.syncPath}/{fileName}
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
              {t('common.cancel', { defaultValue: '取消' })}
            </Button>
            <Button 
              onClick={confirmOverwrite}
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Upload className="h-4 w-4 mr-1 animate-spin" />
                  {t('upload.uploading', { defaultValue: '上传中...' })}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-1" />
                  {t('upload.overwrite', { defaultValue: '覆盖' })}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
