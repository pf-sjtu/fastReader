import { Loader2, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ProcessingMetadata } from '@/services/cloudCacheService'

interface CloudCacheSectionProps {
  isCheckingCloudCache: boolean
  cloudCacheMetadata: ProcessingMetadata | null
  cloudCacheContent: string | null
  file: File | null
  webdavEnabled: boolean
  webdavInitialized: boolean
  onLoadFromCloudCache: () => void
}

export function CloudCacheSection({
  isCheckingCloudCache,
  cloudCacheMetadata,
  cloudCacheContent,
  file,
  webdavEnabled,
  webdavInitialized,
  onLoadFromCloudCache
}: CloudCacheSectionProps) {
  // 检查中状态
  if (isCheckingCloudCache) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在检查云端缓存...
      </div>
    )
  }

  // 有缓存元数据时显示缓存信息
  if (cloudCacheMetadata && !isCheckingCloudCache) {
    return (
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            发现云端缓存
          </span>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>处理时间: {new Date(cloudCacheMetadata.processedAt).toLocaleString()}</p>
          <p>处理模型: {cloudCacheMetadata.model}</p>
          <p>章节数: {cloudCacheMetadata.chapterCount}</p>
          {cloudCacheMetadata.costUSD && cloudCacheMetadata.costUSD > 0 && (
            <p>费用: ${cloudCacheMetadata.costUSD.toFixed(4)} / ¥{cloudCacheMetadata.costRMB?.toFixed(2)}</p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          onClick={onLoadFromCloudCache}
        >
          使用云端缓存
        </Button>
      </div>
    )
  }

  // 无缓存且WebDAV已启用时显示提示
  if (cloudCacheContent === null && !isCheckingCloudCache && file && webdavEnabled && webdavInitialized) {
    return (
      <div className="text-xs text-muted-foreground">
        云端暂无缓存，将进行新处理
      </div>
    )
  }

  return null
}
