/**
 * OpenAI / 302.ai AI Provider 实现
 * 支持 OpenAI 兼容的 API 格式
 */

import type { GenerateContentRequest, GenerateContentResponse } from './types'
import { BaseAIProvider } from './baseProvider'

export class OpenAIProvider extends BaseAIProvider {
  readonly type: 'openai' | '302.ai'
  readonly name: string
  readonly supportsSystemPrompt = true
  readonly supportsStreaming = false

  constructor(config: any, options?: any) {
    super(config, options)
    this.type = config.provider
    this.name = config.provider === '302.ai' ? '302.AI' : 'OpenAI'
  }

  protected getDefaultModel(): string {
    return this.config.provider === '302.ai' ? 'gpt-3.5-turbo' : 'gpt-3.5-turbo'
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
    request: GenerateContentRequest
  ): Promise<GenerateContentResponse> {
    const { prompt, systemPrompt, temperature } = request

    const messages: Array<{ role: 'system' | 'user'; content: string }> = []

    if (systemPrompt && this.supportsSystemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      })
    }

    messages.push({
      role: 'user',
      content: systemPrompt ? `${prompt}\n\n${systemPrompt}` : prompt
    })

    const response = await this.fetchWithProxy(`${this.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: temperature ?? this.temperature
      })
    })

    if (!response.ok) {
      const errorBody = await response.text()
      const error = new Error(
        `${this.name} API请求失败: ${response.status} ${response.statusText} - ${errorBody}`
      ) as any
      error.status = response.status
      error.body = errorBody

      console.error(`${this.name} API错误详情:`, {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
        url: `${this.apiUrl}/chat/completions`,
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

  constructor(config: any, options?: any) {
    super({ ...config, provider: '302.ai' }, options)
  }
}
