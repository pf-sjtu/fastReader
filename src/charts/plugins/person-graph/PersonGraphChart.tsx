import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Core, EventObject } from 'cytoscape'
import type { BookCharts, EntityGraphNode } from '../../types'
import { getEntityGraph } from '../../types'
import { toCytoscapeElements, forceLayoutOptions, compactScale } from './toCytoscape'
import { readChartTheme, subscribeThemeChange, type ChartThemeColors } from '../../theme'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Maximize2, RefreshCw } from 'lucide-react'

interface Props {
  charts: BookCharts
}

const FIT_PADDING = 40

interface SelectedNode {
  node: EntityGraphNode
  edges: {
    relation: string
    otherName: string
    direction: 'in' | 'out'
    description?: string
  }[]
}

const DEFAULT_FORCE = 55
const FORCE_STORAGE_KEY = 'fastreader.entityGraph.forceStrength'

function readStoredForce(): number {
  if (typeof window === 'undefined') return DEFAULT_FORCE
  try {
    const raw = localStorage.getItem(FORCE_STORAGE_KEY)
    if (raw == null) return DEFAULT_FORCE
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_FORCE
    return Math.min(100, Math.max(0, Math.round(n)))
  } catch {
    return DEFAULT_FORCE
  }
}

function writeStoredForce(value: number) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FORCE_STORAGE_KEY, String(value))
  } catch {
    /* private mode / quota */
  }
}

// cytoscape 样式：名字居中写在球上
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildStyles(theme: ChartThemeColors): any[] {
  const nodeFill = theme.primary
  const onNodeText = theme.primaryForeground
  const edgeColor = theme.mutedForeground
  const labelBg = theme.card
  const edgeLabelColor = theme.foreground

  return [
    {
      selector: 'node',
      style: {
        // label 已在 toCytoscape 中按宽度拆行，保证落在圆内
        label: 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-margin-y': 0,
        'background-color': nodeFill,
        'background-opacity': 1,
        color: onNodeText,
        'font-size': (ele: { data: (k: string) => number }) =>
          ele.data('fontSize') || 10,
        'font-weight': 600,
        'text-wrap': 'wrap',
        'text-max-width': (ele: { data: (k: string) => number }) =>
          ele.data('textMaxWidth') || 36,
        'text-outline-width': 0,
        'text-background-opacity': 0,
        width: (ele: { data: (k: string) => number }) => ele.data('size') || 64,
        height: (ele: { data: (k: string) => number }) => ele.data('size') || 64,
        'border-width': 2,
        'border-color': theme.border,
        'border-opacity': 1,
        'min-zoomed-font-size': 4,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'background-color': theme.accent,
        'border-color': onNodeText,
        'border-width': 3,
        color: theme.accentForeground,
      },
    },
    {
      selector: 'node:active',
      style: {
        'overlay-opacity': 0.12,
        'overlay-color': theme.primary,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': edgeColor,
        'target-arrow-color': edgeColor,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.85,
        'curve-style': 'bezier',
        label: 'data(label)',
        'font-size': 10,
        'font-weight': 500,
        color: edgeLabelColor,
        'text-rotation': 'autorotate',
        'text-margin-y': -8,
        'text-background-color': labelBg,
        'text-background-opacity': 0.92,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        opacity: 0.88,
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
  const layoutRef = useRef<{ stop?: () => void } | null>(null)
  const graph = getEntityGraph(charts)
  const [selected, setSelected] = useState<SelectedNode | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [themeTick, setThemeTick] = useState(0)
  /** 力导向强度 0–100；localStorage 持久化（浏览器级记忆） */
  const [force, setForce] = useState(readStoredForce)
  const forceRef = useRef(force)
  forceRef.current = force
  /** 用户手动缩放/平移过之后不再自动 fit，避免和用户抢画布 */
  const userMovedRef = useRef(false)

  /** 容器有尺寸时重算画布并（若用户没动过视角）把全部节点收进画布 */
  const fitIfAllowed = useCallback((force = false) => {
    const cy = cyRef.current
    const el = containerRef.current
    if (!cy || !el || el.clientWidth <= 0 || el.clientHeight <= 0) return
    cy.resize()
    if (force || !userMovedRef.current) {
      userMovedRef.current = false
      cy.fit(undefined, FIT_PADDING)
    }
  }, [])

  /** 布局结束：把过度撑开的布局等比压紧（不重叠），再 fit */
  const compactAndFit = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    const nodes = cy.nodes()
    const pts = nodes.map((n) => ({ x: n.position('x'), y: n.position('y'), r: n.width() / 2 }))
    const s = compactScale(pts, forceRef.current)
    if (s >= 0.97 || pts.length < 2) {
      fitIfAllowed()
      return
    }
    const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length
    const my = pts.reduce((a, p) => a + p.y, 0) / pts.length
    nodes.forEach((n, i) => {
      n.animate(
        { position: { x: mx + (pts[i].x - mx) * s, y: my + (pts[i].y - my) * s } },
        { duration: 280, easing: 'ease-out' }
      )
    })
    window.setTimeout(() => {
      if (cyRef.current === cy && !cy.destroyed()) fitIfAllowed()
    }, 320)
  }, [fitIfAllowed])

  const updateForce = useCallback((value: number) => {
    const v = Math.min(100, Math.max(0, Math.round(value)))
    setForce(v)
    writeStoredForce(v)
  }, [])

  const elements = useMemo(
    () => (graph ? toCytoscapeElements(graph) : []),
    [graph]
  )

  const runForceLayout = useCallback((cy: Core, forceValue: number, randomize = false) => {
    try {
      layoutRef.current?.stop?.()
    } catch {
      /* ignore */
    }
    const opts = {
      ...forceLayoutOptions(forceValue),
      randomize,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout = cy.layout(opts as any)
    layoutRef.current = layout
    layout.run()
  }, [])

  const applyTheme = useCallback((cy: Core) => {
    const theme = readChartTheme()
    cy.style().fromJson(buildStyles(theme)).update()
    if (containerRef.current) {
      containerRef.current.style.backgroundColor = theme.card
    }
  }, [])

  useEffect(() => {
    return subscribeThemeChange(() => setThemeTick((n) => n + 1))
  }, [])

  // 页签切回（display:none → 可见）或对照栏被拖宽时：resize + fit。
  // 根因：fcose 在 0×0 的隐藏容器里跑完布局并 fit，之后容器变大只 resize 不 fit，节点就溢出画布。
  // rAF 节流：拖拽分隔条时每帧最多处理一次。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        fitIfAllowed()
      })
    })
    ro.observe(el)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [graph, fitIfAllowed])

  useEffect(() => {
    const cy = cyRef.current
    if (cy) applyTheme(cy)
  }, [themeTick, applyTheme])

  // 滑块变化：防抖后重跑力导向，节点散开/收拢
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const timer = window.setTimeout(() => {
      runForceLayout(cy, force, false)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [force, runForceLayout])

  useEffect(() => {
    if (!containerRef.current || !graph || elements.length === 0) return

    let cancelled = false
    let cy: Core | null = null

    ;(async () => {
      try {
        const cytoscape = (await import('cytoscape')).default
        const fcose = (await import('cytoscape-fcose')).default
        // 避免 HMR 重复 register
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(cytoscape as any).__fcoseRegistered) {
          cytoscape.use(fcose)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(cytoscape as any).__fcoseRegistered = true
        }

        if (cancelled || !containerRef.current) return

        const theme = readChartTheme()
        containerRef.current.style.backgroundColor = theme.card

        cy = cytoscape({
          container: containerRef.current,
          elements,
          style: buildStyles(theme),
          layout: { name: 'null' },
          // 下限要低于"全图 fit"所需缩放，否则 fit 被夹住、节点仍在画布外
          minZoom: 0.1,
          maxZoom: 3.5,
          // 0.25 默认 → 曾 ×3=0.75 → 再 ×2 ≈ 1.5
          wheelSensitivity: 1.5,
          // 可拖节点；松开后保持位置（力再跑时会重新散开）
          autoungrabify: false,
          boxSelectionEnabled: false,
        })

        cyRef.current = cy
        userMovedRef.current = false
        // userzoom / userpan 只在用户操作时触发（程序化 fit 不会），据此区分"用户动过视角"
        cy.on('userzoom userpan', () => {
          userMovedRef.current = true
        })
        // 布局结束：压紧 + 对齐画布（此时容器可能已经变过尺寸）
        cy.on('layoutstop', () => compactAndFit())
        // 初次：略随机种子 + 力导向散开
        runForceLayout(cy, forceRef.current, true)

        cy.on('tap', 'node', (evt: EventObject) => {
          const n = evt.target
          const id = n.id()
          const nodeData: EntityGraphNode = {
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

        // 拖完节点后轻微再平衡（保持 Obsidian 感）
        cy.on('dragfree', 'node', () => {
          if (!cy) return
          window.setTimeout(() => {
            // 卸载后 cy / cyRef 均为 null：两者相等也不能直接跑布局
            const current = cyRef.current
            if (current && current === cy) {
              runForceLayout(current, forceRef.current, false)
            }
          }, 80)
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
      try {
        layoutRef.current?.stop?.()
      } catch {
        /* ignore */
      }
      if (cy) cy.destroy()
      cyRef.current = null
    }
  }, [graph, elements, runForceLayout, fitIfAllowed, compactAndFit])

  if (!graph || (graph.nodes?.length ?? 0) === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {t('results.charts.noEntityGraph')}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="text-sm text-destructive py-8 text-center">
        {t('results.charts.graphLoadError')}: {loadError}
      </div>
    )
  }

  return (
    <>
      <div className="relative w-full">
        <div
          ref={containerRef}
          className="w-full h-[min(60vh,640px)] min-h-[280px] border border-border rounded-lg bg-card"
        />
        {/* 右下角设置浮层：相互作用力（localStorage 记忆） */}
        <div
          className="absolute bottom-3 right-3 z-10 flex flex-col gap-2 rounded-lg border border-border/80 bg-card/95 backdrop-blur-sm shadow-md px-3 py-2.5 max-w-[min(100%-1.5rem,17rem)]"
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor="graph-force"
              className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap"
            >
              {t('results.charts.forceStrength')}
            </Label>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {force}
            </span>
          </div>
          <Slider
            id="graph-force"
            className="w-full min-w-[9rem]"
            min={0}
            max={100}
            step={1}
            value={[force]}
            onValueChange={(v) => updateForce(v[0] ?? DEFAULT_FORCE)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs w-full"
            onClick={() => {
              const cy = cyRef.current
              if (cy) runForceLayout(cy, force, true)
            }}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            {t('results.charts.relayout')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs w-full"
            onClick={() => fitIfAllowed(true)}
          >
            <Maximize2 className="h-3 w-3 mr-1" />
            {t('results.charts.fitView')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {t('results.charts.entityGraphHint')}
      </p>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent
          side="right"
          className="sm:max-w-md p-0 gap-0 flex flex-col h-full max-h-dvh overflow-hidden"
        >
          <SheetHeader className="shrink-0 pr-12 border-b border-border">
            <SheetTitle className="pr-2 break-words">
              {selected?.node.name}
            </SheetTitle>
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
              <p className="leading-relaxed break-words">
                {selected.node.description}
              </p>
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
                        <p className="text-xs text-muted-foreground mt-1 break-words">
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
