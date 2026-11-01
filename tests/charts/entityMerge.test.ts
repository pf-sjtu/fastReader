import { describe, it, expect } from 'vitest'
import { mergeAliasedEntities } from '../../src/charts/linking/entityMerge'
import type { BookCharts } from '../../src/charts/types'

const meta = (name: string, aliases: string[]) => ({ entities: [{ name, aliases }] })

const charts = (): BookCharts => ({
  version: 1,
  entityGraph: {
    nodes: [
      { id: 'a', name: 'KKR', type: '组织', importance: 6 },
      { id: 'b', name: 'Kohlberg Kravis Roberts', type: '组织', importance: 9, description: '杠杆收购公司' },
      { id: 'c', name: '约翰逊', type: '人物', importance: 8 },
    ],
    edges: [
      { source: 'a', target: 'c', relation: '雇用' },
      { source: 'b', target: 'c', relation: '雇用' }, // 合并后与上一条重复
      { source: 'a', target: 'b', relation: '同一公司' }, // 合并后自环
    ],
  },
  entityTimeline: {
    entities: [
      { id: 'a', name: 'KKR' },
      { id: 'b', name: 'Kohlberg Kravis Roberts' },
    ],
    events: [{ id: 'e1', label: '收购', timeLabel: '1988', order: 1, entityIds: ['a', 'b', 'c', 'zzz'] }],
  },
})

describe('mergeAliasedEntities', () => {
  it('旁路里的别名同时命中两个节点的全名 → 合并成重要度更高的那个，边与事件引用同步改写', () => {
    const out = mergeAliasedEntities(charts(), [meta('Kohlberg Kravis Roberts', ['KKR'])])!
    expect(out.entityGraph!.nodes.map((n) => n.id).sort()).toEqual(['b', 'c'])
    const b = out.entityGraph!.nodes.find((n) => n.id === 'b')!
    expect(b.name).toBe('Kohlberg Kravis Roberts')
    expect(b.description).toBe('杠杆收购公司')
    // 重复边去重、自环删除
    expect(out.entityGraph!.edges).toEqual([{ source: 'b', target: 'c', relation: '雇用' }])
    expect(out.entityTimeline!.entities.map((e) => e.id)).toEqual(['b'])
    // 事件：a→b 去重，未知 id 原样保留
    expect(out.entityTimeline!.events[0].entityIds).toEqual(['b', 'c', 'zzz'])
  })

  it('被并节点的简介 / 更高重要度补给规范节点；同分时先出现的做规范节点', () => {
    const c = charts()
    c.entityGraph!.nodes[0].description = 'KKR 简介'
    c.entityGraph!.nodes[1].description = undefined
    c.entityGraph!.nodes[0].importance = 9 // 与 b 同分 → a 在前
    const out = mergeAliasedEntities(c, [meta('KKR', ['Kohlberg Kravis Roberts'])])!
    const n = out.entityGraph!.nodes.find((x) => x.name === 'KKR')!
    expect(n.id).toBe('a')
    expect(n.description).toBe('KKR 简介')
    expect(n.importance).toBe(9)
  })

  it('没有可合并的：返回同一个引用（memo 稳定）', () => {
    const c = charts()
    expect(mergeAliasedEntities(c, [])).toBe(c)
    expect(mergeAliasedEntities(c, [meta('约翰逊', ['Johnson'])])).toBe(c)
    expect(mergeAliasedEntities(null, [])).toBeNull()
  })

  it('类型都有且不同 → 不并（同名的人和公司）', () => {
    const c = charts()
    c.entityGraph!.nodes[0].type = '人物'
    expect(mergeAliasedEntities(c, [meta('Kohlberg Kravis Roberts', ['KKR'])])).toBe(c)
  })

  it('只比全名，不比 · 拆出的片段（两个「约翰·X」不会被误并）', () => {
    const c: BookCharts = {
      version: 1,
      entityGraph: {
        nodes: [
          { id: 'x', name: '约翰·史密斯' },
          { id: 'y', name: '约翰·琼斯' },
        ],
        edges: [],
      },
    }
    expect(mergeAliasedEntities(c, [meta('约翰', ['约翰·史密斯'])])).toBe(c)
  })

  it('传递合并：A=B、B=C 来自不同章的旁路 → 三个并成一个', () => {
    const c: BookCharts = {
      version: 1,
      entityGraph: {
        nodes: [
          { id: '1', name: 'IBM', importance: 5 },
          { id: '2', name: '国际商业机器', importance: 7 },
          { id: '3', name: 'Big Blue', importance: 6 },
        ],
        edges: [],
      },
    }
    const out = mergeAliasedEntities(c, [meta('IBM', ['国际商业机器']), meta('国际商业机器', ['Big Blue'])])!
    expect(out.entityGraph!.nodes.map((n) => n.id)).toEqual(['2'])
  })

  it('只有图谱或只有时间线也能工作；忽略大小写与首尾空白', () => {
    const c: BookCharts = {
      version: 1,
      entityTimeline: {
        entities: [
          { id: 't1', name: ' ibm ' },
          { id: 't2', name: 'International Business Machines' },
        ],
        events: [{ id: 'e', label: 'x', timeLabel: '', order: 1, entityIds: ['t1', 't2'] }],
      },
    }
    const out = mergeAliasedEntities(c, [meta('IBM', ['international business machines'])])!
    expect(out.entityTimeline!.entities).toHaveLength(1)
    expect(out.entityTimeline!.events[0].entityIds).toHaveLength(1)
    expect(out.entityGraph).toBeUndefined()
  })
})

describe('合并后与正文联动衔接', () => {
  it('被并掉的名字成为规范节点的别名：正文里只写 KKR 也归到合并后的节点', async () => {
    const { buildEntityLinking } = await import('../../src/charts/linking/entityLinking')
    const metas = [meta('Kohlberg Kravis Roberts', ['KKR'])]
    const merged = mergeAliasedEntities(charts(), metas)
    const linking = buildEntityLinking(merged, [
      { id: 'c1', title: '一', text: 'KKR 发起了收购。', meta: metas[0] as never },
      { id: 'c2', title: '二', text: '无关内容。' },
    ])!
    expect(linking.entityChapters.get('b')).toEqual(['c1'])
    expect(linking.entityChapters.has('a')).toBe(false)
  })
})
