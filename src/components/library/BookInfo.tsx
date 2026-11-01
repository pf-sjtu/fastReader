import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { LibraryEntry } from '@/services/library/types'
import { BookCover } from './BookCover'
import { categoryLabel, formatBookSize } from './labels'
import { useCoverUrl } from './useCoverUrl'

/** 与服务端 / 脚本的简介上限一致（functions/_lib/covers.js cleanMeta） */
const DESC_CAP = 400
const extOf = (path: string) => (path.split('.').pop() ?? '').toUpperCase()

/** 章数 / 页数：有哪个显示哪个 */
const countText = (t: TFunction, e: LibraryEntry): string | null =>
  e.chapterCount ? t('library.chapters', { count: e.chapterCount }) : e.pages ? t('library.pages', { count: e.pages }) : null

/** 出版社 · 年份（任一缺失就只显示另一个） */
const publishLine = (e: LibraryEntry) => [e.publisher, e.year].filter(Boolean).join(' · ')

/** 虚拟条目没有可信的大小（0）也没有 WebDAV 路径，不展示 */
const sizeText = (e: LibraryEntry) => (e.size > 0 ? formatBookSize(e.size) : null)

function CategoryChips({ subjects, limit, onPick }: { subjects: string[]; limit?: number; onPick?: (name: string) => void }) {
  const { t } = useTranslation()
  if (!subjects.length) return null
  return (
    <ul className="flex flex-wrap gap-1" aria-label={t('library.info.categories')}>
      {subjects.slice(0, limit).map((s) => (
        <li key={s}>
          {onPick ? (
            <button
              type="button"
              onClick={() => onPick(s)}
              className="min-h-7 rounded-full border px-2.5 text-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              {categoryLabel(t, s)}
            </button>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{categoryLabel(t, s)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** 悬浮 / 聚焦时的紧凑信息卡：一眼看清「这是什么书、值不值得点开」 */
export function BookTooltipBody({ entry }: { entry: LibraryEntry }) {
  const { t } = useTranslation()
  const count = countText(t, entry)
  const facts = [extOf(entry.path), sizeText(entry), count].filter(Boolean).join(' · ')
  const pct = entry.readProgress?.pct ?? 0
  return (
    <div className="max-w-[18rem] space-y-1.5 text-left">
      <p className="font-brand text-sm font-semibold leading-snug">{entry.title}</p>
      {entry.author && <p className="text-xs opacity-80">{entry.author}</p>}
      {publishLine(entry) && <p className="text-xs opacity-70">{publishLine(entry)}</p>}
      {entry.subjects && <CategoryChips subjects={entry.subjects} limit={4} />}
      {entry.desc && <p className="line-clamp-4 text-xs leading-relaxed opacity-90">{entry.desc}</p>}
      {facts && <p className="text-xs tabular-nums opacity-70">{facts}</p>}
      {pct > 0 && pct < 100 && <p className="text-xs opacity-70">{t('library.info.progress')} {pct}%</p>}
      {entry.virtual && <p className="border-t border-current/20 pt-1 text-xs opacity-60">{t('library.info.unverified')}</p>}
    </div>
  )
}

interface DetailProps {
  entry: LibraryEntry | null
  onClose: () => void
  onOpen: (entry: LibraryEntry) => void
  /** 点分类标签：回到书架并按该分类筛选 */
  onPickCategory: (name: string) => void
  disabled?: boolean
}

/** 完整详情：封面 + 全部 metadata；触屏上没有悬浮，这是等价入口 */
export function BookDetailDialog({ entry, onClose, onOpen, onPickCategory, disabled }: DetailProps) {
  const { t } = useTranslation()
  const { ref, url } = useCoverUrl(entry?.coverKey)
  if (!entry) return null
  const count = countText(t, entry)
  const pct = entry.readProgress?.pct ?? 0
  const rows: [string, string | null][] = [
    [t('library.info.publisher'), entry.publisher ?? null],
    [t('library.info.year'), entry.year ? String(entry.year) : null],
    [t('library.info.chapters'), count],
    [t('library.info.format'), extOf(entry.path) || null],
    [t('library.info.size'), sizeText(entry)],
    [t('library.info.progress'), pct > 0 ? `${pct}%` : null],
  ]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-brand">{entry.title}</DialogTitle>
          <DialogDescription>{entry.author ?? t('library.info.title')}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-4">
          <div ref={ref} className="relative aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/10 sm:w-32">
            {url ? <img src={url} alt="" draggable={false} className="size-full object-cover" /> : <BookCover title={entry.title} seed={entry.path} />}
          </div>
          <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1 text-sm">
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words tabular-nums">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
        {entry.subjects && entry.subjects.length > 0 && (
          <CategoryChips
            subjects={entry.subjects}
            onPick={(name) => {
              onPickCategory(name)
              onClose()
            }}
          />
        )}
        {/* 云端简介上限 400 字：到上限说明被截断了，补省略号而不是在半句话处突然结束 */}
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {entry.desc ? (entry.desc.length >= DESC_CAP ? `${entry.desc}…` : entry.desc) : t('library.info.noDesc')}
        </p>
        {entry.virtual && <p className="text-xs text-muted-foreground">{t('library.info.unverified')}</p>}
        <Button
          className="gap-1.5 self-end"
          disabled={disabled}
          onClick={() => {
            onClose()
            onOpen(entry)
          }}
        >
          <BookOpen className="size-4" />
          {t('library.info.openBook')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
