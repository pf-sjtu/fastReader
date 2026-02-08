// 处理选项Store
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProcessingOptions } from '../types'
import type { SupportedLanguage } from '../../services/prompts/utils'

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

export interface ProcessingState {
  processingOptions: ProcessingOptions

  // Actions
  setProcessingMode: (mode: 'summary' | 'mindmap' | 'combined-mindmap') => void
  setBookType: (type: 'fiction' | 'non-fiction') => void
  setUseSmartDetection: (enabled: boolean) => void
  setSkipNonEssentialChapters: (enabled: boolean) => void
  setMaxSubChapterDepth: (depth: number) => void
  setOutputLanguage: (language: SupportedLanguage) => void
  setChapterNamingMode: (mode: 'auto' | 'numbered') => void
  setEnableNotification: (enabled: boolean) => void
  setChapterDetectionMode: (mode: 'normal' | 'smart' | 'epub-toc') => void
  setEpubTocDepth: (depth: number) => void

  // 批量更新
  updateProcessingOptions: (options: Partial<ProcessingOptions>) => void

  // 重置
  resetProcessingOptions: () => void
}

export const useProcessingStore = create<ProcessingState>()(
  persist(
    (set) => ({
      processingOptions: defaultProcessingOptions,

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

      updateProcessingOptions: (options) =>
        set((state) => ({
          processingOptions: { ...state.processingOptions, ...options }
        })),

      resetProcessingOptions: () =>
        set({ processingOptions: defaultProcessingOptions })
    }),
    {
      name: 'ebook-processing-options',
      partialize: (state) => ({
        processingOptions: state.processingOptions
      })
    }
  )
)

// 便捷选择器
export const useProcessingOptions = () =>
  useProcessingStore((state) => state.processingOptions)
