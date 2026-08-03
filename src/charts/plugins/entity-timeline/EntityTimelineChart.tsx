import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { BookCharts } from '../../types'
import { layoutEntityTimeline } from './layout'
import { readChartTheme, subscribeThemeChange } from '../../theme'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface Props {
  charts: BookCharts
}

export function EntityTimelineChart({ charts }: Props) {
  const { t } = useTranslation()
  const data = charts.entityTimeline
  const [themeTick, setThemeTick] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => subscribeThemeChange(() => setThemeTick((n) => n + 1)), [])

  const theme = useMemo(() => {
    void themeTick
    return readChartTheme()
  }, [themeTick])

  const layout = useMemo(
    () =>
      data
        ? layoutEntityTimeline(data, {
            colWidth: 140,
            labelWidth: 104,
            // 名称 + 简介两行
            headerHeight: 64,
            pad: 8,
            fontSize: 11,
            lineHeight: 15,
            minRowHeight: 48,
            palette: theme.palette,
          })
        : null,
    [data, theme.palette]
  )

  const selected = useMemo(() => {
    if (!selectedId || !data) return null
    return data.events.find((e) => e.id === selectedId) || null
  }, [selectedId, data])

  const itemsByRow = useMemo(() => {
    const m = new Map<number, NonNullable<typeof layout>['items']>()
    if (!layout) return m
    for (const it of layout.items) {
      const list = m.get(it.row) || []
      list.push(it)
      m.set(it.row, list)
    }
    return m
  }, [layout])

  if (!data || !layout || layout.timeRows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {t('results.charts.noTimeline', '暂无时间线数据')}
      </div>
    )
  }

  const { config, entities, timeRows, entityColor } = layout
  // 冻结列/行用实色底，避免滚动时透出
  const stickyColBg = theme.isDark ? 'hsl(var(--card))' : 'var(--card, #fff)'

  return (
    <>
      <div className="w-full max-h-[min(70vh,720px)] overflow-auto border border-border rounded-lg bg-card relative">
        <div className="min-w-max" style={{ width: Math.max(layout.width, 320) }}>
          {/* 表头行：纵向 sticky；「时间」角格同时横向 sticky */}
          <div
            className="flex border-b border-border sticky top-0 z-30"
            style={{ minHeight: config.headerHeight }}
          >
            <div
              className="shrink-0 border-r border-border px-2 py-2 text-xs text-muted-foreground flex items-end sticky left-0 z-40 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]"
              style={{
                width: config.labelWidth,
                background: stickyColBg,
              }}
            >
              {t('results.charts.timelineTime', '时间')}
            </div>
            {entities.map((ent) => {
              const color = entityColor.get(ent.id) || theme.palette[0]
              const blurb =
                ent.description?.trim() ||
                ent.type?.trim() ||
                ''
              const tipLines = [
                ent.name,
                ent.type ? `${t('results.charts.entityType', '类型')}: ${ent.type}` : '',
                blurb && blurb !== ent.type ? blurb : '',
              ].filter(Boolean)
              const tip = tipLines.join('\n')
              const headerBg = `color-mix(in oklab, ${color} 18%, var(--card))`

              return (
                <Tooltip key={ent.id} delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div
                      className="shrink-0 px-1.5 py-1.5 flex flex-col items-center justify-center text-center border-r border-border/50 last:border-r-0 cursor-default"
                      style={{
                        width: config.colWidth,
                        background: headerBg,
                      }}
                    >
                      <span className="text-[11px] font-medium text-foreground leading-snug line-clamp-2 w-full break-words">
                        {ent.name}
                      </span>
                      {blurb ? (
                        <span className="text-[10px] text-muted-foreground leading-snug line-clamp-2 w-full mt-0.5 break-words">
                          {blurb}
                        </span>
                      ) : null}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className="max-w-xs whitespace-pre-wrap text-left text-xs"
                  >
                    {tip}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          {/* 数据行：首列（时间）横向 sticky */}
          {timeRows.map((row, rowIndex) => {
            const rowItems = itemsByRow.get(rowIndex) || []
            return (
              <div
                key={`row-${row.order}`}
                className="flex border-b border-border/40 last:border-b-0"
                style={{ minHeight: row.height }}
              >
                <div
                  className="shrink-0 border-r border-border px-2 py-2 flex items-center justify-end sticky left-0 z-20 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                  style={{
                    width: config.labelWidth,
                    background: stickyColBg,
                  }}
                >
                  <span className="text-[10px] text-muted-foreground text-right leading-snug break-words whitespace-normal w-full">
                    {row.timeLabel}
                  </span>
                </div>
                {entities.map((ent, col) => {
                  const color = entityColor.get(ent.id) || theme.palette[0]
                  const cellItems = rowItems.filter((it) => it.col === col)
                  return (
                    <div
                      key={`${row.order}-${ent.id}`}
                      className="shrink-0 px-1 py-1.5 flex flex-col gap-1 justify-center border-r border-border/30 last:border-r-0"
                      style={{
                        width: config.colWidth,
                        background: `color-mix(in oklab, ${color} 8%, transparent)`,
                      }}
                    >
                      {cellItems.map((item) => (
                        <button
                          key={`${item.event.id}-${item.entityId}`}
                          type="button"
                          onClick={() => setSelectedId(item.event.id)}
                          title={
                            item.event.description
                              ? `${item.event.label}\n${item.event.description}`
                              : item.event.label
                          }
                          className={cn(
                            'w-full rounded-md px-1.5 py-1.5 text-left transition-opacity hover:opacity-100 opacity-95',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            'text-white'
                          )}
                          style={{
                            backgroundColor: item.color,
                            textShadow: theme.isDark
                              ? '0 1px 2px rgba(0,0,0,0.65)'
                              : '0 1px 1px rgba(0,0,0,0.4)',
                          }}
                        >
                          <span className="block text-[11px] font-medium leading-snug break-words whitespace-normal">
                            {item.event.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {t(
          'results.charts.timelineHint',
          '纵轴为时间/事件顺序，横轴为实体；表头与时间列已冻结，可滚动查看；点击色块查看详情'
        )}
      </p>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent
          side="right"
          className="sm:max-w-md p-0 gap-0 flex flex-col h-full max-h-dvh overflow-hidden"
        >
          <SheetHeader className="shrink-0 pr-12 border-b border-border">
            <SheetTitle className="pr-2 break-words">{selected?.label}</SheetTitle>
            <SheetDescription className="break-words">
              {selected?.timeLabel}
              {selected?.chapterHint ? ` · ${selected.chapterHint}` : ''}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3 text-sm">
            {selected?.description && (
              <p className="text-foreground leading-relaxed break-words">
                {selected.description}
              </p>
            )}
            {selected?.entityIds?.length ? (
              <div className="pb-6">
                <div className="text-muted-foreground mb-1 sticky top-0 bg-background/95 backdrop-blur-sm py-1">
                  {t('results.charts.relatedEntities', '相关实体')}
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  {selected.entityIds.map((id) => {
                    const name = entities.find((e) => e.id === id)?.name || id
                    return (
                      <li key={id} className="break-words">
                        {name}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
