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
 * 字符 → token 的保守系数。中文多数分词器约 0.6–1 token/字，但 CJK 生僻字、emoji、
 * Claude / 字节级 BPE 可能 >1 token/字；按 1.25 估算，宁可让预算略保守也不让请求超窗被拒。
 */
const TOKENS_PER_CHAR = 1.25
/**
 * 请求输出上限的「不预占」封顶：服务商（OpenAI / Anthropic / OpenRouter）按 max_tokens 预扣限速与额度，
 * 每个小章节都按模型最大值（如 524288）申请会频繁 429 / 402。短提示封顶 32768，长提示放宽到输入的 4 倍。
 */
const OUTPUT_SOFT_CAP = 32768
const OUTPUT_PER_INPUT = 4

/** 粗估提示词 token 数（按 TOKENS_PER_CHAR 保守系数，宁可高估） */
export function estimatePromptTokens(...parts: Array<string | undefined>): number {
  return Math.ceil(parts.reduce((sum, p) => sum + (p?.length ?? 0), 0) * TOKENS_PER_CHAR)
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
  // 推理模型的思考随输入增长：给到输入的 4 倍（至少 32768），但不按模型最大值预占
  let budget = Math.min(Math.floor(outputLimit), Math.max(OUTPUT_SOFT_CAP, promptTokens * OUTPUT_PER_INPUT))
  if (contextWindow && contextWindow > 0) {
    const room = Math.floor(contextWindow - promptTokens - CONTEXT_SAFETY_MARGIN)
    if (room < budget) budget = Math.max(room, MIN_OUTPUT_TOKENS)
  }
  return budget
}

/**
 * 元数据可能略高于服务商的真实上限（实测 SenseNova deepseek-v4-flash：目录 393216，实际上限 384000）。
 * 只从明确表达「上限」的句式里读数字，读不出返回 undefined（不猜：报错里的日期、输入 token 数等都不是上限）。
 * 已覆盖：`should be in [1, 384000]`、`does not support max tokens > 524288`、`must be <= 8192`、
 * `128000 > 64000, which is the maximum allowed`（Anthropic）。
 */
const CAP_PATTERNS = [
  /should be in \[\s*\d+\s*,\s*(\d+)\s*\]/i,
  /max(?:imum)?[ _]?tokens?\s*>\s*(\d+)/i,
  /(?:<=|≤|less than or equal to|at most|maximum of|up to)\s*(\d+)/i,
  /\d+\s*>\s*(\d+),?\s*which is the maximum/i,
]
export function parseMaxTokensCap(body: string | undefined, current: number): number | undefined {
  if (!body || !/max.?tokens|max_completion_tokens|maxOutputTokens|output tokens/i.test(body)) return undefined
  for (const re of CAP_PATTERNS) {
    const n = Number(body.match(re)?.[1])
    if (n >= MIN_OUTPUT_TOKENS && n < current) return n
  }
  return undefined
}

/** 读不出上限时的退避系数：每次报错把输出上限降到 0.8 倍 */
export const OUTPUT_CAP_BACKOFF = 0.8
/**
 * 单次请求内最多调整输出上限的次数（读报错上限与 0.8 倍退避合计）。
 * 3 次后仍报同类错误即按失败处理，且本次试探的上限不存档——只有降级后真正成功的值才会写入共享状态。
 */
export const MAX_CAP_BACKOFFS = 3

/**
 * 「输出上限太大」但报错里没有可信上限数字（如 `max_tokens is too large`、
 * `Requested token count exceeds the model's maximum context length`）。只认明确指向输出上限 / 上下文长度的表述，
 * 认证、限流、内容审核等其它 400 不算——否则会把上限无谓地一路缩小。
 */
export function isOutputLimitError(status: number | undefined, body: string | undefined): boolean {
  if (status !== 400 && status !== 422) return false
  const text = body ?? ''
  const aboutOutput = /max.?tokens|max_completion_tokens|maxOutputTokens|max_output_tokens|output tokens/i.test(text)
  const tooLarge = /too large|too many|exceed|greater than|larger than|out of range|must be (?:less|<=)|invalid|maximum/i.test(text)
  const contextOverflow = /(?:maximum|max) context length|context.{0,20}(?:exceed|too long|overflow)|context_length_exceeded/i.test(text)
  return (aboutOutput && tooLarge) || contextOverflow
}

/**
 * 输出上限被拒后的下一个尝试值：报错里有可信上限就用它；否则若确属输出上限 / 上下文超限，按 0.8 倍退避。
 * 不是这类报错、或已退到保底 1024，返回 undefined（由调用方按普通失败处理）。
 */
export function nextOutputCap(status: number | undefined, body: string | undefined, current: number): number | undefined {
  const parsed = parseMaxTokensCap(body, current)
  if (parsed) return parsed
  if (!isOutputLimitError(status, body)) return undefined
  const backedOff = Math.floor(current * OUTPUT_CAP_BACKOFF)
  return backedOff >= MIN_OUTPUT_TOKENS && backedOff < current ? backedOff : undefined
}

/**
 * OpenAI 官方的推理模型（o 系列 / gpt-5）拒绝 max_tokens，要求 max_completion_tokens；
 * 大多数 OpenAI 兼容网关则只认 max_tokens。按报错切换参数名。
 */
export function isMaxTokensParamError(status: number | undefined, body: string | undefined): boolean {
  if (status !== 400 && status !== 422) return false
  // 只认「参数名不被接受」，不认「数值太大 / 超上下文」（那类由 parseMaxTokensCap 或上层失败处理）
  return /max_completion_tokens/i.test(body ?? '') && /unsupported|not supported|use '?max_completion_tokens/i.test(body ?? '')
}

// ---- 运行中学到的服务商参数怪癖：按「服务商 + 模型」记住，整个会话内复用 ----
//
// AIService 每次请求都新建 provider 实例，实例字段记不住；放模块级表里，
// 一次 400 之后同一模型的后续章节 / 分段 / 合并请求直接用正确参数，不再每次多花一个往返。

export interface LearnedParams {
  /** 服务商真实输出上限（从「超出范围」报错读出） */
  outputCap?: number
  /** 输出上限参数名：OpenAI 推理模型要 max_completion_tokens；null = 不发 */
  tokenParam?: 'max_tokens' | 'max_completion_tokens' | null
  noTemperature?: boolean
  noReasoning?: boolean
  /** 不接受 json_schema：只能用「合法 JSON」模式 */
  noJsonSchema?: boolean
  /** 连 JSON 模式也不接受：不带任何格式参数 */
  noStructured?: boolean
}
const learned = new Map<string, LearnedParams>()
export function learnedParamsKey(providerId: string | undefined, apiUrl: string | undefined, model: string): string {
  return `${providerId || apiUrl || ''}|${model}`
}
export function getLearnedParams(key: string): LearnedParams {
  return learned.get(key) ?? {}
}

const TOKEN_PARAM_RANK = { max_tokens: 0, max_completion_tokens: 1, none: 2 } as const
const rankOf = (p: LearnedParams['tokenParam']) => (p === undefined ? -1 : TOKEN_PARAM_RANK[p ?? 'none'])

/**
 * 单调合并（与服务端 functions/api/state 的 mergeQuirks 同规则）：上限只降不升、旗标只开不关、
 * 参数名只往更保守方向变。返回合并后是否有变化（有变化才上报后端）。
 */
function mergeLearned(key: string, patch: LearnedParams): boolean {
  const prev = learned.get(key) ?? {}
  const next: LearnedParams = { ...prev }
  if (patch.outputCap && patch.outputCap > 0) {
    next.outputCap = prev.outputCap ? Math.min(prev.outputCap, patch.outputCap) : patch.outputCap
  }
  if (patch.tokenParam !== undefined && rankOf(patch.tokenParam) > rankOf(prev.tokenParam)) next.tokenParam = patch.tokenParam
  if (patch.noTemperature) next.noTemperature = true
  if (patch.noReasoning) next.noReasoning = true
  if (patch.noJsonSchema) next.noJsonSchema = true
  if (patch.noStructured) next.noStructured = true
  const changed =
    next.outputCap !== prev.outputCap ||
    next.tokenParam !== prev.tokenParam ||
    next.noTemperature !== prev.noTemperature ||
    next.noReasoning !== prev.noReasoning ||
    next.noJsonSchema !== prev.noJsonSchema ||
    next.noStructured !== prev.noStructured
  if (changed) learned.set(key, next)
  return changed
}

/** 学到新参数时的上报钩子（由 stores 层注入共享状态的 append，避免 services → stores 循环依赖） */
let persister: ((entries: Record<string, LearnedParams>) => void) | undefined
export function setLearnedParamsPersister(fn: typeof persister): void {
  persister = fn
}

/** 运行中学到一条：合并进本地表；有变化则上报后端，所有用户与 CLI 下次启动即生效 */
export function rememberParams(key: string, patch: LearnedParams): void {
  if (mergeLearned(key, patch)) persister?.({ [key]: patch })
}

/** 启动 / 同步时导入后端存档（只合并，不回报） */
export function loadLearnedParams(entries: Record<string, LearnedParams> | undefined): void {
  if (!entries || typeof entries !== 'object') return
  for (const [key, value] of Object.entries(entries)) {
    if (value && typeof value === 'object') mergeLearned(key, value)
  }
}

/** 测试用：清空学习表 */
export function resetLearnedParams(): void {
  learned.clear()
}

// ---- 输入预算：按模型上下文窗口自动计算（与 CLI src/cli/model_budget.py 同语义，契约见 tests/fixtures/model-budget-cases.json）----

/** 元数据缺失时为输出预留的 token */
const DEFAULT_OUTPUT_RESERVE = 8192
/** 提示词模板、系统提示与估算误差的余量 */
const PROMPT_OVERHEAD = 2048
/** 输入预算保底（字符） */
const MIN_INPUT_CHARS = 2000
/** 后处理历史默认上限（无上下文元数据时沿用） */
export const DEFAULT_POST_PROCESS_LIMITS = { chapters: 200_000, connections: 50_000 }

/**
 * 单次请求可放入的正文字符数（按 1 字 ≈ 1 token 保守估计）。无上下文元数据返回 undefined（不限制）。
 * 输出预留 = min(模型最大输出, 上下文/4)：大输出模型（如 1M 窗口 / 524K 输出）不至于把输入挤没。
 */
export function resolveInputBudget(contextWindow: number | undefined, outputLimit: number | undefined): number | undefined {
  if (!contextWindow || contextWindow <= 0) return undefined
  const reserve = Math.min(outputLimit && outputLimit > 0 ? outputLimit : DEFAULT_OUTPUT_RESERVE, Math.floor(contextWindow / 4))
  return Math.max(Math.floor((contextWindow - reserve - PROMPT_OVERHEAD) / TOKENS_PER_CHAR), MIN_INPUT_CHARS)
}

/** 后处理（关联分析 / 全书总结）的压缩上限：预算按 3:1 分给章节摘要与关联分析，且不超过历史默认 */
export function resolvePostProcessLimits(
  contextWindow: number | undefined,
  outputLimit: number | undefined
): { chapters: number; connections: number } {
  const budget = resolveInputBudget(contextWindow, outputLimit)
  if (!budget) return { ...DEFAULT_POST_PROCESS_LIMITS }
  const connections = Math.floor(budget / 4)
  return {
    chapters: Math.min(DEFAULT_POST_PROCESS_LIMITS.chapters, budget - connections),
    connections: Math.min(DEFAULT_POST_PROCESS_LIMITS.connections, connections),
  }
}

/**
 * 把超长正文切成不超过 budget 字符的若干段：优先在空行（段落）处切，单段过长再按句末标点切，
 * 仍过长才硬切。段内顺序与内容不丢失（各段拼接后等于原文去掉切分处的分隔符）。
 */
export function splitByBudget(text: string, budget: number): string[] {
  if (text.length <= budget) return [text]
  // 切成带「前置分隔符」的片段：段落之间是空行，同段内的句子 / 硬切块之间无分隔
  const pieces: Array<{ text: string; sep: string }> = []
  text.split(/\n\s*\n/).forEach((para, pi) => {
    const paraSep = pi === 0 ? '' : '\n\n'
    if (para.length <= budget) {
      pieces.push({ text: para, sep: paraSep })
      return
    }
    // 单段超长：按句末标点切（标点留在句尾），仍过长再硬切
    const sentences = para.match(/[^。！？!?.；;\n]+[。！？!?.；;\n]*/g) ?? [para]
    let first = true
    for (const sentence of sentences) {
      for (let i = 0; i < sentence.length; i += budget) {
        pieces.push({ text: sentence.slice(i, i + budget), sep: first ? paraSep : '' })
        first = false
      }
    }
  })
  // 贪心合并到不超过 budget；新块开头不带分隔符
  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current && current.length + piece.sep.length + piece.text.length > budget) {
      chunks.push(current)
      current = piece.text
    } else {
      current = current ? current + piece.sep + piece.text : piece.text
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/** 服务商因不支持 temperature 拒绝请求（OpenAI o 系列 / gpt-5 等） */
export function isTemperatureParamError(status: number | undefined, body: string | undefined): boolean {
  if (status !== 400 && status !== 422) return false
  // 必须是「temperature 这个参数 / 取值不被支持」，而不是正文里恰好出现 temperature 一词
  return /(?:parameter|value)[:\s]+'?temperature'?|'temperature'|temperature (?:is not supported|does not support|is unsupported)|only the default \(1\)/i.test(
    body ?? ''
  )
}
