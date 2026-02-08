/**
 * 提示词配置类型定义
 */

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

export interface PromptVersionConfig {
  v1: PromptConfig
  v2: PromptConfig
}

export interface PromptState {
  promptConfig: PromptConfig
  promptVersionConfig: PromptVersionConfig
  currentPromptVersion: 'v1' | 'v2'

  // 提示词配置设置方法
  setCurrentPromptVersion: (version: 'v1' | 'v2') => void
  setChapterSummaryPrompt: (
    bookType: 'fiction' | 'non-fiction',
    prompt: string
  ) => void
  setMindmapPrompt: (
    mindmapType: 'chapter' | 'arrow' | 'combined',
    prompt: string
  ) => void
  setConnectionAnalysisPrompt: (prompt: string) => void
  setOverallSummaryPrompt: (prompt: string) => void
  resetPromptsToDefault: () => void
  resetPromptsToDefaultForVersion: (version: 'v1' | 'v2') => void
}
