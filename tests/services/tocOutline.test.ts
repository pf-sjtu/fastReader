import { describe, expect, it, vi } from 'vitest'
import type { NavItem } from '@ssshooter/epubjs'
import {
  buildOutlineTree,
  classifyLabel,
  inferOutline,
  isBoundaryNode,
  isFlatToc,
  normalizeLlmLevels,
  refineWithLlm,
  validateLevels,
  LLM_BATCH,
} from '@/services/epub/tocOutline'

const nav = (labels: string[]): NavItem[] =>
  labels.map((label, i) => ({ id: `n${i}`, href: `text.html#a${i}`, label }) as NavItem)

/** 《大国大城》形态：2 个「篇」+ 若干「第N章」+ 大量「N.标题」小节 */
function bigCityLabels(): string[] {
  const out: string[] = ['上篇 大国难题']
  for (let c = 1; c <= 3; c++) {
    out.push(`第${'一二三'[c - 1]}章 章标题${c}`)
    for (let s = 1; s <= 4; s++) out.push(`${s}.小节标题${c}-${s}`)
  }
  out.push('下篇 大国策略')
  for (let c = 4; c <= 5; c++) {
    out.push(`第${'四五'[c - 4]}章 章标题${c}`)
    for (let s = 1; s <= 4; s++) out.push(`${s}.小节标题${c}-${s}`)
  }
  return out
}

describe('classifyLabel', () => {
  it.each([
    ['上篇 大国难题', 'part'],
    ['第二部分 个人资本', 'part'],
    ['Part II', 'part'],
    ['第一章 行动人', 'chapter'],
    ['第1章总论', 'chapter'],
    ['Chapter 3 Markets', 'chapter'],
    ['第一篇 第二章 货币', 'chapter'], // 篇号只是前缀
    ['第三节 价格', 'jie'],
    ['1.欧洲正经历大考', 'bare'],
    ['2． 人的行动的先决条件', 'bare'], // 全角点
    ['3 战略互动', 'bare'],
    ['2.世界不是平的', 'bare'], // 带点号的明确序号，不能被「世纪」式排除误伤
    ['20 世纪的经济', 'other'], // 仅空白分隔的数量 / 世纪不是序号
    ['1.1 方法论', 'dec2'],
    ['1.6.1 子问题', 'dec3'],
    ['一、绪论', 'cnOrd'],
    ['（二）数据', 'paren'],
    ['II. 本书目的', 'roman'],
    ['论快乐', 'other'],
    ['1978年的改革', 'other'], // 年份不是序号
    ['', 'other'],
  ])('%s → %s', (label, kind) => {
    expect(classifyLabel(label)).toBe(kind)
  })

  it('忽略行首装饰符', () => {
    expect(classifyLabel('︱第一章 行动人')).toBe('chapter')
  })
})

describe('inferOutline', () => {
  it('大国大城形态：篇=0、章=1、节=2，确定无需 LLM', () => {
    const labels = bigCityLabels()
    const r = inferOutline(labels)
    expect(r.confident).toBe(true)
    expect(r.llmCandidate).toBe(false)
    expect(r.levels).not.toBeNull()
    expect(r.levels![0]).toBe(0)
    expect(r.levels![1]).toBe(1)
    expect(r.levels![2]).toBe(2)
    expect(r.levels![labels.indexOf('下篇 大国策略')]).toBe(0)
  })

  it('前言 / 后记等无编号首尾条目与章并列', () => {
    const labels = ['前言', ...bigCityLabels(), '后记']
    const r = inferOutline(labels)
    expect(r.levels![0]).toBe(1)
    expect(r.levels![labels.length - 1]).toBe(1)
  })

  it('只有一种编号且干净（纯「第N章」目录）：保持扁平', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `第${i + 1}章 标题${i}`)
    const r = inferOutline(labels)
    expect(r.levels).toBeNull()
    expect(r.llmCandidate).toBe(false)
  })

  it('几个章标题 + 大量无编号小标题：算法拿不准，交给 LLM 且不单独应用', () => {
    const labels: string[] = []
    for (let c = 1; c <= 4; c++) {
      labels.push(`第${c}章 章${c}`)
      for (let s = 0; s < 8; s++) labels.push(`无编号小标题${c}-${s}`)
    }
    const r = inferOutline(labels)
    expect(r.confident).toBe(false)
    expect(r.llmCandidate).toBe(true)
    expect(r.applyWithoutLlm).toBe(false)
  })

  it('完全无编号：长目录才值得问 LLM', () => {
    const short = inferOutline(Array.from({ length: 12 }, (_, i) => `文章${i}`))
    expect(short.levels).toBeNull()
    expect(short.llmCandidate).toBe(false)
    const long = inferOutline(Array.from({ length: 40 }, (_, i) => `文章${i}`))
    expect(long.llmCandidate).toBe(true)
  })

  it('零星出现的编号种类不参与定级', () => {
    const labels = Array.from({ length: 40 }, (_, i) => `第${i + 1}章 标题`)
    labels[10] = '1.偶然一条'
    const r = inferOutline(labels)
    expect(r.levels).toBeNull()
  })
})

describe('normalizeLlmLevels / validateLevels', () => {
  it('覆盖率不足 90% 视为不合格', () => {
    const answers = Array.from({ length: 5 }, (_, i) => ({ id: i, level: 1 }))
    expect(normalizeLlmLevels(answers, 20)).toBeNull()
  })

  it('缺失条目沿用前一条；非法层级被丢弃', () => {
    const answers = [
      { id: 0, level: 1 },
      { id: 1, level: 2 },
      { id: 2, level: 1 },
      { id: 3, level: 2 },
      { id: 4, level: 99 }, // 非法 → 视为缺失 → 沿用上一条
      { id: 5, level: 1 },
      { id: 6, level: 2 },
      { id: 7, level: 1 },
      { id: 8, level: 2 },
      { id: 9, level: 2 },
    ]
    const r = normalizeLlmLevels(answers, 10)
    expect(r).toEqual([1, 2, 1, 2, 2, 1, 2, 1, 2, 2])
  })

  it('至少 2 个章级且有层级差', () => {
    expect(validateLevels([1, 1, 1])).toBe(false)
    expect(validateLevels([1, 2, 2])).toBe(false)
    expect(validateLevels([1, 2, 1, 2])).toBe(true)
  })
})

describe('buildOutlineTree', () => {
  it('篇成为根上的边界节点，章下挂节，href 原样保留', () => {
    const labels = bigCityLabels()
    const toc = nav(labels)
    const levels = inferOutline(labels).levels!
    const tree = buildOutlineTree(toc, levels)!
    expect(tree).not.toBeNull()

    const parts = tree.filter(isBoundaryNode)
    expect(parts.map((p) => p.label)).toEqual(['上篇 大国难题', '下篇 大国策略'])
    const chapters = tree.filter((n) => !isBoundaryNode(n))
    expect(chapters).toHaveLength(5)
    expect(chapters.every((c) => c.subitems!.length === 4)).toBe(true)
    // 回挂的是原目录项的 href，而不是改写过的
    expect(chapters[0].href).toBe(toc[1].href)
    expect(chapters[0].subitems![0].href).toBe(toc[2].href)
    // 不污染原数组
    expect(toc[1].subitems).toBeUndefined()
  })

  it('层级数组与目录长度不一致 / 章级不足 → null', () => {
    const toc = nav(['a', 'b', 'c'])
    expect(buildOutlineTree(toc, [1, 2])).toBeNull()
    expect(buildOutlineTree(toc, [1, 2, 2])).toBeNull()
  })
})

describe('isFlatToc', () => {
  it('够多且无嵌套才算扁平', () => {
    expect(isFlatToc(nav(Array.from({ length: 9 }, (_, i) => `x${i}`)))).toBe(false)
    expect(isFlatToc(nav(Array.from({ length: 10 }, (_, i) => `x${i}`)))).toBe(true)
    const nested = nav(Array.from({ length: 10 }, (_, i) => `x${i}`))
    nested[3].subitems = nav(['y'])
    expect(isFlatToc(nested)).toBe(false)
  })
})

describe('refineWithLlm', () => {
  it('按批请求并合并，后一批带前一批末尾作上下文', async () => {
    const n = LLM_BATCH + 30
    const labels = Array.from({ length: n }, (_, i) => (i % 5 === 0 ? `章${i}` : `节${i}`))
    const ask = vi.fn(async (entries: { id: number; label: string }[]) =>
      entries.map((e) => ({ id: e.id, level: e.id % 5 === 0 ? 1 : 2 }))
    )
    const levels = await refineWithLlm(labels, ask)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[0][1]).toEqual([]) // 第一批没有上文
    const secondPrior = ask.mock.calls[1][1] as { id: number; level: number }[]
    expect(secondPrior.length).toBeGreaterThan(0)
    expect(secondPrior[secondPrior.length - 1].id).toBe(LLM_BATCH - 1)
    expect(levels).toHaveLength(n)
    expect(levels![0]).toBe(1)
    expect(levels![1]).toBe(2)
  })

  it('结果不合格（全是同一级）→ null', async () => {
    const labels = Array.from({ length: 12 }, (_, i) => `x${i}`)
    const levels = await refineWithLlm(labels, async (entries) => entries.map((e) => ({ id: e.id, level: 1 })))
    expect(levels).toBeNull()
  })

  it('模型什么都没返回 → null', async () => {
    const labels = Array.from({ length: 12 }, (_, i) => `x${i}`)
    expect(await refineWithLlm(labels, async () => [])).toBeNull()
  })

  it('已取消的信号抛 AbortError', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(refineWithLlm(['a', 'b'], async () => [], ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
