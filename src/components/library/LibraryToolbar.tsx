import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { LibraryFilter, LibrarySort } from '@/services/library/libraryIndex'
import type { GroupBy } from '@/services/library/libraryOrganize'
import { categoryLabel } from './labels'

/** 分类条最多直接摆几个，其余收进「更多分类」下拉；书很多、分类也很多时不把工具栏撑成几行 */
const CATEGORY_CHIPS = 8
const SELECT_CLS = 'h-8 rounded-md border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring'
const chip = (active: boolean) =>
  cn(
    'min-h-8 rounded-full border px-3 text-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
    active && 'bg-primary text-primary-foreground hover:bg-primary/90'
  )

interface Props {
  filter: LibraryFilter
  onFilter: (f: LibraryFilter) => void
  sort: LibrarySort
  onSort: (s: LibrarySort) => void
  group: GroupBy
  onGroup: (g: GroupBy) => void
  category: string | null
  onCategory: (c: string | null) => void
  categories: { name: string; count: number }[]
}

export function LibraryToolbar({ filter, onFilter, sort, onSort, group, onGroup, category, onCategory, categories }: Props) {
  const { t } = useTranslation()
  const filters: { id: LibraryFilter; label: string }[] = [
    { id: 'all', label: t('library.filter.all') },
    { id: 'done', label: t('library.filter.done') },
    { id: 'todo', label: t('library.filter.todo') },
  ]
  const sorts: { id: LibrarySort; label: string }[] = [
    { id: 'recent', label: t('library.sort.recent') },
    { id: 'name', label: t('library.sort.name') },
    { id: 'author', label: t('library.sort.author') },
    { id: 'year', label: t('library.sort.year') },
    { id: 'status', label: t('library.sort.status') },
    { id: 'progress', label: t('library.sort.progress') },
    { id: 'size', label: t('library.sort.size') },
    { id: 'modified', label: t('library.sort.modified') },
  ]
  const groups: { id: GroupBy; label: string }[] = [
    { id: 'none', label: t('library.group.none') },
    { id: 'category', label: t('library.group.category') },
    { id: 'status', label: t('library.group.status') },
    { id: 'author', label: t('library.group.author') },
    { id: 'year', label: t('library.group.year') },
    { id: 'publisher', label: t('library.group.publisher') },
    { id: 'format', label: t('library.group.format') },
    { id: 'folder', label: t('library.group.folder') },
  ]
  // 当前选中的分类即使排在 8 名开外，也要以 chip 形式可见（否则用户看不到自己正在筛选什么）
  const head = categories.slice(0, CATEGORY_CHIPS)
  const shown = category && !head.some((c) => c.name === category) ? [...head, categories.find((c) => c.name === category) ?? { name: category, count: 0 }] : head
  const rest = categories.filter((c) => !shown.some((s) => s.name === c.name))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} className={chip(filter === f.id)} onClick={() => onFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="sr-only sm:not-sr-only">{t('library.sortBy')}</span>
          <select aria-label={t('library.sortBy')} className={SELECT_CLS} value={sort} onChange={(e) => onSort(e.target.value as LibrarySort)}>
            {sorts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="sr-only sm:not-sr-only">{t('library.groupBy')}</span>
          <select aria-label={t('library.groupBy')} className={SELECT_CLS} value={group} onChange={(e) => onGroup(e.target.value as GroupBy)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {categories.length > 0 && (
        // 手机上单行横向滚动（四五行 chip 会占掉整个首屏）；桌面才换行铺开
        <div
          className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] [&>*]:shrink-0 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          role="group"
          aria-label={t('library.category.label')}
        >
          <button type="button" aria-pressed={category === null} className={chip(category === null)} onClick={() => onCategory(null)}>
            {t('library.category.all')}
          </button>
          {shown.map((c) => (
            <button
              key={c.name}
              type="button"
              aria-pressed={category === c.name}
              className={chip(category === c.name)}
              onClick={() => onCategory(category === c.name ? null : c.name)}
            >
              {t('library.category.count', { name: categoryLabel(t, c.name), count: c.count })}
            </button>
          ))}
          {rest.length > 0 && (
            <select
              aria-label={t('library.category.more')}
              className={SELECT_CLS}
              value=""
              onChange={(e) => e.target.value && onCategory(e.target.value)}
            >
              <option value="">{t('library.category.more')}</option>
              {rest.map((c) => (
                <option key={c.name} value={c.name}>
                  {t('library.category.count', { name: categoryLabel(t, c.name), count: c.count })}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  )
}
