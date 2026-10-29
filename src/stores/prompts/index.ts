/**
 * 提示词 store：只保存「相对内置 v2 默认值的覆盖项」。
 *
 * 内置模板升级后，用户没改过的条目会自动跟随新默认值。
 */
import { create } from 'zustand'
import type { PromptConfig } from '../../types/ai'
import type { PromptOverrides } from '../types'
import { DEFAULT_PROMPT_CONFIG } from '../../services/prompts/templates'
import { mergePromptOverrides } from '../../services/prompts/overrides'
import { markDirty, registerSection } from '../../services/shared/sharedState'

const SECTION = 'prompts' as const

/** 覆盖项里出现空字符串视为「显式清空」，与默认值不同 → 需要保留 */
function normalize(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export interface PromptState {
  overrides: PromptOverrides
  /** 派生：默认值 + 覆盖项 */
  promptConfig: PromptConfig

  setChapterSummaryPrompt: (bookType: 'fiction' | 'non-fiction', prompt: string) => void
  setMindmapPrompt: (mindmapType: 'chapter' | 'arrow' | 'combined', prompt: string) => void
  setConnectionAnalysisPrompt: (prompt: string) => void
  setOverallSummaryPrompt: (prompt: string) => void
  /** 恢复某一条为内置默认 */
  resetPrompt: (path: PromptPath) => void
  resetAllPrompts: () => void
  /** 整体替换（导入 / hydrate） */
  replacePrompts: (overrides: PromptOverrides) => void
}

export type PromptPath =
  | { group: 'chapterSummary'; key: 'fiction' | 'nonFiction' }
  | { group: 'mindmap'; key: 'chapter' | 'arrow' | 'combined' }
  | { group: 'connectionAnalysis' }
  | { group: 'overallSummary' }

function derive(overrides: PromptOverrides): PromptConfig {
  return mergePromptOverrides(DEFAULT_PROMPT_CONFIG, overrides)
}

function setIn(
  overrides: PromptOverrides,
  path: PromptPath,
  prompt: string | undefined
): PromptOverrides {
  const next: PromptOverrides = {
    ...overrides,
    ...(overrides.chapterSummary ? { chapterSummary: { ...overrides.chapterSummary } } : {}),
    ...(overrides.mindmap ? { mindmap: { ...overrides.mindmap } } : {}),
  }

  if (path.group === 'chapterSummary') {
    const group = { ...(next.chapterSummary ?? {}) }
    const value = normalize(prompt)
    if (value === undefined) delete group[path.key]
    else group[path.key] = value
    next.chapterSummary = group
  } else if (path.group === 'mindmap') {
    const group = { ...(next.mindmap ?? {}) }
    const value = normalize(prompt)
    if (value === undefined) delete group[path.key]
    else group[path.key] = value
    next.mindmap = group
  } else if (path.group === 'connectionAnalysis') {
    const value = normalize(prompt)
    if (value === undefined) delete next.connectionAnalysis
    else next.connectionAnalysis = value
  } else {
    const value = normalize(prompt)
    if (value === undefined) delete next.overallSummary
    else next.overallSummary = value
  }

  return next
}

export const usePromptStore = create<PromptState>()((set, get) => {
  const commit = (overrides: PromptOverrides) => {
    set({ overrides, promptConfig: derive(overrides) })
    markDirty(SECTION)
  }

  return {
    overrides: {},
    promptConfig: derive({}),

    setChapterSummaryPrompt: (bookType, prompt) => {
      const key = bookType === 'fiction' ? 'fiction' : 'nonFiction'
      const defaultText = DEFAULT_PROMPT_CONFIG.chapterSummary[key]
      // 与默认一致时不写覆盖项，保持「跟随默认」
      const value = prompt === defaultText ? undefined : prompt
      commit(setIn(get().overrides, { group: 'chapterSummary', key }, value))
    },

    setMindmapPrompt: (mindmapType, prompt) => {
      const defaultText = DEFAULT_PROMPT_CONFIG.mindmap[mindmapType]
      commit(
        setIn(get().overrides, { group: 'mindmap', key: mindmapType }, prompt === defaultText ? undefined : prompt)
      )
    },

    setConnectionAnalysisPrompt: (prompt) =>
      commit(
        setIn(
          get().overrides,
          { group: 'connectionAnalysis' },
          prompt === DEFAULT_PROMPT_CONFIG.connectionAnalysis ? undefined : prompt
        )
      ),

    setOverallSummaryPrompt: (prompt) =>
      commit(
        setIn(
          get().overrides,
          { group: 'overallSummary' },
          prompt === DEFAULT_PROMPT_CONFIG.overallSummary ? undefined : prompt
        )
      ),

    resetPrompt: (path) => commit(setIn(get().overrides, path, undefined)),

    resetAllPrompts: () => commit({}),

    replacePrompts: (overrides) => commit(overrides ?? {}),
  }
})

registerSection<PromptOverrides>(
  SECTION,
  {
    getData: () => usePromptStore.getState().overrides,
    setData: (data) => {
      const overrides: PromptOverrides =
        data && typeof data === 'object'
          ? {
              ...(data.chapterSummary ? { chapterSummary: data.chapterSummary } : {}),
              ...(data.mindmap ? { mindmap: data.mindmap } : {}),
              ...(typeof data.connectionAnalysis === 'string' ? { connectionAnalysis: data.connectionAnalysis } : {}),
              ...(typeof data.overallSummary === 'string' ? { overallSummary: data.overallSummary } : {}),
            }
          : {}
      usePromptStore.setState({ overrides, promptConfig: derive(overrides) })
    },
    debounceMs: 800,
  },
  { autoWrite: false }
)

// 便捷选择器
export const usePromptConfig = () => usePromptStore((state) => state.promptConfig)
export const usePromptOverrides = () => usePromptStore((state) => state.overrides)
