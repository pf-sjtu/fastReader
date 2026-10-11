/**
 * Gemini AI Provider 实现（浏览器直连 SDK）
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GenerativeModel } from '@google/generative-ai'
import type {
  AICallOptions,
  AIGenerateResult,
  AIProviderConfig,
  AIServiceOptions,
  GenerateContentRequest
} from './types'
import { BaseAIProvider } from './baseProvider'

export class GeminiProvider extends BaseAIProvider {
  readonly type = 'gemini' as const
  readonly name = 'Gemini'
  readonly supportsSystemPrompt = false
  readonly supportsStreaming = false

  private genAI: GoogleGenerativeAI
  private generativeModel: GenerativeModel

  constructor(config: AIProviderConfig, options?: AIServiceOptions) {
    super(config, options)
    this.genAI = new GoogleGenerativeAI(this.config.apiKey)
    this.generativeModel = this.genAI.getGenerativeModel({
      model: this.model
    })
  }

  protected getDefaultModel(): string {
    return 'gemini-1.5-flash'
  }

  protected async doGenerateContent(
    request: GenerateContentRequest,
    opts?: AICallOptions
  ): Promise<AIGenerateResult> {
    const { prompt, systemPrompt, temperature } = request

    // Gemini 不支持系统提示，合并到用户提示中
    const finalPrompt = systemPrompt ? `${prompt}\n\n**${systemPrompt}**` : prompt

    // SDK 0.24 的 SingleRequestOptions 支持 signal（客户端放弃请求，服务端仍可能计费）
    const result = await this.generativeModel.generateContent(
      {
        contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
        generationConfig: {
          temperature: temperature ?? this.temperature
        }
      },
      { signal: opts?.signal }
    )

    const response = result.response
    const tokenCount = response?.usageMetadata?.totalTokenCount
    if (tokenCount) {
      this.recordTokenUsage(tokenCount)
    }

    return {
      content: response.text(),
      tokenCount,
      finishReason: response.candidates?.[0]?.finishReason
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // 使用简单的测试提示
      const response = await this.generateContent({
        prompt: 'Say "OK"',
        temperature: 0.1
      })

      return {
        success: response.content.length > 0
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
