import { useTranslation } from 'react-i18next'
import { Info, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { LibraryEntry } from '@/services/library/types'
import { BookCover } from './BookCover'
import { BookTooltipBody } from './BookInfo'
import { categoryLabel, formatBookSize } from './labels'
import { useCoverUrl } from './useCoverUrl'
import { useLongPress } from './useLongPress'
import { useOpenProgress } from '@/stores/openProgress'
import { fractionOf } from '@/services/webdav/progress'

const RING_R = 18
const RING_C = 2 * Math.PI * RING_R

/**
 * 打开中的进度环：下载阶段有总量时按百分比走；连接 / 解析 / 总量未知时转圈并写出阶段，
 * 让用户一眼看出「在干活」而不是卡死。详细的速度与剩余时间在全局 toast 里。
 */
function OpeningOverlay({ path }: { path: string }) {
  const { t } = useTranslation()
  const cur = useOpenProgress((s) => (s.current?.path === path ? s.current : null))
  const frac = cur?.phase === 'downloading' && cur.progress ? fractionOf(cur.progress) : null
  const label = !cur
    ? null
    : cur.phase === 'connecting'
      ? t('library.download.connectingShort')
      : cur.phase === 'parsing'
        ? t('library.download.parsingShort')
        : cur.stalled
          ? t('library.download.stalledShort')
          : null
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/75" role="status">
      {frac != null ? (
        <span className="relative flex size-11 items-center justify-center">
          <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden="true">
            <circle cx="22" cy="22" r={RING_R} fill="none" strokeWidth="4" className="stroke-muted" />
            <circle
              cx="22"
              cy="22"
              r={RING_R}
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              className="stroke-primary transition-[stroke-dashoffset] duration-200"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - frac)}
            />
          </svg>
          <span className="text-xs font-medium tabular-nums">{Math.floor(frac * 100)}%</span>
        </span>
      ) : (
        <Loader2 className="size-5 animate-spin" />
      )}
      {label && <span className="px-1 text-center text-xs leading-tight text-muted-foreground">{label}</span>}
    </span>
  )
}

interface BookCardProps {
  entry: LibraryEntry
  opening: boolean
  disabled: boolean
  onOpen: () => void
  /** 打开详情对话框（悬浮卡的键盘 / 触屏等价入口） */
  onInfo: () => void
  /** 推荐理由等：显示在封面左上角的小胶囊 */
  caption?: string
  /** 按大小排序时才把体积直接显示在卡片上；平时只放进悬停提示 */
  showSize?: boolean
  /** 紧凑：封面内书名缩到 text-xs 两行，作者/章数只留在悬停提示里 */
  compact?: boolean
}

const fmtSize = formatBookSize
const extOf = (path: string) => (path.split('.').pop() ?? '').toUpperCase()
/** 默认格式不占位：EPUB 最常见，只有 PDF/TXT/MD 这类少数派才值得在封面上标出 */
const DEFAULT_FORMAT = 'EPUB'
/** 毛玻璃小胶囊：压在任意封面上都清晰 */
const PILL = 'max-w-full truncate whitespace-nowrap rounded-full bg-black/45 px-1.5 py-0.5 sm:px-2 text-xs font-medium leading-4 text-white backdrop-blur-sm'

/**
 * 书卡：书名与作者放进封面内部底部，用自下而上的深色渐变做底，
 * 任何封面（真实/生成）上都能读清；封面下方只留一行安静的元信息。
 */
export function BookCard({ entry, opening, disabled, onOpen, onInfo, caption, showSize = false, compact = false }: BookCardProps) {
  const { t } = useTranslation()
  const format = extOf(entry.path)
  const oddFormat = format && format !== DEFAULT_FORMAT ? format : null
  // 章数（或 PDF 页数）有决策价值：放在书名下方同一行；体积价值低：进悬停提示
  const count = entry.chapterCount
    ? t('library.chapters', { count: entry.chapterCount })
    : entry.pages
      ? t('library.pages', { count: entry.pages })
      : null
  // 虚拟条目没有可信的大小（0）：不显示 "1 KB" 这种假数据
  const facts = [format, entry.size > 0 ? fmtSize(entry.size) : null, count].filter(Boolean).join(' · ')
  const primaryCategory = entry.subjects?.[0] ? categoryLabel(t, entry.subjects[0]) : null
  const label = [entry.title, entry.author, primaryCategory, facts].filter(Boolean).join('，')
  const pct = entry.readProgress?.pct ?? 0
  const inProgress = pct > 0 && pct < 100
  // 真实封面：进入视口才请求（队列限并发）；没有/失败时回退生成式封面
  const { ref, url } = useCoverUrl(entry.coverKey)
  const longPress = useLongPress(onInfo)
  return (
    <div className="group relative">
    <Tooltip delayDuration={350}>
    <TooltipTrigger asChild>
    <button
      type="button"
      data-book-card=""
      onClick={onOpen}
      disabled={disabled}
      aria-label={label}
      {...longPress}
      className="flex min-h-11 w-full select-none flex-col rounded-lg p-1 text-left outline-none transition-colors [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <div
        ref={ref}
        className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-card shadow-[0_1px_2px_rgb(0_0_0/0.18),0_6px_14px_-6px_rgb(0_0_0/0.35)] ring-1 ring-black/10 transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-[0_2px_4px_rgb(0_0_0/0.2),0_14px_24px_-8px_rgb(0_0_0/0.45)] dark:ring-white/10"
      >
        {url ? (
          <img src={url} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <BookCover title={entry.title} seed={entry.path} />
        )}

        {/* 底部阴影层：书名 + 作者 */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent text-white',
            compact ? 'px-1.5 pb-1.5 pt-8' : 'px-2.5 pb-2.5 pt-12'
          )}
        >
          <span
            className={cn(
              'font-brand font-semibold leading-snug [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]',
              compact ? 'line-clamp-2 text-xs' : 'line-clamp-3 text-sm'
            )}
          >
            {entry.title}
          </span>
          {(!compact || showSize) && (entry.author || count || showSize) && (
            <span className="mt-0.5 flex items-baseline justify-between gap-2 text-xs leading-tight text-white/75 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
              <span className="line-clamp-1 min-w-0">{entry.author}</span>
              <span className="shrink-0 tabular-nums text-white/65">
                {[showSize ? fmtSize(entry.size) : null, count].filter(Boolean).join(' · ')}
              </span>
            </span>
          )}
        </div>

        {/* 角标 */}
        <div data-slot="book-corner" className="pointer-events-none absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-1">
          {/* 左上：推荐理由 / 少见格式；窄卡片里它先让位（min-w-0 + 截断） */}
          <div className="min-w-0 flex-1">
            {caption ? <span className={PILL}>{caption}</span> : oddFormat ? <span className={PILL}>{oddFormat}</span> : null}
          </div>
          {/* 右上：主分类（subjects[0]）；有阅读状态时叠在它下面 */}
          <div className="flex max-w-[60%] shrink-0 flex-col items-end gap-1">
            {primaryCategory && <span className={PILL}>{primaryCategory}</span>}
            {entry.status !== 'unprocessed' && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium leading-4 text-primary-foreground shadow-sm">
                {entry.status === 'done' ? t('library.status.done') : t('library.status.partial')}
              </span>
            )}
          </div>
        </div>

        {inProgress && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
            <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
        )}
        {opening && <OpeningOverlay path={entry.path} />}
      </div>

    </button>
    </TooltipTrigger>
    <TooltipContent side="top" className="bg-popover text-popover-foreground shadow-md ring-1 ring-border">
      <BookTooltipBody entry={entry} />
    </TooltipContent>
    </Tooltip>
    {/* 详情入口（键盘 / 平板 / 鼠标）；与主按钮是兄弟节点（按钮里不能再套按钮）。
        手机触屏上卡片太窄，按钮会盖住书名：那里改用长按（见 useLongPress），按钮保留给读屏与键盘 */}
    <button
      type="button"
      onClick={onInfo}
      aria-label={`${t('library.info.open')}：${entry.title}`}
      className="absolute bottom-3 right-3 flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 [@media(hover:none)]:opacity-100 max-sm:[@media(hover:none)]:pointer-events-none max-sm:[@media(hover:none)]:opacity-0 max-sm:[@media(hover:none)]:focus-visible:opacity-100"
    >
      <Info className="size-4" />
    </button>
    </div>
  )
}
