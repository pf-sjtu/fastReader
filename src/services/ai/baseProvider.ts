/**
 * AI Provider 基类
 * 提供共享的重试逻辑和工具方法
 */

import type {
  AIProvider,
  AIProviderConfig,
  AIServiceOptions,
  GenerateContentRequest,
  GenerateContentResponse,
  RateLimitError
} from './types'
import {
  sleep,
  identifyRateLimitError,
  calculateRetryDelay,
  proxyFetch
} from './utils'

export abstract class BaseAIProvider implements AIProvider {
  protected config: AIProviderConfig
  protected options: Required<AIServiceOptions>
  protected onTokenUsage?: (tokens: number) => void

  abstract readonly type: string
  abstract readonly name: string
  abstract readonly supportsSystemPrompt: boolean
  abstract readonly supportsStreaming: boolean

  constructor(config: AIProviderConfig, options?: AIServiceOptions) {
    this.config = config
    this.options = {
      maxRetries: options?.maxRetries ?? 3,
      baseRetryDelay: options?.baseRetryDelay ?? 60000
    }
    this.onTokenUsage = options?.onTokenUsage
  }

  /**
   * 子类实现的具体生成逻辑
   */
  protected abstract doGenerateContent(
    request: GenerateContentRequest
  ): Promise<GenerateContentResponse>

  /**
   * 生成内容（带重试逻辑）
   */
  async generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse> {
    return this.executeWithRetry(
      () => this.doGenerateContent(request),
      '内容生成',
      {
        provider: this.type,
        model: this.config.model,
        promptLength: request.prompt.length
      }
    )
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

  /**
   * 带重试的执行包装器
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    context?: Record<string, unknown>
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[AI服务] ${operationName} - 尝试第 ${attempt} 次`)
        }

        const result = await operation()

        if (attempt > 1) {
          console.log(`[AI服务] ${operationName} - 第 ${attempt} 次尝试成功`)
        }

        return result
      } catch (error: unknown) {
        lastError = error as Error

        // 尝试识别流量限制错误
        const rateLimitError = this.identifyRateLimitError(error as Error)

        if (rateLimitError && attempt < this.options.maxRetries) {
          const retryDelay = rateLimitError.retryAfter
            ? rateLimitError.retryAfter * 1000
            : calculateRetryDelay(attempt, this.options.baseRetryDelay)

          console.log(
            `[AI服务] ${operationName} - 触发流量限制，${retryDelay / 1000}秒后重试...`
          )
          await sleep(retryDelay)
          continue
        }

        // 如果已达到最大重试次数，抛出错误
        if (attempt >= this.options.maxRetries) {
          console.error(`[AI服务] ${operationName} - 达到最大重试次数，操作失败:`, {
            error: lastError?.message || lastError,
            context,
            attempts: attempt
          })
          throw lastError
        }

        // 其他错误，计算延迟后重试
        const retryDelay = calculateRetryDelay(attempt, this.options.baseRetryDelay)
        console.log(
          `[AI服务] ${operationName} - 第 ${attempt} 次尝试失败，${retryDelay / 1000}秒后重试...`,
          error?.message || error
        )
        await sleep(retryDelay)
      }
    }

    throw lastError
  }

  /**
   * 识别流量限制错误
   */
  protected identifyRateLimitError(error: Error): RateLimitError | null {
    return identifyRateLimitError(error, (error as { status?: number }).status, (error as { body?: string }).body)
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
   * 代理请求包装器
   */
  protected async fetchWithProxy(url: string, options: RequestInit): Promise<Response> {
    return proxyFetch(url, options, this.config.proxyEnabled ? this.config.proxyUrl : undefined)
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
