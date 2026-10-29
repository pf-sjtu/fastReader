// Store 共享类型定义
import type { SupportedLanguage } from '../services/prompts/utils'
import type { SecretRef } from '../types/ai'

export type {
  AIProviderType,
  AIProtocol,
  AIProviderConfig,
  AIServiceOptions,
  ProviderEntry,
  ProviderModel,
  ProviderModelMeta,
  SecretRef,
  AIState,
} from '../types/ai'

// 提示词配置接口
export type { PromptConfig } from '../types/ai'

/** 提示词覆盖项：只保存与内置默认值不同的条目 */
export interface PromptOverrides {
  chapterSummary?: {
    fiction?: string
    nonFiction?: string
  }
  mindmap?: {
    chapter?: string
    arrow?: string
    combined?: string
  }
  connectionAnalysis?: string
  overallSummary?: string
}

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
  /**
   * 章节级 AI 并行上限（1–10）。默认 3。
   * 并行执行时结果仍按章节选择顺序提交/呈现。
   */
  chapterConcurrency: number
}

// WebDAV配置接口
export interface WebDAVConfig {
  enabled: boolean
  serverUrl: string
  username: string
  /** 秘密字段：客户端只知道是否已配置，明文只存在于服务端 */
  password?: SecretRef
  appName: string
  autoSync: boolean
  syncPath: string
  browsePath: string
  lastSyncTime: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
}

/** USD → CNY 汇率（共享处理配置的一部分） */
export const DEFAULT_EXCHANGE_RATE = 7.0
