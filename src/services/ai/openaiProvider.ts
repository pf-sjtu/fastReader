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
import { stripThinking } from './stripThinking'
import { isUnsupportedParamError, openAIReasoningParams } from './reasoning'
import {
  estimatePromptTokens,
  isMaxTokensParamError,
  isTemperatureParamError,
  parseMaxTokensCap
} from './outputBudget'

type TokenParam = 'max_tokens' | 'max_completion_tokens' | null

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
    // 输出上限自动取模型最大值（meta.output），并保证「输入 + 输出」不超过上下文窗口
    let maxTokens = this.resolveOutputCap(estimatePromptTokens(prompt, systemPrompt))
    const send = (withReasoning: boolean, tokenParam: TokenParam) =>
      this.fetchWithProxy(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          ...(this.wantsTemperature ? { temperature: temperature ?? this.temperature } : {}),
          ...(tokenParam && maxTokens ? { [tokenParam]: maxTokens } : {}),
          ...(withReasoning ? openAIReasoningParams(this.effectiveReasoningEffort) : {})
        }),
        signal: opts?.signal
      })

    let withReasoning = Object.keys(openAIReasoningParams(this.effectiveReasoningEffort)).length > 0
    // 本会话已学到该模型的参数名（如 OpenAI 推理模型只认 max_completion_tokens）则直接用
    const learnedParam = this.learned.tokenParam
    let tokenParam: TokenParam = maxTokens ? (learnedParam === undefined ? 'max_tokens' : learnedParam) : null
    let response = await send(withReasoning, tokenParam)
    // 参数不被接受时逐个降级重试，而不是让整章失败：
    // max_tokens → max_completion_tokens（OpenAI 推理模型）→ 省略；reasoning_effort → 省略；temperature → 省略
    for (let attempt = 0; attempt < 4 && !response.ok; attempt++) {
      const body = await response.clone().text().catch(() => '')
      const cap = tokenParam && maxTokens ? parseMaxTokensCap(body, maxTokens) : undefined
      if (cap && (response.status === 400 || response.status === 422)) {
        // 元数据高于服务商真实上限：按报错里的上限重试（参数名不变）
        logger.warn(`[${this.name}] ${this.model} 输出上限 ${maxTokens} 超出服务商范围，按 ${cap} 重试（本会话记住）`)
        maxTokens = cap
        this.remember({ outputCap: cap })
      } else if (tokenParam && isMaxTokensParamError(response.status, body)) {
        tokenParam = tokenParam === 'max_tokens' ? 'max_completion_tokens' : null
        this.remember({ tokenParam })
        logger.warn(`[${this.name}] ${this.model} 不接受当前输出上限参数，改用 ${tokenParam ?? '服务商默认'} 重试`)
      } else if (this.wantsTemperature && isTemperatureParamError(response.status, body)) {
        this.remember({ noTemperature: true })
        logger.warn(`[${this.name}] ${this.model} 不支持自定义温度，已按服务商默认重试（本会话记住）`)
      } else if (withReasoning && isUnsupportedParamError(response.status, body)) {
        withReasoning = false
        this.remember({ noReasoning: true })
        logger.warn(`[${this.name}] ${this.model} 不支持思考强度参数，已按默认重试`)
      } else {
        break
      }
      response = await send(withReasoning, tokenParam)
    }

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
      // 部分网关把 <think>…</think> 写进 content：不剥掉会进入摘要与导图解析
      content: stripThinking(data.choices?.[0]?.message?.content || ''),
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
