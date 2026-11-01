import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { LibraryEntry } from '@/services/library/types'
import { BookCover } from './BookCover'
import { categoryLabel, categoryTone, formatBookSize, type CategoryTone } from './labels'
import { useCoverUrl } from './useCoverUrl'

/** 与服务端 / 脚本的简介上限一致（functions/_lib/covers.js cleanMeta） */
const DESC_CAP = 400
const extOf = (path: string) => (path.split('.').pop() ?? '').toUpperCase()

/** 简介全文；云端上限 400 字：到上限说明被截断了，补省略号而不是在半句话处突然结束 */
const descText = (desc: string) => (desc.length >= DESC_CAP ? `${desc}…` : desc)

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

/** 悬浮卡里的分类标签：淡底 + 同色字（语义 token），不抢书名的风头；颜色与书卡右上角的分类胶囊同一套色调 */
const SOFT_TONE: Record<CategoryTone, string> = {
  primary: 'bg-primary/10 text-primary',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
}

/**
 * 悬浮 / 聚焦时的信息卡：像一页书签——衬线书名 + 朱砂题签短线、作者与出版信息、彩色分类标签、完整简介、
 * 格式 / 体积 / 章数标签与阅读进度条。显示全部 metadata（不截断）；内容超过可用高度时在卡内纵向滚动，
 * 滚动区下方还有内容时底边渐隐，提示「还有」，滚到底自动消失。
 * 高度取 Radix 给出的「当前方向上的可用高度」，再封顶 24rem：矮窗口里也不会顶出视口。
 * Tooltip 内容默认可悬停（鼠标能移进来），所以滚轮滚动可用；overscroll-contain 避免滚到底后带动页面。
 */
export function BookTooltipBody({ entry }: { entry: LibraryEntry }) {
  const { t } = useTranslation()
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const measure = useCallback(() => {
    const el = scroller.current
    if (el) setMore(el.scrollHeight - el.clientHeight - el.scrollTop > 4)
  }, [])
  useLayoutEffect(() => {
    measure()
    const el = scroller.current
    // 卡片的可用高度会随窗口 / 定位变化：高度一变就重新判断是否需要渐隐提示
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, entry])

  const facts = [extOf(entry.path), sizeText(entry), countText(t, entry)].filter(Boolean) as string[]
  const pct = entry.readProgress?.pct ?? 0
  const byline = [entry.author, publishLine(entry)].filter(Boolean)
  return (
    <div
      ref={scroller}
      onScroll={measure}
      style={more ? { maskImage: 'linear-gradient(to bottom, black calc(100% - 2rem), transparent)' } : undefined}
      className="max-h-[min(24rem,var(--radix-tooltip-content-available-height,24rem))] max-w-[20rem] space-y-2.5 overflow-y-auto overscroll-contain py-0.5 pr-1 text-left [scrollbar-width:thin]"
    >
      <div className="space-y-1.5">
        <p className="t-title">{entry.title}</p>
        <span aria-hidden className="block h-0.5 w-8 rounded-full bg-primary" />
        {byline.length > 0 && <p className="t-caption">{byline.join(' · ')}</p>}
      </div>
      {entry.subjects && entry.subjects.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t('library.info.categories')}>
          {entry.subjects.map((s) => (
            <li key={s} className={`rounded-full px-2 py-0.5 text-xs ${SOFT_TONE[categoryTone(s)]}`}>
              {categoryLabel(t, s)}
            </li>
          ))}
        </ul>
      )}
      {entry.desc && <p className="whitespace-pre-line text-xs leading-relaxed text-foreground/90">{descText(entry.desc)}</p>}
      {facts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-xs tabular-nums text-muted-foreground">
          {facts.map((f) => (
            <li key={f} className="rounded-md border px-1.5 py-0.5">
              {f}
            </li>
          ))}
        </ul>
      )}
      {pct > 0 && pct < 100 && (
        <div className="space-y-1">
          <p className="t-caption flex justify-between tabular-nums">
            <span>{t('library.info.progress')}</span>
            <span>{pct}%</span>
          </p>
          <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-1 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
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
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{entry.desc ? descText(entry.desc) : t('library.info.noDesc')}</p>
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
