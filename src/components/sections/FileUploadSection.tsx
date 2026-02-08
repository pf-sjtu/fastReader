import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Upload, FileText, List, Loader2, Trash2, Network } from 'lucide-react'
import { toast } from 'sonner'
import { EpubProcessor, type ChapterData } from '@/services/epubProcessor'
import { PdfProcessor } from '@/services/pdfProcessor'
import { ConfigDialog } from '@/components/project/ConfigDialog'
import { BatchProcessingDialog } from '@/components/project/BatchProcessingDialog'
import { useConfigStore } from '@/stores/configStore'

const epubProcessor = new EpubProcessor()
const pdfProcessor = new PdfProcessor()

interface FileUploadSectionProps {
  onFileSelect: (file: File) => void
  onChaptersExtracted: (chapters: ChapterData[]) => void
  processing: boolean
  file: File | null
}

export function FileUploadSection({
  onFileSelect,
  onChaptersExtracted,
  processing,
  file
}: FileUploadSectionProps) {
  const { t } = useTranslation()
  const [extractingChapters, setExtractingChapters] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    processingOptions: { useSmartDetection, skipNonEssentialChapters, maxSubChapterDepth, chapterNamingMode, chapterDetectionMode, epubTocDepth }
  } = useConfigStore()

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) return
    
    onFileSelect(selectedFile)
  }, [onFileSelect])

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const extractChapters = useCallback(async () => {
    if (!file) return
    
    setExtractingChapters(true)
    try {
      let chapters: ChapterData[]
      
      if (file.name.endsWith('.epub')) {
        const bookData = await epubProcessor.parseEpub(file)
        chapters = await epubProcessor.extractChapters(
          bookData.book,
          useSmartDetection,
          skipNonEssentialChapters,
          maxSubChapterDepth,
          chapterNamingMode,
          chapterDetectionMode,
          epubTocDepth
        )
      } else if (file.name.endsWith('.pdf')) {
        chapters = await pdfProcessor.extractChapters(
          file,
          useSmartDetection,
          skipNonEssentialChapters,
          maxSubChapterDepth,
          chapterNamingMode,
          chapterDetectionMode
        )
      } else {
        throw new Error(t('upload.invalidFile'))
      }
      
      onChaptersExtracted(chapters)
      toast.success(t('progress.chaptersExtracted', { count: chapters.length }))
    } catch (error) {
      console.error('提取章节失败:', error)
      toast.error(error instanceof Error ? error.message : t('progress.extractionError'))
    } finally {
      setExtractingChapters(false)
    }
  }, [file, useSmartDetection, skipNonEssentialChapters, maxSubChapterDepth, chapterNamingMode, chapterDetectionMode, epubTocDepth, onChaptersExtracted, t])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          {t('upload.title')}
        </CardTitle>
        <CardDescription>{t('upload.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="file">{t('upload.selectFile')}</Label>
          <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-50 dark:bg-gray-800">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 min-w-0 flex-1">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{file?.name || t('upload.noFileSelected')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={triggerFileInput}
                disabled={processing}
              >
                <Upload className="h-4 w-4 mr-1" />
                {t('upload.localUpload')}
              </Button>
              <BatchProcessingDialog />
            </div>
          </div>
          <Input
            ref={fileInputRef}
            id="file"
            type="file"
            accept=".epub,.pdf"
            onChange={handleFileChange}
            disabled={processing}
            className="hidden"
          />
        </div>

        {file && (
          <div className="flex items-center justify-end gap-2">
            <Button
              onClick={extractChapters}
              disabled={!file || extractingChapters || processing}
              variant="outline"
              size="sm"
            >
              {extractingChapters ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  {t('upload.extractingChapters')}
                </>
              ) : (
                <>
                  <List className="h-4 w-4 mr-1" />
                  {t('upload.extractChapters')}
                </>
              )}
            </Button>
            <ConfigDialog processing={processing} file={file} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
