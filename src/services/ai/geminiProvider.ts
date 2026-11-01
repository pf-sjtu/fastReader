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
import { estimatePromptTokens, type LearnedParams } from './outputBudget'
import { isStructuredFormatError } from './structured'
import { isEventStream, isStreamUnsupportedError, parseGeminiStream } from './streamParse'

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
    const { prompt, systemPrompt, temperature, format } = request

    // Gemini 没有 system 角色（0.24 SDK 时代的兼容行为：合并到用户提示尾部）
    const finalPrompt = systemPrompt ? `${prompt}\n\n**${systemPrompt}**` : prompt

    const base = this.apiUrl.replace(/\/+$/, '')
    const thinking = geminiReasoningParams(this.effectiveReasoningEffort)
    const maxTokens = this.resolveOutputCap(estimatePromptTokens(finalPrompt))
    const thinkingOn = Object.keys(thinking).length > 0
    // 默认流式（SSE）：Cloudflare 同源代理 100 秒无响应即 524，长章节非流式必然踩线
    let streaming = true
    // 格式化请求：responseMimeType + responseJsonSchema（标准 JSON Schema）→ 仅 responseMimeType → 不带
    let fmt: 'schema' | 'json' | null = !format || this.learned.noStructured ? null : format.schema && !this.learned.noJsonSchema ? 'schema' : 'json'
    const tentative: LearnedParams = {}
    const url = () =>
      `${base}/models/${encodeURIComponent(this.model)}:${streaming ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
    const send = (withThinking: boolean) =>
      this.fetchWithProxy(url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
          generationConfig: {
            ...(this.wantsTemperature ? { temperature: temperature ?? this.temperature } : {}),
            ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
            ...(withThinking ? thinking : {}),
            ...(fmt ? { responseMimeType: 'application/json' } : {}),
            ...(fmt === 'schema' && format?.schema ? { responseJsonSchema: format.schema } : {}),
          },
        }),
        signal: opts?.signal,
      })

    let withThinking = thinkingOn
    let response = await send(withThinking)
    // 参数不被接受时逐个降级重试：流式 → 一次性；schema → 仅 JSON MIME；思考参数 → 去掉
    for (let attempt = 0; attempt < 5 && !response.ok; attempt++) {
      const body = await response.clone().text().catch(() => '')
      if (streaming && isStreamUnsupportedError(response.status, body)) {
        streaming = false
        logger.warn(`[${this.name}] ${this.model} 不支持流式，退回一次性响应`)
      } else if (fmt && isStructuredFormatError(response.status, body)) {
        if (fmt === 'schema') {
          fmt = 'json'
          tentative.noJsonSchema = true
          logger.warn(`[${this.name}] ${this.model} 不支持 responseJsonSchema，退回仅 JSON MIME 重试`)
        } else {
          fmt = null
          tentative.noStructured = true
          logger.warn(`[${this.name}] ${this.model} 不支持 JSON 输出参数，退回纯提示词约束重试`)
        }
      } else if (withThinking && isUnsupportedParamError(response.status, body)) {
        withThinking = false
      } else {
        break
      }
      response = await send(withThinking)
    }
    // 降级后成功才记住并存档
    if (response.ok && Object.keys(tentative).length > 0) this.remember(tentative)

    if (!response.ok) {
      const error = await this.createHttpError(response, this.name)
      logger.error('Gemini API错误详情:', {
        status: error.status,
        body: error.body,
        model: this.model,
      })
      throw error
    }

    if (streaming && isEventStream(response)) {
      const stream = await parseGeminiStream(response)
      const tokens = stream.usage?.total
      if (typeof tokens === 'number') this.recordTokenUsage(tokens)
      return {
        content: stream.content,
        tokenCount: tokens,
        // MAX_TOKENS 会被 isTruncatedFinishReason 归一为 length
        finishReason: stream.finishReason,
      }
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
