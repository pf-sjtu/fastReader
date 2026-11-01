import { useMemo, useState, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Trash2, RefreshCw, MoreHorizontal, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { BookCharts, ChartPluginProps } from './types'
import { getSortedPlugins } from './registry'
import { cn } from '@/lib/utils'

export interface ChartsPanelProps {
  charts?: BookCharts | null
  chartsError?: string | null
  /** 后处理中正在生成 */
  generating?: boolean
  onClearCache?: () => void
  /** 手动重新生成关键图表 */
  onRegenerate?: () => void | Promise<void>
  canRegenerate?: boolean
  /** 取消正在进行的生成 */
  onCancel?: () => void
  /** 生成前的用量预估（显示在「生成」按钮下方） */
  estimateSlot?: ReactNode
  /** 只渲染该插件（不显示内层页签）：对照栏每个图表占一个页签时使用 */
  onlyPlugin?: string
  /** 联动入参（焦点/回调/配色），原样透传给插件；不传则插件只做展示 */
  pluginProps?: Omit<ChartPluginProps, 'charts'>
  /** 工具栏左侧的插槽（如图谱的联动开关）：和图表操作菜单同一行，不再各占一行 */
  toolbarSlot?: ReactNode
}

export function ChartsPanel({
  charts,
  chartsError,
  generating,
  onClearCache,
  onRegenerate,
  canRegenerate = false,
  onCancel,
  estimateSlot,
  onlyPlugin,
  pluginProps,
  toolbarSlot,
}: ChartsPanelProps) {
  const { t } = useTranslation()
  const plugins = useMemo(() => getSortedPlugins(), [])
  const [regenBusy, setRegenBusy] = useState(false)
  const [activePlugin, setActivePlugin] = useState<string>('')

  const available = useMemo(
    () =>
      charts
        ? plugins.filter((p) => (!onlyPlugin || p.id === onlyPlugin) && p.hasData(charts))
        : [],
    [charts, plugins, onlyPlugin]
  )

  // 保持当前子 Tab；数据就绪后默认选第一个
  useEffect(() => {
    if (!available.length) {
      setActivePlugin('')
      return
    }
    setActivePlugin((prev) =>
      prev && available.some((p) => p.id === prev) ? prev : available[0].id
    )
  }, [available])

  const handleRegenerate = async () => {
    if (!onRegenerate || regenBusy) return
    setRegenBusy(true)
    try {
      await onRegenerate()
    } finally {
      setRegenBusy(false)
    }
  }

  // 数据级操作（重新生成 / 清除缓存）低频且有破坏性：收进一个「⋯」菜单，不再是两枚常驻的文字按钮
  const canRegen = canRegenerate && !!onRegenerate
  const canClear = !!onClearCache && !!charts
  const toolbar =
    toolbarSlot || canRegen || canClear ? (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{toolbarSlot}</div>
        {(canRegen || canClear) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label={t('results.charts.moreActions')} title={t('results.charts.moreActions')}>
                {regenBusy || generating ? <RefreshCw className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canRegen && (
                <DropdownMenuItem disabled={regenBusy || generating} onSelect={() => void handleRegenerate()}>
                  <RefreshCw className="size-4" />
                  {t('results.charts.regenerate')}
                </DropdownMenuItem>
              )}
              {generating && onCancel && (
                <DropdownMenuItem onSelect={onCancel}>
                  <X className="size-4" />
                  {t('results.charts.cancel')}
                </DropdownMenuItem>
              )}
              {canRegen && canClear && <DropdownMenuSeparator />}
              {canClear && (
                <DropdownMenuItem variant="destructive" onSelect={onClearCache}>
                  <Trash2 className="size-4" />
                  {t('results.charts.clearCache')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    ) : null

  if (generating && !charts) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
        {t('results.charts.generating')}
        {onCancel && (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onCancel}>
            {t('results.charts.cancel')}
          </Button>
        )}
      </div>
    )
  }

  if (chartsError && !charts) {
    return (
      <div className="space-y-3">
        {toolbar}
        <div className="text-center py-8 space-y-2">
          <p className="text-sm text-destructive">
            {t('results.charts.failed')}
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
        <div className="space-y-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t('results.charts.empty')}</p>
          {canRegen && (
            <>
              <Button size="sm" onClick={() => void handleRegenerate()} disabled={regenBusy}>
                <RefreshCw className="size-4" />
                {t('results.charts.generate')}
              </Button>
              {estimateSlot}
              <p className="t-caption mx-auto max-w-xs">{t('results.charts.generateHint')}</p>
            </>
          )}
        </div>
      </div>
    )
  }

  // onlyPlugin 不需要等 effect 选出默认页签，首帧就渲染
  if (!activePlugin && !onlyPlugin) {
    return (
      <div className="space-y-3 min-w-0">
        {toolbar}
      </div>
    )
  }

  if (onlyPlugin) {
    const Comp = available[0].Component
    return (
      <div className="space-y-3 min-w-0">
        {toolbar}
        <Comp charts={charts} {...pluginProps} />
      </div>
    )
  }

  return (
    <div className="space-y-3 min-w-0">
      {toolbar}

      <Tabs
        value={activePlugin}
        onValueChange={setActivePlugin}
        className="w-full min-w-0"
      >
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
            <TabsContent
              key={p.id}
              value={p.id}
              forceMount
              className={cn(
                'mt-3 min-w-0',
                activePlugin !== p.id && 'hidden'
              )}
            >
              <Comp charts={charts} {...pluginProps} active={activePlugin === p.id} />
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
