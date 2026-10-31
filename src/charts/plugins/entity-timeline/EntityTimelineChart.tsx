import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChartPluginProps } from '../../types'
import { layoutEntityTimeline } from './layout'
import { readChartTheme, readableTextOn, resolveCssVarColor, subscribeThemeChange } from '../../theme'
import { flashElement } from '@/utils/scrollTo'
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

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

export function EntityTimelineChart({
  charts,
  focus,
  active = true,
  onEntitySelect,
  onEventSelect,
  styleOf,
  colorize = false,
}: ChartPluginProps) {
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

  const scrollRef = useRef<HTMLDivElement>(null)

  /** 某实体当前该用的颜色：开启"同色"时取统一 token（CSS 变量，DOM 里可直接用） */
  const colorOf = (id: string, fallback: string): string =>
    (colorize ? styleOf?.(id)?.cssVar : undefined) ?? fallback

  /** 色块上的字色：按解析后的实际底色取深/浅，保证暗色主题下也读得清 */
  const textOn = (bg: string): string => {
    void themeTick
    return readableTextOn(resolveCssVarColor(bg, theme.primary))
  }

  const hitEvents = focus?.chapterEventIds
  const hasHit = !!hitEvents && hitEvents.size > 0
  const focusedEventId = focus?.focusedEventId ?? null
  const focusedEntityId = focus?.focusedEntityId ?? null
  const nonce = focus?.jumpNonce

  // 跳转到达：把被聚焦的事件（或实体首个事件）滚到视野中央并闪烁；页签隐藏时不动，切回后补上
  const handledNonce = useRef<number | undefined>(undefined)
  useEffect(() => {
    const box = scrollRef.current
    if (!box || !active || nonce === handledNonce.current) return
    const sel = focusedEventId
      ? `[data-event-id="${CSS.escape(focusedEventId)}"]`
      : focusedEntityId
        ? `[data-entity-col="${CSS.escape(focusedEntityId)}"]`
        : null
    const el = sel ? box.querySelector<HTMLElement>(sel) : null
    if (!el) return
    handledNonce.current = nonce
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    return flashElement(el)
  }, [active, nonce, focusedEventId, focusedEntityId, layout])

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
        {t('results.charts.noTimeline')}
      </div>
    )
  }

  const { config, entities, timeRows, entityColor } = layout
  // 冻结列用实色底（hex，来自主题），避免滚动时透出下层
  const stickyColBg = theme.card || '#ffffff'

  return (
    <>
      <div
        ref={scrollRef}
        className="w-full max-h-[min(70vh,720px)] overflow-auto border border-border rounded-lg bg-card relative"
      >
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
              {t('results.charts.timelineTime')}
            </div>
            {entities.map((ent) => {
              const color = colorOf(ent.id, entityColor.get(ent.id) || theme.palette[0])
              const blurb =
                ent.description?.trim() ||
                ent.type?.trim() ||
                ''
              const tipLines = [
                ent.name,
                ent.type ? `${t('results.charts.entityType')}: ${ent.type}` : '',
                blurb && blurb !== ent.type ? blurb : '',
              ].filter(Boolean)
              const tip = tipLines.join('\n')
              const headerBg = `color-mix(in oklab, ${color} 18%, var(--card))`

              return (
                <Tooltip key={ent.id} delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div
                      data-entity-col={ent.id}
                      role={onEntitySelect ? 'button' : undefined}
                      tabIndex={onEntitySelect ? 0 : undefined}
                      onClick={onEntitySelect ? (e) => onEntitySelect(ent.id, rectOf(e.currentTarget)) : undefined}
                      onKeyDown={
                        onEntitySelect
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onEntitySelect(ent.id, rectOf(e.currentTarget))
                              }
                            }
                          : undefined
                      }
                      className={cn(
                        'shrink-0 px-1.5 py-1.5 flex flex-col items-center justify-center text-center border-r border-border/50 last:border-r-0',
                        onEntitySelect
                          ? 'cursor-pointer hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring'
                          : 'cursor-default',
                        focusedEntityId === ent.id && 'ring-2 ring-inset ring-foreground/60'
                      )}
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
                  const color = colorOf(ent.id, entityColor.get(ent.id) || theme.palette[0])
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
                      {cellItems.map((item) => {
                        const bg = colorOf(item.entityId, item.color)
                        const isHit = hasHit && hitEvents.has(item.event.id)
                        const isFocused = focusedEventId === item.event.id
                        return (
                        <button
                          key={`${item.event.id}-${item.entityId}`}
                          type="button"
                          data-event-id={item.event.id}
                          aria-current={isHit ? 'true' : undefined}
                          onClick={(e) =>
                            onEventSelect
                              ? onEventSelect(item.event.id, rectOf(e.currentTarget))
                              : setSelectedId(item.event.id)
                          }
                          title={
                            item.event.description
                              ? `${item.event.label}\n${item.event.description}`
                              : item.event.label
                          }
                          className={cn(
                            'w-full rounded-md px-1.5 py-1.5 text-left transition-opacity hover:opacity-100',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            // 本章事件保持醒目，其余淡化（不隐藏：全局脉络仍可见）
                            hasHit && !isHit && !isFocused ? 'opacity-55' : 'opacity-95',
                            (isHit || isFocused) && 'ring-2 ring-foreground/70 ring-offset-1 ring-offset-card'
                          )}
                          style={{ backgroundColor: bg, color: textOn(bg) }}
                        >
                          <span className="block text-[11px] font-medium leading-snug break-words whitespace-normal">
                            {item.event.label}
                          </span>
                        </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {t('results.charts.timelineHint')}
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
                  {t('results.charts.relatedEntities')}
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
