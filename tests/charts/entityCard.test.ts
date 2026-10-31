import { describe, it, expect } from 'vitest'
import {
  buildEntityLinking,
  chapterEntityIds,
  chapterEventIds,
  earliestRank,
  nextOccurrence,
  entityChapterList,
} from '@/charts/linking/entityLinking'
import { buildEntityCardModel, CARD_MAX_EVENTS, CARD_MAX_RELATION_GROUPS } from '@/charts/linking/entityCard'
import { makeSnippet } from '@/charts/linking/entityIndex'
import type { BookCharts } from '@/charts/types'

const chapters = [
  { id: 'c1', title: '第1章 序幕', text: '罗斯·约翰逊担任纳贝斯克的首席执行官。' },
  { id: 'c2', title: '第2章 私有化', text: '罗斯·约翰逊提出私有化方案。' },
  { id: 'c3', title: '第3章 KKR 登场', text: 'KKR开始关注纳贝斯克。' },
  { id: 'c4', title: '第4章 对立', text: '罗斯·约翰逊与KKR正面对立。' },
  { id: 'c5', title: '第5章 出价', text: 'KKR再次出价。' },
  { id: 'c6', title: '第6章 结局', text: '薛利先生见证罗斯·约翰逊败给KKR。' },
]

const charts: BookCharts = {
  version: 1,
  entityGraph: {
    nodes: [
      { id: 'ross', name: '罗斯·约翰逊', type: '人物', importance: 9, description: '纳贝斯克CEO，私有化发起人' },
      { id: 'nab', name: '纳贝斯克', type: '组织', importance: 8, description: '食品烟草集团' },
      { id: 'kkr', name: 'KKR', type: '组织', importance: 8, description: '赢得竞购的收购机构' },
      { id: 'shelly', name: '薛利先生', type: '人物', importance: 3, description: '旁观者薛利的身份' },
      { id: 'ghost', name: '幽灵人', type: '人物', importance: 2, description: '从未在正文出现' },
    ],
    edges: [
      { source: 'ross', target: 'nab', relation: '领导' }, // 共现 c1
      { source: 'kkr', target: 'nab', relation: '收购' }, // 共现 c3
      { source: 'ross', target: 'kkr', relation: '对立' }, // 共现 c4, c6
      { source: 'ross', target: 'shelly', relation: '顾问' }, // 共现 c6
      { source: 'ross', target: 'ghost', relation: '秘密联系' }, // ghost 从未出现 → 无法判断
    ],
  },
  entityTimeline: {
    entities: [{ id: 'ross', name: '罗斯·约翰逊' }],
    events: [
      { id: 'e1', label: '提出私有化', timeLabel: '1988-10', order: 1, entityIds: ['ross'], chapterHint: '第2章' },
      { id: 'e2', label: '正面交锋', timeLabel: '1988-11', order: 2, entityIds: ['ross', 'kkr'], chapterHint: '第4章' },
      { id: 'e3', label: '败给KKR', timeLabel: '1989-01', order: 3, entityIds: ['ross'], chapterHint: '第6章' },
      { id: 'e4', label: '神秘会面', timeLabel: '某日', order: 4, entityIds: ['ross'] }, // 无章节线索
    ],
  },
}

const L = buildEntityLinking(charts, chapters)!
const model = (id: string, cur: string | undefined, reveal = false) => buildEntityCardModel(L, id, cur, reveal)!

describe('信息项关联章节', () => {
  it('关系边 = 两端实体共同出现的章节（多对多）', () => {
    const e = (rel: string) => L.edges.find((x) => x.relation === rel)!
    expect(e('领导').chapters).toEqual(['c1'])
    expect(e('对立').chapters).toEqual(['c4', 'c6'])
    expect(e('收购').chapters).toEqual(['c3'])
  })

  it('两端从未共现 → 无法判断（空集合）', () => {
    expect(L.edges.find((x) => x.relation === '秘密联系')!.chapters).toEqual([])
  })

  it('chapterHint 优先于共现推导', () => {
    const hinted = buildEntityLinking(
      {
        ...charts,
        entityGraph: {
          nodes: charts.entityGraph!.nodes,
          edges: [{ source: 'ross', target: 'kkr', relation: '对立', chapterHint: '第2章' }],
        },
      },
      chapters
    )!
    expect(hinted.edges[0].chapters).toEqual(['c2'])
  })

  it('chapterHint 映射不上时回退到共现推导，而不是丢信息', () => {
    const bad = buildEntityLinking(
      {
        ...charts,
        entityGraph: {
          nodes: charts.entityGraph!.nodes,
          edges: [{ source: 'ross', target: 'kkr', relation: '对立', chapterHint: '完全无关的话' }],
        },
      },
      chapters
    )!
    expect(bad.edges[0].chapters).toEqual(['c4', 'c6'])
  })

  it('节点归属：正文出现的章节；有 hint 则以 hint 为准', () => {
    expect(L.entityChapters.get('ross')).toEqual(['c1', 'c2', 'c4', 'c6'])
    expect(L.entityChapters.get('ghost')).toEqual([])
    const hinted = buildEntityLinking(
      { ...charts, entityGraph: { nodes: [{ id: 'ross', name: '罗斯·约翰逊', chapterHint: '第3章' }], edges: [] } },
      chapters
    )!
    expect(hinted.entityChapters.get('ross')).toEqual(['c3'])
  })

  it('事件映射 + 本章实体/事件查询', () => {
    expect(L.eventChapters.get('e1')).toBe('c2')
    expect(L.eventChapters.get('e4')).toBeNull()
    expect([...chapterEventIds(L, 'c4')]).toEqual(['e2'])
    expect([...chapterEntityIds(L, 'c3')].sort()).toEqual(['kkr', 'nab'])
    expect(chapterEntityIds(null, 'c1').size).toBe(0)
  })

  it('earliestRank / 出场章节列表 / 下一次出现', () => {
    expect(earliestRank(L, ['c4', 'c2'])).toBe(1)
    expect(earliestRank(L, [])).toBeNull()
    expect(entityChapterList(L, 'ross').map((x) => x.chapterId)).toEqual(['c1', 'c2', 'c4', 'c6'])
    expect(nextOccurrence(L, 'ross', 'c2', L.chapterOrder)?.chapterId).toBe('c4')
    expect(nextOccurrence(L, 'ross', 'c6', L.chapterOrder)?.chapterId).toBe('c1') // 到末尾 → 回到首次
    expect(nextOccurrence(L, 'ghost', 'c1', L.chapterOrder)).toBeNull()
  })

  it('无图表或无实体时返回 null', () => {
    expect(buildEntityLinking(null, chapters)).toBeNull()
    expect(buildEntityLinking({ version: 1 }, chapters)).toBeNull()
  })
})

describe('出现位置与摘录', () => {
  it('记录每一次出现的章节、序号与前后文', () => {
    const occ = L.index.occurrences.get('kkr')!
    expect(occ.map((o) => `${o.chapterId}#${o.ordinal}`)).toEqual(['c3#1', 'c4#1', 'c5#1', 'c6#1'])
    expect(occ[0].snippet).toContain('KKR开始关注')
  })

  it('同章多次出现序号递增', () => {
    const l = buildEntityLinking(charts, [{ id: 'x', title: '第1章', text: 'KKR来了，KKR又来了，KKR走了' }])!
    expect(l.index.occurrences.get('kkr')!.map((o) => o.ordinal)).toEqual([1, 2, 3])
  })

  it('摘录去掉 Markdown 记号、两端加省略号', () => {
    const text = '前面很长很长很长很长很长很长的铺垫文字。**罗斯·约翰逊**在会上宣布了私有化方案，后面还有很长很长很长很长的内容。'
    const s = makeSnippet(text, text.indexOf('罗斯'), text.indexOf('罗斯') + 6)
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(s).not.toContain('*')
    expect(s).toContain('罗斯·约翰逊')
  })
})

describe('buildEntityCardModel：剧透折叠', () => {
  it('默认只显示严格早于当前章的信息（在第 4 章）', () => {
    const m = model('ross', 'c4')
    // 领导(c1) 可见；对立(最早 c4，不早于当前章)、顾问(c6)、秘密联系(无法判断) 折叠
    expect(m.visible.relations.map((g) => g.relation)).toEqual(['领导'])
    expect(m.hidden.relations).toBe(3) // 对立 + 顾问 + 秘密联系
    expect(m.visible.events.map((e) => e.id)).toEqual(['e1'])
    expect(m.hidden.events).toBe(3) // e2(c4) e3(c6) e4(无法判断)
    expect(m.visible.description).toBe('纳贝斯克CEO，私有化发起人')
    expect(m.hidden.total).toBe(3 + 3)
  })

  it('折叠的内容不会出现在模型里（防止 DOM/复制/读屏泄露）', () => {
    const json = JSON.stringify(model('ross', 'c4'))
    for (const leaked of ['对立', '顾问', '秘密联系', '幽灵人', '薛利', '正面交锋', '败给KKR', '神秘会面']) {
      expect(json).not.toContain(leaked)
    }
    expect(model('ross', 'c4').revealed).toBeNull()
  })

  it('点击展开后才给出被折叠内容，并带章节归属', () => {
    const m = model('ross', 'c4', true)
    expect(m.revealed!.relations.map((g) => g.relation).sort()).toEqual(['对立', '秘密联系', '顾问'].sort())
    expect(m.revealed!.relations.find((g) => g.relation === '对立')!.firstChapterId).toBe('c4')
    expect(m.revealed!.relations.find((g) => g.relation === '秘密联系')!.firstChapterId).toBeNull()
    expect(m.revealed!.events.map((e) => e.id)).toEqual(['e2', 'e3', 'e4'])
    expect(m.revealed!.events.find((e) => e.id === 'e4')!.chapterId).toBeNull()
  })

  it('读到后面的章节时，前面折叠的内容自动变为可见', () => {
    const m = model('ross', 'c6')
    expect(m.visible.relations.map((g) => g.relation).sort()).toEqual(['对立', '领导'].sort())
    expect(m.visible.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    // 顾问(c6) 与无法判断的两项仍折叠
    expect(m.hidden.relations).toBe(2)
  })

  it('实体首次出场就在当前章：简介/关系/事件全部折叠', () => {
    const m = model('shelly', 'c6')
    expect(m.firstAppearsHere).toBe(true)
    expect(m.visible.description).toBeUndefined()
    expect(m.visible.relations).toEqual([])
    expect(m.hidden.description).toBe(1)
    expect(JSON.stringify(m)).not.toContain('旁观者薛利的身份')
  })

  it('当前章未知时按最保守处理：一切折叠', () => {
    const m = model('ross', undefined)
    expect(m.visible.relations).toEqual([])
    expect(m.visible.events).toEqual([])
    expect(m.visible.description).toBeUndefined()
    expect(m.hidden.total).toBeGreaterThan(0)
  })

  it('从未在正文出现的实体：无法判断归属 → 简介折叠', () => {
    const m = model('ghost', 'c6')
    expect(m.firstChapterId).toBeNull()
    expect(m.visible.description).toBeUndefined()
    expect(m.hidden.description).toBe(1)
  })

  it('未知实体返回 null；没有 linking 返回 null', () => {
    expect(buildEntityCardModel(L, 'nope', 'c1')).toBeNull()
    expect(buildEntityCardModel(null, 'ross', 'c1')).toBeNull()
  })
})

describe('buildEntityCardModel：关系概括与事件上限', () => {
  const many = (n: number): BookCharts => ({
    version: 1,
    entityGraph: {
      nodes: [
        { id: 'hub', name: '核心人物甲', importance: 10 },
        ...Array.from({ length: n }, (_, i) => ({ id: `n${i}`, name: `配角人物${i}号`, importance: 1 + (i % 9) })),
      ],
      edges: Array.from({ length: n }, (_, i) => ({ source: 'hub', target: `n${i}`, relation: `关系${i}` })),
    },
    entityTimeline: {
      entities: [{ id: 'hub', name: '核心人物甲' }],
      events: Array.from({ length: 9 }, (_, i) => ({
        id: `ev${i}`, label: `事件${i}`, timeLabel: `t${i}`, order: i, entityIds: ['hub'], chapterHint: '第1章',
      })),
    },
  })
  const text = '核心人物甲' + Array.from({ length: 10 }, (_, i) => `配角人物${i}号`).join('、')
  const chs = [
    { id: 'a', title: '第1章', text },
    { id: 'b', title: '第2章', text: '后续章节' },
  ]

  it('关系组最多 6 个，其余并入 moreRelations；事件取最近 5 条', () => {
    const l = buildEntityLinking(many(10), chs)!
    const m = buildEntityCardModel(l, 'hub', 'b')!
    expect(m.visible.relations).toHaveLength(CARD_MAX_RELATION_GROUPS)
    expect(m.visible.moreRelations).toBe(10 - CARD_MAX_RELATION_GROUPS)
    expect(m.visible.events).toHaveLength(CARD_MAX_EVENTS)
    expect(m.visible.events.map((e) => e.id)).toEqual(['ev4', 'ev5', 'ev6', 'ev7', 'ev8'])
    expect(m.visible.moreEvents).toBe(9 - CARD_MAX_EVENTS)
  })

  it('同一关系词的多个邻居归并成一组，并按邻居重要度排序', () => {
    const c: BookCharts = {
      version: 1,
      entityGraph: {
        nodes: [
          { id: 'hub', name: '核心人物甲', importance: 10 },
          { id: 'x', name: '配角人物乙', importance: 2 },
          { id: 'y', name: '配角人物丙', importance: 9 },
        ],
        edges: [
          { source: 'hub', target: 'x', relation: '领导' },
          { source: 'hub', target: 'y', relation: '领导' },
        ],
      },
    }
    const l = buildEntityLinking(c, [
      { id: 'a', title: '第1章', text: '核心人物甲、配角人物乙、配角人物丙' },
      { id: 'b', title: '第2章', text: '后续' },
    ])!
    const g = buildEntityCardModel(l, 'hub', 'b')!.visible.relations
    expect(g).toHaveLength(1)
    expect(g[0].neighbors.map((n) => n.id)).toEqual(['y', 'x'])
  })

  it('区分关系方向：A→B 与 B→A 是两组', () => {
    const c: BookCharts = {
      version: 1,
      entityGraph: {
        nodes: [{ id: 'a', name: '甲方人物' }, { id: 'b', name: '乙方人物' }],
        edges: [
          { source: 'a', target: 'b', relation: '影响' },
          { source: 'b', target: 'a', relation: '影响' },
        ],
      },
    }
    const l = buildEntityLinking(c, [
      { id: '1', title: '第1章', text: '甲方人物与乙方人物' },
      { id: '2', title: '第2章', text: '后续' },
    ])!
    const dirs = buildEntityCardModel(l, 'a', '2')!.visible.relations.map((g) => g.direction).sort()
    expect(dirs).toEqual(['in', 'out'])
  })
})
