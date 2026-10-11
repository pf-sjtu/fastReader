/**
 * OpenAI / 302.ai AI Provider 实现
 * 支持 OpenAI 兼容的 API 格式
 */

import type {
  AICallOptions,
  AIGenerateResult,
  AIProviderConfig,
  AIServiceOptions,
  GenerateContentRequest
} from './types'
import { BaseAIProvider } from './baseProvider'
import { logger } from '../../lib/logger'

export class OpenAIProvider extends BaseAIProvider {
  readonly type: AIProviderConfig['provider']
  readonly name: string
  readonly supportsSystemPrompt = true
  readonly supportsStreaming = false

  constructor(config: AIProviderConfig, options?: AIServiceOptions) {
    super(config, options)
    this.type = config.provider
    this.name = config.provider === '302.ai' ? '302.AI' : 'OpenAI'
  }

  protected getDefaultModel(): string {
    return 'gpt-3.5-turbo'
  }

  protected get apiUrl(): string {
    return (
      this.config.apiUrl ||
      (this.config.provider === '302.ai'
        ? 'https://api.302.ai/v1'
        : 'https://api.openai.com/v1')
    )
  }

  protected async doGenerateContent(
    request: GenerateContentRequest,
    opts?: AICallOptions
  ): Promise<AIGenerateResult> {
    const { prompt, systemPrompt, temperature } = request

    const messages: Array<{ role: 'system' | 'user'; content: string }> = []

    // system prompt 只放 system 消息，避免在 user 消息末尾重复一遍浪费 token
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    const url = `${this.apiUrl}/chat/completions`
    const response = await this.fetchWithProxy(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: temperature ?? this.temperature
      }),
      signal: opts?.signal
    })

    if (!response.ok) {
      const error = await this.createHttpError(response, this.name)
      logger.error(`${this.name} API错误详情:`, {
        status: error.status,
        body: error.body,
        url,
        model: this.model,
        provider: this.config.provider
      })
      throw error
    }

    const data = await response.json()

    // 统计 token 使用量
    if (data.usage?.total_tokens) {
      this.recordTokenUsage(data.usage.total_tokens)
    }

    return {
      content: data.choices?.[0]?.message?.content || '',
      tokenCount: data.usage?.total_tokens,
      finishReason: data.choices?.[0]?.finish_reason
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.fetchWithProxy(`${this.apiUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`
        }
      })

      if (response.ok) {
        return { success: true }
      } else {
        const errorData = await response.text()
        return {
          success: false,
          error: `API 测试失败: ${response.status} - ${errorData}`
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

// 302.ai Provider（继承自 OpenAIProvider）
export class Provider302 extends OpenAIProvider {
  readonly type = '302.ai' as const
  readonly name = '302.AI'

  constructor(config: AIProviderConfig, options?: AIServiceOptions) {
    super({ ...config, provider: '302.ai' }, options)
  }
}
