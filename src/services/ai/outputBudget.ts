/**
 * 单次请求的输出 token 上限：按模型元数据（models.dev / OpenRouter / 网关目录的 limit.output）自动取最大值。
 *
 * 为什么要显式给满：推理模型的「思考」也算输出 token。不传或传小了，长章节会把预算全花在思考上，
 * 返回空内容（实测 MiniMax-M3.1-Flash 对 4.8 万字单章：reasoning=4095/4096、content 为空）。
 *
 * 与 CLI `src/cli/ai_client.py: resolve_max_output_tokens` 同语义。
 */

/** 输入 + 输出不能超过上下文窗口：给提示词估算之外再留的余量 */
const CONTEXT_SAFETY_MARGIN = 1024
/** 上下文很紧时的保底输出预算 */
const MIN_OUTPUT_TOKENS = 1024

/**
 * 粗估提示词 token 数：按字符数算（中文约 1 字 ≈ 0.6–1 token，英文约 4 字符 ≈ 1 token），
 * 宁可高估——高估只会让预算略保守，低估会让请求因超出上下文被拒。
 */
export function estimatePromptTokens(...parts: Array<string | undefined>): number {
  return parts.reduce((sum, p) => sum + (p?.length ?? 0), 0)
}

/**
 * @param outputLimit 模型最大输出 token（未知则返回 undefined，由调用方决定是否省略参数）
 * @param contextWindow 模型上下文窗口（未知则不做上下文截断）
 * @param promptTokens 估算的输入 token 数
 */
export function resolveMaxOutputTokens(
  outputLimit: number | undefined,
  contextWindow: number | undefined,
  promptTokens: number
): number | undefined {
  if (!outputLimit || outputLimit <= 0) return undefined
  let budget = Math.floor(outputLimit)
  if (contextWindow && contextWindow > 0) {
    const room = Math.floor(contextWindow - promptTokens - CONTEXT_SAFETY_MARGIN)
    if (room < budget) budget = Math.max(room, MIN_OUTPUT_TOKENS)
  }
  return budget
}

/**
 * 元数据可能略高于服务商的真实上限（实测 SenseNova deepseek-v4-flash：目录 393216，实际上限 384000）。
 * 从「超出范围」的报错里读出真实上限：取报错中小于当前值的最大数字。读不出返回 undefined。
 * 已覆盖的报错形态：`should be in [1, 384000]`、`does not support max tokens > 524288`、`<= 8192`。
 */
export function parseMaxTokensCap(body: string | undefined, current: number): number | undefined {
  if (!body || !/max.?tokens|max_completion_tokens|maxOutputTokens/i.test(body)) return undefined
  const nums = (body.match(/\d{3,}/g) ?? []).map(Number).filter((n) => n >= MIN_OUTPUT_TOKENS && n < current)
  return nums.length ? Math.max(...nums) : undefined
}

/**
 * OpenAI 官方的推理模型（o 系列 / gpt-5）拒绝 max_tokens，要求 max_completion_tokens；
 * 大多数 OpenAI 兼容网关则只认 max_tokens。按报错切换参数名。
 */
export function isMaxTokensParamError(status: number | undefined, body: string | undefined): boolean {
  if (status !== 400 && status !== 422) return false
  return /max_completion_tokens|max_tokens/i.test(body ?? '')
}
