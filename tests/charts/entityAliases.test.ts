import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { aliasesFromMetas } from '@/charts/linking/entityAliases'
import { buildEntityMatcher, findEntityMatches } from '@/charts/linking/entityIndex'
import { buildEntityLinking } from '@/charts/linking/entityLinking'
import { remarkEntityMark } from '@/charts/linking/remarkEntityMark'
import type { BookCharts } from '@/charts/types'

const kkrMeta = { entities: [{ name: 'KKR', aliases: ['Kohlberg Kravis Roberts', '科尔伯格-克拉维斯-罗伯茨'] }] }

describe('aliasesFromMetas：旁路里的写法并入图表实体', () => {
  const ents = [{ id: 'kkr', name: 'KKR' }, { id: 'ross', name: '罗斯·约翰逊' }]

  it('旁路规范名/别名与图表实体名对上 → 其余写法成为该实体的别名', () => {
    const r = aliasesFromMetas(ents, [kkrMeta])
    expect(r.get('kkr')).toEqual(['Kohlberg Kravis Roberts', '科尔伯格-克拉维斯-罗伯茨'])
    expect(r.has('ross')).toBe(false)
  })

  it('反过来也行：图表里是全称，旁路里规范名是缩写', () => {
    const r = aliasesFromMetas([{ id: 'k', name: 'Kohlberg Kravis Roberts' }], [kkrMeta])
    expect(r.get('k')).toEqual(['KKR', '科尔伯格-克拉维斯-罗伯茨'])
  })

  it('图表实体名带括号/中点时按变体对上（罗斯·约翰逊（Ross Johnson）← 旁路里的「约翰逊」不算：太短/不相等）', () => {
    const r = aliasesFromMetas([{ id: 'ross', name: '罗斯·约翰逊（Ross Johnson）' }], [{ entities: [{ name: 'Ross Johnson', aliases: ['RJR 总裁'] }] }])
    expect(r.get('ross')).toEqual(['RJR 总裁'])
  })

  it('对不上任何图表实体的旁路实体被忽略；null/空旁路安全', () => {
    expect(aliasesFromMetas(ents, [null, undefined, { entities: [{ name: '无关的人', aliases: [] }] }]).size).toBe(0)
  })

  it('别名已是另一个实体的名字：不抢', () => {
    const r = aliasesFromMetas([{ id: 'a', name: 'KKR' }, { id: 'b', name: '科尔伯格-克拉维斯-罗伯茨' }], [kkrMeta])
    expect(r.get('a')).toEqual(['Kohlberg Kravis Roberts'])
  })
})

describe('buildEntityMatcher：别名优先级低于所有实体的主名', () => {
  it('别名与另一实体主名撞车时主名赢；别名本身可命中', () => {
    const m = buildEntityMatcher([
      { id: 'a', name: '甲公司', aliases: ['乙公司', '甲集团'] },
      { id: 'b', name: '乙公司' },
    ])
    expect(findEntityMatches(m, '乙公司与甲集团').map((x) => x.entityId)).toEqual(['b', 'a'])
  })
})

describe('端到端：正文只写全称，图谱里是缩写', () => {
  const charts = { version: 1, entityGraph: { nodes: [{ id: 'kkr', name: 'KKR', importance: 9 }], edges: [] } } as unknown as BookCharts
  const chapters = [
    { id: 'c1', title: '第1章', text: 'Kohlberg Kravis Roberts 发起了收购。' },
    { id: 'c2', title: '第2章', text: '科尔伯格-克拉维斯-罗伯茨再次出价，KKR 获胜。' },
  ]

  it('没有旁路：全称不被识别（现状基线）', () => {
    const l = buildEntityLinking(charts, chapters)!
    expect(l.index.entityToChapters.get('kkr')).toEqual([{ chapterId: 'c2', count: 1 }])
  })

  it('有旁路：两种全称都并入 KKR，出场章节与次数随之增加', () => {
    const l = buildEntityLinking(charts, chapters.map((c) => ({ ...c, meta: kkrMeta })))!
    expect(l.index.entityToChapters.get('kkr')).toEqual([
      { chapterId: 'c1', count: 1 },
      { chapterId: 'c2', count: 2 },
    ])
  })

  it('正文标注：别名被包成同一个实体的 entity-mark', () => {
    const l = buildEntityLinking(charts, chapters.map((c) => ({ ...c, meta: kkrMeta })))!
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [[remarkEntityMark, { matcher: l.matcher }]] }, chapters[0].text))
    expect(html).toContain('<span class="entity-mark" data-entity-id="kkr">Kohlberg Kravis Roberts</span>')
  })
})

describe('useEntityLinking：章节的 meta 会传到联动查询表', () => {
  it('Chapter.meta 里的别名生效（接线没丢）', async () => {
    const { mount } = await import('../uiTestUtils')
    const { useEntityLinking } = await import('@/charts/linking/useEntityLinking')
    let got: ReturnType<typeof useEntityLinking> = null
    const charts = { version: 1, entityGraph: { nodes: [{ id: 'kkr', name: 'KKR', importance: 9 }], edges: [] } } as unknown as BookCharts
    function Probe() {
      got = useEntityLinking(charts, [{ id: 'c1', title: '一', summary: 'Kohlberg Kravis Roberts 出价。'.repeat(2), meta: kkrMeta }], false)
      return null
    }
    const m = mount(createElement(Probe))
    expect(got!.index.entityToChapters.get('kkr')).toEqual([{ chapterId: 'c1', count: 2 }])
    m.unmount()
  })
})
