import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, RefreshCw, Search, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { continueReading, listEntries, type LibraryFilter, type LibrarySort } from '@/services/library/libraryIndex'
import { groupEntries, recommendBooks, type GroupBy } from '@/services/library/libraryOrganize'
import { useLibraryStore } from '@/services/library/libraryStore'
import type { LibraryEntry } from '@/services/library/types'
import { webdavService } from '@/services/webdavService'
import { BookCard } from './BookCard'
import { groupLabel, reasonLabel } from './labels'

interface LibraryViewProps {
  onOpenBook: (entry: LibraryEntry) => void
  /** 正在打开的书（下载/解析中），卡片上显示转圈并禁用重复点击 */
  openingPath?: string | null
}

const GRID = 'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6'
const RECOMMEND_COUNT = 6
const SELECT_CLS = 'h-8 rounded-md border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring'

export function LibraryView({ onOpenBook, openingPath = null }: LibraryViewProps) {
  const { t } = useTranslation()
  const { index, refreshing, fresh, error, unavailable, refresh, fillProgress, fillMetadata, cancelFill } = useLibraryStore()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [group, setGroup] = useState<GroupBy>('none')
  // 推荐：种子决定结果；"换一批"换种子并避开上一批。初始种子取当前时间，每次进入书架都是新的一批
  const [seed, setSeed] = useState(() => Date.now() % 1_000_000)
  const [prevBatch, setPrevBatch] = useState<string[]>([])

  // 进入书库就刷新：先显示本地镜像，再后台扫描（见 libraryService 的分阶段回调）
  useEffect(() => {
    void refresh()
  }, [refresh])

  // 进来时 WebDAV 可能还在自动连接：连上之后补刷一次，否则 unavailable 会让书库永远不出现
  useEffect(() => {
    if (!unavailable) return
    return webdavService.onInitialized(() => void refresh())
  }, [unavailable, refresh])

  const entries = useMemo(() => listEntries(index, { query, filter, sort }), [index, query, filter, sort])
  const groups = useMemo(() => groupEntries(entries, group), [entries, group])
  const browsing = !query && filter === 'all'
  const resume = useMemo(() => (browsing ? continueReading(index) : []), [index, browsing])
  const total = Object.keys(index.entries).length
  const recs = useMemo(
    () => (browsing && total >= 3 ? recommendBooks(index, { seed, count: RECOMMEND_COUNT, exclude: prevBatch, omit: resume.map((e) => e.path) }) : []),
    [index, browsing, total, seed, prevBatch, resume]
  )
  const staleCount = useMemo(() => Object.values(index.entries).filter((e) => e.stale).length, [index])

  if (unavailable) return null

  const filters: { id: LibraryFilter; label: string }[] = [
    { id: 'all', label: t('library.filter.all') },
    { id: 'done', label: t('library.filter.done') },
    { id: 'todo', label: t('library.filter.todo') },
  ]
  const sorts: { id: LibrarySort; label: string }[] = [
    { id: 'recent', label: t('library.sort.recent') },
    { id: 'name', label: t('library.sort.name') },
    { id: 'author', label: t('library.sort.author') },
    { id: 'status', label: t('library.sort.status') },
    { id: 'progress', label: t('library.sort.progress') },
    { id: 'size', label: t('library.sort.size') },
    { id: 'modified', label: t('library.sort.modified') },
  ]
  const groupOptions: { id: GroupBy; label: string }[] = [
    { id: 'none', label: t('library.group.none') },
    { id: 'status', label: t('library.group.status') },
    { id: 'format', label: t('library.group.format') },
    { id: 'author', label: t('library.group.author') },
    { id: 'folder', label: t('library.group.folder') },
  ]
  const chip = (active: boolean) =>
    cn(
      'min-h-8 rounded-full border px-3 text-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
      active && 'bg-primary text-primary-foreground hover:bg-primary/90'
    )
  const card = (e: LibraryEntry, caption?: string) => (
    <BookCard
      key={e.path}
      entry={e}
      opening={openingPath === e.path}
      disabled={!!openingPath}
      onOpen={() => onOpenBook(e)}
      caption={caption}
      showSize={sort === 'size'}
    />
  )
  const shuffle = () => {
    setPrevBatch(recs.map((r) => r.entry.path))
    setSeed((s) => s + 1)
  }

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

      {total > 0 && (error || (!fresh && !refreshing)) && (
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
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            {t('library.sortBy')}
            <select aria-label={t('library.sortBy')} className={SELECT_CLS} value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)}>
              {sorts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            {t('library.groupBy')}
            <select aria-label={t('library.groupBy')} className={SELECT_CLS} value={group} onChange={(e) => setGroup(e.target.value as GroupBy)}>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          {/* 补全书名/作者/封面：要下载整本书，所以由用户触发，且可取消 */}
          {fillProgress ? (
            <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" />
              {t('library.fill.running', { done: fillProgress.done, total: fillProgress.total })}
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={cancelFill}>
                {t('library.fill.cancel')}
              </Button>
            </span>
          ) : (
            staleCount > 0 && (
              <Button variant="outline" size="sm" className="ml-auto h-8 gap-1 text-xs" onClick={() => void fillMetadata()} title={t('library.fill.hint')}>
                <Download className="size-3.5" />
                {t('library.fill.button', { count: staleCount })}
              </Button>
            )
          )}
        </div>
      )}

      {resume.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{t('library.continue')}</h3>
          <div className={GRID}>{resume.map((e) => card(e))}</div>
        </div>
      )}

      {recs.length > 0 && (
        <div className="space-y-1.5" aria-label={t('library.recommend.title')}>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">{t('library.recommend.title')}</h3>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={shuffle}>
              <Shuffle className="size-3.5" />
              {t('library.recommend.shuffle')}
            </Button>
          </div>
          <div className={GRID}>{recs.map((r) => card(r.entry, reasonLabel(t, r.reason)))}</div>
        </div>
      )}

      {entries.length > 0 ? (
        groups.map((g) => (
          <div key={g.key} className="space-y-1.5">
            {group !== 'none' && (
              <h3 className="border-b pb-1 text-xs font-medium text-muted-foreground">
                {groupLabel(t, g.key)}
                <span className="ml-1.5 font-normal">{g.entries.length}</span>
              </h3>
            )}
            <div className={GRID}>{g.entries.map((e) => card(e))}</div>
          </div>
        ))
      ) : (
        <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
          {total === 0 && error && !refreshing ? (
            <>
              <p role="alert" className="text-destructive">
                {t('library.scanFailed', { error })}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                {t('library.retry')}
              </Button>
            </>
          ) : (
            <p>{refreshing && total === 0 ? t('library.loading') : total === 0 ? t('library.empty') : t('library.noMatch')}</p>
          )}
        </div>
      )}
    </section>
  )
}
