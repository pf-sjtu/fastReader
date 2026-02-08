// 核心Store - Token使用追踪和AI服务选项
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AIServiceOptions } from '../types'

const defaultAIServiceOptions: AIServiceOptions = {
  maxRetries: 3,
  baseRetryDelay: 60000 // 60秒
}

export interface CoreState {
  // Token使用量追踪
  tokenUsage: number
  addTokenUsage: (tokens: number) => void
  resetTokenUsage: () => void

  // AI服务选项
  aiServiceOptions: AIServiceOptions
  setMaxRetries: (maxRetries: number) => void
  setBaseRetryDelay: (baseRetryDelay: number) => void

  // 批量更新
  updateAIServiceOptions: (options: Partial<AIServiceOptions>) => void

  // 重置
  resetCoreState: () => void
}

export const useCoreStore = create<CoreState>()(
  persist(
    (set) => ({
      tokenUsage: 0,
      aiServiceOptions: defaultAIServiceOptions,

      addTokenUsage: (tokens) =>
        set((state) => ({
          tokenUsage: state.tokenUsage + tokens
        })),

      resetTokenUsage: () =>
        set(() => ({
          tokenUsage: 0
        })),

      setMaxRetries: (maxRetries) =>
        set((state) => ({
          aiServiceOptions: { ...state.aiServiceOptions, maxRetries }
        })),

      setBaseRetryDelay: (baseRetryDelay) =>
        set((state) => ({
          aiServiceOptions: { ...state.aiServiceOptions, baseRetryDelay }
        })),

      updateAIServiceOptions: (options) =>
        set((state) => ({
          aiServiceOptions: { ...state.aiServiceOptions, ...options }
        })),

      resetCoreState: () =>
        set(() => ({
          tokenUsage: 0,
          aiServiceOptions: defaultAIServiceOptions
        }))
    }),
    {
      name: 'ebook-core-config',
      partialize: (state) => ({
        tokenUsage: state.tokenUsage,
        aiServiceOptions: state.aiServiceOptions
      })
    }
  )
)

// 便捷选择器
export const useTokenUsage = () => useCoreStore((state) => state.tokenUsage)
export const useAIServiceOptions = () => useCoreStore((state) => state.aiServiceOptions)
