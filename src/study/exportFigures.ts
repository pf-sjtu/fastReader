/**
 * 学习包里的「彩色图谱 / 时间线图片」（openspec 任务 7.2 的图片部分）。
 *
 * 为什么是自制 SVG 而不是截图：
 * - 人物关系图的 cytoscape 实例是组件内部的局部 ref，且导出按钮所在的页签往往并没有挂载它，
 *   拿不到 DOM/实例；实体时间线是纯 div，没有可序列化的矢量根（截图要引 html2canvas 类新依赖）。
 * - 两者的数据本来就在 `BookCharts` 里，而时间线的**几何**已经被 `layoutEntityTimeline` 算好
 *   （应用内那套列宽/换行/行高），照着画 SVG 等于用同一套排版离线重绘一遍，零新依赖。
 *
 * 因此：时间线的排版沿用 `layoutEntityTimeline` 的函数与换行规则（参数按打印尺寸另配），
 * 图内配色取**亮色**实体色表（见 `exportPack.ts` 的 `PACK_ENTITY_PALETTE`）；人物关系图用的是
 * 自己写的**圆环布局**（应用内是 cytoscape 的力导布局）——节点、连线与关系文字都在，位置不逐字复刻。
 *
 * 图里全部用十六进制色：SVG 一旦进了 `<img src="data:...">` 就是独立文档，读不到页面的
 * `--pack-*` 变量；而这些值正是学习包亮色主题（见 `buildPack.ts` 的 STYLE）的 sRGB 对应值。
 * 另外 `readableTextOn` 也需要 #rrggbb 才能算对比度。
 */
import { buildEntityStyles } from '@/charts/linking/entityColors'
import { layoutEntityTimeline, type TimelineLayoutConfig } from '@/charts/plugins/entity-timeline/layout'
import { cssColorToHex, readableTextOn } from '@/charts/theme'
import { getEntityGraph, type BookCharts } from '@/charts/types'
import { wrapText } from '@/charts/textWrap'
import { svgToDataUri } from '@/lib/mermaidRender'
import { escapeHtml, type PackImage } from '@/study/pack'

const FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'
/** 学习包亮色主题（`buildPack.ts` 的 `--pack-*`）的 sRGB 对应值 */
const PAPER = '#f7f4ee'
const INK = '#2b2620'
const MUTED = '#6f675c'
const LINE = '#d9d2c6'

const TIMELINE_CONFIG: TimelineLayoutConfig = {
  colWidth: 124,
  labelWidth: 96,
  headerHeight: 56,
  pad: 8,
  fontSize: 12,
  lineHeight: 16,
  minRowHeight: 52,
}

interface TextOpts {
  size?: number
  weight?: number
  fill?: string
  anchor?: 'start' | 'middle' | 'end'
}

/**
 * 一行 SVG 文本。内容与属性值都过 `escapeHtml`：`fill` 虽然目前只来自本文件的常量或
 * `readableTextOn` 的结果，但它是唯一往属性里塞外部颜色的入口所在（实体色来自书的数据），
 * 转义成本为零，不做就是留一个「颜色字符串能跑出属性」的口子。
 */
function text(x: number, y: number, content: string, opts: TextOpts = {}): string {
  const { size = 12, weight = 400, fill = INK, anchor = 'start' } = opts
  return (
    `<text x="${round(x)}" y="${round(y)}" font-size="${size}" font-weight="${weight}"` +
    ` fill="${escapeHtml(fill)}" text-anchor="${escapeHtml(anchor)}">${escapeHtml(content)}</text>`
  )
}

/** 文字底色块：图的线条与文字会互相穿插，标签后面垫一层纸色才看得清 */
function labelPlate(x: number, y: number, width: number, height: number): string {
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="3" fill="${PAPER}" opacity="0.86"/>`
}

const round = (n: number): number => Math.round(n * 100) / 100

function svgDoc(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}"` +
    ` viewBox="0 0 ${round(width)} ${round(height)}" font-family="${escapeHtml(FONT)}">` +
    `<rect width="${round(width)}" height="${round(height)}" fill="${PAPER}"/>${body}</svg>`
  )
}

/** 实体色：调用方给的那份优先（与应用内 `--entity-N` 同源），没有就用布局层的回退色 */
export type FigureColorOf = (entityId: string, fallback?: string) => string

/**
 * 实体时间线 → SVG。几何完全交给 `layoutEntityTimeline`（与应用内同一个函数、同一套换行规则），
 * 这里只负责把矩形与文字画出来。
 *
 * 参数**不照抄界面默认值**：界面用 `DEFAULT_LAYOUT` 并另外注入 `theme.palette`，而这里按打印尺寸
 * 另配一份 `TIMELINE_CONFIG`（列更窄、字更小、行更高），所以列位置与换行点会与界面略有出入。
 *
 * 没有事件（或没有实体）时返回 null：空的图不如不导出。
 */
export function timelineFigure(
  charts: BookCharts | null | undefined,
  colorOf: FigureColorOf,
  title: string
): PackImage | null {
  const data = charts?.entityTimeline
  if (!data?.events?.length) return null
  const layout = layoutEntityTimeline(data, TIMELINE_CONFIG)
  const { config } = layout
  const width = Math.max(round(layout.width), 320)
  const height = round(layout.height + 8)
  const body: string[] = []

  layout.entities.forEach((entity, col) => {
    const w = config.colWidth - config.pad * 2
    const x = config.labelWidth + col * config.colWidth + config.pad
    body.push(`<rect x="${round(x)}" y="6" width="${round(w)}" height="4" rx="2" fill="${escapeHtml(colorOf(entity.id, layout.entityColor.get(entity.id)))}"/>`)
    const lines = layout.headerLines.get(entity.id) ?? [entity.name]
    lines.slice(0, 3).forEach((line, i) => {
      body.push(
        text(x + w / 2, 26 + i * config.lineHeight, line, {
          size: config.fontSize + 1,
          weight: 600,
          anchor: 'middle',
        })
      )
    })
  })

  layout.timeRows.forEach((row) => {
    body.push(`<line x1="0" y1="${round(row.y)}" x2="${round(width)}" y2="${round(row.y)}" stroke="${LINE}"/>`)
    row.labelLines.slice(0, 3).forEach((line, i) => {
      body.push(text(8, row.y + 16 + i * config.lineHeight, line, { size: config.fontSize, fill: MUTED }))
    })
  })

  layout.items.forEach((item) => {
    const color = colorOf(item.entityId, item.color)
    body.push(
      `<rect x="${round(item.x)}" y="${round(item.y)}" width="${round(item.chipWidth)}" height="${round(item.chipHeight)}" rx="8" fill="${escapeHtml(color)}"/>`
    )
    const fg = readableTextOn(cssColorToHex(color, '#ffffff'))
    item.labelLines.slice(0, 4).forEach((line, i) => {
      body.push(
        text(item.x + 8, item.y + config.pad + config.fontSize + i * config.lineHeight, line, {
          size: config.fontSize,
          fill: fg,
        })
      )
    })
  })

  return { title, dataUri: svgToDataUri(svgDoc(width, height, body.join(''))) }
}

/** 圆环布局参数：半径固定，节点大小随数量收一点，标签最多两行 */
const GRAPH_WIDTH = 720
const GRAPH_HEIGHT = 560
const GRAPH_RADIUS = 190
const GRAPH_LABEL_UNITS = 7

/**
 * 人物关系图 → SVG（圆环布局）。
 *
 * 节点形状沿用应用内的语义：人物是圆、组织是圆角矩形（`shapeForType`），颜色取实体色。
 * 同一对实体之间的多条关系用不同的弧线错开，关系文字垫纸色底。
 */
export function personGraphFigure(
  charts: BookCharts | null | undefined,
  colorOf: FigureColorOf,
  title: string
): PackImage | null {
  if (!charts) return null
  const graph = getEntityGraph(charts)
  const nodes = graph?.nodes ?? []
  if (nodes.length < 2) return null

  const styles = buildEntityStyles(charts)
  const shapeOf = (id: string): string => styles.get(id)?.shape ?? 'circle'
  const r = nodes.length > 12 ? 22 : 28
  const cx = GRAPH_WIDTH / 2
  const cy = GRAPH_HEIGHT / 2 - 12
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((node, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length
    pos.set(node.id, { x: cx + GRAPH_RADIUS * Math.cos(angle), y: cy + GRAPH_RADIUS * Math.sin(angle) })
  })

  const body: string[] = []

  // 边：按「无向对」分组，第 k 条用不同的弧度错开（否则同一对实体的多条关系会重叠成一条）
  const pairs = new Map<string, number>()
  for (const edge of graph?.edges ?? []) {
    const from = pos.get(edge.source)
    const to = pos.get(edge.target)
    if (!from || !to || edge.source === edge.target) continue
    const key = [edge.source, edge.target].sort().join('\u0000')
    const nth = pairs.get(key) ?? 0
    pairs.set(key, nth + 1)

    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const gap = r + 4
    const sx = from.x + ux * gap
    const sy = from.y + uy * gap
    const ex = to.x - ux * gap
    const ey = to.y - uy * gap
    // 垂直方向的偏移量：0, +26, -26, +52, -52 …
    const shift = Math.ceil(nth / 2) * 26 * (nth % 2 === 1 ? 1 : -1)
    const mx = (sx + ex) / 2 - uy * shift
    const my = (sy + ey) / 2 + ux * shift
    body.push(
      `<path d="M ${round(sx)} ${round(sy)} Q ${round(mx)} ${round(my)} ${round(ex)} ${round(ey)}" fill="none" stroke="${LINE}" stroke-width="1.5"/>`
    )

    const label = edge.relation?.trim()
    if (label) {
      const lx = 0.25 * sx + 0.5 * mx + 0.25 * ex
      const ly = 0.25 * sy + 0.5 * my + 0.25 * ey
      const w = label.length * 11 + 8
      body.push(labelPlate(lx - w / 2, ly - 9, w, 15))
      body.push(text(lx, ly + 3, label, { size: 10, fill: MUTED, anchor: 'middle' }))
    }
  }

  // 节点：先画形状，再画标签（标签垫纸色，压住从下面穿过的连线）
  nodes.forEach((node) => {
    const point = pos.get(node.id)
    if (!point) return
    const color = colorOf(node.id)
    if (shapeOf(node.id) === 'round-rect' || shapeOf(node.id) === 'diamond') {
      const w = r * 2.4
      const h = r * 1.6
      body.push(
        `<rect x="${round(point.x - w / 2)}" y="${round(point.y - h / 2)}" width="${round(w)}" height="${round(h)}" rx="8" fill="${escapeHtml(color)}" stroke="${PAPER}" stroke-width="2"/>`
      )
    } else {
      body.push(
        `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="${r}" fill="${escapeHtml(color)}" stroke="${PAPER}" stroke-width="2"/>`
      )
    }
    const lines = wrapText(node.name, GRAPH_LABEL_UNITS).slice(0, 2)
    lines.forEach((line, i) => {
      const y = point.y + r + 15 + i * 15
      const w = line.length * 12 + 6
      body.push(labelPlate(point.x - w / 2, y - 12, w, 16))
      body.push(text(point.x, y, line, { size: 12, fill: INK, anchor: 'middle' }))
    })
  })

  return { title, dataUri: svgToDataUri(svgDoc(GRAPH_WIDTH, GRAPH_HEIGHT, body.join(''))) }
}
