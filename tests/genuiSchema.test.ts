import { describe, it, expect } from 'vitest'
import { GENUI_LIMITS, parseGenUi } from '@/components/markdown/genui/schema'

const ok = (code: string) => {
  const r = parseGenUi(code)
  if (!r.ok) throw new Error(r.error)
  return r.nodes
}

describe('parseGenUi：宽容解析，坏的单项丢弃', () => {
  it('九种组件各自能解析（字段别名也认）——单块受 nodes 上限 8 约束，第九种单独校验', () => {
    const nodes = ok(
      JSON.stringify([
        { type: 'steps', title: '流程', items: [{ label: '孕育', detail: '想法' }, '婴儿'] },
        { type: 'compare', columns: ['A', 'B'], rows: [{ label: '风险', cells: ['高', '低'] }] },
        { type: 'timeline', items: [{ time: '1990', label: '创立' }] },
        { type: 'cards', items: [{ title: '甲', body: '乙', tag: '概念' }] },
        { type: 'callout', tone: 'warn', body: '注意' },
        { type: 'tabs', tabs: [{ label: '一', body: '内容一' }] },
        { type: 'quiz', question: '谁？', options: ['甲', '乙'], answer: 1 },
        { type: 'concept', items: [{ term: '边际成本', definition: '多生产一单位所增加的成本', example: '第 100 件产品的成本', contrast: '固定成本不随产量变化' }] },
      ])
    )
    const tree = ok(
      JSON.stringify({ type: 'hierarchy', items: [{ label: '成本', level: 1 }, { label: '固定成本', level: 2 }, { label: '房租', level: 3 }, { label: '可变成本', level: 2 }] })
    )
    expect([...nodes.map((n) => n.type), ...tree.map((n) => n.type)]).toEqual(['steps', 'compare', 'timeline', 'cards', 'callout', 'tabs', 'quiz', 'concept', 'hierarchy'])
    expect(nodes[0]).toMatchObject({ items: [{ label: '孕育', detail: '想法' }, { label: '婴儿' }] })
    expect(nodes[7]).toMatchObject({ items: [{ term: '边际成本', example: '第 100 件产品的成本' }] })
    expect(tree[0]).toMatchObject({ items: [{ label: '成本', level: 1 }, { label: '固定成本', level: 2 }, { label: '房租', level: 3 }, { label: '可变成本', level: 2 }] })
  })

  it('概念：字段别名与丢弃规则（term 与 definition 都非空才保留）', () => {
    const n = ok(
      JSON.stringify({
        type: 'concept',
        title: '两个常被混用的概念',
        concepts: [
          { label: '沉没成本', desc: '已经付出、无法收回的支出', ex: '已投入的研发费用', counter: '决策时应忽略' },
          { title: '机会成本', body: '为选择而放弃的次优项', negExample: '看不见但必须计入' },
          { term: '只说术语' },
          { term: '没有定义', definition: '   ' },
          { definition: '没有术语' },
        ],
      })
    )[0]
    expect(n).toMatchObject({ type: 'concept', title: '两个常被混用的概念' })
    expect(n.type === 'concept' && n.items).toEqual([
      { term: '沉没成本', definition: '已经付出、无法收回的支出', example: '已投入的研发费用', contrast: '决策时应忽略' },
      { term: '机会成本', definition: '为选择而放弃的次优项', example: undefined, contrast: '看不见但必须计入' },
    ])
    // 一条都留不下 → 整块丢弃
    expect(parseGenUi('{"type":"concept","items":[{"term":"甲"}]}')).toEqual({ ok: false, error: '没有可渲染的组件' })
  })

  it('层级：level 只认整数，非整数 / 缺失当 1，超出范围夹到 1..4；label 为空丢弃', () => {
    const n = ok(
      JSON.stringify({
        type: 'hierarchy',
        nodes: [
          { title: '成本', level: 0 },
          { label: '固定成本', depth: 9 },
          { label: '房租' },
          { label: '可变成本', level: 2.5 },
          { label: '人工', level: '3' },
          { label: '无标签 1' },
          { label: '  ' },
        ],
      })
    )[0]
    expect(n.type === 'hierarchy' && n.items.map((i) => [i.label, i.level])).toEqual([
      ['成本', 1],
      ['固定成本', 4],
      ['房租', 1],
      ['可变成本', 1],
      ['人工', 1],
      ['无标签 1', 1],
    ])
    expect(ok('{"type":"hierarchy","tree":[{"label":"甲","detail":"乙","level":3}]}')[0]).toMatchObject({ items: [{ label: '甲', detail: '乙', level: 3 }] })
    expect(parseGenUi('{"type":"hierarchy","items":[]}')).toEqual({ ok: false, error: '没有可渲染的组件' })
  })

  it('三种顶层写法：单个节点 / 数组 / {blocks:[…]}', () => {
    expect(ok('{"type":"callout","body":"x"}')).toHaveLength(1)
    expect(ok('[{"type":"callout","body":"x"},{"type":"callout","body":"y"}]')).toHaveLength(2)
    expect(ok('{"blocks":[{"type":"callout","body":"x"}]}')).toHaveLength(1)
  })

  it('模型常见的小毛病：尾逗号、行注释 → 宽容读取', () => {
    expect(ok('// 说明\n{"type":"callout","body":"x",}')).toHaveLength(1)
    expect(ok('{"type":"steps","items":[{"label":"甲"},{"label":"乙"},]}')[0]).toMatchObject({ items: [{ label: '甲' }, { label: '乙' }] })
  })

  it('一个坏节点不毁掉整块：其余仍渲染；全都读不出来才报错', () => {
    const nodes = ok('[{"type":"nope"},{"type":"callout","body":"好的"},{"type":"steps","items":[]}]')
    expect(nodes).toHaveLength(1)
    expect(parseGenUi('[{"type":"nope"}]')).toEqual({ ok: false, error: '没有可渲染的组件' })
    expect(parseGenUi('不是 JSON')).toEqual({ ok: false, error: 'JSON 无法解析' })
    expect(parseGenUi('')).toMatchObject({ ok: false })
  })

  it('测验：答案必须落在选项里，否则整题丢弃（无法判分）；选项少于 2 个也丢弃', () => {
    expect(parseGenUi('{"type":"quiz","question":"q","options":["a","b"],"answer":2}')).toMatchObject({ ok: false })
    expect(parseGenUi('{"type":"quiz","question":"q","options":["a"],"answer":0}')).toMatchObject({ ok: false })
    expect(parseGenUi('{"type":"quiz","question":"q","options":["a","b"],"answer":"0"}')).toMatchObject({ ok: true }) // 数字字符串宽容
    expect(parseGenUi('{"type":"quiz","question":"q","options":["a","b"],"answer":1.5}')).toMatchObject({ ok: false })
  })

  it('对比表：单元格多于列数的截断；缺列不报错；没有列 / 没有行 → 丢弃', () => {
    const n = ok('{"type":"compare","columns":["A","B"],"rows":[{"label":"r","cells":["1","2","3"]},{"label":"s","cells":["1"]}]}')[0]
    expect(n).toMatchObject({ rows: [{ cells: ['1', '2'] }, { cells: ['1'] }] })
    expect(parseGenUi('{"type":"compare","columns":[],"rows":[{"label":"r","cells":[]}]}')).toMatchObject({ ok: false })
  })

  it('限长限量：文本、条目数、节点数都有上限；控制字符被清除；HTML 当纯文本保留（渲染时自动转义）', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ label: `步${i}` }))
    const n = ok(JSON.stringify({ type: 'steps', items: many }))[0]
    expect(n.type === 'steps' && n.items).toHaveLength(GENUI_LIMITS.items)
    const long = ok(JSON.stringify({ type: 'callout', body: 'x'.repeat(5000) }))[0]
    expect(long.type === 'callout' && long.body.length).toBe(GENUI_LIMITS.text)
    const dirty = ok(JSON.stringify({ type: 'callout', body: 'a\u0000b\u0007c<script>alert(1)</script>' }))[0]
    expect(dirty.type === 'callout' && dirty.body).toBe('abc<script>alert(1)</script>') // 不做 HTML 处理：React 渲染文本时转义
    const nodes = ok(JSON.stringify(Array.from({ length: 20 }, () => ({ type: 'callout', body: 'x' }))))
    expect(nodes).toHaveLength(GENUI_LIMITS.nodes)
  })

  it('未知字段 / 原型污染式键名被忽略；type 大小写不敏感', () => {
    const nodes = ok('{"type":"CALLOUT","body":"x","__proto__":{"polluted":1},"constructor":"y"}')
    expect(nodes[0]).toEqual({ type: 'callout', tone: 'info', title: undefined, body: 'x' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
