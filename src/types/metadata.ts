/**
 * 元数据相关类型定义
 */

// ==================== 处理元数据 ====================

/**
 * AI 响应信息
 */
export interface AIResponseInfo {
  inputTokens: number
  outputTokens: number
}

/**
 * 处理元数据（用于生成文件头部）
 */
export interface ProcessingMetadata {
  /** 文件名 */
  fileName: string
  /** 书籍标题 */
  bookTitle: string
  /** 使用的模型 */
  model: string
  /** 章节检测模式 */
  chapterDetectionMode: string
  /** 选中的章节 */
  selectedChapters: number[]
  /** 选中的章节数 */
  selectedChapterCount: number
  /** 总章节数 */
  chapterCount: number
  /** 原始字符数 */
  originalCharCount: number
  /** 处理后字符数 */
  processedCharCount: number
  /** 跳过的章节数 */
  skippedChapters: number
  /** 是否部分处理 */
  isPartial: boolean
  /** AI 响应信息 */
  aiResponseInfo: AIResponseInfo
  /** 费用（美元） */
  costUSD: number
  /** 费用（人民币） */
  costRMB: number
}

/**
 * 元数据格式化选项
 */
export interface MetadataFormatterOptions {
  /** 汇率（USD 到 CNY） */
  exchangeRate?: number
}

// ==================== 书籍数据结构 ====================

/**
 * 章节摘要
 */
export interface ChapterSummary {
  id: string
  title: string
  summary: string
}

/**
 * 书籍数据结构（用于格式化输出）
 */
export interface BookDataForFormatting {
  title: string
  author: string
  chapters: ChapterSummary[]
  overallSummary: string
  connections: string
}

// ==================== 缓存元数据 ====================

/**
 * 缓存文件元数据
 */
export interface CacheFileMetadata {
  /** 来源 */
  source: string
  /** 文件名 */
  fileName: string
  /** 处理时间 */
  processedAt: string
  /** 模型 */
  model: string
  /** 章节信息 */
  chapters: {
    total: number
    processed: number
  }
  /** Token 使用 */
  tokens: {
    input: number
    output: number
  }
  /** 费用 */
  cost: {
    usd: number
    cny: number
  }
}
