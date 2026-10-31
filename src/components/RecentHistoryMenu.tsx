import { History, ChevronDown, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ProcessingHistoryRecord } from '@/stores/processingHistory'

const MODE_KEY = {
  summary: 'history.modeSummary',
  mindmap: 'history.modeMindmap',
  'combined-mindmap': 'history.modeCombinedMindmap',
} as const

/** 菜单里最多列出的条数；更多的走「查看全部」 */
export const RECENT_MENU_LIMIT = 6

interface Props {
  records: readonly ProcessingHistoryRecord[]
  /** 正在加载的记录（fileName）；非 null 时整个菜单禁用 */
  loadingFileName: string | null
  onSelect: (record: ProcessingHistoryRecord) => void
  onViewAll: () => void
}

function dateOf(iso: string, locale: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
}

/**
 * 配置页的「最近处理」入口：一个按钮 + 纵向列表。
 * 取代原先挤在状态栏中间的两枚截断到 120px 的小按钮（一次只看得到一条半，还带出横向滚动条）。
 */
export function RecentHistoryMenu({ records, loadingFileName, onSelect, onViewAll }: Props) {
  const { t, i18n } = useTranslation()
  if (records.length === 0) return null
  const latest = records[0]
  const loading = loadingFileName !== null
  const shown = records.slice(0, RECENT_MENU_LIMIT)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={loading} className="h-8 max-w-full gap-1.5 px-2 text-sm text-muted-foreground hover:text-foreground">
          {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <History className="size-4 shrink-0" />}
          <span className="shrink-0">{t('history.recent')}</span>
          <span className="min-w-0 max-w-[14rem] truncate font-medium text-foreground">{latest.bookTitle}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-[min(92vw,26rem)]">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('history.recentHint')}</DropdownMenuLabel>
        {shown.map((r) => (
          <DropdownMenuItem key={r.fileName} onSelect={() => onSelect(r)} className="flex-col items-start gap-0.5 py-2">
            <span className="w-full whitespace-normal break-words font-medium leading-snug">{r.bookTitle}</span>
            <span className="text-xs text-muted-foreground">
              {[t(MODE_KEY[r.processingMode]), `${r.chapterCount}${t('history.chapters')}`, dateOf(r.completedAt, i18n.language)].filter(Boolean).join(' · ')}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onViewAll} className="justify-center text-sm">
          {t('history.viewAll', { count: records.length })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
