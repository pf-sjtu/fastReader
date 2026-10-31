/**
 * 对照栏：一排页签 + 内容区。纯展示——不认识图谱/原文，页签内容由工作台拼装传入，
 * 以后新增「人物志 / 问书 / 自测 / 笔记」只需往 tabs 里加一项。
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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

export function CompanionDock({ tabs, active, onActiveChange, onCollapse, className }: CompanionDockProps) {
  const { t } = useTranslation()
  const listWrap = useRef<HTMLDivElement>(null)
  // 存档里的页签可能在当前书里不可用（如无图表数据）：回落到第一个
  const current = tabs.length === 0 || tabs.some((x) => x.id === active) ? active : tabs[0].id

  // 页签很多时，切到靠右的页签要让它自动滚入可见区（滚动条本身已隐藏，用户看不到还有没露出的页签）
  useEffect(() => {
    listWrap.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [current])

  if (tabs.length === 0) return null

  return (
    <Tabs
      value={current}
      onValueChange={(v) => onActiveChange(v as CompanionTab)}
      className={cn('flex h-full min-h-0 min-w-0 flex-col gap-2', className)}
    >
      <div className="flex shrink-0 items-center gap-1">
        {/* 页签多时横向滚动，不换行挤占高度 */}
        <div ref={listWrap} className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="h-9 w-max">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="px-3 text-xs sm:text-sm">
                {tab.label}
              </TabsTrigger>
            ))}
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
