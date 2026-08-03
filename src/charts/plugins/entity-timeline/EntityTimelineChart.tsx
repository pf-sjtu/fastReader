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
            colWidth: 132,
            labelWidth: 104,
            headerHeight: 48,
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

  return (
    <>
      <div className="w-full overflow-auto border border-border rounded-lg bg-card">
        <div className="min-w-max" style={{ width: Math.max(layout.width, 320) }}>
          {/* 表头：完整实体名，换行不截断 */}
          <div
            className="flex border-b border-border sticky top-0 z-10 bg-card/95 backdrop-blur-sm"
            style={{ minHeight: config.headerHeight }}
          >
            <div
              className="shrink-0 border-r border-border px-2 py-2 text-xs text-muted-foreground flex items-end"
              style={{ width: config.labelWidth }}
            >
              {t('results.charts.timelineTime', '时间')}
            </div>
            {entities.map((ent) => {
              const color = entityColor.get(ent.id) || theme.palette[0]
              return (
                <div
                  key={ent.id}
                  className="shrink-0 px-1.5 py-2 flex items-center justify-center text-center border-r border-border/50 last:border-r-0"
                  style={{
                    width: config.colWidth,
                    background: `color-mix(in oklab, ${color} 18%, var(--card))`,
                  }}
                >
                  <span className="text-[11px] font-medium text-foreground leading-snug break-words whitespace-normal w-full">
                    {ent.name}
                  </span>
                </div>
              )
            })}
          </div>

          {/* 数据行：高度随内容自适应，色块文字完整换行 */}
          {timeRows.map((row, rowIndex) => {
            const rowItems = itemsByRow.get(rowIndex) || []
            return (
              <div
                key={`row-${row.order}`}
                className="flex border-b border-border/40 last:border-b-0"
                style={{ minHeight: row.height }}
              >
                <div
                  className="shrink-0 border-r border-border px-2 py-2 flex items-center justify-end"
                  style={{ width: config.labelWidth }}
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
          '纵轴为时间/事件顺序，横轴为实体；点击色块查看详情'
        )}
      </p>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected?.label}</SheetTitle>
            <SheetDescription>
              {selected?.timeLabel}
              {selected?.chapterHint ? ` · ${selected.chapterHint}` : ''}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3 text-sm px-1">
            {selected?.description && (
              <p className="text-foreground leading-relaxed">{selected.description}</p>
            )}
            {selected?.entityIds?.length ? (
              <div>
                <div className="text-muted-foreground mb-1">
                  {t('results.charts.relatedEntities', '相关实体')}
                </div>
                <ul className="list-disc pl-5">
                  {selected.entityIds.map((id) => {
                    const name = entities.find((e) => e.id === id)?.name || id
                    return <li key={id}>{name}</li>
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
