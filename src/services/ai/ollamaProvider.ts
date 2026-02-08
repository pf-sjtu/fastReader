/**
 * Ollama AI Provider 实现
 * 本地部署的 LLM 服务
 */

import type { GenerateContentRequest, GenerateContentResponse } from './types'
import { BaseAIProvider } from './baseProvider'

export class OllamaProvider extends BaseAIProvider {
  readonly type = 'ollama' as const
  readonly name = 'Ollama'
  readonly supportsSystemPrompt = true
  readonly supportsStreaming = false

  protected getDefaultModel(): string {
    return 'llama2'
  }

  protected get apiUrl(): string {
    return this.config.apiUrl || 'http://localhost:11434'
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
      content: prompt
    })

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    // 如果提供了 API 密钥，则添加 Authorization 头
    if (this.config.apiKey) {
      requestHeaders['Authorization'] = `Bearer ${this.config.apiKey}`
    }

    const response = await this.fetchWithProxy(`${this.apiUrl}/api/chat`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: temperature ?? this.temperature
        }
      })
    })

    if (!response.ok) {
      const errorBody = await response.text()
      const error = new Error(
        `Ollama API请求失败: ${response.status} ${response.statusText} - ${errorBody}`
      ) as any
      error.status = response.status
      error.body = errorBody

      console.error('Ollama API错误详情:', {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
        url: `${this.apiUrl}/api/chat`,
        model: this.model
      })

      throw error
    }

    const data = await response.json()

    return {
      content: data.message?.content || '',
      finishReason: data.done ? 'stop' : undefined
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.fetchWithProxy(`${this.apiUrl}/api/tags`, {
        method: 'GET'
      })

      if (response.ok) {
        const data = await response.json()
        // 检查模型是否可用
        const models = data.models || []
        const hasModel = models.some((m: any) => m.name === this.model || m.name === `${this.model}:latest`)

        if (hasModel || models.length > 0) {
          return { success: true }
        } else {
          return {
            success: false,
            error: 'Ollama 服务可用，但未找到可用模型'
          }
        }
      } else {
        return {
          success: false,
          error: `连接失败: ${response.status}`
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
