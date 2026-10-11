// 提示词模板索引
import { 
  loadPromptConfig
} from '../config/promptLoader'

// 加载v1和v2版本的配置
const v1Config = loadPromptConfig('v1')
const v2Config = loadPromptConfig('v2')

// 导出v1版本的模板（保持向后兼容）
export const CHAPTER_SUMMARY_TEMPLATES = {
  fiction: {
    name: '小说类章节总结',
    template: v1Config.chapterSummary.fiction
  },
  nonFiction: {
    name: '社科类章节总结',
    template: v1Config.chapterSummary.nonFiction
  }
} as const

export const MINDMAP_TEMPLATES = {
  chapter: {
    name: '章节思维导图',
    template: v1Config.mindmap.chapter
  },
  arrow: {
    name: '思维导图箭头连接',
    template: v1Config.mindmap.arrow
  },
  combined: {
    name: '整书思维导图',
    template: v1Config.mindmap.combined
  }
} as const

export const CONNECTION_ANALYSIS_TEMPLATES = {
  standard: {
    name: '标准章节关联分析',
    template: v1Config.connectionAnalysis
  }
} as const

export const OVERALL_SUMMARY_TEMPLATES = {
  standard: {
    name: '标准全书总结',
    template: v1Config.overallSummary
  }
} as const

// 导出v2版本的模板
export const CHAPTER_SUMMARY_TEMPLATES_V2 = {
  fiction: {
    name: '小说类章节总结 V2',
    template: v2Config.chapterSummary.fiction
  },
  nonFiction: {
    name: '社科类章节总结 V2',
    template: v2Config.chapterSummary.nonFiction
  }
} as const

export const MINDMAP_TEMPLATES_V2 = {
  chapter: {
    name: '章节思维导图 V2',
    template: v2Config.mindmap.chapter
  },
  arrow: {
    name: '思维导图箭头连接 V2',
    template: v2Config.mindmap.arrow
  },
  combined: {
    name: '整书思维导图 V2',
    template: v2Config.mindmap.combined
  }
} as const

export const CONNECTION_ANALYSIS_TEMPLATES_V2 = {
  standard: {
    name: '标准章节关联分析 V2',
    template: v2Config.connectionAnalysis
  }
} as const

export const OVERALL_SUMMARY_TEMPLATES_V2 = {
  standard: {
    name: '标准全书总结 V2',
    template: v2Config.overallSummary
  }
} as const

// 默认提示词配置（保持向后兼容）
export const DEFAULT_PROMPT_CONFIG = {
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
} as const

// 第二版默认提示词配置
export const DEFAULT_PROMPT_CONFIG_V2 = {
  chapterSummary: {
    fiction: CHAPTER_SUMMARY_TEMPLATES_V2.fiction.template,
    nonFiction: CHAPTER_SUMMARY_TEMPLATES_V2.nonFiction.template
  },
  mindmap: {
    chapter: MINDMAP_TEMPLATES_V2.chapter.template,
    arrow: MINDMAP_TEMPLATES_V2.arrow.template,
    combined: MINDMAP_TEMPLATES_V2.combined.template
  },
  connectionAnalysis: CONNECTION_ANALYSIS_TEMPLATES_V2.standard.template,
  overallSummary: OVERALL_SUMMARY_TEMPLATES_V2.standard.template
} as const

// 提示词类型定义
export type PromptType = 'chapterSummary' | 'mindmap' | 'connectionAnalysis' | 'overallSummary'
export type BookType = 'fiction' | 'non-fiction'
export type MindmapType = 'chapter' | 'arrow' | 'combined'
export type PromptVersion = 'v1' | 'v2'

/** 默认 prompt 版本（v2 结构更完整）；新用户、重置、未配置时的兜底均以此为准，CLI 的 DEFAULT_PROMPT_VERSION 与之保持一致 */
export const DEFAULT_PROMPT_VERSION: PromptVersion = 'v2'

export const DEFAULT_PROMPT_CONFIG_BY_VERSION = {
  v1: DEFAULT_PROMPT_CONFIG,
  v2: DEFAULT_PROMPT_CONFIG_V2,
} as const
