import { describe, it, expect, afterEach } from 'vitest'
import { estimateRun, estimateTokens, formatCount, OUTPUT_RATIO } from '@/services/runEstimate'
import { setPricingProvider } from '@/services/metadataFormatter'

afterEach(() => setPricingProvider(() => null))

describe('estimateTokens', () => {
  it('中文按字、拉丁按更低系数；空串为 0', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('abcdefghij')).toBe(3) // 10 × 0.3
    expect(estimateTokens('你好 abc')).toBe(Math.round(2 + 4 * 0.3))
  })
})

describe('estimateRun', () => {
  it('汇总字数/章数；输出按比例估', () => {
    const e = estimateRun(['一二三四五', '六七八'], undefined)
    expect(e).toMatchObject({ chapters: 2, chars: 8, inputTokens: 8, outputTokens: Math.round(8 * OUTPUT_RATIO) })
  })

  it('价格未知：不给金额（null），而不是 0 或别的模型的价格', () => {
    const e = estimateRun(['你好'.repeat(1000)], 'some-unknown-model')
    expect(e.costRMB).toBeNull()
    expect(e.costUSD).toBeNull()
  })

  it('价格已知：按 input/output 分别计价', () => {
    setPricingProvider((m) => (m === 'm1' ? { input: 1, output: 4 } : null)) // $/百万 token
    const e = estimateRun(['字'.repeat(1_000_000)], 'm1')
    // 输入 100 万 token → $1；输出 18 万 token → $0.72
    expect(e.costUSD).toBeCloseTo(1.72, 4)
    expect(e.costRMB).toBeGreaterThan(e.costUSD!)
  })

  it('没选章节/没有模型：全 0 且不报错', () => {
    expect(estimateRun([], 'm1')).toMatchObject({ chapters: 0, chars: 0, inputTokens: 0, outputTokens: 0 })
    expect(estimateRun(['abc'], undefined).costRMB).toBeNull()
  })
})

describe('formatCount', () => {
  it('万为单位', () => {
    expect(formatCount(9999)).toBe('9999')
    expect(formatCount(12_345)).toBe('1.2 万')
  })
})
