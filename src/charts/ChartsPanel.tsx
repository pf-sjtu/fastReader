import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Trash2, RefreshCw } from 'lucide-react'
import type { BookCharts } from './types'
import { getSortedPlugins } from './registry'

export interface ChartsPanelProps {
  charts?: BookCharts | null
  chartsError?: string | null
  /** 后处理中正在生成 */
  generating?: boolean
  onClearCache?: () => void
  /** 手动重新生成关键图表 */
  onRegenerate?: () => void | Promise<void>
  canRegenerate?: boolean
}

export function ChartsPanel({
  charts,
  chartsError,
  generating,
  onClearCache,
  onRegenerate,
  canRegenerate = false,
}: ChartsPanelProps) {
  const { t } = useTranslation()
  const plugins = useMemo(() => getSortedPlugins(), [])
  const [regenBusy, setRegenBusy] = useState(false)

  const available = useMemo(
    () => (charts ? plugins.filter((p) => p.hasData(charts)) : []),
    [charts, plugins]
  )

  const handleRegenerate = async () => {
    if (!onRegenerate || regenBusy) return
    setRegenBusy(true)
    try {
      await onRegenerate()
    } finally {
      setRegenBusy(false)
    }
  }

  const toolbar = (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      {canRegenerate && onRegenerate && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={regenBusy || generating}
          onClick={handleRegenerate}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${regenBusy ? 'animate-spin' : ''}`} />
          {t('results.charts.regenerate', '重新生成图表')}
        </Button>
      )}
      {onClearCache && charts && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={onClearCache}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          {t('results.charts.clearCache', '清除图表缓存')}
        </Button>
      )}
    </div>
  )

  if (generating && !charts) {
    return (
      <div className="text-center text-muted-foreground py-12 text-sm">
        {t('results.charts.generating', '正在生成关键图表…')}
      </div>
    )
  }

  if (chartsError && !charts) {
    return (
      <div className="space-y-3">
        {toolbar}
        <div className="text-center py-8 space-y-2">
          <p className="text-sm text-destructive">
            {t('results.charts.failed', '关键图表生成失败')}
          </p>
          <p className="text-xs text-muted-foreground break-all max-w-lg mx-auto">
            {chartsError}
          </p>
        </div>
      </div>
    )
  }

  if (!charts || available.length === 0) {
    return (
      <div className="space-y-3">
        {toolbar}
        <div className="text-center text-muted-foreground py-8 text-sm">
          {t('results.charts.empty', '暂无关键图表数据')}
        </div>
      </div>
    )
  }

  const defaultTab = available[0].id

  return (
    <div className="space-y-3 min-w-0">
      {toolbar}

      <Tabs defaultValue={defaultTab} className="w-full min-w-0">
        <TabsList
          className="h-auto flex flex-wrap w-full justify-start gap-1"
        >
          {available.map((p) => (
            <TabsTrigger
              key={p.id}
              value={p.id}
              className="text-xs sm:text-sm px-2 sm:px-3 py-1.5"
            >
              {t(p.titleKey, p.id)}
            </TabsTrigger>
          ))}
        </TabsList>

        {available.map((p) => {
          const Comp = p.Component
          return (
            <TabsContent key={p.id} value={p.id} className="mt-3 min-w-0">
              <Comp charts={charts} />
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
