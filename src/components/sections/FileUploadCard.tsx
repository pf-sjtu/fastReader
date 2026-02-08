import { useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Upload, FileText, Loader2, List, Trash2, Network } from 'lucide-react'
import { ConfigDialog } from '@/components/project/ConfigDialog'
import { BatchProcessingDialog } from '@/components/project/BatchProcessingDialog'
import { CloudCacheSection } from './CloudCacheSection'
import type { ProcessingMetadata } from '@/services/cloudCacheService'

interface FileUploadCardProps {
  file: File | null
  processing: boolean
  extractingChapters: boolean
  isCheckingCloudCache: boolean
  cloudCacheMetadata: ProcessingMetadata | null
  cloudCacheContent: string | null
  webdavEnabled: boolean
  webdavInitialized: boolean
  onFileSelect: (file: File) => void
  onExtractChapters: () => void
  onClearCache: () => void
  onOpenWebDAVBrowser: () => void
  onLoadFromCloudCache: () => void
}

export function FileUploadCard({
  file,
  processing,
  extractingChapters,
  isCheckingCloudCache,
  cloudCacheMetadata,
  cloudCacheContent,
  webdavEnabled,
  webdavInitialized,
  onFileSelect,
  onExtractChapters,
  onClearCache,
  onOpenWebDAVBrowser,
  onLoadFromCloudCache
}: FileUploadCardProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) return
    onFileSelect(selectedFile)
  }, [onFileSelect])

  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

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
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                {t('upload.localUpload')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenWebDAVBrowser}
                disabled={processing}
                className="flex items-center gap-2"
              >
                <Network className="h-4 w-4" />
                WebDAV
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

        <div className="flex items-center justify-end">
          <div className="flex items-center gap-2">
            <Button
              onClick={onExtractChapters}
              disabled={!file || extractingChapters || processing}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              {extractingChapters ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('upload.extractingChapters')}
                </>
              ) : (
                <>
                  <List className="h-4 w-4" />
                  {t('upload.extractChapters')}
                </>
              )}
            </Button>
            <ConfigDialog processing={processing} file={file} />
            <Button
              variant="outline"
              size="sm"
              onClick={onClearCache}
              disabled={processing}
              className="flex items-center gap-1 text-red-500 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('upload.clearCache')}
            </Button>
          </div>
        </div>

        {/* 云端缓存提示 */}
        <CloudCacheSection
          isCheckingCloudCache={isCheckingCloudCache}
          cloudCacheMetadata={cloudCacheMetadata}
          cloudCacheContent={cloudCacheContent}
          file={file}
          webdavEnabled={webdavEnabled}
          webdavInitialized={webdavInitialized}
          onLoadFromCloudCache={onLoadFromCloudCache}
        />
      </CardContent>
    </Card>
  )
}
