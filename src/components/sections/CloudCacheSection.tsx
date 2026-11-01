import { useMemo } from 'react'
import { Loader2, Check, ArrowRight, AlertTriangle } from 'lucide-react'
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
    // 元数据药丸：「标签 值」一枚一枚排开，窄屏自动折行（比两列表格更像一张「收藏卡」，也不会让长模型名撑坏布局）
    const chip = 'inline-flex max-w-full items-baseline gap-1.5 rounded-full border bg-background/70 px-2.5 py-0.5 text-xs'
    return (
      <div data-slot="cloud-cache" className="relative overflow-hidden rounded-lg border border-success/30 bg-success/5">
        {/* 书脊：左缘一道成功色竖条，一眼分出「这是已有成果」而不是普通提示 */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-success" />
        <div className="flex flex-wrap items-center gap-3 p-3 pl-5">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-success-foreground">
            <Check className="size-5" strokeWidth={3} />
          </span>
          <div className="min-w-0 flex-1 basis-40">
            <p className="t-title">{t('cloudCache.found')}</p>
            <p className="t-caption tabular-nums">{new Date(cloudCacheMetadata.processedAt).toLocaleString()}</p>
          </div>
          <Button type="button" onClick={onLoadFromCloudCache} className="gap-1.5">
            {t('cloudCache.useCache')}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3 pl-5">
          <dl className="contents">
            <div className={chip}>
              <dt className="text-muted-foreground">{t('cloudCache.model')}</dt>
              <dd className="min-w-0 break-all font-medium">{cloudCacheMetadata.model}</dd>
            </div>
            <div className={chip}>
              <dt className="text-muted-foreground">{t('cloudCache.chapterCount')}</dt>
              <dd className="font-medium tabular-nums">{cloudCacheMetadata.chapterCount}</dd>
            </div>
            {hasCost && (
              <div className={chip}>
                <dt className="text-muted-foreground">{t('cloudCache.cost')}</dt>
                <dd className="font-medium tabular-nums">${cloudCacheMetadata.costUSD!.toFixed(4)} / ¥{cloudCacheMetadata.costRMB?.toFixed(2)}</dd>
              </div>
            )}
          </dl>
          <span className={includesKeyCharts ? `${chip} border-success/40 text-success` : `${chip} border-dashed text-muted-foreground`}>
            {includesKeyCharts
              ? cloudChartsFileFound
                ? t('cloudCache.includesKeyChartsJson')
                : t('cloudCache.includesKeyCharts')
              : t('cloudCache.noKeyChartsYet')}
          </span>
        </div>
        {cloudCacheIsPartial && (
          <p className="flex items-start gap-1.5 border-t border-warning/30 bg-warning/10 py-2 pl-5 pr-3 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {t('cloudCache.partialLoaded')}
          </p>
        )}
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
