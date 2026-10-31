/**
 * 「本章出场」条：章节正文上方一排彩色实体胶囊，点击展开该实体的卡片（不跳转）。
 * 颜色/形状与正文标注、图谱、时间线同源（linking.styles）。
 */
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { EntityLinking } from '@/charts/linking/entityLinking'
import { rectOf } from './anchor'
import { EntitySwatch } from './EntitySwatch'
import type { AnchorRect } from './anchor'

const MAX_CHIPS = 8

interface EntityStripProps {
  linking: EntityLinking
  chapterId: string
  onOpenEntity: (id: string, anchor: AnchorRect, chapterId: string) => void
}

export const EntityStrip = memo(function EntityStrip({ linking, chapterId, onOpenEntity }: EntityStripProps) {
  const { t } = useTranslation()

  // 按本章出现次数排序，最核心的排前面
  const ranked = useMemo(() => {
    const ids = linking.index.chapterToEntities.get(chapterId)
    if (!ids?.size) return []
    const countIn = (id: string) =>
      linking.index.entityToChapters.get(id)?.find((c) => c.chapterId === chapterId)?.count ?? 0
    return [...ids].sort((a, b) => countIn(b) - countIn(a) || (linking.styles.get(a)?.name ?? '').localeCompare(linking.styles.get(b)?.name ?? '', 'zh'))
  }, [linking, chapterId])

  if (!ranked.length) return null
  const shown = ranked.slice(0, MAX_CHIPS)

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('entityStrip.label')}>
      <span className="text-xs text-muted-foreground">{t('entityStrip.label')}</span>
      {shown.map((id) => {
        const s = linking.styles.get(id)
        if (!s) return null
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => onOpenEntity(id, rectOf(e.currentTarget), chapterId)}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <EntitySwatch cssVar={s.cssVar} shape={s.shape} />
            {s.name}
          </button>
        )
      })}
      {ranked.length > MAX_CHIPS && (
        <span className="text-xs text-muted-foreground">{t('entityStrip.more', { count: ranked.length - MAX_CHIPS })}</span>
      )}
    </div>
  )
})
