import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Core, EventObject } from 'cytoscape'
import type { BookCharts, PersonGraphNode } from '../../types'
import { toCytoscapeElements, nodeSize } from './toCytoscape'
import { readChartTheme, subscribeThemeChange, type ChartThemeColors } from '../../theme'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface Props {
  charts: BookCharts
}

interface SelectedNode {
  node: PersonGraphNode
  edges: {
    relation: string
    otherName: string
    direction: 'in' | 'out'
    description?: string
  }[]
}

// cytoscape 样式对象（动态主题）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildStyles(theme: ChartThemeColors): any[] {
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        // 标签放节点下方 + 背景衬底，亮/暗都清晰
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'background-color': theme.primary,
        'background-opacity': theme.isDark ? 0.92 : 0.88,
        color: theme.foreground,
        'font-size': 12,
        'font-weight': 500,
        'text-wrap': 'wrap',
        'text-max-width': 96,
        'text-background-color': theme.card,
        'text-background-opacity': 0.92,
        'text-background-padding': '3px',
        'text-background-shape': 'roundrectangle',
        'text-border-width': 1,
        'text-border-color': theme.border,
        'text-border-opacity': 0.6,
        width: (ele: { data: (k: string) => number }) => nodeSize(ele.data('importance')),
        height: (ele: { data: (k: string) => number }) => nodeSize(ele.data('importance')),
        'border-width': 2,
        'border-color': theme.border,
        'border-opacity': 0.9,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'background-color': theme.accent,
        'border-color': theme.primary,
        'border-width': 3,
        color: theme.accentForeground,
        'text-background-color': theme.card,
      },
    },
    {
      selector: 'node:active',
      style: {
        'overlay-opacity': 0.08,
        'overlay-color': theme.primary,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': theme.mutedForeground,
        'target-arrow-color': theme.mutedForeground,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
        'curve-style': 'bezier',
        label: 'data(label)',
        'font-size': 10,
        'font-weight': 500,
        color: theme.foreground,
        'text-rotation': 'autorotate',
        'text-margin-y': -10,
        'text-background-color': theme.card,
        'text-background-opacity': 0.88,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        opacity: 0.85,
      },
    },
    {
      selector: 'edge:selected',
      style: {
        width: 2.5,
        'line-color': theme.primary,
        'target-arrow-color': theme.primary,
        opacity: 1,
      },
    },
  ]
}

export function PersonGraphChart({ charts }: Props) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const graph = charts.personGraph
  const [selected, setSelected] = useState<SelectedNode | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [themeTick, setThemeTick] = useState(0)

  const elements = useMemo(
    () => (graph ? toCytoscapeElements(graph) : []),
    [graph]
  )

  const applyTheme = useCallback((cy: Core) => {
    const theme = readChartTheme(containerRef.current)
    cy.style().fromJson(buildStyles(theme)).update()
    // 画布背景随 card
    if (containerRef.current) {
      containerRef.current.style.backgroundColor = theme.card
    }
  }, [])

  useEffect(() => {
    return subscribeThemeChange(() => setThemeTick((n) => n + 1))
  }, [])

  useEffect(() => {
    const cy = cyRef.current
    if (cy) applyTheme(cy)
  }, [themeTick, applyTheme])

  useEffect(() => {
    if (!containerRef.current || !graph || elements.length === 0) return

    let cancelled = false
    let cy: Core | null = null

    ;(async () => {
      try {
        const cytoscape = (await import('cytoscape')).default
        if (cancelled || !containerRef.current) return

        const theme = readChartTheme(containerRef.current)
        containerRef.current.style.backgroundColor = theme.card

        cy = cytoscape({
          container: containerRef.current,
          elements,
          style: buildStyles(theme),
          layout: {
            name: 'cose',
            animate: false,
            padding: 36,
            nodeRepulsion: () => 7000,
            idealEdgeLength: () => 110,
            nodeOverlap: 24,
          } as object,
          minZoom: 0.3,
          maxZoom: 3,
          wheelSensitivity: 0.25,
        })

        cyRef.current = cy

        cy.on('tap', 'node', (evt: EventObject) => {
          const n = evt.target
          const id = n.id()
          const nodeData: PersonGraphNode = {
            id,
            name: n.data('name') || n.data('label'),
            type: n.data('type'),
            description: n.data('description'),
            importance: n.data('importance'),
          }
          const edges: SelectedNode['edges'] = []
          n.connectedEdges().forEach(
            (edge: {
              data: (k: string) => string
              source: () => { id: () => string }
              target: () => { id: () => string }
            }) => {
              const src = edge.source().id()
              const tgt = edge.target().id()
              const otherId = src === id ? tgt : src
              const other = cy!.getElementById(otherId)
              edges.push({
                relation: edge.data('relation') || edge.data('label'),
                otherName: other.data('name') || other.data('label') || otherId,
                direction: src === id ? 'out' : 'in',
                description: edge.data('description') || undefined,
              })
            }
          )
          setSelected({ node: nodeData, edges })
        })
      } catch (err) {
        console.error('[PersonGraphChart]', err)
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'load failed')
        }
      }
    })()

    return () => {
      cancelled = true
      if (cy) cy.destroy()
      cyRef.current = null
    }
  }, [graph, elements])

  if (!graph || (graph.nodes?.length ?? 0) === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {t('results.charts.noPersonGraph', '暂无人物关系数据')}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="text-sm text-destructive py-8 text-center">
        {t('results.charts.graphLoadError', '关系图加载失败')}: {loadError}
      </div>
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        className="w-full h-[min(60vh,640px)] min-h-[280px] border border-border rounded-lg bg-card"
      />
      <p className="text-xs text-muted-foreground mt-2">
        {t(
          'results.charts.personGraphHint',
          '滚轮缩放 · 拖动画布/节点 · 点击人物查看详情'
        )}
      </p>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected?.node.name}</SheetTitle>
            <SheetDescription>
              {[
                selected?.node.type,
                selected?.node.importance != null
                  ? `重要度 ${selected.node.importance}`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ') || ' '}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3 text-sm px-1">
            {selected?.node.description && (
              <p className="leading-relaxed">{selected.node.description}</p>
            )}
            {selected?.edges && selected.edges.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-2">
                  {t('results.charts.relations', '关系')}
                </div>
                <ul className="space-y-2">
                  {selected.edges.map((e, i) => (
                    <li key={i} className="border rounded-md p-2">
                      <span className="font-medium">{e.relation}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        {e.direction === 'out' ? '→' : '←'} {e.otherName}
                      </span>
                      {e.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {e.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
