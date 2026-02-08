import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ProcessingOptions,
  AIServiceOptions,
  ProcessingState
} from './types'

const defaultProcessingOptions: ProcessingOptions = {
  processingMode: 'mindmap',
  bookType: 'non-fiction',
  useSmartDetection: false,
  skipNonEssentialChapters: true,
  maxSubChapterDepth: 0,
  outputLanguage: 'en',
  chapterNamingMode: 'auto',
  enableNotification: true,
  chapterDetectionMode: 'normal',
  epubTocDepth: 1
}

const defaultAIServiceOptions: AIServiceOptions = {
  maxRetries: 3,
  baseRetryDelay: 60000 // 60秒
}

export const useProcessingStore = create<ProcessingState>()(
  persist(
    (set) => ({
      processingOptions: defaultProcessingOptions,
      aiServiceOptions: defaultAIServiceOptions,

      // 处理选项设置方法
      setProcessingMode: (processingMode) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, processingMode }
        })),

      setBookType: (bookType) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, bookType }
        })),

      setUseSmartDetection: (useSmartDetection) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, useSmartDetection }
        })),

      setSkipNonEssentialChapters: (skipNonEssentialChapters) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, skipNonEssentialChapters }
        })),

      setMaxSubChapterDepth: (maxSubChapterDepth) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, maxSubChapterDepth }
        })),

      setOutputLanguage: (outputLanguage) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, outputLanguage }
        })),

      setChapterNamingMode: (chapterNamingMode) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, chapterNamingMode }
        })),

      setEnableNotification: (enableNotification) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, enableNotification }
        })),

      setChapterDetectionMode: (chapterDetectionMode) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, chapterDetectionMode }
        })),

      setEpubTocDepth: (epubTocDepth) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, epubTocDepth }
        })),

      // AI服务选项设置方法
      setMaxRetries: (maxRetries) =>
        set((state) => ({
          aiServiceOptions: { ...state.aiServiceOptions, maxRetries }
        })),

      setBaseRetryDelay: (baseRetryDelay) =>
        set((state) => ({
          aiServiceOptions: { ...state.aiServiceOptions, baseRetryDelay }
        }))
    }),
    {
      name: 'processing-options-store',
      partialize: (state) => ({
        processingOptions: state.processingOptions,
        aiServiceOptions: state.aiServiceOptions
      })
    }
  )
)

// 导出便捷选择器
export const useProcessingOptions = () =>
  useProcessingStore((state) => state.processingOptions)

export const useAIServiceOptions = () =>
  useProcessingStore((state) => state.aiServiceOptions)
