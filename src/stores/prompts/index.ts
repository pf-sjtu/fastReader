// 提示词配置Store
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PromptConfig, PromptVersionConfig } from '../types'
import {
  DEFAULT_PROMPT_CONFIG,
  DEFAULT_PROMPT_CONFIG_V2
} from '../../services/prompts/templates'

const defaultPromptConfig: PromptConfig = DEFAULT_PROMPT_CONFIG
const defaultPromptVersionConfig: PromptVersionConfig = {
  v1: DEFAULT_PROMPT_CONFIG,
  v2: DEFAULT_PROMPT_CONFIG_V2
}

export interface PromptState {
  promptConfig: PromptConfig
  promptVersionConfig: PromptVersionConfig
  currentPromptVersion: 'v1' | 'v2'

  // Actions
  setCurrentPromptVersion: (version: 'v1' | 'v2') => void
  setChapterSummaryPrompt: (bookType: 'fiction' | 'non-fiction', prompt: string) => void
  setMindmapPrompt: (mindmapType: 'chapter' | 'arrow' | 'combined', prompt: string) => void
  setConnectionAnalysisPrompt: (prompt: string) => void
  setOverallSummaryPrompt: (prompt: string) => void
  resetPromptsToDefault: () => void
  resetPromptsToDefaultForVersion: (version: 'v1' | 'v2') => void

  // 批量更新
  updatePromptConfig: (config: Partial<PromptConfig>) => void
}

export const usePromptStore = create<PromptState>()(
  persist(
    (set) => ({
      promptConfig: defaultPromptConfig,
      promptVersionConfig: defaultPromptVersionConfig,
      currentPromptVersion: 'v1',

      setCurrentPromptVersion: (version) =>
        set((state) => {
          const newPromptConfig = state.promptVersionConfig[version]
          return {
            currentPromptVersion: version,
            promptConfig: newPromptConfig
          }
        }),

      setChapterSummaryPrompt: (bookType, prompt) =>
        set((state) => {
          const updatedConfig = {
            ...state.promptConfig,
            chapterSummary: {
              ...state.promptConfig.chapterSummary,
              [bookType === 'fiction' ? 'fiction' : 'nonFiction']: prompt
            }
          }
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]: updatedConfig
          }
          return {
            promptConfig: updatedConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),

      setMindmapPrompt: (mindmapType, prompt) =>
        set((state) => {
          const updatedConfig = {
            ...state.promptConfig,
            mindmap: {
              ...state.promptConfig.mindmap,
              [mindmapType]: prompt
            }
          }
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]: updatedConfig
          }
          return {
            promptConfig: updatedConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),

      setConnectionAnalysisPrompt: (prompt) =>
        set((state) => {
          const updatedConfig = {
            ...state.promptConfig,
            connectionAnalysis: prompt
          }
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]: updatedConfig
          }
          return {
            promptConfig: updatedConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),

      setOverallSummaryPrompt: (prompt) =>
        set((state) => {
          const updatedConfig = {
            ...state.promptConfig,
            overallSummary: prompt
          }
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]: updatedConfig
          }
          return {
            promptConfig: updatedConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),

      resetPromptsToDefault: () =>
        set((state) => ({
          promptConfig:
            state.currentPromptVersion === 'v1'
              ? DEFAULT_PROMPT_CONFIG
              : DEFAULT_PROMPT_CONFIG_V2,
          promptVersionConfig: {
            ...state.promptVersionConfig,
            [state.currentPromptVersion]:
              state.currentPromptVersion === 'v1'
                ? DEFAULT_PROMPT_CONFIG
                : DEFAULT_PROMPT_CONFIG_V2
          }
        })),

      resetPromptsToDefaultForVersion: (version) =>
        set((state) => {
          const defaultConfig =
            version === 'v1' ? DEFAULT_PROMPT_CONFIG : DEFAULT_PROMPT_CONFIG_V2
          const updatedVersionConfig = {
            ...state.promptVersionConfig,
            [version]: defaultConfig
          }
          const newPromptConfig =
            state.currentPromptVersion === version ? defaultConfig : state.promptConfig

          return {
            promptConfig: newPromptConfig,
            promptVersionConfig: updatedVersionConfig
          }
        }),

      updatePromptConfig: (config) =>
        set((state) => {
          const updatedConfig = { ...state.promptConfig, ...config }
          return {
            promptConfig: updatedConfig,
            promptVersionConfig: {
              ...state.promptVersionConfig,
              [state.currentPromptVersion]: updatedConfig
            }
          }
        })
    }),
    {
      name: 'ebook-prompt-config',
      partialize: (state) => ({
        promptConfig: state.promptConfig,
        promptVersionConfig: state.promptVersionConfig,
        currentPromptVersion: state.currentPromptVersion
      })
    }
  )
)

// 便捷选择器
export const usePromptConfig = () => usePromptStore((state) => state.promptConfig)
export const usePromptVersionConfig = () =>
  usePromptStore((state) => state.promptVersionConfig)
export const useCurrentPromptVersion = () =>
  usePromptStore((state) => state.currentPromptVersion)
