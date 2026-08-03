import { describe, it, expect } from 'vitest'
import {
  extractJsonObject,
  parseCharts,
  deserializeCharts,
  serializeCharts,
} from '@/charts/parseCharts'
import { enforceChartLimits } from '@/charts/schema'
import { CHART_LIMITS } from '@/charts/types'

describe('extractJsonObject', () => {
  it('提取 fence 内 JSON', () => {
    const text = '说明\n```json\n{"version":1,"personGraph":{"nodes":[],"edges":[]}}\n```\n'
    const j = extractJsonObject(text)
    expect(j).toContain('"version"')
  })

  it('提取裸 JSON', () => {
    const j = extractJsonObject('前缀 {"a":1,"b":{"c":2}} 后缀')
    expect(j).toBe('{"a":1,"b":{"c":2}}')
  })

  it('空文本返回 null', () => {
    expect(extractJsonObject('')).toBeNull()
  })
})

describe('parseCharts', () => {
  const valid = {
    version: 1 as const,
    personGraph: {
      nodes: [
        { id: 'a', name: '甲', importance: 9 },
        { id: 'b', name: '乙', importance: 7 },
      ],
      edges: [{ source: 'a', target: 'b', relation: '朋友' }],
    },
    entityTimeline: {
      entities: [
        { id: 'a', name: '甲' },
        { id: 'b', name: '乙' },
      ],
      events: [
        {
          id: 'e1',
          label: '相识',
          timeLabel: '第一章',
          order: 1,
          entityIds: ['a', 'b'],
        },
      ],
    },
  }

  it('解析合法 JSON', () => {
    const charts = parseCharts(JSON.stringify(valid))
    expect(charts).not.toBeNull()
    expect(charts!.personGraph!.nodes).toHaveLength(2)
    expect(charts!.entityTimeline!.events).toHaveLength(1)
  })

  it('解析 fence 包裹', () => {
    const charts = parseCharts('```json\n' + JSON.stringify(valid) + '\n```')
    expect(charts?.personGraph?.nodes[0].name).toBe('甲')
  })

  it('缺 version 时自动补 1', () => {
    const { version: _, ...rest } = valid
    const charts = parseCharts(JSON.stringify(rest))
    expect(charts?.version).toBe(1)
  })

  it('空节点空事件返回 null', () => {
    expect(
      parseCharts(JSON.stringify({ version: 1, personGraph: { nodes: [], edges: [] } }))
    ).toBeNull()
  })

  it('非法 JSON 返回 null', () => {
    expect(parseCharts('不是 json')).toBeNull()
  })

  it('序列化往返', () => {
    const charts = parseCharts(JSON.stringify(valid))!
    const again = deserializeCharts(serializeCharts(charts))
    expect(again?.personGraph?.nodes).toHaveLength(2)
  })
})

describe('enforceChartLimits', () => {
  it('裁剪超限节点', () => {
    const nodes = Array.from({ length: CHART_LIMITS.maxNodes + 10 }, (_, i) => ({
      id: `n${i}`,
      name: `N${i}`,
      importance: i,
    }))
    const limited = enforceChartLimits({
      version: 1,
      personGraph: { nodes, edges: [] },
    })
    expect(limited.personGraph!.nodes.length).toBe(CHART_LIMITS.maxNodes)
    // 保留 importance 最高
    expect(limited.personGraph!.nodes[0].importance).toBeGreaterThanOrEqual(
      limited.personGraph!.nodes.at(-1)!.importance ?? 0
    )
  })
})
