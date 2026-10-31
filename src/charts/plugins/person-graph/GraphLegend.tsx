/**
 * 图例：形状 = 类型（可点击过滤），颜色 = 实体（与正文标注同色）。
 * 过滤只隐藏节点，不改数据；颜色只显示拿到独立色槽的实体（其余为中性色，不逐个列出）。
 */
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '@/lib/utils'
import type { ChartAnchor } from '../../types'
import type { EntityShape } from '../../linking/entityColors'

export interface LegendEntity {
  id: string
  name: string
  cssVar: string
  shape: EntityShape
}

interface GraphLegendProps {
  /** 图里各形状分组的节点数；0 的分组不显示 */
  groups: { shape: EntityShape; count: number }[]
  hidden: ReadonlySet<string>
  onToggleGroup: (shape: EntityShape) => void
  /** 拿到独立色槽的实体（按色槽排序）；未开启"与正文同色"时传空数组 */
  entities: LegendEntity[]
  onEntityClick?: (id: string, anchor: ChartAnchor) => void
}

/** i18n 要求静态 key，不能拼接 shape */
function shapeLabel(t: TFunction, shape: EntityShape): string {
  if (shape === 'circle') return t('graphLegend.shape.circle')
  if (shape === 'round-rect') return t('graphLegend.shape.roundRect')
  return t('graphLegend.shape.diamond')
}

function ShapeGlyph({ shape, className }: { shape: EntityShape; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0 bg-current',
        shape === 'circle' && 'rounded-full',
        shape === 'round-rect' && 'rounded-[3px]',
        shape === 'diamond' && 'rotate-45 scale-90 rounded-[2px]',
        className
      )}
    />
  )
}

export function GraphLegend({ groups, hidden, onToggleGroup, entities, onEntityClick }: GraphLegendProps) {
  const { t } = useTranslation()
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('graphLegend.types')}>
        {groups.map(({ shape, count }) => {
          const off = hidden.has(shape)
          return (
            <button
              key={shape}
              type="button"
              aria-pressed={!off}
              onClick={() => onToggleGroup(shape)}
              className={cn(
                'inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-xs transition-opacity hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                off && 'opacity-45 line-through'
              )}
            >
              <ShapeGlyph shape={shape} className="text-muted-foreground" />
              {shapeLabel(t, shape)} · {count}
            </button>
          )
        })}
      </div>
      {entities.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('graphLegend.colors')}>
          {entities.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={(ev) => {
                const r = ev.currentTarget.getBoundingClientRect()
                onEntityClick?.(e.id, { x: r.x, y: r.y, width: r.width, height: r.height })
              }}
              className="inline-flex min-h-6 max-w-[9rem] items-center gap-1 rounded px-1 text-[11px] hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <ShapeGlyph shape={e.shape} className="" />
              <span className="truncate">{e.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
