import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import {
  buildEntityMatcher,
  findEntityMatches,
  indexEntityChapters,
  indexEventChapters,
  matchChapterHint,
  nameVariants,
  parseChapterNumber,
  extractChapterNumber,
} from '@/charts/linking/entityIndex'
import {
  buildEntityStyles,
  shapeForType,
  ENTITY_SLOT_COUNT,
} from '@/charts/linking/entityColors'
import { remarkEntityMark } from '@/charts/linking/remarkEntityMark'
import type { BookCharts } from '@/charts/types'

describe('nameVariants', () => {
  it('拆分 · 与括号，丢弃过短片段', () => {
    expect(nameVariants('罗斯·约翰逊（Ross Johnson）').sort()).toEqual(
      ['罗斯·约翰逊（Ross Johnson）', '罗斯·约翰逊', 'Ross Johnson', '罗斯', '约翰逊'].sort()
    )
    // 单字、2 字符拉丁都不应作为变体
    expect(nameVariants('王')).toEqual([])
    expect(nameVariants('Al')).toEqual([])
  })
})

describe('findEntityMatches', () => {
  const m = buildEntityMatcher([
    { id: 'ross', name: '罗斯·约翰逊' },
    { id: 'kkr', name: 'KKR' },
  ])

  it('长名优先于其子串', () => {
    const r = findEntityMatches(m, '罗斯·约翰逊宣布，约翰逊同意。')
    expect(r.map((x) => [x.start, x.end, x.entityId])).toEqual([
      [0, 6, 'ross'],
      [9, 12, 'ross'], // "约翰逊" 变体
    ])
  })

  it('拉丁词要求词边界且大小写不敏感', () => {
    expect(findEntityMatches(m, 'The kkr team; KKRX no').map((x) => x.start)).toEqual([4])
  })

  it('同一变体被多个实体占用时保留靠前者', () => {
    const mm = buildEntityMatcher([
      { id: 'a', name: '约翰逊' },
      { id: 'b', name: '罗斯·约翰逊' },
    ])
    expect(findEntityMatches(mm, '约翰逊')[0].entityId).toBe('a')
  })

  it('空匹配器与空文本安全', () => {
    expect(findEntityMatches(buildEntityMatcher([]), '任意文本')).toEqual([])
    expect(findEntityMatches(m, '')).toEqual([])
  })
})

describe('indexEntityChapters', () => {
  it('建立实体↔章节双向索引与总次数', () => {
    const m = buildEntityMatcher([
      { id: 'ross', name: '罗斯·约翰逊' },
      { id: 'kkr', name: 'KKR' },
    ])
    const idx = indexEntityChapters(m, [
      { id: 'c1', title: '第1章', text: '罗斯·约翰逊提出方案。' },
      { id: 'c2', title: '第2章', text: 'KKR 出价，罗斯·约翰逊反对，KKR 加价。' },
    ])
    expect(idx.entityToChapters.get('ross')).toEqual([
      { chapterId: 'c1', count: 1 },
      { chapterId: 'c2', count: 1 },
    ])
    expect(idx.entityToChapters.get('kkr')).toEqual([{ chapterId: 'c2', count: 2 }])
    expect([...idx.chapterToEntities.get('c1')!]).toEqual(['ross'])
    expect(idx.totals.get('kkr')).toBe(2)
  })

  it('300 章 × 50 实体在合理时间内完成（防退化成 O(文本×实体)）', () => {
    const entities = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, name: `人物${i}号` }))
    const matcher = buildEntityMatcher(entities)
    const filler = '这是一段没有实体名称的普通叙述文字，用来填充章节篇幅。'.repeat(80)
    const chapters = Array.from({ length: 300 }, (_, i) => ({
      id: `c${i}`,
      title: `第${i + 1}章`,
      text: `${filler}人物${i % 50}号登场。${filler}`,
    }))
    const t0 = performance.now()
    const idx = indexEntityChapters(matcher, chapters)
    const ms = performance.now() - t0
    expect(idx.totals.size).toBe(50)
    expect(ms).toBeLessThan(1000) // 并行跑全量测试时 CPU 争用会让它到数百 ms；O(文本×实体) 的退化是数秒级
  })
})

describe('章节序号与 chapterHint', () => {
  it('中文数字与阿拉伯数字', () => {
    expect(parseChapterNumber('十二')).toBe(12)
    expect(parseChapterNumber('二十')).toBe(20)
    expect(parseChapterNumber('一百零五')).toBe(105)
    expect(parseChapterNumber('7')).toBe(7)
    expect(parseChapterNumber('abc')).toBeNull()
    expect(extractChapterNumber('第十二章 谈判')).toBe(12)
    expect(extractChapterNumber('Chapter 3')).toBe(3)
    expect(extractChapterNumber('第７章')).toBe(7) // 全角
    expect(extractChapterNumber('01 镜像世界', true)).toBe(1)
    expect(extractChapterNumber('01 镜像世界')).toBeNull()
  })

  const chapters = [
    { id: 'c1', title: '序幕' },
    { id: 'c7', title: '第7章 野蛮人准备行动' },
    { id: 'c12', title: '第12章 第二次谈判' },
    { id: 'c13', title: '第13章 事情失去了控制' },
  ]

  it('序号命中', () => {
    expect(matchChapterHint('第十二章', chapters)).toBe('c12')
    expect(matchChapterHint('Chapter 7', chapters)).toBe('c7')
  })

  it('标题包含命中', () => {
    expect(matchChapterHint('野蛮人准备行动', chapters)).toBe('c7')
  })

  it('Dice 模糊命中，且低于阈值时返回 null 而不是乱猜', () => {
    expect(matchChapterHint('事情失去控制', chapters)).toBe('c13')
    expect(matchChapterHint('完全无关的内容描述', chapters)).toBeNull()
    expect(matchChapterHint('', chapters)).toBeNull()
    expect(matchChapterHint(undefined, chapters)).toBeNull()
  })

  it('numberOnly 不做模糊匹配', () => {
    expect(matchChapterHint('野蛮人准备行动', chapters, { numberOnly: true })).toBeNull()
  })

  it('indexEventChapters：chapterHint 优先，timeLabel 仅序号兜底', () => {
    const r = indexEventChapters(
      [
        { id: 'e1', chapterHint: '第7章' },
        { id: 'e2', timeLabel: '第 12 章' },
        { id: 'e3', timeLabel: '1988年10月' },
      ],
      chapters
    )
    expect(r.get('e1')).toBe('c7')
    expect(r.get('e2')).toBe('c12')
    expect(r.get('e3')).toBeNull()
  })
})

describe('buildEntityStyles / shapeForType', () => {
  it('类型 → 形状', () => {
    expect(shapeForType(undefined)).toBe('circle')
    expect(shapeForType('人物')).toBe('circle')
    expect(shapeForType('机构')).toBe('round-rect')
    expect(shapeForType('理论')).toBe('diamond')
  })

  const charts: BookCharts = {
    version: 1,
    entityGraph: {
      nodes: Array.from({ length: 12 }, (_, i) => ({
        id: `n${i}`,
        name: `实体${i}`,
        importance: 12 - i,
      })),
      edges: [],
    },
    entityTimeline: {
      entities: [{ id: 'n0', name: '实体0' }, { id: 't1', name: '仅时间线' }],
      events: [{ id: 'ev', label: 'x', timeLabel: 't', order: 1, entityIds: ['t1'] }],
    },
  }

  it('按重要度分配前 10 个色槽，其余中性；图谱与时间线 id 合并', () => {
    const s = buildEntityStyles(charts)
    expect(s.size).toBe(13) // 12 个节点 + 仅时间线的 t1
    expect(s.get('n0')!.slot).toBe(1)
    expect(s.get('n0')!.cssVar).toBe('var(--entity-1)')
    expect(s.get('n9')!.slot).toBe(ENTITY_SLOT_COUNT)
    expect(s.get('n11')!.slot).toBeNull()
    expect(s.get('n11')!.cssVar).toBe('var(--entity-neutral)')
  })

  it('同一输入多次计算结果一致（颜色不抖动）', () => {
    const a = [...buildEntityStyles(charts).values()].map((x) => [x.id, x.slot])
    const b = [...buildEntityStyles(charts).values()].map((x) => [x.id, x.slot])
    expect(a).toEqual(b)
  })

  it('空输入安全', () => {
    expect(buildEntityStyles(null).size).toBe(0)
    expect(buildEntityStyles({ version: 1 }).size).toBe(0)
  })
})

describe('remarkEntityMark', () => {
  const matcher = buildEntityMatcher([{ id: 'ross', name: '罗斯·约翰逊' }])
  // 与应用一致：经 react-markdown 渲染，验证 data.hName 的节点确实变成 <span>
  const renderWith = (md: string, m = matcher) =>
    renderToStaticMarkup(
      createElement(ReactMarkdown, { remarkPlugins: [[remarkEntityMark, { matcher: m }]] }, md)
    )
  const render = (md: string) => renderWith(md)

  it('包裹正文中的实体名', () => {
    expect(render('罗斯·约翰逊来了')).toContain(
      '<span class="entity-mark" data-entity-id="ross">罗斯·约翰逊</span>'
    )
  })

  it('跳过代码块与链接', () => {
    expect(render('```\n罗斯·约翰逊\n```')).not.toContain('entity-mark')
    expect(render('[罗斯·约翰逊](http://x.y)')).not.toContain('entity-mark')
  })

  describe('行内代码：整段就是实体名才标注（AI 常把 `KKR` 这类缩写写进反引号）', () => {
    const m = buildEntityMatcher([{ id: 'kkr', name: 'KKR' }, { id: 'ross', name: '罗斯·约翰逊' }])

    it('整段恰好是实体名：标注，且不再带等宽 <code>', () => {
      const html = renderWith('董事会选择了`KKR`。', m)
      expect(html).toContain('<span class="entity-mark" data-entity-id="kkr">KKR</span>')
      expect(html).not.toContain('<code>')
      expect(renderWith('`罗斯·约翰逊`', m)).toContain('data-entity-id="ross"')
    })

    it('部分匹配的真代码保持原样：不标注、仍是 <code>', () => {
      const html = renderWith('`KKR_FUND = 1`', m)
      expect(html).toContain('<code>KKR_FUND = 1</code>')
      expect(html).not.toContain('entity-mark')
    })

    it('一段代码里有两个实体（不是一个名字）：保持原样', () => {
      expect(renderWith('`KKR 罗斯·约翰逊`', m)).not.toContain('entity-mark')
    })

    it('与实体无关的行内代码不受影响', () => {
      expect(renderWith('用 `npm install`', m)).toContain('<code>npm install</code>')
    })
  })

  it('在强调内部仍然生效', () => {
    expect(render('**罗斯·约翰逊**')).toContain('entity-mark')
  })

  it('空匹配器是 no-op', () => {
    expect(renderWith('罗斯·约翰逊', buildEntityMatcher([]))).toBe('<p>罗斯·约翰逊</p>')
  })
})
