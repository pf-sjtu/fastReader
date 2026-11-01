import { useMemo } from 'react'
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { ProcessingMetadata } from '@/services/cloudCacheService'

interface CloudCacheSectionProps {
  isCheckingCloudCache: boolean
  cloudCacheMetadata: ProcessingMetadata | null
  cloudCacheContent: string | null
  /** 同名 .json 是否在云端存在 */
  cloudChartsFileFound?: boolean
  /** 云缓存存在但不完整（含失败章节） */
  cloudCacheIsPartial?: boolean
  /** 无法确认云端缓存状态（网络/鉴权异常），不等于无缓存 */
  cloudCacheStatusUnknown?: boolean
  file: File | null
  webdavEnabled: boolean
  webdavInitialized: boolean
  onLoadFromCloudCache: () => void | Promise<void>
}

export function CloudCacheSection({
  isCheckingCloudCache,
  cloudCacheMetadata,
  cloudCacheContent,
  cloudChartsFileFound = false,
  cloudCacheIsPartial = false,
  cloudCacheStatusUnknown = false,
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
    // 费用必须用 `> 0` 判断：`costUSD && …` 在费用为 0 时会把数字 0 原样渲染到页面上
    const hasCost = (cloudCacheMetadata.costUSD ?? 0) > 0
    return (
      <div data-slot="cloud-cache" className="rounded-lg border border-success/30 bg-success/5 p-3">
        {/* 标题行：状态在左、主操作在右（不再埋在卡片底部整行铺开）；窄屏自动换行 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 shrink-0 text-success" />
            <span className="text-sm font-medium text-foreground">{t('cloudCache.found')}</span>
          </div>
          <Button type="button" size="sm" onClick={onLoadFromCloudCache}>
            {t('cloudCache.useCache')}
          </Button>
        </div>
        {/* 标签 / 数值两列对齐；整句说明（关键图表、不完整）横跨两列 */}
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{t('cloudCache.processedAt')}</dt>
          <dd className="min-w-0 tabular-nums">{new Date(cloudCacheMetadata.processedAt).toLocaleString()}</dd>
          <dt className="text-muted-foreground">{t('cloudCache.model')}</dt>
          <dd className="min-w-0 break-all">{cloudCacheMetadata.model}</dd>
          <dt className="text-muted-foreground">{t('cloudCache.chapterCount')}</dt>
          <dd className="min-w-0 tabular-nums">{cloudCacheMetadata.chapterCount}</dd>
          {hasCost && (
            <>
              <dt className="text-muted-foreground">{t('cloudCache.cost')}</dt>
              <dd className="min-w-0 tabular-nums">${cloudCacheMetadata.costUSD!.toFixed(4)} / ¥{cloudCacheMetadata.costRMB?.toFixed(2)}</dd>
            </>
          )}
          <dd className={includesKeyCharts ? 'col-span-2 text-foreground/80' : 'col-span-2 text-muted-foreground'}>
            {includesKeyCharts
              ? cloudChartsFileFound
                ? t('cloudCache.includesKeyChartsJson')
                : t('cloudCache.includesKeyCharts')
              : t('cloudCache.noKeyChartsYet')}
          </dd>
          {cloudCacheIsPartial && (
            <dd className="col-span-2 flex items-start gap-1 text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t('cloudCache.partialLoaded')}
            </dd>
          )}
        </dl>
      </div>
    )
  }

  if (cloudCacheStatusUnknown && file && webdavEnabled) {
    return (
      <div role="status" className="flex items-start gap-1 text-xs text-warning">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        {t('cloudCache.statusUnknown')}
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
