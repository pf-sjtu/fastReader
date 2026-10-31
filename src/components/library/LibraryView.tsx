import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { continueReading, listEntries, type LibraryFilter, type LibrarySort } from '@/services/library/libraryIndex'
import { useLibraryStore } from '@/services/library/libraryStore'
import type { LibraryEntry } from '@/services/library/types'
import { BookCover } from './BookCover'

interface LibraryViewProps {
  onOpenBook: (entry: LibraryEntry) => void
  /** 正在打开的书（下载/解析中），卡片上显示转圈并禁用重复点击 */
  openingPath?: string | null
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const extOf = (path: string) => (path.split('.').pop() ?? '').toUpperCase()
const GRID = 'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6'

function BookCard({ entry, opening, disabled, onOpen }: { entry: LibraryEntry; opening: boolean; disabled: boolean; onOpen: () => void }) {
  const { t } = useTranslation()
  const pct = entry.readProgress?.pct ?? 0
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="group flex min-h-11 flex-col gap-1.5 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <div className="relative">
        <BookCover title={entry.title} seed={entry.path} className="transition-transform group-hover:-translate-y-0.5" />
        {entry.status !== 'unprocessed' && (
          <Badge className="absolute right-1.5 top-1.5 bg-primary text-primary-foreground">
            {entry.status === 'done' ? t('library.status.done') : t('library.status.partial')}
          </Badge>
        )}
        {opening && (
          <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70">
            <Loader2 className="size-5 animate-spin" />
          </span>
        )}
        {pct > 0 && pct < 100 && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-border">
            <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
      <span className="line-clamp-2 text-sm font-medium leading-snug">{entry.title}</span>
      <span className="text-xs text-muted-foreground">
        {extOf(entry.path)} · {fmtSize(entry.size)}
        {entry.chapterCount ? ` · ${t('library.chapters', { count: entry.chapterCount })}` : ''}
      </span>
    </button>
  )
}

export function LibraryView({ onOpenBook, openingPath = null }: LibraryViewProps) {
  const { t } = useTranslation()
  const { index, refreshing, fresh, error, unavailable, refresh } = useLibraryStore()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [sort, setSort] = useState<LibrarySort>('recent')

  // 进入书库就刷新：先显示本地镜像，再后台扫描（见 libraryService 的分阶段回调）
  useEffect(() => {
    void refresh()
  }, [refresh])

  const entries = useMemo(() => listEntries(index, { query, filter, sort }), [index, query, filter, sort])
  const resume = useMemo(() => (query || filter !== 'all' ? [] : continueReading(index)), [index, query, filter])
  const total = Object.keys(index.entries).length

  if (unavailable) return null

  const filters: { id: LibraryFilter; label: string }[] = [
    { id: 'all', label: t('library.filter.all') },
    { id: 'done', label: t('library.filter.done') },
    { id: 'todo', label: t('library.filter.todo') },
  ]
  const sorts: { id: LibrarySort; label: string }[] = [
    { id: 'recent', label: t('library.sort.recent') },
    { id: 'name', label: t('library.sort.name') },
    { id: 'status', label: t('library.sort.status') },
  ]
  const chip = (active: boolean) =>
    cn(
      'min-h-8 rounded-full border px-3 text-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
      active && 'bg-primary text-primary-foreground hover:bg-primary/90'
    )
  const card = (e: LibraryEntry) => (
    <BookCard key={e.path} entry={e} opening={openingPath === e.path} disabled={!!openingPath} onOpen={() => onOpenBook(e)} />
  )

  return (
    <section aria-label={t('library.title')} className="space-y-3 rounded-xl border bg-card p-3 sm:p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="font-brand mr-auto text-base font-semibold">
          {t('library.title')}
          {total > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{total}</span>}
        </h2>
        {total > 0 && (
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('library.search')} className="h-9 pl-8" />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          onClick={() => void refresh()}
          disabled={refreshing}
          aria-label={t('library.refresh')}
          title={t('library.refresh')}
        >
          <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
        </Button>
      </header>

      {(error || (!fresh && !refreshing && total > 0)) && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('library.stale')}
          {error ? `（${error}）` : ''}
        </p>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} className={chip(filter === f.id)} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {sorts.map((s) => (
            <button key={s.id} type="button" aria-pressed={sort === s.id} className={chip(sort === s.id)} onClick={() => setSort(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {resume.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{t('library.continue')}</h3>
          <div className={GRID}>{resume.map(card)}</div>
        </div>
      )}

      {entries.length > 0 ? (
        <div className={GRID}>{entries.map(card)}</div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {refreshing && total === 0 ? t('library.loading') : total === 0 ? t('library.empty') : t('library.noMatch')}
        </p>
      )}
    </section>
  )
}
