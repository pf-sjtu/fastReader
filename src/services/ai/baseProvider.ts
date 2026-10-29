/**
 * AI Provider 基类
 * 提供共享的重试逻辑和工具方法
 */

import type {
  AICallOptions,
  AIGenerateResult,
  AIProviderConfig,
  AIProviderType,
  AIServiceOptions,
  CancellableAIProvider,
  GenerateContentRequest,
  RateLimitError
} from './types'
import { identifyRateLimitError, proxyFetch } from './utils'
import {
  AIRequestError,
  abortableSleep,
  backoffDelay,
  classifyError,
  DEFAULT_RETRY_BASE_MS,
  getServerRetryAfterMs,
  parseRetryAfterBody,
  parseRetryAfterHeader,
  RETRY_MAX_DELAY_MS,
  RETRY_TRANSIENT_BASE_MAX_MS,
  setProviderCooldown,
  throwIfAborted,
  waitProviderCooldown
} from './retry'
import { logger } from '../../lib/logger'

/** finishReason 表示输出被长度上限截断（OpenAI: length；Gemini: MAX_TOKENS） */
export function isTruncatedFinishReason(reason: string | undefined | null): boolean {
  if (!reason) return false
  const r = reason.toLowerCase()
  return r === 'length' || r === 'max_tokens'
}

export abstract class BaseAIProvider implements CancellableAIProvider {
  protected config: AIProviderConfig
  protected options: { maxRetries: number; baseRetryDelay: number }
  protected onTokenUsage?: (tokens: number) => void

  abstract readonly type: AIProviderType
  abstract readonly name: string
  abstract readonly supportsSystemPrompt: boolean
  abstract readonly supportsStreaming: boolean

  constructor(config: AIProviderConfig, options?: AIServiceOptions) {
    this.config = config
    this.options = {
      maxRetries: options?.maxRetries ?? 3,
      baseRetryDelay: options?.baseRetryDelay ?? DEFAULT_RETRY_BASE_MS
    }
    this.onTokenUsage = options?.onTokenUsage
  }

  /**
   * 子类实现的具体生成逻辑
   */
  protected abstract doGenerateContent(
    request: GenerateContentRequest,
    opts?: AICallOptions
  ): Promise<AIGenerateResult>

  /**
   * 生成内容（带重试逻辑）
   */
  async generateContent(request: GenerateContentRequest, opts?: AICallOptions): Promise<AIGenerateResult> {
    const result = await this.executeWithRetry(
      () => this.doGenerateContent(request, opts),
      '内容生成',
      {
        provider: this.type,
        model: this.config.model,
        promptLength: request.prompt.length
      },
      opts?.signal
    )
    if (isTruncatedFinishReason(result.finishReason)) {
      logger.warn(`[AI服务] ${this.name} 输出被长度上限截断 (finishReason=${result.finishReason})`)
      return { ...result, truncated: true }
    }
    return result
  }

  /**
   * 测试连接（默认实现，子类可覆盖）
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.generateContent({
        prompt: 'Hello, this is a test message. Please respond with "OK".',
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

  /** 同一 provider（类型 + 接口地址）共享 429 冷却 */
  protected get cooldownKey(): string {
    return `${this.type}|${this.config.apiUrl ?? ''}`
  }

  /**
   * 带重试的执行包装器：
   * - 只对 408/429/5xx/网络错误重试；400/401/403/404/上下文超长立即失败
   * - 429：优先 Retry-After，否则按 baseRetryDelay 指数退避，并设置 provider 级冷却
   * - signal 触发时立即中断等待并抛 AbortError
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    context?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<T> {
    const maxAttempts = Math.max(1, this.options.maxRetries)

    for (let attempt = 1; ; attempt++) {
      // 其他并发请求刚收到 429：冷却结束前不发出
      await waitProviderCooldown(this.cooldownKey, signal)
      throwIfAborted(signal)

      try {
        if (attempt > 1) {
          logger.info(`[AI服务] ${operationName} - 尝试第 ${attempt} 次`)
        }
        return await operation()
      } catch (error: unknown) {
        const kind = signal?.aborted ? 'abort' : classifyError(error)
        if (kind === 'abort') throw error

        const message = (error as Error)?.message || String(error)
        if (kind === 'fatal' || kind === 'context' || attempt >= maxAttempts) {
          logger.error(`[AI服务] ${operationName} - 失败（${kind}，第 ${attempt} 次）:`, {
            error: message,
            context
          })
          throw error
        }

        const serverDelay = getServerRetryAfterMs(error)
        let delay: number
        if (serverDelay !== undefined) {
          delay = Math.min(serverDelay, RETRY_MAX_DELAY_MS)
        } else if (kind === 'rateLimit') {
          delay = backoffDelay(attempt, this.options.baseRetryDelay)
        } else {
          delay = backoffDelay(attempt, Math.min(this.options.baseRetryDelay, RETRY_TRANSIENT_BASE_MAX_MS))
        }

        if (kind === 'rateLimit') {
          setProviderCooldown(this.cooldownKey, delay)
          logger.warn(`[AI服务] ${operationName} - 触发流量限制，${Math.round(delay / 1000)}秒后重试`)
        } else {
          logger.warn(
            `[AI服务] ${operationName} - 第 ${attempt} 次失败，${Math.round(delay / 1000)}秒后重试:`,
            message
          )
        }
        await abortableSleep(delay, signal)
      }
    }
  }

  /**
   * 识别流量限制错误
   */
  protected identifyRateLimitError(error: Error): RateLimitError | null {
    return identifyRateLimitError(error, (error as { status?: number }).status, (error as { body?: string }).body)
  }

  /**
   * 把非 2xx 响应转为带 status/body/retryAfterMs 的错误
   */
  protected async createHttpError(response: Response, label: string): Promise<AIRequestError> {
    const body = await response.text().catch(() => '')
    const retryAfterMs =
      parseRetryAfterHeader(response.headers?.get?.('retry-after')) ?? parseRetryAfterBody(body)
    return new AIRequestError(
      `${label} API请求失败: ${response.status} ${response.statusText} - ${body}`,
      { status: response.status, body, retryAfterMs }
    )
  }

  /**
   * 记录 Token 使用量
   */
  protected recordTokenUsage(tokens: number): void {
    if (this.onTokenUsage && tokens > 0) {
      this.onTokenUsage(tokens)
    }
  }

  /**
   * 上游接口地址（服务商 baseUrl）。子类可覆盖默认值。
   */
  protected get apiUrl(): string {
    return this.config.apiUrl || ''
  }

  /**
   * 代理请求包装器：把服务商 id 与端点路径交给服务端，由服务端注入 base 与凭据。
   *
   * 直连模式（Ollama）覆盖此方法。
   */
  protected async fetchWithProxy(url: string, options: RequestInit): Promise<Response> {
    return proxyFetch(url, options, {
      providerId: this.config.providerId,
      apiBase: this.apiUrl,
    })
  }

  /**
   * 获取温度参数
   */
  protected get temperature(): number {
    return this.config.temperature ?? 0.7
  }

  /**
   * 获取模型名称
   */
  protected get model(): string {
    return this.config.model || this.getDefaultModel()
  }

  /**
   * 获取默认模型（子类实现）
   */
  protected abstract getDefaultModel(): string
}
