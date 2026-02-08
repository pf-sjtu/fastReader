/**
 * AI 服务模块统一导出
 */

// 类型定义
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
} from './types'

// 主要服务
export { AIService, SKIPPED_SUMMARY_PREFIX } from './aiService'

// Provider 工厂
export { createAIProvider, getSupportedProviders, isProviderSupported } from './factory'

// Provider 实现（需要时可直接使用）
export { BaseAIProvider } from './baseProvider'
export { GeminiProvider } from './geminiProvider'
export { OpenAIProvider, Provider302 } from './openaiProvider'
export { OllamaProvider } from './ollamaProvider'

// 工具函数
export {
  isBrowser,
  sleep,
  proxyFetch,
  getHttpsProxyAgent,
  identifyRateLimitError,
  calculateRetryDelay
} from './utils'
