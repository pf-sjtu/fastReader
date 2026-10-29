// 提示词模板索引（只保留 v2；v1 已废弃并删除）
import { loadPromptConfig, DEFAULT_PROMPT_VERSION } from '../config/promptLoader'
import type { PromptConfig } from '../../../types/ai'

const v2Config = loadPromptConfig('v2')

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

/** 内置默认提示词（唯一版本 v2） */
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
