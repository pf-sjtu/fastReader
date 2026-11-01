/** 书级步骤 map-reduce：关联分析 / 全书总结在摘要总长超出预算时分组再合并，而不是把每章砍短 */
import { describe, it, expect } from 'vitest'
import { AIService } from '../src/services/ai/aiService'
import { groupChaptersByChars } from '../src/services/ai/promptInputs'
import type { AIProviderConfig } from '../src/stores/types'

const cfg = { id: 1, name: 't', provider: 'openai', apiKey: 'k', apiUrl: 'https://x.example/v1', model: 'm', customFields: {} } as unknown as AIProviderConfig

function svc(limit: number) {
  const prompts: string[] = []
  const s = new AIService(cfg)
  const priv = s as unknown as { postProcessLimits: () => unknown; generateContent: (p: string) => Promise<string> }
  priv.postProcessLimits = () => ({ chapters: limit, connections: 1000 })
  priv.generateContent = async (p: string) => {
    prompts.push(p)
    return `结论${prompts.length}`
  }
  return { s, prompts }
}

const chapters = (n: number, len = 40) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `章${i + 1}`, content: '', summary: `${'甲'.repeat(len - 3)}#${i + 1}`.padEnd(len, '。'), processed: true }))

describe('groupChaptersByChars', () => {
  it('按顺序贪心装组、每组不超限；单章超限独占一组；总长不超限只有一组', () => {
    const cs = chapters(6)
    expect(groupChaptersByChars(cs, 100).map((g) => g.length)).toEqual([2, 2, 2])
    expect(groupChaptersByChars(cs, 10_000)).toHaveLength(1)
    expect(groupChaptersByChars([{ summary: 'x'.repeat(500) }, { summary: 'y' }], 100).map((g) => g.length)).toEqual([1, 1])
    expect(groupChaptersByChars([], 100)).toEqual([])
    expect(groupChaptersByChars(cs, 100).flat()).toEqual(cs) // 不丢章、不乱序
  })
})

describe('map-reduce', () => {
  it('关联分析：未超预算 → 一次调用；超预算 → 每组一次 + 合并一次，合并输入是各组结论', async () => {
    const small = svc(100_000)
    await small.s.analyzeConnections(chapters(6))
    expect(small.prompts).toHaveLength(1)

    const big = svc(100)
    const out = await big.s.analyzeConnections(chapters(6))
    expect(big.prompts).toHaveLength(4)
    expect(out).toBe('结论4')
    // 前三次各只看到本组的章节，最后一次只看到分组结论
    expect(big.prompts[0]).toContain('#1')
    expect(big.prompts[0]).not.toContain('#3')
    expect(big.prompts[3]).toContain('结论1')
    expect(big.prompts[3]).toContain('结论3')
    expect(big.prompts[3]).not.toContain('甲甲甲')
  })

  it('全书总结：超预算时先分段总结（不带关联），最后用分段总结 + 关联分析合并', async () => {
    const big = svc(100)
    await big.s.generateOverallSummary('某书', chapters(6), '关联文本XYZ')
    expect(big.prompts).toHaveLength(4)
    expect(big.prompts.slice(0, 3).every((p) => !p.includes('关联文本XYZ'))).toBe(true)
    expect(big.prompts[3]).toContain('关联文本XYZ')
    expect(big.prompts[3]).toContain('结论2')
  })

  it('章节不足 / 为空的边界保持原行为；单章组直接沿用该章摘要', async () => {
    const { s, prompts } = svc(100)
    expect(await s.analyzeConnections(chapters(1))).toContain('章节数量不足')
    expect(await s.generateOverallSummary('书', [], '')).toContain('没有可用的章节摘要')
    expect(prompts).toHaveLength(0)
    // 3 章各 60 字、预算 100 → 每章独占一组：单章组不调 AI，只有最终合并 1 次
    await s.analyzeConnections(chapters(3, 60))
    expect(prompts).toHaveLength(1)
  })
})
