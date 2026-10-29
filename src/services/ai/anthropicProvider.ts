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

/** Anthropic 要求显式 max_tokens；章节摘要/导图 JSON 在 8K 内足够 */
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

    const response = await this.fetchWithProxy(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature ?? this.temperature,
      }),
      signal: opts?.signal,
    })

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
