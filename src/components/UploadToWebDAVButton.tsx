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
      selectedChapters: selectedChapters,
      chapterCount: bookSummary.chapters.length,
      originalCharCount: originalCharCount,
      processedCharCount: processedCharCount
    })
  }

  // 生成markdown内容
  const generateMarkdownContent = () => {
    if (!bookSummary || !file) return ''

    let markdownContent = ''

    // 在文件头部添加处理元数据（HTML 注释格式）
    const metadata = generateMetadata()
    if (metadata) {
      markdownContent += metadataFormatter.formatAsComment(metadata)
      markdownContent += '\n\n'
    }

    markdownContent += `# ${bookSummary.title}\n\n`
    markdownContent += `**作者**: ${bookSummary.author}\n\n`
    markdownContent += `---\n\n`

    // 添加章节总结
    bookSummary.chapters.forEach((chapter: any, index: number) => {
      // 根据章节命名模式生成标题
      let chapterTitle: string
      if (chapterNamingMode === 'numbered') {
        chapterTitle = `第${String(index + 1).padStart(2, '0')}章`
      } else {
        chapterTitle = chapter.title || `第${index + 1}章`
      }

      markdownContent += `## ${chapterTitle}\n\n`
      if (chapter.summary) {
        markdownContent += `${chapter.summary}\n\n`
      }
    })

    return markdownContent
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
      toast.error('WebDAV未启用，请先在设置中配置WebDAV')
      return
    }

    if (!bookSummary || !file) {
      toast.error('没有可上传的内容')
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

      // 上传文件
      console.log('🚀 开始上传到WebDAV:')
      console.log('   远程路径:', remotePath)
      console.log('   内容长度:', markdownContent.length)
      console.log('   内容预览:', markdownContent.substring(0, 100) + '...')
      
      const uploadResult = await webdavService.uploadFile(remotePath, markdownContent)
      
      console.log('📤 上传结果:', uploadResult)
      
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || '上传失败')
      }
      
      // 验证文件是否真的上传成功
      console.log('🔍 验证上传结果...')
      const verifyResult = await webdavService.fileExists(remotePath)
      console.log('📁 文件存在检查:', verifyResult)
      
      if (!verifyResult) {
        throw new Error('文件上传后验证失败：文件在服务器上未找到')
      }
      
      setUploadStatus('uploaded')
      toast.success(`文件已上传到WebDAV: ${fileName}`)
      
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
          className={`${className} border-blue-200 hover:border-blue-300 hover:bg-blue-50`}
          title={t('upload.clickToOverwrite', { defaultValue: '点击覆盖上传' })}
        >
          <Cloud className="h-4 w-4 mr-1 text-blue-600" />
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
