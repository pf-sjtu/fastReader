// Store共享类型定义
import type { SupportedLanguage } from '../services/prompts/utils'

// 提示词配置接口
export interface PromptConfig {
  chapterSummary: {
    fiction: string
    nonFiction: string
  }
  mindmap: {
    chapter: string
    arrow: string
    combined: string
  }
  connectionAnalysis: string
  overallSummary: string
}

// 提示词版本配置接口
export interface PromptVersionConfig {
  v1: PromptConfig
  v2: PromptConfig
}

// 单个AI服务商配置接口
export interface AIProviderConfig {
  provider: 'gemini' | 'openai' | 'ollama' | '302.ai' | 'custom'
  apiKey: string
  apiUrl: string
  model: string
  temperature: number
  proxyUrl?: string
  proxyEnabled?: boolean
  customFields?: Record<string, unknown>
}

// AI配置管理接口
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

  createFromTemplate: (template: 'gemini' | 'openai' | 'ollama' | '302.ai') => number
  getAvailableTemplates: () => Array<{ id: string; name: string; description: string }>
}

/** @deprecated 使用 AIProviderConfig 替代 */
export type AIConfig = AIProviderConfig

// 处理选项接口
export interface ProcessingOptions {
  processingMode: 'summary' | 'mindmap' | 'combined-mindmap'
  bookType: 'fiction' | 'non-fiction'
  useSmartDetection: boolean
  skipNonEssentialChapters: boolean
  maxSubChapterDepth: number
  outputLanguage: SupportedLanguage
  chapterNamingMode: 'auto' | 'numbered'
  enableNotification: boolean
  chapterDetectionMode: 'normal' | 'smart' | 'epub-toc'
  epubTocDepth: number
}

// WebDAV配置接口
export interface WebDAVConfig {
  enabled: boolean
  serverUrl: string
  username: string
  password: string
  appName: string
  autoSync: boolean
  syncPath: string
  browsePath: string
  lastSyncTime: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
}

// AI服务选项接口
export interface AIServiceOptions {
  maxRetries?: number
  baseRetryDelay?: number
}
