/**
 * 对照栏：一排页签 + 内容区。纯展示——不认识图谱/原文，页签内容由工作台拼装传入，
 * 以后新增「人物志 / 问书 / 自测 / 笔记」只需往 tabs 里加一项。
 */
import type { ReactNode } from 'react'
import { ChevronDown, PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { CompanionTab } from '@/stores/readingFocus'

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

/** 常驻页签（栏宽 450 左右也放得下）；其余收进「更多」菜单，当前激活的非常驻页签临时顶替显示 */
const PINNED_TABS: readonly CompanionTab[] = ['graph', 'timeline', 'people', 'ask']

export function CompanionDock({ tabs, active, onActiveChange, onCollapse, className }: CompanionDockProps) {
  const { t } = useTranslation()
  // 存档里的页签可能在当前书里不可用（如无图表数据）：回落到第一个
  const current = tabs.length === 0 || tabs.some((x) => x.id === active) ? active : tabs[0].id

  if (tabs.length === 0) return null

  const shown = tabs.filter((x) => PINNED_TABS.includes(x.id) || x.id === current)
  const more = tabs.filter((x) => !shown.includes(x))
  // 只有一两个页签不值得做菜单：全部直接展示
  const showAll = more.length <= 1
  const visible = showAll ? tabs : shown
  const hidden = showAll ? [] : more

  return (
    <Tabs
      value={current}
      onValueChange={(v) => onActiveChange(v as CompanionTab)}
      className={cn('flex h-full min-h-0 min-w-0 flex-col gap-2', className)}
    >
      <div className="flex shrink-0 items-center gap-1">
        <div className="min-w-0 flex-1">
          <TabsList className="h-9 w-full justify-start">
            {visible.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="min-w-0 flex-1 px-2 text-sm">
                <span className="truncate">{tab.label}</span>
              </TabsTrigger>
            ))}
            {hidden.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('workspace.dock.more')}
                    className="inline-flex h-[calc(100%-1px)] shrink-0 items-center gap-0.5 rounded-md px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {t('workspace.dock.more')}
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {hidden.map((tab) => (
                    <DropdownMenuItem key={tab.id} onSelect={() => onActiveChange(tab.id)}>
                      {tab.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </TabsList>
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
