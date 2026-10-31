import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { LibraryEntry } from '@/services/library/types'
import { BookCover } from './BookCover'
import { useCoverUrl } from './useCoverUrl'

interface BookCardProps {
  entry: LibraryEntry
  opening: boolean
  disabled: boolean
  onOpen: () => void
  /** 推荐理由等一行小字 */
  caption?: string
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const extOf = (path: string) => (path.split('.').pop() ?? '').toUpperCase()

export function BookCard({ entry, opening, disabled, onOpen, caption }: BookCardProps) {
  const { t } = useTranslation()
  const pct = entry.readProgress?.pct ?? 0
  // 真实封面：进入视口才请求（队列限并发）；没有/失败时回退生成式封面
  const { ref, url } = useCoverUrl(entry.coverKey)
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="group flex min-h-11 flex-col gap-1.5 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <div ref={ref} className="relative">
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className="aspect-[3/4] w-full rounded-md border object-cover shadow-sm transition-transform group-hover:-translate-y-0.5"
          />
        ) : (
          <BookCover title={entry.title} seed={entry.path} className="transition-transform group-hover:-translate-y-0.5" />
        )}
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
      {entry.author && <span className="line-clamp-1 text-xs text-muted-foreground">{entry.author}</span>}
      <span className="text-xs text-muted-foreground">
        {extOf(entry.path)} · {fmtSize(entry.size)}
        {entry.chapterCount ? ` · ${t('library.chapters', { count: entry.chapterCount })}` : ''}
        {entry.pages ? ` · ${t('library.pages', { count: entry.pages })}` : ''}
      </span>
      {caption && <span className="text-xs text-primary">{caption}</span>}
    </button>
  )
}
