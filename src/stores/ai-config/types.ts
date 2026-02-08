/**
 * AI配置类型定义
 */

export type AIProvider = 'gemini' | 'openai' | 'ollama' | '302.ai' | 'custom'

export interface AIProviderConfig {
  provider: AIProvider
  apiKey: string
  apiUrl: string
  model: string
  temperature: number
  proxyUrl?: string
  proxyEnabled?: boolean
  customFields?: Record<string, unknown>
}

export interface AIProviderTemplate extends AIProviderConfig {
  name: string
  description: string
}

export interface AIProviderWithMeta extends AIProviderConfig {
  id?: string
  createdAt?: string
  updatedAt?: string
}

export interface AIConfigManager {
  providers: AIProviderConfig[]
  currentModelId: number

  addProvider: (config: Omit<AIProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => number
  updateProvider: (index: number, config: Partial<AIProviderConfig>) => void
  deleteProvider: (index: number, config?: never) => void
  duplicateProvider: (index: number) => number
  setCurrentModelId: (index: number) => void

  getActiveProvider: () => AIProviderConfig | undefined
  getProviderByIndex: (index: number) => AIProviderConfig | undefined

  createFromTemplate: (template: AIProvider) => number
  getAvailableTemplates: () => Array<{ id: string; name: string; description: string }>
}

export interface AIConfigState {
  // AI配置管理器
  aiConfigManager: AIConfigManager

  // 向后兼容的AI配置（从当前激活的服务商获取）
  aiConfig: AIProviderConfig

  // Token使用量追踪
  tokenUsage: number
  addTokenUsage: (tokens: number) => void
  resetTokenUsage: () => void

  // 向后兼容的设置方法
  setAiProvider: (provider: AIProvider) => void
  setApiKey: (apiKey: string) => void
  setApiUrl: (apiUrl: string) => void
  setModel: (model: string) => void
  setTemperature: (temperature: number) => void
  setProxyUrl: (proxyUrl: string) => void
  setProxyEnabled: (enabled: boolean) => void

  // 新的AI服务商管理方法
  addAIProvider: (config: Omit<AIProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => number
  updateAIProvider: (index: number, config: Partial<AIProviderConfig>) => void
  deleteAIProvider: (index: number) => void
  duplicateAIProvider: (index: number) => number
  setCurrentModelId: (index: number) => void
  getActiveAIProvider: () => AIProviderConfig | undefined
  getAIProviderByIndex: (index: number) => AIProviderConfig | undefined
  createAIProviderFromTemplate: (template: AIProvider) => number
  getAvailableAITemplates: () => Array<{ id: string; name: string; description: string }>

  // 直接访问方法（兼容层）
  addProvider: (config: Omit<AIProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => number
  updateProvider: (index: number, config: Partial<AIProviderConfig>) => void
  deleteProvider: (index: number) => void
  duplicateProvider: (index: number) => number
  getProviderByIndex: (index: number) => AIProviderConfig | undefined
}
