/**
 * 单书处理结果类型（前端单书 hook、批量引擎、云端缓存共用）
 */
import type { MindElixirData } from 'mind-elixir'
import type { BookCharts } from '@/charts'
import type { ChapterMeta } from '@/services/prompts/chapterMeta'

export interface Chapter {
  id: string
  title: string
  content: string
  summary?: string
  mindMap?: MindElixirData
  /** false 表示未处理或处理失败（失败时 summary 为 failedText 占位） */
  processed: boolean
  /** v3 旁路：一句话、要点、规范实体名等（仅本次会话/缓存，不写入云端 MD） */
  meta?: ChapterMeta
  /** 质量闸：仍有格式/长度问题时为 'warn'（已做过一次定向重写） */
  quality?: 'warn'
}

export interface BookSummary {
  title: string
  author: string
  chapters: Chapter[]
  connections: string
  overallSummary: string
  /** 关键图表结构化数据（实体关系 + 时间线等） */
  charts?: BookCharts | null
  chartsError?: string | null
}

export interface BookMindMap {
  title: string
  author: string
  chapters: Chapter[]
  combinedMindMap?: MindElixirData | null
}

export type ProcessingMode = 'summary' | 'mindmap' | 'combined-mindmap'
