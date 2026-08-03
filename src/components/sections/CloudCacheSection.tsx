import { useMemo } from 'react'
import { Loader2, CheckCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { ProcessingMetadata } from '@/services/cloudCacheService'

interface CloudCacheSectionProps {
  isCheckingCloudCache: boolean
  cloudCacheMetadata: ProcessingMetadata | null
  cloudCacheContent: string | null
  /** 同名 .json 是否在云端存在 */
  cloudChartsFileFound?: boolean
  file: File | null
  webdavEnabled: boolean
  webdavInitialized: boolean
  onLoadFromCloudCache: () => void
}

export function CloudCacheSection({
  isCheckingCloudCache,
  cloudCacheMetadata,
  cloudCacheContent,
  cloudChartsFileFound = false,
  file,
  webdavEnabled,
  webdavInitialized,
  onLoadFromCloudCache
}: CloudCacheSectionProps) {
  const { t } = useTranslation()

  const includesKeyCharts = useMemo(() => {
    if (cloudChartsFileFound) return true
    return !!(cloudCacheContent && /##[ \t]+关键图表(?:\s|$)/m.test(cloudCacheContent))
  }, [cloudCacheContent, cloudChartsFileFound])

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
      <div className="p-3 bg-muted border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            {t('cloudCache.found')}
          </span>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>{t('cloudCache.processedAt')}: {new Date(cloudCacheMetadata.processedAt).toLocaleString()}</p>
          <p>{t('cloudCache.model')}: {cloudCacheMetadata.model}</p>
          <p>{t('cloudCache.chapterCount')}: {cloudCacheMetadata.chapterCount}</p>
          {includesKeyCharts ? (
            <p className="text-foreground/80">
              {cloudChartsFileFound
                ? t('cloudCache.includesKeyChartsJson', '含关键图表（同名 JSON）')
                : t('cloudCache.includesKeyCharts', '含关键图表')}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {t('cloudCache.noKeyChartsYet', '暂无关键图表 JSON，加载后可重新生成')}
            </p>
          )}
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
