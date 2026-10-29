/**
 * AI Provider 工厂
 * 根据配置创建对应的 Provider 实例
 */

import type { AIProviderConfig, AIProviderType, AIServiceOptions, CancellableAIProvider } from './types'
import { GeminiProvider } from './geminiProvider'
import { OpenAIProvider, Provider302 } from './openaiProvider'
import { OllamaProvider } from './ollamaProvider'
import { AnthropicProvider } from './anthropicProvider'

// Provider 注册表
const providerRegistry: Record<AIProviderType, new (config: AIProviderConfig, options?: AIServiceOptions) => CancellableAIProvider> = {
  gemini: GeminiProvider,
  openai: OpenAIProvider,
  '302.ai': Provider302,
  ollama: OllamaProvider,
  anthropic: AnthropicProvider,
  custom: OpenAIProvider // 自定义 provider 使用 OpenAI 兼容格式
}

/**
 * 创建 AI Provider 实例
 */
export function createAIProvider(
  config: AIProviderConfig,
  options?: AIServiceOptions
): CancellableAIProvider {
  const ProviderClass = providerRegistry[config.provider]

  if (!ProviderClass) {
    throw new Error(`不支持的 AI Provider: ${config.provider}`)
  }

  return new ProviderClass(config, options)
}

/**
 * 获取支持的 Provider 列表
 */
export function getSupportedProviders(): Array<{ type: AIProviderType; name: string }> {
  return [
    { type: 'gemini', name: 'Gemini' },
    { type: 'openai', name: 'OpenAI' },
    { type: '302.ai', name: '302.AI' },
    { type: 'ollama', name: 'Ollama' },
    { type: 'anthropic', name: 'Anthropic' }
  ]
}

/**
 * 检查 Provider 是否支持
 */
export function isProviderSupported(provider: string): provider is AIProviderType {
  return provider in providerRegistry
}
