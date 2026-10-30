/**
 * Anthropic Messages 协议（`POST {base}/messages`）。
 *
 * 用于只提供 Anthropic 协议、不提供 OpenAI 兼容 `/chat/completions` 的服务商（如 Kiro 网关）。
 * 鉴权头（`x-api-key` + `anthropic-version`）由同源代理在服务端注入，浏览器不接触密钥。
 */
import type { AICallOptions, AIGenerateResult, AIProviderConfig, AIServiceOptions, GenerateContentRequest } from './types'
import { BaseAIProvider } from './baseProvider'
import { logger } from '../../lib/logger'
import { stripThinking } from './stripThinking'
import { anthropicReasoningParams, isUnsupportedParamError } from './reasoning'
import { isEventStream, parseAnthropicStream } from './streamParse'
import { MAX_CAP_BACKOFFS, estimatePromptTokens, isTemperatureParamError, nextOutputCap, type LearnedParams } from './outputBudget'

/** Anthropic 要求显式 max_tokens：模型元数据缺失时的保底值 */
const DEFAULT_MAX_TOKENS = 8192

export class AnthropicProvider extends BaseAIProvider {
  readonly type = 'anthropic' as const
  readonly name = 'Anthropic'
  readonly supportsSystemPrompt = true
  readonly supportsStreaming = false

  constructor(config: AIProviderConfig, options?: AIServiceOptions) {
    super(config, options)
  }

  protected getDefaultModel(): string {
    return 'claude-haiku-4-5'
  }

  protected get apiUrl(): string {
    return (this.config.apiUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '')
  }

  protected async doGenerateContent(request: GenerateContentRequest, opts?: AICallOptions): Promise<AIGenerateResult> {
    const { prompt, systemPrompt, temperature } = request
    const url = `${this.apiUrl}/messages`

    let maxTokens = this.resolveOutputCap(estimatePromptTokens(prompt, systemPrompt)) ?? DEFAULT_MAX_TOKENS
    const thinkingOn = Object.keys(anthropicReasoningParams(this.effectiveReasoningEffort, maxTokens).params).length > 0
    // 本次请求内的降级只是试探：降级后成功才记住并存档（与 openaiProvider 同策略）
    const tentative: LearnedParams = {}
    let noTemperature = false
    // 本次已探到的服务商上限：thinking 的 max_tokens（= max(maxTokens, budget+2048)）也不能超过它
    let probedCap: number | undefined = this.learned.outputCap
    const send = (withThinking: boolean) => {
      // 每次发送都按当前 maxTokens 重算 thinking 参数，否则重发的仍是同一个超限请求
      const reasoning = anthropicReasoningParams(this.effectiveReasoningEffort, maxTokens)
      const thinkingMax = probedCap ? Math.min(reasoning.maxTokens, probedCap) : reasoning.maxTokens
      return this.fetchWithProxy(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: withThinking ? thinkingMax : maxTokens,
          stream: true,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: [{ role: 'user', content: prompt }],
          // 开启 thinking 时 Anthropic 只接受 temperature=1；目录标注不支持温度则不发
          ...(withThinking
            ? { temperature: 1 }
            : this.wantsTemperature && !noTemperature
              ? { temperature: temperature ?? this.temperature }
              : {}),
          ...(withThinking ? reasoning.params : {}),
        }),
        signal: opts?.signal,
      })
    }

    // 默认流式：Cloudflare 同源代理 100 秒无响应即 524，thinking 长输出的非流式请求必然踩线
    let withThinking = thinkingOn
    let capBackoffs = 0
    let response = await send(withThinking)
    // 参数被拒时逐个降级：输出上限超限 → 报错上限，读不出则 ×0.8（最多 3 次）；temperature → 省略；thinking → 关闭
    for (let attempt = 0; attempt < 6 && !response.ok && (response.status === 400 || response.status === 422); attempt++) {
      const body = await response.clone().text().catch(() => '')
      // thinking 开启时实际发出的是 thinking 的 max_tokens，退避要以它为基准
      const sent = withThinking
        ? Math.min(anthropicReasoningParams(this.effectiveReasoningEffort, maxTokens).maxTokens, probedCap ?? Infinity)
        : maxTokens
      const cap = capBackoffs < MAX_CAP_BACKOFFS ? nextOutputCap(response.status, body, sent) : undefined
      if (cap) {
        capBackoffs++
        logger.warn(`[${this.name}] ${this.model} 输出上限 ${sent} 被拒，改用 ${cap} 重试（第 ${capBackoffs}/${MAX_CAP_BACKOFFS} 次）`)
        maxTokens = Math.min(maxTokens, cap)
        probedCap = cap
        tentative.outputCap = cap
      } else if (this.wantsTemperature && !noTemperature && !withThinking && isTemperatureParamError(response.status, body)) {
        noTemperature = true
        tentative.noTemperature = true
        logger.warn(`[${this.name}] ${this.model} 不支持自定义温度，已按服务商默认重试`)
      } else if (withThinking && isUnsupportedParamError(response.status, body) && /thinking|budget_tokens/i.test(body)) {
        // 只认「thinking 不被支持」：不能把超上限之类的其他 400 也当成它
        withThinking = false
        tentative.noReasoning = true
        logger.warn(`[${this.name}] ${this.model} 不支持 thinking，已按默认重试`)
      } else {
        break
      }
      response = await send(withThinking)
    }
    // 降级后成功才记住并存档；降级后仍失败的试探值丢弃
    if (response.ok && Object.keys(tentative).length > 0) this.remember(tentative)

    if (!response.ok) {
      const error = await this.createHttpError(response, this.name)
      logger.error(`${this.name} API错误详情:`, { status: error.status, body: error.body, url, model: this.model })
      throw error
    }

    if (!isEventStream(response)) {
      // 网关忽略 stream:true、直接回一次性 JSON：按原样解析
      const data = await response.json()
      const content = ((data.content ?? []) as Array<{ type: string; text?: string }>)
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
      const total = (Number(data.usage?.input_tokens) || 0) + (Number(data.usage?.output_tokens) || 0)
      if (total > 0) this.recordTokenUsage(total)
      return {
        content: stripThinking(content),
        tokenCount: total || undefined,
        finishReason: data.stop_reason === 'max_tokens' ? 'length' : data.stop_reason,
      }
    }

    // 流式：逐块累加 text delta；thinking 块不进正文（解析器只取 content_block_delta 的 text）
    const stream = await parseAnthropicStream(response)
    const total = stream.usage?.total
    if (total && total > 0) this.recordTokenUsage(total)
    return {
      content: stripThinking(stream.content),
      tokenCount: total || undefined,
      finishReason: stream.finishReason,
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.fetchWithProxy(`${this.apiUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
      })
      if (response.ok) return { success: true }
      const text = await response.text()
      return { success: false, error: `API 测试失败: ${response.status} - ${text.slice(0, 200)}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
