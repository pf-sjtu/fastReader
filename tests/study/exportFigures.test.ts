import { describe, expect, it } from 'vitest'
import { personGraphFigure, timelineFigure, type FigureColorOf } from '@/study/exportFigures'
import type { BookCharts } from '@/charts/types'
import type { PackImage } from '@/study/pack'

/** data URI 是 URL 编码的，比对内容前先解回来 */
function svgOf(image: PackImage): string {
  const encoded = image.dataUri.split(',').slice(1).join(',')
  return decodeURIComponent(encoded)
}

const CHARTS: BookCharts = {
  version: 1,
  entityGraph: {
    nodes: [
      { id: 'p1', name: '苏格拉底', type: '人物', importance: 9 },
      { id: 'p2', name: '柏拉图', type: '人物', importance: 8 },
      { id: 'o1', name: '雅典学院', type: '组织', description: '柏拉图创办的学园' },
    ],
    edges: [
      { source: 'p1', target: 'p2', relation: '师生' },
      { source: 'p2', target: 'o1', relation: '创办' },
      { source: 'p2', target: 'o1', relation: '任教' },
    ],
  },
  entityTimeline: {
    entities: [
      { id: 'p1', name: '苏格拉底' },
      { id: 'p2', name: '柏拉图' },
    ],
    events: [
      { id: 'e1', label: '出生', timeLabel: '公元前 470', order: 1, entityIds: ['p1'] },
      { id: 'e2', label: '求学', timeLabel: '公元前 407', order: 2, entityIds: ['p2'] },
    ],
  },
}

/** 实体色由调用方给：测试里不读 CSS 变量 */
const colorOf: FigureColorOf = (id) => {
  if (id === 'p1') return '#b45309'
  if (id === 'p2') return '#1d4ed8'
  return '#6f675c'
}

describe('timelineFigure', () => {
  it('没有图表数据、或时间线里没有事件时返回 null', () => {
    expect(timelineFigure(null, colorOf, '实体时间线')).toBeNull()
    expect(timelineFigure(undefined, colorOf, '实体时间线')).toBeNull()
    expect(timelineFigure({ version: 1 }, colorOf, '实体时间线')).toBeNull()
    expect(
      timelineFigure(
        { version: 1, entityTimeline: { entities: [{ id: 'p1', name: '苏格拉底' }], events: [] } },
        colorOf,
        '实体时间线'
      )
    ).toBeNull()
  })

  it('把实体名、事件标签、时间标签与实体色画进 SVG', () => {
    const image = timelineFigure(CHARTS, colorOf, '实体时间线')
    expect(image?.title).toBe('实体时间线')
    expect(image?.dataUri.startsWith('data:image/svg+xml')).toBe(true)

    const svg = svgOf(image as PackImage)
    expect(svg).toContain('苏格拉底')
    expect(svg).toContain('柏拉图')
    expect(svg).toContain('出生')
    expect(svg).toContain('求学')
    expect(svg).toContain('公元前 470')
    // 色带 / 事件块用的是调用方给的颜色
    expect(svg).toContain('#b45309')
    expect(svg).toContain('#1d4ed8')
  })

  it('不写出任何外链：只有 SVG 命名空间那一个 http 字样', () => {
    const svg = svgOf(timelineFigure(CHARTS, colorOf, '实体时间线') as PackImage)
    expect(svg.match(/https?:\/\//g) ?? []).toHaveLength(1)
    expect(svg).not.toMatch(/href=/)
  })

  it('实体色里的引号被转义：颜色原样进去，但构造不出新属性', () => {
    // 实体色来自书的数据（`BookCharts` 里可带 color），不是可信常量
    const hostile = 'red" onload="alert(1)'
    const svg = svgOf(timelineFigure(CHARTS, () => hostile, '实体时间线') as PackImage)
    expect(svg).not.toContain('" onload="')

    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    const fills = [...parsed.querySelectorAll('[fill]')].map((el) => el.getAttribute('fill'))
    expect(fills).toContain(hostile)
    expect(parsed.querySelector('[onload]')).toBeNull()
  })
})

describe('personGraphFigure', () => {
  it('节点少于两个、或没有图表数据时返回 null', () => {
    expect(personGraphFigure(null, colorOf, '人物关系图')).toBeNull()
    expect(personGraphFigure({ version: 1 }, colorOf, '人物关系图')).toBeNull()
    expect(
      personGraphFigure(
        { version: 1, entityGraph: { nodes: [{ id: 'p1', name: '苏格拉底' }], edges: [] } },
        colorOf,
        '人物关系图'
      )
    ).toBeNull()
  })

  it('画出节点名与关系文字，同一对实体的多条关系各自成线', () => {
    const image = personGraphFigure(CHARTS, colorOf, '人物关系图')
    expect(image?.title).toBe('人物关系图')

    const svg = svgOf(image as PackImage)
    expect(svg).toContain('苏格拉底')
    expect(svg).toContain('柏拉图')
    expect(svg).toContain('雅典学院')
    expect(svg).toContain('师生')
    expect(svg).toContain('创办')
    expect(svg).toContain('任教')
    // 三条关系 = 三条二次贝塞尔（柏拉图 ↔ 雅典学院的两条必须错开，否则重叠成一条）
    expect(svg.match(/<path /g) ?? []).toHaveLength(3)
    // 人物是圆、组织是圆角矩形（节点形状单独带纸色描边；其余 `<rect>` 是标签底色）
    expect(svg.match(/<circle [^>]*stroke="#f7f4ee"/g) ?? []).toHaveLength(2)
    expect(svg).toMatch(/<rect [^>]*rx="8" fill="#6f675c" stroke="#f7f4ee"/)
  })

  it('实体名与关系文字里的 HTML 一律转义', () => {
    const hostile: BookCharts = {
      version: 1,
      entityGraph: {
        nodes: [
          { id: 'a', name: '<script>alert(1)</script>', type: '人物' },
          { id: 'b', name: '正常名字', type: '人物' },
        ],
        edges: [{ source: 'a', target: 'b', relation: '<img src=x onerror=1>' }],
      },
    }
    const svg = svgOf(personGraphFigure(hostile, colorOf, '人物关系图') as PackImage)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('<img')
    expect(svg).toContain('&lt;script&gt;')
  })

  it('节点色里的引号被转义：节点照画，属性注入不成立', () => {
    const hostile = 'blue" onmouseover="alert(1)'
    const svg = svgOf(personGraphFigure(CHARTS, () => hostile, '人物关系图') as PackImage)
    expect(svg).not.toContain('" onmouseover="')

    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    const fills = [...parsed.querySelectorAll('[fill]')].map((el) => el.getAttribute('fill'))
    expect(fills).toContain(hostile)
    // 三个节点都画出来了（圆 + 圆角矩形），不是被异常颜色吞掉
    expect(svg.match(/<circle [^>]*fill=/g) ?? []).toHaveLength(2)
    expect(svg.match(/<rect [^>]*stroke="#f7f4ee"/g) ?? []).toHaveLength(1)
    expect(parsed.querySelector('[onmouseover]')).toBeNull()
  })
})
