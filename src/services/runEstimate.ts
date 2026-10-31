/**
 * 开始处理前的粗略用量预估（只用于"心里有数"，不是账单）。
 *
 * 诚实边界：
 * - token 是按字符类别的经验系数估的，真实值随分词器浮动
 * - 输出量按输入的固定比例估，章节总结的实际篇幅受提示词影响
 * - 价格未知（查不到模型元数据）时不给金额，不拿别的模型顶替
 * - 不估耗时：取决于服务商速度与并发，没有可靠依据
 */
import { calculateCost } from './metadataFormatter'

/** CJK 一个字约 1 token；拉丁/数字按 4 字符 ≈ 1 token 的常见经验值再略保守取 0.3 */
const TOKENS_PER_CJK = 1.0
const TOKENS_PER_OTHER = 0.3
/** 章节总结 + 汇总 + 图表生成的输出量，约占输入的比例（偏保守的经验值） */
export const OUTPUT_RATIO = 0.18

const CJK = /[⺀-鿿豈-﫿가-힯]/g

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(CJK) ?? []).length
  return Math.round(cjk * TOKENS_PER_CJK + (text.length - cjk) * TOKENS_PER_OTHER)
}

export interface RunEstimate {
  chapters: number
  chars: number
  inputTokens: number
  outputTokens: number
  /** 价格未知时 costRMB/costUSD 为 null，界面只显示 token */
  costUSD: number | null
  costRMB: number | null
}

export function estimateRun(contents: readonly string[], model: string | undefined): RunEstimate {
  const chars = contents.reduce((n, c) => n + c.length, 0)
  const inputTokens = contents.reduce((n, c) => n + estimateTokens(c), 0)
  const outputTokens = Math.round(inputTokens * OUTPUT_RATIO)
  const cost = model ? calculateCost(model, inputTokens, outputTokens) : null
  return {
    chapters: contents.length,
    chars,
    inputTokens,
    outputTokens,
    costUSD: cost?.pricingKnown ? cost.costUSD : null,
    costRMB: cost?.pricingKnown ? cost.costRMB : null,
  }
}

/** 12_345 → "1.2 万"；<1 万保持原数 */
export function formatCount(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toFixed(1)} 万` : String(n)
}
