import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BookCharts } from '../../types'
import { layoutEntityTimeline } from './layout'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface Props {
  charts: BookCharts
}

export function EntityTimelineChart({ charts }: Props) {
  const { t } = useTranslation()
  const data = charts.entityTimeline
  const layout = useMemo(
    () => (data ? layoutEntityTimeline(data) : null),
    [data]
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = useMemo(() => {
    if (!selectedId || !data) return null
    return data.events.find((e) => e.id === selectedId) || null
  }, [selectedId, data])

  if (!data || !layout || layout.timeRows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {t('results.charts.noTimeline', '暂无时间线数据')}
      </div>
    )
  }

  const { config, entities, timeRows, items, width, height, entityColor } = layout
  const chipW = config.colWidth - config.pad * 2
  const chipH = config.rowHeight - config.pad * 2

  return (
    <>
      <div className="w-full overflow-auto border rounded-lg bg-card">
        <svg
          width={Math.max(width, 320)}
          height={Math.max(height, 200)}
          className="min-w-full"
          role="img"
          aria-label={t('results.charts.timeline', '实体时间线')}
        >
          {/* 表头：实体名 */}
          {entities.map((ent, col) => {
            const x = config.labelWidth + col * config.colWidth
            const color = entityColor.get(ent.id) || '#888'
            return (
              <g key={ent.id}>
                <rect
                  x={x}
                  y={0}
                  width={config.colWidth}
                  height={config.headerHeight}
                  fill={color}
                  opacity={0.15}
                />
                <text
                  x={x + config.colWidth / 2}
                  y={config.headerHeight / 2 + 4}
                  textAnchor="middle"
                  className="fill-foreground text-[11px] font-medium"
                  style={{ fontSize: 11 }}
                >
                  {ent.name.length > 8 ? ent.name.slice(0, 7) + '…' : ent.name}
                </text>
              </g>
            )
          })}

          {/* 色带背景列 */}
          {entities.map((ent, col) => {
            const x = config.labelWidth + col * config.colWidth
            const color = entityColor.get(ent.id) || '#888'
            return (
              <rect
                key={`band-${ent.id}`}
                x={x + 2}
                y={config.headerHeight}
                width={config.colWidth - 4}
                height={timeRows.length * config.rowHeight}
                fill={color}
                opacity={0.08}
                rx={4}
              />
            )
          })}

          {/* 纵轴时间标签 + 横线 */}
          {timeRows.map((row, i) => {
            const y = config.headerHeight + i * config.rowHeight
            return (
              <g key={`row-${row.order}`}>
                <line
                  x1={config.labelWidth}
                  y1={y}
                  x2={width}
                  y2={y}
                  stroke="currentColor"
                  opacity={0.08}
                />
                <text
                  x={config.labelWidth - 6}
                  y={y + config.rowHeight / 2 + 4}
                  textAnchor="end"
                  style={{ fontSize: 10 }}
                  className="fill-muted-foreground"
                >
                  {row.timeLabel.length > 10
                    ? row.timeLabel.slice(0, 9) + '…'
                    : row.timeLabel}
                </text>
              </g>
            )
          })}

          {/* 事件色块 */}
          {items.map((item) => (
            <g
              key={`${item.event.id}-${item.entityId}`}
              transform={`translate(${item.x},${item.y})`}
              className="cursor-pointer"
              onClick={() => setSelectedId(item.event.id)}
            >
              <title>
                {item.event.label}
                {item.event.description ? `\n${item.event.description}` : ''}
              </title>
              <rect
                width={chipW}
                height={Math.min(chipH, 44)}
                rx={6}
                fill={item.color}
                opacity={0.85}
              />
              <text
                x={chipW / 2}
                y={Math.min(chipH, 44) / 2 + 4}
                textAnchor="middle"
                fill="#fff"
                style={{ fontSize: 10, fontWeight: 500 }}
              >
                {item.event.label.length > 10
                  ? item.event.label.slice(0, 9) + '…'
                  : item.event.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {t('results.charts.timelineHint', '纵轴为时间/事件顺序，横轴为实体；点击色块查看详情')}
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
