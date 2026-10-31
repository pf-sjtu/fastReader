/**
 * 人物志：全部实体按类型分组，带统一实体色。可搜索。
 * 简介走防剧透模型（读到此处之前出场才显示），点击行展开卡片而不是跳转。
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { buildEntityCardModel } from '@/charts/linking/entityCard'
import type { EntityLinking } from '@/charts/linking/entityLinking'
import { rectOf } from './anchor'
import { EntitySwatch } from './EntitySwatch'
import type { AnchorRect } from './anchor'

interface PeoplePanelProps {
  linking: EntityLinking | null
  currentChapterId?: string
  onOpenEntity: (id: string, anchor: AnchorRect) => void
}

export function PeoplePanel({ linking, currentChapterId, onOpenEntity }: PeoplePanelProps) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')

  const groups = useMemo(() => {
    if (!linking) return []
    const query = q.trim().toLowerCase()
    const byType = new Map<string, { id: string; name: string; description?: string; hidden: boolean }[]>()
    for (const s of linking.styles.values()) {
      if (query && !s.name.toLowerCase().includes(query)) continue
      const m = buildEntityCardModel(linking, s.id, currentChapterId)
      const type = s.type || t('people.untyped')
      const list = byType.get(type) ?? []
      // 简介受防剧透约束：折叠时只显示占位，不把文字交给 DOM
      list.push({ id: s.id, name: s.name, description: m?.visible.description, hidden: (m?.hidden.description ?? 0) > 0 })
      byType.set(type, list)
    }
    return [...byType.entries()]
  }, [linking, currentChapterId, q, t])

  if (!linking) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">{t('people.empty')}</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('people.search')}
          aria-label={t('people.search')}
          className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {groups.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('people.noMatch')}</p>}

      {groups.map(([type, rows]) => (
        <section key={type} aria-label={type}>
          <h4 className="mb-1 t-label">
            {type} · {rows.length}
          </h4>
          <ul className="space-y-0.5">
            {rows.map((r) => {
              const s = linking.styles.get(r.id)!
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={(e) => onOpenEntity(r.id, rectOf(e.currentTarget))}
                    className="flex min-h-9 w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <EntitySwatch cssVar={s.cssVar} shape={s.shape} className="mt-1.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      {r.description ? (
                        <span className="line-clamp-2 text-xs text-muted-foreground">{r.description}</span>
                      ) : r.hidden ? (
                        <span className="text-xs italic text-muted-foreground">{t('people.folded')}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
