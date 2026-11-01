/**
 * 对照栏：一排页签 + 内容区。纯展示——不认识图谱/原文，页签内容由工作台拼装传入，
 * 以后新增「人物志 / 问书 / 自测 / 笔记」只需往 tabs 里加一项。
 *
 * 页签尽量不折叠：宽度够就「图标 + 文字」全部直接显示；不够时按 dockLayout 的顺序退让
 * （次要页签先收成图标 → 主要页签也收成图标 → 折进「…」菜单；「…」本身也是先图文、再只剩图标）。
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BookOpen,
  CalendarClock,
  FileText,
  ListChecks,
  MessageCircleQuestion,
  MoreHorizontal,
  Network,
  NotebookPen,
  PanelRightClose,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { CompanionTab } from '@/stores/readingFocus'
import { planDockLayout } from './dockLayout'

export interface DockTab {
  id: CompanionTab
  label: string
  content: ReactNode
  /** 切走后保持挂载（图谱：避免重新跑布局） */
  keepMounted?: boolean
}

interface CompanionDockProps {
  tabs: DockTab[]
  active: CompanionTab
  onActiveChange: (tab: CompanionTab) => void
  /** 提供时显示「收起」按钮 */
  onCollapse?: () => void
  className?: string
}

const TAB_ICONS: Record<CompanionTab, LucideIcon> = {
  graph: Network,
  timeline: CalendarClock,
  people: Users,
  study: Zap,
  quiz: ListChecks,
  notes: NotebookPen,
  ask: MessageCircleQuestion,
  overall: FileText,
  source: BookOpen,
}

/** 主要页签：文字最后才收起、最后才折进菜单 */
const PRIMARY_TABS: ReadonlySet<string> = new Set<CompanionTab>(['graph', 'study', 'ask', 'source'])

/** 只有图标的页签宽度（size-4 图标 + px-2.5） */
const ICON_WIDTH = 36
const MORE_ICON_WIDTH = 36
const GAP = 2
/** TabsList 的内边距（p-[3px] × 2） */
const LIST_PADDING = 6

export function CompanionDock({ tabs, active, onActiveChange, onCollapse, className }: CompanionDockProps) {
  const { t } = useTranslation()
  // 存档里的页签可能在当前书里不可用（如无图表数据）：回落到第一个
  const current = tabs.length === 0 || tabs.some((x) => x.id === active) ? active : tabs[0].id

  const listRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  // 尚未测量 / 环境没有 ResizeObserver（jsdom）时按「不限宽」处理：全部图文显示
  const [available, setAvailable] = useState(Infinity)
  const [natural, setNatural] = useState<{ tabs: Record<string, number>; more: number }>({ tabs: {}, more: 0 })

  const moreLabel = t('workspace.dock.more')
  const labelKey = tabs.map((x) => `${x.id}:${x.label}`).join('|') + `|${moreLabel}`

  // 量「图标 + 文字」的自然宽度：画一排看不见的完整页签，标签文字（语言切换）变了才重量
  useLayoutEffect(() => {
    const root = measureRef.current
    if (!root) return
    const next: Record<string, number> = {}
    root.querySelectorAll<HTMLElement>('[data-measure]').forEach((el) => {
      const id = el.dataset.measure!
      const w = Math.ceil(el.getBoundingClientRect().width)
      if (w) next[id] = w
    })
    setNatural({ tabs: next, more: next.__more ?? 0 })
  }, [labelKey])

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // 宽度为 0 = 还没布局 / 被 display:none 藏起来：量不出来就按「不限宽」，别误判成「一个都放不下」
    const measure = () => setAvailable(el.clientWidth > 0 ? Math.max(0, el.clientWidth - LIST_PADDING) : Infinity)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(
    () =>
      planDockLayout({
        ids: tabs.map((x) => x.id),
        primary: PRIMARY_TABS,
        fullWidth: natural.tabs,
        iconWidth: ICON_WIDTH,
        moreFullWidth: natural.more || MORE_ICON_WIDTH,
        moreIconWidth: MORE_ICON_WIDTH,
        gap: GAP,
        available,
        active: current,
      }),
    [tabs, natural, available, current]
  )

  if (tabs.length === 0) return null

  const byId = new Map(tabs.map((x) => [x.id, x]))
  const triggerClass = 'min-w-0 text-sm'

  return (
    <Tabs
      value={current}
      onValueChange={(v) => onActiveChange(v as CompanionTab)}
      className={cn('flex h-full min-h-0 min-w-0 flex-col gap-2', className)}
    >
      <div className="flex shrink-0 items-center gap-1">
        <div ref={listRef} data-slot="dock-list" className="relative min-w-0 flex-1">
          <TabsList className="h-9 w-full justify-start" style={{ gap: GAP }}>
            {layout.visible.map(({ id, mode }) => {
              const tab = byId.get(id as CompanionTab)!
              const Icon = TAB_ICONS[tab.id]
              const iconOnly = mode === 'icon'
              return (
                <TabsTrigger
                  key={id}
                  value={id}
                  // 只有图标时必须有可访问名称与悬浮提示
                  aria-label={iconOnly ? tab.label : undefined}
                  title={iconOnly ? tab.label : undefined}
                  className={cn(triggerClass, iconOnly ? 'w-9 flex-none px-0' : 'flex-auto px-2.5')}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {!iconOnly && <span className="truncate">{tab.label}</span>}
                </TabsTrigger>
              )
            })}
            {layout.more && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={moreLabel}
                    title={moreLabel}
                    className={cn(
                      'inline-flex h-[calc(100%-1px)] shrink-0 items-center justify-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      layout.more === 'icon' ? 'w-9 px-0' : 'px-2.5'
                    )}
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                    {layout.more === 'full' && moreLabel}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {layout.overflow.map((id) => {
                    const tab = byId.get(id as CompanionTab)!
                    const Icon = TAB_ICONS[tab.id]
                    return (
                      <DropdownMenuItem key={id} onSelect={() => onActiveChange(tab.id)}>
                        <Icon className="size-4" aria-hidden="true" />
                        {tab.label}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </TabsList>

          {/* 测量用：与真实页签同样式的「图标 + 文字」自然宽度，看不见、不占位、不进无障碍树 */}
          <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex h-0 overflow-hidden whitespace-nowrap">
            {tabs.map((tab) => {
              const Icon = TAB_ICONS[tab.id]
              return (
                <span key={tab.id} data-measure={tab.id} className="inline-flex items-center gap-1.5 px-2.5 text-sm font-medium">
                  <Icon className="size-4" />
                  {tab.label}
                </span>
              )
            })}
            <span data-measure="__more" className="inline-flex items-center gap-1 px-2.5 text-sm">
              <MoreHorizontal className="size-4" />
              {moreLabel}
            </span>
          </div>
        </div>
        {onCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={onCollapse}
            title={t('workspace.dock.collapse')}
            aria-label={t('workspace.dock.collapse')}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {tabs.map((tab) => (
        <TabsContent
          key={tab.id}
          value={tab.id}
          forceMount={tab.keepMounted ? true : undefined}
          className={cn(
            'mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain',
            tab.keepMounted && current !== tab.id && 'hidden'
          )}
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
