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
import { estimatePromptTokens, isTemperatureParamError, parseMaxTokensCap } from './outputBudget'

/** Anthropic 要求显式 max_tokens：模型元数据缺失时的保底值 */
const DEFAULT_MAX_TOKENS = 8192

interface AnthropicContentBlock {
  type: string
  text?: string
}

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
    const send = (withThinking: boolean) => {
      // 每次发送都按当前 maxTokens 重算 thinking 参数：被拒后 maxTokens 会降到服务商上限，
      // thinking 的 max_tokens（= max(maxTokens, budget+2048)）也必须跟着变，否则重发的仍是同一个超限请求
      const reasoning = anthropicReasoningParams(this.effectiveReasoningEffort, maxTokens)
      const cap = this.learned.outputCap
      const thinkingMax = cap ? Math.min(reasoning.maxTokens, cap) : reasoning.maxTokens
      return this.fetchWithProxy(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: withThinking ? thinkingMax : maxTokens,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: [{ role: 'user', content: prompt }],
          // 开启 thinking 时 Anthropic 只接受 temperature=1；目录标注不支持温度则不发
          ...(withThinking
            ? { temperature: 1 }
            : this.wantsTemperature
              ? { temperature: temperature ?? this.temperature }
              : {}),
          ...(withThinking ? reasoning.params : {}),
        }),
        signal: opts?.signal,
      })
    }

    let response = await send(thinkingOn)
    // 参数被拒时逐个降级：输出上限超范围 → 按报错上限；temperature 不支持 → 省略
    for (let attempt = 0; attempt < 2 && !response.ok && (response.status === 400 || response.status === 422); attempt++) {
      const body = await response.clone().text().catch(() => '')
      const cap = parseMaxTokensCap(body, maxTokens)
      if (cap) {
        logger.warn(`[${this.name}] ${this.model} 输出上限 ${maxTokens} 超出服务商范围，按 ${cap} 重试（本会话记住）`)
        maxTokens = cap
        this.remember({ outputCap: cap })
      } else if (this.wantsTemperature && isTemperatureParamError(response.status, body)) {
        this.remember({ noTemperature: true })
        logger.warn(`[${this.name}] ${this.model} 不支持自定义温度，已按服务商默认重试（本会话记住）`)
      } else {
        break
      }
      response = await send(thinkingOn)
    }
    if (thinkingOn && !response.ok) {
      const body = await response.clone().text().catch(() => '')
      // 只认「thinking 不被支持」：不能把超上限之类的其他 400 也当成它
      if (isUnsupportedParamError(response.status, body) && /thinking|budget_tokens/i.test(body)) {
        this.remember({ noReasoning: true })
        logger.warn(`[${this.name}] ${this.model} 不支持 thinking，已按默认重试`)
        response = await send(false)
      }
    }

    if (!response.ok) {
      const error = await this.createHttpError(response, this.name)
      logger.error(`${this.name} API错误详情:`, { status: error.status, body: error.body, url, model: this.model })
      throw error
    }

    const data = await response.json()
    // 只取 text 块；thinking / tool_use 等块不进入正文
    const content = ((data.content ?? []) as AnthropicContentBlock[])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')

    const input = Number(data.usage?.input_tokens) || 0
    const output = Number(data.usage?.output_tokens) || 0
    const total = input + output
    if (total > 0) this.recordTokenUsage(total)

    return {
      content: stripThinking(content),
      tokenCount: total || undefined,
      // Anthropic 用 max_tokens 表示截断；统一映射成 length，交给通用截断判定
      finishReason: data.stop_reason === 'max_tokens' ? 'length' : data.stop_reason,
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
