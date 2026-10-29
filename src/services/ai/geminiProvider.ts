/**
 * Gemini AI Provider（经同源代理的 REST 实现）
 *
 * 不再依赖 `@google/generative-ai` 浏览器 SDK：
 * Key 只存在于服务端，由 /api/ai 代理以 `x-goog-api-key` 注入。
 */
import type { AICallOptions, AIGenerateResult, GenerateContentRequest } from './types'
import { BaseAIProvider } from './baseProvider'
import { logger } from '../../lib/logger'
import { geminiReasoningParams, isUnsupportedParamError } from './reasoning'

const DEFAULT_MODEL = 'gemini-2.5-flash'

export class GeminiProvider extends BaseAIProvider {
  readonly type = 'gemini' as const
  readonly name = 'Gemini'
  readonly supportsSystemPrompt = false
  readonly supportsStreaming = false

  protected getDefaultModel(): string {
    return DEFAULT_MODEL
  }

  protected get apiUrl(): string {
    return this.config.apiUrl || 'https://generativelanguage.googleapis.com/v1beta'
  }

  protected async doGenerateContent(
    request: GenerateContentRequest,
    opts?: AICallOptions
  ): Promise<AIGenerateResult> {
    const { prompt, systemPrompt, temperature } = request

    // Gemini 没有 system 角色（0.24 SDK 时代的兼容行为：合并到用户提示尾部）
    const finalPrompt = systemPrompt ? `${prompt}\n\n**${systemPrompt}**` : prompt

    const url = `${this.apiUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(this.model)}:generateContent`
    const thinking = geminiReasoningParams(this.config.reasoningEffort)
    const thinkingOn = Object.keys(thinking).length > 0
    const send = (withThinking: boolean) =>
      this.fetchWithProxy(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
          generationConfig: { temperature: temperature ?? this.temperature, ...(withThinking ? thinking : {}) },
        }),
        signal: opts?.signal,
      })

    let response = await send(thinkingOn)
    if (thinkingOn && !response.ok) {
      const body = await response.clone().text().catch(() => '')
      if (isUnsupportedParamError(response.status, body)) response = await send(false)
    }

    if (!response.ok) {
      const error = await this.createHttpError(response, this.name)
      logger.error('Gemini API错误详情:', {
        status: error.status,
        body: error.body,
        model: this.model,
      })
      throw error
    }

    const data = await response.json()
    const candidate = data?.candidates?.[0]
    const content =
      candidate?.content?.parts
        ?.map((part: { text?: string }) => part?.text ?? '')
        .join('') ?? ''
    const tokenCount = data?.usageMetadata?.totalTokenCount
    if (typeof tokenCount === 'number') this.recordTokenUsage(tokenCount)

    return {
      content,
      tokenCount,
      // MAX_TOKENS 会被 isTruncatedFinishReason 归一为 length
      finishReason: candidate?.finishReason,
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.fetchWithProxy(`${this.apiUrl.replace(/\/+$/, '')}/models`, {
        method: 'GET',
      })
      if (response.ok) return { success: true }
      const errorData = await response.text()
      return { success: false, error: `API 测试失败: ${response.status} - ${errorData.slice(0, 200)}` }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
