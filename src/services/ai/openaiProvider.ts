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
import { AIRequestError } from './retry'
import { isEventStream, isStreamUnsupportedError, parseOpenAIStream } from './streamParse'
import { logger } from '../../lib/logger'
import { stripThinking } from './stripThinking'
import { isUnsupportedParamError, openAIReasoningParams } from './reasoning'
import { isStructuredFormatError } from './structured'
import {
  MAX_CAP_BACKOFFS,
  estimatePromptTokens,
  isMaxTokensParamError,
  isTemperatureParamError,
  nextOutputCap,
  type LearnedParams
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
    const { prompt, systemPrompt, temperature, format } = request

    const messages: Array<{ role: 'system' | 'user'; content: string }> = []

    // system prompt 只放 system 消息，避免在 user 消息末尾重复一遍浪费 token
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    const url = `${this.apiUrl}/chat/completions`
    // 输出上限自动取模型最大值（meta.output），并保证「输入 + 输出」不超过上下文窗口
    let maxTokens = this.resolveOutputCap(estimatePromptTokens(prompt, systemPrompt))
    // 默认流式：Cloudflare 同源代理对「上游 100 秒内没有响应」直接返回 524，
    // 长章节（推理模型 2–5 分钟）非流式必然踩线。stream_options.include_usage 让末尾块带 token 用量，
    // 不认识它的网关会在下面的降级循环里去掉重试。
    let streaming = true
    let includeUsage = true
    // 格式化请求：json_schema(strict) → json_object → 不带，逐档降级（本会话 / 存档里学到的档位直接沿用）
    let fmt: 'schema' | 'json' | null = !format || this.learned.noStructured ? null : format.schema && !this.learned.noJsonSchema ? 'schema' : 'json'
    const responseFormat = () =>
      fmt === 'schema' && format?.schema
        ? { response_format: { type: 'json_schema', json_schema: { name: format.name, strict: true, schema: format.schema } } }
        : fmt === 'json'
          ? { response_format: { type: 'json_object' } }
          : {}
    const send =(withReasoning: boolean, tokenParam: TokenParam, noTemperature: boolean) =>
      this.fetchWithProxy(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          ...(this.wantsTemperature && !noTemperature ? { temperature: temperature ?? this.temperature } : {}),
          ...(tokenParam && maxTokens ? { [tokenParam]: maxTokens } : {}),
          ...(withReasoning ? openAIReasoningParams(this.effectiveReasoningEffort) : {}),
          ...responseFormat(),
          ...(streaming ? { stream: true } : {}),
          ...(streaming && includeUsage ? { stream_options: { include_usage: true } } : {})
        }),
        signal: opts?.signal
      })

    let withReasoning = Object.keys(openAIReasoningParams(this.effectiveReasoningEffort)).length > 0
    // 本会话已学到该模型的参数名（如 OpenAI 推理模型只认 max_completion_tokens）则直接用
    const learnedParam = this.learned.tokenParam
    let tokenParam: TokenParam = maxTokens ? (learnedParam === undefined ? 'max_tokens' : learnedParam) : null
    // 本次请求内的降级只是「试探」：只有降级后的请求真正成功才记住并存档（verified），
    // 降级后仍报同类错误、最终失败的，一律不存档，避免把错误经验写进共享状态
    const tentative: LearnedParams = {}
    let noTemperature = false
    let capBackoffs = 0
    let response = await send(withReasoning, tokenParam, noTemperature)
    // 参数不被接受时逐个降级重试，而不是让整章失败：
    // 输出上限超限 → 报错里的上限，读不出则 ×0.8（最多 3 次）；max_tokens → max_completion_tokens → 省略；
    // temperature → 省略；reasoning_effort → 省略
    for (let attempt = 0; attempt < 10 && !response.ok; attempt++) {
      const body = await response.clone().text().catch(() => '')
      const cap =
        tokenParam && maxTokens && capBackoffs < MAX_CAP_BACKOFFS
          ? nextOutputCap(response.status, body, maxTokens)
          : undefined
      if (cap) {
        capBackoffs++
        logger.warn(`[${this.name}] ${this.model} 输出上限 ${maxTokens} 被拒，改用 ${cap} 重试（第 ${capBackoffs}/${MAX_CAP_BACKOFFS} 次）`)
        maxTokens = cap
        tentative.outputCap = cap
      } else if (tokenParam && isMaxTokensParamError(response.status, body)) {
        tokenParam = tokenParam === 'max_tokens' ? 'max_completion_tokens' : null
        tentative.tokenParam = tokenParam
        logger.warn(`[${this.name}] ${this.model} 不接受当前输出上限参数，改用 ${tokenParam ?? '服务商默认'} 重试`)
      } else if (this.wantsTemperature && !noTemperature && isTemperatureParamError(response.status, body)) {
        noTemperature = true
        tentative.noTemperature = true
        logger.warn(`[${this.name}] ${this.model} 不支持自定义温度，已按服务商默认重试`)
      } else if (streaming && includeUsage && /stream_options/i.test(body) && isStreamUnsupportedError(response.status, body)) {
        // 只拒 stream_options：去掉它继续流式（仍能拿到正文，只是没有用量）
        includeUsage = false
        logger.warn(`[${this.name}] ${this.model} 不支持 stream_options，去掉后重试`)
      } else if (streaming && isStreamUnsupportedError(response.status, body)) {
        streaming = false
        logger.warn(`[${this.name}] ${this.model} 不支持流式，退回一次性响应`)
      } else if (fmt && isStructuredFormatError(response.status, body)) {
        // 放在思考参数之前：isUnsupportedParamError 的 unsupported/unknown 太宽，会把这类 400 误判成「不支持思考」
        if (fmt === 'schema') {
          fmt = 'json'
          tentative.noJsonSchema = true
          logger.warn(`[${this.name}] ${this.model} 不支持 json_schema，退回 json_object 重试`)
        } else {
          fmt = null
          tentative.noStructured = true
          logger.warn(`[${this.name}] ${this.model} 不支持结构化输出参数，退回纯提示词约束重试`)
        }
      } else if (withReasoning && isUnsupportedParamError(response.status, body)) {
        withReasoning = false
        tentative.noReasoning = true
        logger.warn(`[${this.name}] ${this.model} 不支持思考强度参数，已按默认重试`)
      } else {
        break
      }
      response = await send(withReasoning, tokenParam, noTemperature)
    }
    // 降级后成功：经验已被验证，记住并上报后端；失败则丢弃
    if (response.ok && Object.keys(tentative).length > 0) this.remember(tentative)

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

    if (streaming && isEventStream(response)) {
      const stream = await parseOpenAIStream(response)
      if (stream.unsupported) {
        // 标成 SSE 却没有任何数据帧：正文已读掉，交给上层重试
        throw new AIRequestError(`${this.name} 流式响应无数据`, { status: 502 })
      }
      if (stream.usage?.total) this.recordTokenUsage(stream.usage.total)
      return {
        // 部分网关把 <think>…</think> 写进 content：不剥掉会进入摘要与导图解析
        content: stripThinking(stream.content),
        tokenCount: stream.usage?.total,
        finishReason: stream.finishReason
      }
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
