import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, RefreshCw, Search, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useConfigStore } from '@/stores/configStore'
import { continueReading, listEntries, type LibraryFilter, type LibrarySort } from '@/services/library/libraryIndex'
import { groupEntries, limitGroups, recommendBooks, type GroupBy } from '@/services/library/libraryOrganize'
import { buildShelf, categoryCounts, virtualEntries } from '@/services/library/cloudCatalog'
import { useLibraryStore } from '@/services/library/libraryStore'
import type { LibraryEntry } from '@/services/library/types'
import { isFillable } from '@/services/library/libraryFill'
import { formatFileSize } from '@/utils/file'
import { useGridColumns } from './useGridColumns'
import { BookCard } from './BookCard'
import { BookDetailDialog } from './BookInfo'
import { LibraryToolbar } from './LibraryToolbar'
import { MissingBookDialog, OrphanNotice } from './MissingBookDialogs'
import { groupLabel, reasonLabel } from './labels'

interface LibraryViewProps {
  onOpenBook: (entry: LibraryEntry) => void
  /** 正在打开的书（下载/解析中），卡片上显示转圈并禁用重复点击 */
  openingPath?: string | null
}

/** 紧凑封面墙：一行多放几本（手机 4 / 平板 6 / 桌面 8），首屏只当「随机推荐」看，不是全量目录 */
const GRID = 'grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8'
/** 推荐固定 2 整行（数量 = 列数 × 2，随断点变化），少渲染就少请求封面，也少打扰上游 */
const RECOMMEND_ROWS = 2
/** 首屏书数（6 列 × 4 行）与每次「显示更多」追加的数量；超出的不渲染，别把下面的上传区推到几屏之外 */
const PAGE_FIRST = 24
const PAGE_STEP = 48
/** 补全元数据要下载的总量超过它就先确认（约 200MB） */
const FILL_CONFIRM_BYTES = 200 * 1024 * 1024

export function LibraryView({ onOpenBook, openingPath = null }: LibraryViewProps) {
  const { t } = useTranslation()
  const { index, catalog, catalogLoaded, refreshing, fresh, error, unavailable, refresh, loadCatalog, loadMirror, fillProgress, fillMetadata, cancelFill } =
    useLibraryStore()
  const davEnabled = useConfigStore((s) => s.webdavConfig.enabled)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [group, setGroup] = useState<GroupBy>('none')
  const [category, setCategory] = useState<string | null>(null)
  const [info, setInfo] = useState<LibraryEntry | null>(null)
  // 推荐：种子决定结果；"换一批"换种子并避开上一批。初始种子取当前时间，每次进入书架都是新的一批
  const cols = useGridColumns()
  const recommendCount = cols * RECOMMEND_ROWS
  const [seed, setSeed] = useState(() => Date.now() % 1_000_000)
  const [prevBatch, setPrevBatch] = useState<string[]>([])

  // 进入书库只读「云端书目」和「本地镜像」，都不碰 WebDAV：书架立刻可用，
  // 直到用户真正点开一本书（或手动刷新）才去连 WebDAV。
  useEffect(() => {
    void loadCatalog()
    void loadMirror()
  }, [loadCatalog, loadMirror, davEnabled])

  // 书架 = WebDAV 书库索引 ∪ 云端书目（云端有而 WebDAV 暂无记录的书是「虚拟条目」）
  const shelf = useMemo(() => buildShelf(index, catalog), [index, catalog])
  const allEntries = useMemo(() => listEntries(shelf, { query, filter, sort, category }), [shelf, query, filter, sort, category])
  const categories = useMemo(() => categoryCounts(Object.values(shelf.entries)), [shelf])
  const browsing = !query && filter === 'all' && !category
  const resume = useMemo(() => (browsing ? continueReading(shelf, cols) : []), [shelf, browsing, cols])
  const total = Object.keys(shelf.entries).length
  const recs = useMemo(
    () => (browsing && total >= 3 ? recommendBooks(shelf, { seed, count: recommendCount, exclude: prevBatch, omit: resume.map((e) => e.path) }) : []),
    [shelf, browsing, total, seed, prevBatch, resume, recommendCount]
  )
  // 「继续阅读 / 推荐」已经展示的书不在下面的全量网格里再出现一遍（同一屏相邻重复）；
  // 分组/排序模式下网格本身就是主视图，不排除
  const entries = useMemo(() => {
    if (!browsing || group !== 'none') return allEntries
    const featured = new Set([...resume.map((e) => e.path), ...recs.map((r) => r.entry.path)])
    return featured.size ? allEntries.filter((e) => !featured.has(e.path)) : allEntries
  }, [allEntries, browsing, group, resume, recs])
  // 默认浏览态（有「继续阅读 / 推荐」、最近排序、不分组）下，其余书籍收起：首屏只放几行，按需展开
  const [expanded, setExpanded] = useState(false)
  const collapsed = browsing && group === 'none' && sort === 'recent' && !expanded && resume.length + recs.length > 0
  const groups = useMemo(() => groupEntries(entries, group), [entries, group])
  // 显示上限：筛选/排序/分组/搜索一变就回到首屏数量
  const resetKey = `${query}|${filter}|${sort}|${group}|${category}`
  const [page, setPage] = useState({ key: resetKey, n: PAGE_FIRST })
  const shownCount = page.key === resetKey ? page.n : PAGE_FIRST
  const pagedGroups = useMemo(() => limitGroups(groups, shownCount), [groups, shownCount])
  const hiddenCount = entries.length - pagedGroups.reduce((n, g) => n + g.entries.length, 0)
  const staleEntries = useMemo(() => Object.values(shelf.entries).filter((e) => e.stale && !e.virtual && isFillable(e.path)), [shelf])
  const staleCount = staleEntries.length
  // 补全要把整本书下载下来：先告诉用户总量（646 本约几个 GB），超过阈值再确认一次
  const staleBytes = useMemo(() => staleEntries.reduce((n, e) => n + (e.size || 0), 0), [staleEntries])
  const sizeText = formatFileSize(staleBytes)
  const startFill = () => {
    if (staleBytes >= FILL_CONFIRM_BYTES && !window.confirm(t('library.fill.confirm', { count: staleCount, size: sizeText }))) return
    void fillMetadata()
  }
  // 云端有、WebDAV 没有的书：只有「本次会话成功扫描过、且确实扫到了书」才可信（目录配错时扫到 0 本，不能据此断定书被删了）
  const orphans = useMemo(
    () => (fresh && !refreshing && Object.values(index.entries).some((e) => !e.virtual) ? virtualEntries(shelf) : []),
    [fresh, refreshing, index, shelf]
  )

  // 没有 WebDAV、也没有云端书目 → 没什么可显示的，整块不渲染（和以前 WebDAV 未启用时一致）
  if (unavailable && catalogLoaded && total === 0) return null

  const card = (e: LibraryEntry, caption?: string) => (
    <BookCard
      key={e.path}
      entry={e}
      opening={openingPath === e.path}
      disabled={!!openingPath}
      onOpen={() => onOpenBook(e)}
      onInfo={() => setInfo(e)}
      caption={caption}
      showSize={sort === 'size'}
      compact
    />
  )
  const shuffle = () => {
    setPrevBatch(recs.map((r) => r.entry.path))
    setSeed((s) => s + 1)
  }

  return (
    <section aria-label={t('library.title')} className="space-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="t-title mr-auto">
          {t('library.title')}
          {total > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{total}</span>}
        </h2>
        {/* 补全书籍信息：要下载整本书，由用户触发，且可取消 */}
        {fillProgress ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin" />
            {t('library.fill.running', { done: fillProgress.done, total: fillProgress.total })}
            <Button variant="ghost" size="sm" className="px-2 text-xs" onClick={cancelFill}>
              {t('library.fill.cancel')}
            </Button>
          </span>
        ) : (
          staleCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1 text-xs"
              onClick={startFill}
              title={t('library.fill.hintSize', { count: staleCount, size: sizeText })}
              aria-label={t('library.fill.button', { count: staleCount })}
            >
              <Download className="size-3.5" />
              <span className="hidden sm:inline">{t('library.fill.button', { count: staleCount })}</span>
              <span className="sm:hidden">{staleCount}</span>
            </Button>
          )
        )}
        {davEnabled && (
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
        )}
        {total > 0 && (
          <div className="relative order-last w-full sm:order-none sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('library.search')} className="h-9 pl-8" />
          </div>
        )}
      </header>

      {/* 安静的一行：说清楚数据从哪来、WebDAV 什么时候才会被访问 */}
      {total > 0 && davEnabled && (error || !fresh) && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('library.sync.cached')}
          {error ? `（${error}）` : ''}
        </p>
      )}

      <OrphanNotice orphans={orphans} />

      {total > 0 && (
        <LibraryToolbar
          filter={filter}
          onFilter={setFilter}
          sort={sort}
          onSort={setSort}
          group={group}
          onGroup={setGroup}
          category={category}
          onCategory={setCategory}
          categories={categories}
        />
      )}

      {resume.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="t-label">{t('library.continue')}</h3>
          <div className={GRID}>{resume.map((e) => card(e))}</div>
        </div>
      )}

      {recs.length > 0 && (
        <div className="space-y-1.5" aria-label={t('library.recommend.title')}>
          <div className="flex items-center gap-2">
            <h3 className="t-label">{t('library.recommend.title')}</h3>
            <Button variant="ghost" size="xs" onClick={shuffle}>
              <Shuffle className="size-3.5" />
              {t('library.recommend.shuffle')}
            </Button>
          </div>
          <div className={GRID}>{recs.map((r) => card(r.entry, reasonLabel(t, r.reason)))}</div>
        </div>
      )}

      {collapsed ? (
        entries.length > 0 && (
          <div className="flex justify-center pt-1">
            <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
              {t('library.browseRest', { count: entries.length })}
            </Button>
          </div>
        )
      ) : allEntries.length > 0 ? (
        <>
          {expanded && browsing && group === 'none' && sort === 'recent' && (
            <div className="flex justify-end">
              <Button variant="ghost" size="xs" onClick={() => setExpanded(false)}>
                {t('library.collapseRest')}
              </Button>
            </div>
          )}
          {pagedGroups.map((g) => (
            <div key={g.key} className="space-y-1.5">
              {/* 上面有「继续阅读 / 推荐」时，全量网格也要有自己的标题，否则读起来是同一排 */}
              {group === 'none' && browsing && (resume.length > 0 || recs.length > 0) && (
                <h3 className="border-b pb-1 t-label">
                  {t('library.all')}
                  <span className="ml-1.5 font-normal">{g.total}</span>
                </h3>
              )}
              {group !== 'none' && (
                <h3 className="border-b pb-1 t-label">
                  {groupLabel(t, g.key, group)}
                  <span className="ml-1.5 font-normal">{g.total}</span>
                </h3>
              )}
              <div className={GRID}>{g.entries.map((e) => card(e))}</div>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={() => setPage({ key: resetKey, n: shownCount + PAGE_STEP })}>
                {t('library.showMore', { count: hiddenCount })}
              </Button>
            </div>
          )}
        </>
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
            <p>{total === 0 ? (catalogLoaded && !refreshing ? t('library.empty') : t('library.loading')) : t('library.noMatch')}</p>
          )}
        </div>
      )}

      <BookDetailDialog
        entry={info}
        onClose={() => setInfo(null)}
        onOpen={onOpenBook}
        onPickCategory={(name) => {
          setCategory(name)
          setQuery('')
          setFilter('all')
        }}
        disabled={!!openingPath}
      />
      <MissingBookDialog />
    </section>
  )
}
