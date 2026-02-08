import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_PROMPT_CONFIG,
  DEFAULT_PROMPT_CONFIG_V2
} from '../../services/prompts/templates'
import type { PromptConfig, PromptVersionConfig, PromptState } from './types'

const defaultPromptConfig: PromptConfig = DEFAULT_PROMPT_CONFIG
const defaultPromptVersionConfig: PromptVersionConfig = {
  v1: DEFAULT_PROMPT_CONFIG,
  v2: DEFAULT_PROMPT_CONFIG_V2
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
              [bookType]: prompt
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
            state.currentPromptVersion === version
              ? defaultConfig
              : state.promptConfig

          return {
            promptConfig: newPromptConfig,
            promptVersionConfig: updatedVersionConfig
          }
        })
    }),
    {
      name: 'prompt-config-store',
      partialize: (state) => ({
        promptConfig: state.promptConfig,
        promptVersionConfig: state.promptVersionConfig,
        currentPromptVersion: state.currentPromptVersion
      })
    }
  )
)

// 导出便捷选择器
export const usePromptConfig = () =>
  usePromptStore((state) => state.promptConfig)

export const usePromptVersionConfig = () =>
  usePromptStore((state) => state.promptVersionConfig)

export const useCurrentPromptVersion = () =>
  usePromptStore((state) => state.currentPromptVersion)
