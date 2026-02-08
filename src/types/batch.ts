/**
 * 批量处理相关类型定义
 */

import type { BatchQueueItem } from '../stores/batchQueueStore'

// ==================== 处理结果 ====================

/**
 * 单个文件的处理结果
 */
export interface BatchProcessingResult {
  success: boolean
  fileName: string
  outputPath?: string
  content?: string
  metadata?: {
    chapterCount: number
    processedChapters: number
    skippedChapters: number
    costUSD: number
    costRMB: number
    startTime: string
    endTime: string
    isPartial?: boolean
  }
  error?: string
}

/**
 * 批量处理汇总结果
 */
export interface BatchProcessingSummary {
  totalFiles: number
  successCount: number
  failedCount: number
  skippedCount: number
  totalCostUSD: number
  totalCostRMB: number
  results: BatchProcessingResult[]
  duration: number // 毫秒
}

// ==================== 回调函数 ====================

/**
 * 批量处理回调接口
 */
export interface BatchProcessingCallbacks {
  onItemStart?: (item: BatchQueueItem) => void
  onItemProgress?: (itemId: string, progress: number, message: string) => void
  onItemComplete?: (item: BatchQueueItem, result: BatchProcessingResult) => void
  onItemError?: (item: BatchQueueItem, error: string) => void
  onItemSkip?: (item: BatchQueueItem, reason: string) => void
  onQueueComplete?: (results: BatchProcessingSummary) => void
  onError?: (error: Error) => void
}

// ==================== 任务状态 ====================

/**
 * 批量处理任务状态
 */
export interface BatchProcessingStatus {
  isRunning: boolean
  isPaused: boolean
}

/**
 * 批量处理文件下载结果
 */
export interface BatchDownloadResult {
  success: boolean
  data?: ArrayBuffer
  error?: string
}
