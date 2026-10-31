/**
 * 旧版节点详情抽屉：只在宿主没有提供 onEntitySelect 时使用（独立展示图谱的旧用法）。
 * 在阅读工作台里，点击节点改为展开对照栏内的实体卡片，不再遮住正文。
 */
import { useTranslation } from 'react-i18next'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { EntityGraphNode } from '../../types'

export interface SelectedNode {
  node: EntityGraphNode
  edges: {
    relation: string
    otherName: string
    direction: 'in' | 'out'
    description?: string
  }[]
}

export function GraphNodeSheet({ selected, onClose }: { selected: SelectedNode | null; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Sheet open={!!selected} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="sm:max-w-md p-0 gap-0 flex flex-col h-full max-h-dvh overflow-hidden"
      >
        <SheetHeader className="shrink-0 pr-12 border-b border-border">
          <SheetTitle className="pr-2 break-words">{selected?.node.name}</SheetTitle>
          <SheetDescription>
            {[
              selected?.node.type,
              selected?.node.importance != null
                ? t('results.charts.importance', { value: selected.node.importance })
                : '',
            ]
              .filter(Boolean)
              .join(' · ') || ' '}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3 text-sm">
          {selected?.node.description && (
            <p className="leading-relaxed break-words">{selected.node.description}</p>
          )}
          {selected?.edges && selected.edges.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-2 sticky top-0 bg-background/95 backdrop-blur-sm py-1">
                {t('results.charts.relations')}
              </div>
              <ul className="space-y-2 pb-6">
                {selected.edges.map((e, i) => (
                  <li key={i} className="border rounded-md p-2">
                    <span className="font-medium">{e.relation}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      {e.direction === 'out' ? '→' : '←'} {e.otherName}
                    </span>
                    {e.description && (
                      <p className="text-xs text-muted-foreground mt-1 break-words">{e.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
