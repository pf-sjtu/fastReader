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
import { useConfigStore } from '@/stores/configStore'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface FileUploadCardProps {
  file: File | null
  processing: boolean
  extractingChapters: boolean
  isCheckingCloudCache: boolean
  cloudCacheMetadata: ProcessingMetadata | null
  cloudCacheContent: string | null
  cloudChartsFileFound?: boolean
  /** 云缓存存在但不完整（含失败章节） */
  cloudCacheIsPartial?: boolean
  /** 无法确认云端缓存状态（网络/鉴权异常），不等于无缓存 */
  cloudCacheStatusUnknown?: boolean
  webdavEnabled: boolean
  webdavInitialized: boolean
  onFileSelect: (file: File) => void
  onExtractChapters: () => void
  onClearCache: () => void
  onOpenWebDAVBrowser: () => void
  onLoadFromCloudCache: () => void | Promise<void>
}

export function FileUploadCard({
  file,
  processing,
  extractingChapters,
  isCheckingCloudCache,
  cloudCacheMetadata,
  cloudCacheContent,
  cloudChartsFileFound = false,
  cloudCacheIsPartial = false,
  cloudCacheStatusUnknown = false,
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
  const processingMode = useConfigStore((s) => s.processingOptions.processingMode)
  const setProcessingMode = useConfigStore((s) => s.setProcessingMode)

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
        {/* 处理模式：主路径可见，不必进配置 Dialog */}
        <div className="space-y-2">
          <Label>{t('config.processingMode')}</Label>
          <Select
            value={processingMode}
            onValueChange={(value: 'summary' | 'mindmap' | 'combined-mindmap') =>
              setProcessingMode(value)
            }
            disabled={processing}
          >
            <SelectTrigger className="w-full min-h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="summary">{t('config.summaryMode')}</SelectItem>
              <SelectItem value="mindmap">{t('config.mindmapMode')}</SelectItem>
              <SelectItem value="combined-mindmap">
                {t('config.combinedMindmapMode')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="file">{t('upload.selectFile')}</Label>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 border border-dashed rounded-lg bg-background/60 gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 flex-1 overflow-hidden">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate block">{file?.name || t('upload.noFileSelected')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={triggerFileInput}
                disabled={processing}
                className="flex items-center gap-2 min-h-9"
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
                className="flex items-center gap-2 min-h-9"
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
            accept=".epub,.pdf,.txt,.md,.markdown"
            onChange={handleFileChange}
            disabled={processing}
            className="hidden"
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            onClick={onExtractChapters}
            disabled={!file || extractingChapters || processing}
            variant="outline"
            size="sm"
            className="flex items-center gap-2 min-h-9"
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
            variant="ghost"
            size="sm"
            onClick={onClearCache}
            disabled={processing}
            // 破坏性操作平时不抢眼，悬停才显色；颜色走语义 token，明暗主题都对
            className="flex items-center gap-1 min-h-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('upload.clearCache')}
          </Button>
        </div>

        {/* 云端缓存提示 */}
        <CloudCacheSection
          isCheckingCloudCache={isCheckingCloudCache}
          cloudCacheMetadata={cloudCacheMetadata}
          cloudCacheContent={cloudCacheContent}
          cloudChartsFileFound={cloudChartsFileFound}
          cloudCacheIsPartial={cloudCacheIsPartial}
          cloudCacheStatusUnknown={cloudCacheStatusUnknown}
          file={file}
          webdavEnabled={webdavEnabled}
          webdavInitialized={webdavInitialized}
          onLoadFromCloudCache={onLoadFromCloudCache}
        />
      </CardContent>
    </Card>
  )
}
