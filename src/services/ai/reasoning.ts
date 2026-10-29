/**
 * 思考强度 → 各协议请求参数。
 *
 * 实测（2026-10）：
 * - MiniMax-M3.1-Flash：reasoning_effort=low 时推理 token 从 26 降到 0；不能完全关闭（thinking.disabled 报 400）
 * - 智谱 glm-5.3：reasoning_effort=low 推理 token 41 → 6
 * - Kiro（Anthropic 协议）：thinking.budget_tokens 生效
 * 不认识该参数的服务商会报 400 → 调用方去掉参数重试一次（见 isUnsupportedParamError）。
 */
import type { ReasoningEffort } from '../../types/ai'

/** OpenAI 兼容：reasoning_effort。off 用 minimal（OpenAI 的最低档；大多数网关也接受 low 以下的值） */
export function openAIReasoningParams(effort: ReasoningEffort | undefined): Record<string, unknown> {
  switch (effort) {
    case 'off':
      return { reasoning_effort: 'minimal' }
    case 'low':
    case 'medium':
    case 'high':
      return { reasoning_effort: effort }
    default:
      return {}
  }
}

/** Anthropic：显式开启 thinking 并给预算；off/auto 不发（默认就是不思考） */
const ANTHROPIC_BUDGET: Partial<Record<ReasoningEffort, number>> = { low: 1024, medium: 4096, high: 12000 }
export function anthropicReasoningParams(
  effort: ReasoningEffort | undefined,
  maxTokens: number
): { params: Record<string, unknown>; maxTokens: number } {
  const budget = effort ? ANTHROPIC_BUDGET[effort] : undefined
  if (!budget) return { params: {}, maxTokens }
  // Anthropic 要求 max_tokens > budget_tokens，且开启 thinking 时 temperature 只能为 1
  return {
    params: { thinking: { type: 'enabled', budget_tokens: budget } },
    maxTokens: Math.max(maxTokens, budget + 2048),
  }
}

/** Gemini：generationConfig.thinkingConfig.thinkingBudget（0=关闭，-1=动态） */
const GEMINI_BUDGET: Partial<Record<ReasoningEffort, number>> = { off: 0, low: 1024, medium: 8192, high: 24576 }
export function geminiReasoningParams(effort: ReasoningEffort | undefined): Record<string, unknown> {
  const budget = effort ? GEMINI_BUDGET[effort] : undefined
  return budget === undefined ? {} : { thinkingConfig: { thinkingBudget: budget } }
}

/** 上游是否因为「不认识/不支持该参数」而拒绝（400/422 且正文提到相关字段） */
export function isUnsupportedParamError(status: number | undefined, body: string | undefined): boolean {
  if (status !== 400 && status !== 422) return false
  return /reasoning|thinking|unsupported|unknown|unrecognized|not support|invalid param|extra.*not permitted/i.test(body ?? '')
}
