import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { LibraryEntry } from '@/services/library/types'
import { BookCover } from './BookCover'
import { useCoverUrl } from './useCoverUrl'

interface BookCardProps {
  entry: LibraryEntry
  opening: boolean
  disabled: boolean
  onOpen: () => void
  /** 推荐理由等：显示在封面左上角的小胶囊 */
  caption?: string
  /** 按大小排序时才把体积直接显示在卡片上；平时只放进悬停提示 */
  showSize?: boolean
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const extOf = (path: string) => (path.split('.').pop() ?? '').toUpperCase()
/** 默认格式不占位：EPUB 最常见，只有 PDF/TXT/MD 这类少数派才值得在封面上标出 */
const DEFAULT_FORMAT = 'EPUB'
/** 毛玻璃小胶囊：压在任意封面上都清晰 */
const PILL = 'rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium leading-4 text-white backdrop-blur-sm'

/**
 * 书卡：书名与作者放进封面内部底部，用自下而上的深色渐变做底，
 * 任何封面（真实/生成）上都能读清；封面下方只留一行安静的元信息。
 */
export function BookCard({ entry, opening, disabled, onOpen, caption, showSize = false }: BookCardProps) {
  const { t } = useTranslation()
  const format = extOf(entry.path)
  const oddFormat = format && format !== DEFAULT_FORMAT ? format : null
  // 章数（或 PDF 页数）有决策价值：放在书名下方同一行；体积价值低：进悬停提示
  const count = entry.chapterCount
    ? t('library.chapters', { count: entry.chapterCount })
    : entry.pages
      ? t('library.pages', { count: entry.pages })
      : null
  const detail = [entry.title, entry.author, [format, fmtSize(entry.size), count].filter(Boolean).join(' · ')].filter(Boolean).join('\n')
  const pct = entry.readProgress?.pct ?? 0
  const inProgress = pct > 0 && pct < 100
  // 真实封面：进入视口才请求（队列限并发）；没有/失败时回退生成式封面
  const { ref, url } = useCoverUrl(entry.coverKey)
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      title={detail}
      aria-label={detail.replace(/\n/g, '，')}
      className="group flex min-h-11 flex-col rounded-xl p-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2.5 pb-2.5 pt-12 text-white">
          <span className="font-brand line-clamp-3 text-[13px] font-semibold leading-snug [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
            {entry.title}
          </span>
          {(entry.author || count || showSize) && (
            <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] leading-tight text-white/75 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
              <span className="line-clamp-1 min-w-0">{entry.author}</span>
              <span className="shrink-0 tabular-nums text-white/65">
                {[showSize ? fmtSize(entry.size) : null, count].filter(Boolean).join(' · ')}
              </span>
            </span>
          )}
        </div>

        {/* 角标 */}
        <div className="pointer-events-none absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-1">
          {caption ? <span className={PILL}>{caption}</span> : oddFormat ? <span className={PILL}>{oddFormat}</span> : <span />}
          {entry.status !== 'unprocessed' && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium leading-4 text-primary-foreground shadow-sm">
              {entry.status === 'done' ? t('library.status.done') : t('library.status.partial')}
            </span>
          )}
        </div>

        {inProgress && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
            <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
        )}
        {opening && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="size-5 animate-spin" />
          </span>
        )}
      </div>

    </button>
  )
}
