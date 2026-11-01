import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Core, EventObject, NodeSingular } from 'cytoscape'
import type { ChartPluginProps, EntityGraphNode } from '../../types'
import { getEntityGraph } from '../../types'
import { toCytoscapeElements, forceLayoutOptions, compactScale } from './toCytoscape'
import { readChartTheme, subscribeThemeChange } from '../../theme'
import { shapeForType, type EntityShape } from '../../linking/entityColors'
import { buildStyles, FIT_PADDING } from './graphStyles'
import { applyEntityStyle, applyGraphFocus, centerOnNode, nodeAnchor } from './graphFocus'
import { GraphLegend, type LegendEntity } from './GraphLegend'
import { GraphNodeSheet, type SelectedNode } from './GraphNodeSheet'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Maximize2, RefreshCw, SlidersHorizontal } from 'lucide-react'

const DEFAULT_FORCE = 55
const FORCE_STORAGE_KEY = 'fastreader.entityGraph.forceStrength'
const SHAPE_ORDER: EntityShape[] = ['circle', 'round-rect', 'diamond']
const EMPTY_SET: ReadonlySet<string> = new Set()

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

export function PersonGraphChart({
  charts,
  focus,
  active = true,
  onEntitySelect,
  onEntityDoubleClick,
  styleOf,
  colorize = false,
}: ChartPluginProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const layoutRef = useRef<{ stop?: () => void } | null>(null)
  const graph = getEntityGraph(charts)
  const [selected, setSelected] = useState<SelectedNode | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [themeTick, setThemeTick] = useState(0)
  /** cy 实例创建后自增，让依赖实例的 effect 重新执行 */
  const [cyTick, setCyTick] = useState(0)
  const [hiddenGroups, setHiddenGroups] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [showForce, setShowForce] = useState(false)
  /** 力导向强度 0–100；localStorage 持久化（浏览器级记忆） */
  const [force, setForce] = useState(readStoredForce)
  const forceRef = useRef(force)
  forceRef.current = force
  /** 用户手动缩放/平移过之后不再自动 fit，避免和用户抢画布 */
  const userMovedRef = useRef(false)

  // 事件处理器注册在 cy 上一次，之后通过 ref 读取最新回调，避免因回调身份变化重建图
  const handlersRef = useRef({ onEntitySelect, onEntityDoubleClick })
  handlersRef.current = { onEntitySelect, onEntityDoubleClick }

  const elements = useMemo(() => (graph ? toCytoscapeElements(graph) : []), [graph])

  const shapeOf = useCallback(
    (id: string): EntityShape => {
      const s = styleOf?.(id)
      if (s) return s.shape
      return shapeForType(graph?.nodes.find((n) => n.id === id)?.type)
    },
    [styleOf, graph]
  )

  /** 容器有尺寸时重算画布并（若用户没动过视角）把全部节点收进画布 */
  const fitIfAllowed = useCallback((forceFit = false) => {
    const cy = cyRef.current
    const el = containerRef.current
    if (!cy || !el || el.clientWidth <= 0 || el.clientHeight <= 0) return
    cy.resize()
    if (forceFit || !userMovedRef.current) {
      userMovedRef.current = false
      cy.fit(cy.nodes(':visible'), FIT_PADDING)
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

  const runForceLayout = useCallback((cy: Core, forceValue: number, randomize = false) => {
    try {
      layoutRef.current?.stop?.()
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout = cy.layout({ ...forceLayoutOptions(forceValue), randomize } as any)
    layoutRef.current = layout
    layout.run()
  }, [])

  const applyTheme = useCallback((cy: Core) => {
    const theme = readChartTheme()
    cy.style().fromJson(buildStyles(theme)).update()
    if (containerRef.current) containerRef.current.style.backgroundColor = theme.card
  }, [])

  useEffect(() => subscribeThemeChange(() => setThemeTick((n) => n + 1)), [])

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

  // 主题切换：重建样式表，随后下面的着色 effect 会按新主题重新解析实体色
  useEffect(() => {
    const cy = cyRef.current
    if (cy) applyTheme(cy)
  }, [themeTick, applyTheme])

  // 与正文同色：开关 / 样式表 / 主题变化时重新写入节点颜色
  useEffect(() => {
    const cy = cyRef.current
    if (cy) applyEntityStyle(cy, styleOf, colorize)
  }, [cyTick, themeTick, styleOf, colorize])

  // 本章高亮 / 渐进模式 / 类型过滤：只改样式，不移动视角
  useEffect(() => {
    const cy = cyRef.current
    if (cy) applyGraphFocus(cy, { focus, hiddenGroups, groupOf: shapeOf })
  }, [cyTick, focus, hiddenGroups, shapeOf])

  // 跳转到达：被聚焦的实体居中。nonce 保证连续两次跳到同一实体仍会重新定位；
  // 页签隐藏时不动画（容器 0×0），切回后由 active 变化补上
  const handledNonce = useRef<number | undefined>(undefined)
  const focusedId = focus?.focusedEntityId ?? null
  const nonce = focus?.jumpNonce
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !active || !focusedId || nonce === handledNonce.current) return
    if (centerOnNode(cy, focusedId)) handledNonce.current = nonce
  }, [cyTick, active, focusedId, nonce])

  // 滑块变化：防抖后重跑力导向，节点散开/收拢
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const timer = window.setTimeout(() => runForceLayout(cy, force, false), 180)
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
          wheelSensitivity: 1.5,
          autoungrabify: false,
          boxSelectionEnabled: false,
        })

        cyRef.current = cy
        userMovedRef.current = false
        // userzoom / userpan 只在用户操作时触发（程序化 fit 不会），据此区分"用户动过视角"
        cy.on('userzoom userpan', () => {
          userMovedRef.current = true
        })
        cy.on('layoutstop', () => compactAndFit())
        runForceLayout(cy, forceRef.current, true)

        // 单击：只选中并交给宿主展开卡片（不跳转，防误触）；没有宿主回调时退回旧版详情抽屉
        cy.on('tap', 'node', (evt: EventObject) => {
          const n: NodeSingular = evt.target
          const id = n.id()
          const select = handlersRef.current.onEntitySelect
          if (select) {
            select(id, nodeAnchor(n, containerRef.current!))
            return
          }
          const nodeData: EntityGraphNode = {
            id,
            name: n.data('name') || n.data('label'),
            type: n.data('type'),
            description: n.data('description'),
            importance: n.data('importance'),
          }
          const edges: SelectedNode['edges'] = []
          n.connectedEdges().forEach((edge) => {
            const src = edge.source().id()
            const otherId = src === id ? edge.target().id() : src
            const other = cy!.getElementById(otherId)
            edges.push({
              relation: edge.data('relation') || edge.data('label'),
              otherName: other.data('name') || other.data('label') || otherId,
              direction: src === id ? 'out' : 'in',
              description: edge.data('description') || undefined,
            })
          })
          setSelected({ node: nodeData, edges })
        })
        cy.on('dbltap', 'node', (evt: EventObject) => handlersRef.current.onEntityDoubleClick?.(evt.target.id()))
        // 点空白处：取消选中并收起卡片
        cy.on('tap', (evt: EventObject) => {
          if (evt.target === cy) {
            cy!.nodes().unselect()
            handlersRef.current.onEntitySelect?.(null)
          }
        })

        // 拖完节点后轻微再平衡（保持 Obsidian 感）
        cy.on('dragfree', 'node', () => {
          window.setTimeout(() => {
            // 卸载后 cyRef 为 null：两者相等也不能直接跑布局
            const current = cyRef.current
            if (current && current === cy) runForceLayout(current, forceRef.current, false)
          }, 80)
        })
        setCyTick((n) => n + 1)
      } catch (err) {
        console.error('[PersonGraphChart]', err)
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'load failed')
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
  }, [graph, elements, runForceLayout, compactAndFit])

  const legendGroups = useMemo(() => {
    const counts = new Map<EntityShape, number>()
    for (const n of graph?.nodes ?? []) counts.set(shapeOf(n.id), (counts.get(shapeOf(n.id)) ?? 0) + 1)
    return SHAPE_ORDER.filter((s) => counts.has(s)).map((shape) => ({ shape, count: counts.get(shape)! }))
  }, [graph, shapeOf])

  const legendEntities = useMemo<LegendEntity[]>(() => {
    if (!colorize || !styleOf || !graph) return []
    const out: (LegendEntity & { slot: number })[] = []
    for (const n of graph.nodes) {
      const s = styleOf(n.id)
      if (s?.slot) out.push({ id: n.id, name: n.name, cssVar: s.cssVar, shape: s.shape, slot: s.slot })
    }
    return out.sort((a, b) => a.slot - b.slot)
  }, [graph, styleOf, colorize])

  const toggleGroup = useCallback((shape: EntityShape) => {
    setHiddenGroups((prev) => {
      const next = new Set(prev)
      if (!next.delete(shape)) next.add(shape)
      return next
    })
  }, [])

  if (!graph || (graph.nodes?.length ?? 0) === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">{t('results.charts.noEntityGraph')}</div>
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
      {/* 工具条在画布上方，不再用浮层遮住节点 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => fitIfAllowed(true)}>
          <Maximize2 className="h-3 w-3 mr-1" />
          {t('results.charts.fitView')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => cyRef.current && runForceLayout(cyRef.current, force, true)}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          {t('results.charts.relayout')}
        </Button>
        <Button
          type="button"
          variant={showForce ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          aria-expanded={showForce}
          onClick={() => setShowForce((v) => !v)}
        >
          <SlidersHorizontal className="h-3 w-3 mr-1" />
          {t('results.charts.forceStrength')}
          <span className="ml-1 tabular-nums text-muted-foreground">{force}</span>
        </Button>
        {showForce && (
          <div className="flex min-w-[10rem] flex-1 items-center gap-2 px-1">
            <Label htmlFor="graph-force" className="sr-only">
              {t('results.charts.forceStrength')}
            </Label>
            <Slider
              id="graph-force"
              className="w-full"
              min={0}
              max={100}
              step={1}
              value={[force]}
              onValueChange={(v) => updateForce(v[0] ?? DEFAULT_FORCE)}
            />
          </div>
        )}
      </div>
      <div
        ref={containerRef}
        // 随视口高度伸缩（不再封顶 640px）：减去页头 / 页签 / 工具条 / 图例 / 提示占的约 19rem，最小 280px
        className="w-full h-[max(280px,calc(100dvh-19rem))] border border-border rounded-lg bg-card"
      />
      <GraphLegend
        groups={legendGroups}
        hidden={hiddenGroups}
        onToggleGroup={toggleGroup}
        entities={legendEntities}
        onEntityClick={onEntitySelect}
      />
      <p className="text-xs text-muted-foreground mt-2">{t('results.charts.entityGraphHint')}</p>
      <GraphNodeSheet selected={selected} onClose={() => setSelected(null)} />
    </>
  )
}
