// 提示词模板索引（默认版本；v1 已废弃并删除）
import { loadPromptConfig, DEFAULT_PROMPT_VERSION } from '../config/promptLoader'
import type { PromptConfig } from '../../../types/ai'

const v2Config = loadPromptConfig(DEFAULT_PROMPT_VERSION)

export const CHAPTER_SUMMARY_TEMPLATES = {
  fiction: {
    name: '小说类章节总结',
    template: v2Config.chapterSummary.fiction
  },
  nonFiction: {
    name: '社科类章节总结',
    template: v2Config.chapterSummary.nonFiction
  }
} as const

export const MINDMAP_TEMPLATES = {
  chapter: {
    name: '章节思维导图',
    template: v2Config.mindmap.chapter
  },
  arrow: {
    name: '思维导图箭头连接',
    template: v2Config.mindmap.arrow
  },
  combined: {
    name: '整书思维导图',
    template: v2Config.mindmap.combined
  }
} as const

export const CONNECTION_ANALYSIS_TEMPLATES = {
  standard: {
    name: '标准章节关联分析',
    template: v2Config.connectionAnalysis
  }
} as const

export const OVERALL_SUMMARY_TEMPLATES = {
  standard: {
    name: '标准全书总结',
    template: v2Config.overallSummary
  }
} as const

/**
 * v2 内置提示词：只用于导入旧配置（1.0.0 导出 / 旧版本地存档）时求「覆盖项」——
 * 旧配置里没改过的条目等于 v2 默认文本，不应被当成用户覆盖而钉死在 v2 上，而要跟随当前默认（v3）。
 */
export const LEGACY_V2_PROMPT_CONFIG: PromptConfig = (() => {
  const v2 = loadPromptConfig('v2')
  return {
    chapterSummary: { fiction: v2.chapterSummary.fiction, nonFiction: v2.chapterSummary.nonFiction },
    mindmap: { chapter: v2.mindmap.chapter, arrow: v2.mindmap.arrow, combined: v2.mindmap.combined },
    connectionAnalysis: v2.connectionAnalysis,
    overallSummary: v2.overallSummary
  }
})()

/** 内置默认提示词（当前默认版本，见 DEFAULT_PROMPT_VERSION） */
export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  chapterSummary: {
    fiction: CHAPTER_SUMMARY_TEMPLATES.fiction.template,
    nonFiction: CHAPTER_SUMMARY_TEMPLATES.nonFiction.template
  },
  mindmap: {
    chapter: MINDMAP_TEMPLATES.chapter.template,
    arrow: MINDMAP_TEMPLATES.arrow.template,
    combined: MINDMAP_TEMPLATES.combined.template
  },
  connectionAnalysis: CONNECTION_ANALYSIS_TEMPLATES.standard.template,
  overallSummary: OVERALL_SUMMARY_TEMPLATES.standard.template
}

// 提示词类型定义
export type PromptType = 'chapterSummary' | 'mindmap' | 'connectionAnalysis' | 'overallSummary'
export type BookType = 'fiction' | 'non-fiction'
export type MindmapType = 'chapter' | 'arrow' | 'combined'

export { DEFAULT_PROMPT_VERSION }
