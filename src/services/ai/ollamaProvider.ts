/**
 * Ollama AI Provider 实现
 * 本地部署的 LLM 服务
 */

import type { AICallOptions, AIGenerateResult, GenerateContentRequest } from './types'
import { BaseAIProvider } from './baseProvider'
import { logger } from '../../lib/logger'
import { estimatePromptTokens } from './outputBudget'
import { isEventStream, parseOllamaStream } from './streamParse'

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

  /**
   * Ollama 跑在用户本机（http://localhost:11434），服务端访问不到 → 一律浏览器直连。
   * 也因此不经过 /api/ai，不需要服务端保存的凭据。
   */
  protected async fetchWithProxy(url: string, options: RequestInit): Promise<Response> {
    return fetch(url, options)
  }

  protected async doGenerateContent(
    request: GenerateContentRequest,
    opts?: AICallOptions
  ): Promise<AIGenerateResult> {
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

    const url = `${this.apiUrl}/api/chat`
    const promptTokens = estimatePromptTokens(...messages.map((m) => m.content))
    const maxTokens = this.resolveOutputCap(promptTokens)
    // Ollama 默认上下文很小（常见 2K–4K），超出部分会被静默截断：按本次实际需要的窗口显式申请，
    // 且不超过模型上下文（meta.context）；未知上下文则不发，保持 Ollama 默认
    const ctx = this.config.contextWindow
    const numCtx = ctx ? Math.min(ctx, promptTokens + (maxTokens ?? 0) + 1024) : undefined
    const response = await this.fetchWithProxy(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        options: {
          ...(this.wantsTemperature ? { temperature: temperature ?? this.temperature } : {}),
          ...(maxTokens ? { num_predict: maxTokens } : {}),
          ...(numCtx ? { num_ctx: numCtx } : {})
        }
      }),
      signal: opts?.signal
    })

    if (!response.ok) {
      const error = await this.createHttpError(response, 'Ollama')
      logger.error('Ollama API错误详情:', {
        status: error.status,
        body: error.body,
        url,
        model: this.model
      })
      throw error
    }

    if (!isEventStream(response)) {
      // 忽略 stream:true 的网关 / 老版本 Ollama：一次性 JSON
      const data = await response.json()
      return {
        content: data.message?.content || '',
        finishReason: data.done_reason ?? (data.done ? 'stop' : undefined),
      }
    }
    const stream = await parseOllamaStream(response)
    const tokens = stream.usage?.total
    if (typeof tokens === 'number') this.recordTokenUsage(tokens)
    return {
      content: stream.content,
      tokenCount: tokens,
      // 新版 Ollama 返回 done_reason（length 表示达到 num_predict 上限）
      finishReason: stream.finishReason,
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
        const models = data.models as Array<{ name: string }> || []
        const hasModel = models.some((m) => m.name === this.model || m.name === `${this.model}:latest`)

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
