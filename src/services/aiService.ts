/**
 * AI Service - 兼容壳
 *
 * 此文件作为向后兼容的 facade，将所有功能委托给新的策略模式实现：
 * - ai/types.ts - 类型定义
 * - ai/baseProvider.ts - Provider 基类
 * - ai/geminiProvider.ts - Gemini 实现
 * - ai/openaiProvider.ts - OpenAI/302.ai 实现
 * - ai/ollamaProvider.ts - Ollama 实现
 * - ai/factory.ts - Provider 工厂
 * - ai/aiService.ts - 新的 AIService 实现
 */

// 重新导出所有类型和类，保持向后兼容
export type {
  AIProvider,
  AIProviderConfig,
  AIProviderType,
  AIServiceOptions,
  Chapter,
  GenerateContentRequest,
  GenerateContentResponse,
  MindMapNode,
  PromptConfig,
  RateLimitError
} from './ai/types'

// 导出新的 AIService 实现
export {
  AIService,
  SKIPPED_SUMMARY_PREFIX
} from './ai/aiService'

// 导出 Provider 实现（供高级使用）
export { BaseAIProvider } from './ai/baseProvider'
export { GeminiProvider } from './ai/geminiProvider'
export { OpenAIProvider, Provider302 } from './ai/openaiProvider'
export { OllamaProvider } from './ai/ollamaProvider'

// 导出工厂函数
export {
  createAIProvider,
  getSupportedProviders,
  isProviderSupported
} from './ai/factory'

// 导出工具函数
export {
  isBrowser,
  sleep,
  proxyFetch,
  getHttpsProxyAgent,
  identifyRateLimitError,
  calculateRetryDelay
} from './ai/utils'

// 保持向后兼容的别名
import { AIService } from './ai/aiService'

/**
 * @deprecated 使用 AIService 替代
 */
export class AiService extends AIService {
  constructor(config: any, promptConfig?: any, options?: any) {
    super(config, promptConfig, options)
    console.warn('AiService 已弃用，请使用 AIService')
  }
}

// 兼容静态方法
export namespace AIServiceCompat {
  export const SKIPPED_SUMMARY_PREFIX = '【已跳过】'

  export function createSkippedSummary(reason?: string): string {
    const details = reason?.trim()
    if (details) {
      return `${SKIPPED_SUMMARY_PREFIX} 触发内容过滤：${details}`
    }
    return `${SKIPPED_SUMMARY_PREFIX} 触发内容过滤，已跳过该章节`
  }

  export function isSkippedSummary(summary: string): boolean {
    return summary.trim().startsWith(SKIPPED_SUMMARY_PREFIX)
  }
}
