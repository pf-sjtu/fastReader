/**
 * 处理选项类型定义
 */

import type { SupportedLanguage } from '../../services/prompts/utils'

export type ProcessingMode = 'summary' | 'mindmap' | 'combined-mindmap'
export type BookType = 'fiction' | 'non-fiction'
export type ChapterNamingMode = 'auto' | 'numbered'
export type ChapterDetectionMode = 'normal' | 'smart' | 'epub-toc'

export interface ProcessingOptions {
  processingMode: ProcessingMode
  bookType: BookType
  useSmartDetection: boolean
  skipNonEssentialChapters: boolean
  maxSubChapterDepth: number
  outputLanguage: SupportedLanguage
  chapterNamingMode: ChapterNamingMode
  enableNotification: boolean
  chapterDetectionMode: ChapterDetectionMode
  epubTocDepth: number
}

export interface AIServiceOptions {
  maxRetries?: number
  baseRetryDelay?: number
}

export interface ProcessingState {
  processingOptions: ProcessingOptions
  aiServiceOptions: AIServiceOptions

  // 处理选项设置方法
  setProcessingMode: (mode: ProcessingMode) => void
  setBookType: (type: BookType) => void
  setUseSmartDetection: (enabled: boolean) => void
  setSkipNonEssentialChapters: (enabled: boolean) => void
  setMaxSubChapterDepth: (depth: number) => void
  setOutputLanguage: (language: SupportedLanguage) => void
  setChapterNamingMode: (mode: ChapterNamingMode) => void
  setEnableNotification: (enabled: boolean) => void
  setChapterDetectionMode: (mode: ChapterDetectionMode) => void
  setEpubTocDepth: (depth: number) => void

  // AI服务选项设置方法
  setMaxRetries: (maxRetries: number) => void
  setBaseRetryDelay: (baseRetryDelay: number) => void
}
