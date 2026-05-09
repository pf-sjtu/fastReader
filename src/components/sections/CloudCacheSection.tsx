import { Loader2, CheckCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

  if (isCheckingCloudCache) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('cloudCache.checking')}
      </div>
    )
  }

  if (cloudCacheMetadata && !isCheckingCloudCache) {
    return (
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            {t('cloudCache.found')}
          </span>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>{t('cloudCache.processedAt')}: {new Date(cloudCacheMetadata.processedAt).toLocaleString()}</p>
          <p>{t('cloudCache.model')}: {cloudCacheMetadata.model}</p>
          <p>{t('cloudCache.chapterCount')}: {cloudCacheMetadata.chapterCount}</p>
          {cloudCacheMetadata.costUSD && cloudCacheMetadata.costUSD > 0 && (
            <p>{t('cloudCache.cost')}: ${cloudCacheMetadata.costUSD.toFixed(4)} / ¥{cloudCacheMetadata.costRMB?.toFixed(2)}</p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          onClick={onLoadFromCloudCache}
        >
          {t('cloudCache.useCache')}
        </Button>
      </div>
    )
  }

  if (cloudCacheContent === null && !isCheckingCloudCache && file && webdavEnabled && webdavInitialized) {
    return (
      <div className="text-xs text-muted-foreground">
        {t('cloudCache.noCache')}
      </div>
    )
  }

  return null
}
