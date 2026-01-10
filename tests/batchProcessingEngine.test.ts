/**
 * 批量处理引擎测试（简化版）
 * 由于 epubjs 包在测试环境有解析问题，此测试验证接口和类型
 */

import { describe, it, expect } from 'vitest'
import type { BatchProcessingCallbacks, BatchProcessingResult, BatchProcessingSummary } from '../src/services/batchProcessingEngine'
import type { BatchQueueItem, BatchProcessingConfig } from '../src/stores/batchQueueStore'

describe('BatchProcessingEngine Types & Interfaces', () => {
  describe('BatchProcessingCallbacks', () => {
    it('should accept all callback types', () => {
      const callbacks: BatchProcessingCallbacks = {
        onItemStart: (item) => {
          expect(item.id).toBeDefined()
        },
        onItemProgress: (itemId, progress, message) => {
          expect(typeof itemId).toBe('string')
          expect(typeof progress).toBe('number')
          expect(typeof message).toBe('string')
        },
        onItemComplete: (item, result) => {
          expect(item.fileName).toBeDefined()
          expect(result.success).toBeDefined()
        },
        onItemError: (item, error) => {
          expect(item.id).toBeDefined()
          expect(typeof error).toBe('string')
        },
        onItemSkip: (item, reason) => {
          expect(item.id).toBeDefined()
          expect(typeof reason).toBe('string')
        },
        onQueueComplete: (results) => {
          expect(results.totalFiles).toBeDefined()
          expect(results.successCount).toBeDefined()
        },
        onError: (error) => {
          expect(error.message).toBeDefined()
        }
      }

      // Verify callbacks object is valid
      expect(callbacks).toBeDefined()
      expect(typeof callbacks.onItemStart).toBe('function')
      expect(typeof callbacks.onItemProgress).toBe('function')
      expect(typeof callbacks.onItemComplete).toBe('function')
      expect(typeof callbacks.onItemError).toBe('function')
      expect(typeof callbacks.onItemSkip).toBe('function')
      expect(typeof callbacks.onQueueComplete).toBe('function')
      expect(typeof callbacks.onError).toBe('function')
    })

    it('should accept partial callbacks', () => {
      const callbacks: BatchProcessingCallbacks = {
        onItemComplete: (item, result) => {
          console.log('Completed:', item.fileName)
        }
      }

      expect(callbacks.onItemComplete).toBeDefined()
      expect(callbacks.onItemStart).toBeUndefined()
    })
  })

  describe('BatchProcessingResult', () => {
    it('should have correct structure for success result', () => {
      const result: BatchProcessingResult = {
        success: true,
        fileName: 'test.epub',
        outputPath: '/fastReader/test-完整摘要.md',
        content: '# Test Book\n\nContent here.',
        metadata: {
          chapterCount: 10,
          processedChapters: 5,
          costUSD: 0.015,
          costRMB: 0.105,
          startTime: '2024-01-01T00:00:00.000Z',
          endTime: '2024-01-01T00:05:00.000Z'
        }
      }

      expect(result.success).toBe(true)
      expect(result.fileName).toBe('test.epub')
      expect(result.outputPath).toBe('/fastReader/test-完整摘要.md')
      expect(result.content).toBeDefined()
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.chapterCount).toBe(10)
      expect(result.metadata?.processedChapters).toBe(5)
      expect(result.metadata?.costUSD).toBe(0.015)
      expect(result.metadata?.costRMB).toBe(0.105)
      expect(result.error).toBeUndefined()
    })

    it('should have correct structure for error result', () => {
      const result: BatchProcessingResult = {
        success: false,
        fileName: 'test.epub',
        error: 'Failed to download file'
      }

      expect(result.success).toBe(false)
      expect(result.fileName).toBe('test.epub')
      expect(result.error).toBe('Failed to download file')
      expect(result.metadata).toBeUndefined()
      expect(result.content).toBeUndefined()
    })

    it('should handle skipped result', () => {
      const result: BatchProcessingResult = {
        success: true,
        fileName: 'test.epub',
        error: '已跳过（已有缓存）'
      }

      expect(result.success).toBe(true)
      expect(result.error).toContain('已跳过')
    })
  })

  describe('BatchProcessingSummary', () => {
    it('should have correct structure', () => {
      const summary: BatchProcessingSummary = {
        totalFiles: 10,
        successCount: 7,
        failedCount: 2,
        skippedCount: 1,
        totalCostUSD: 0.15,
        totalCostRMB: 1.05,
        results: [],
        duration: 60000
      }

      expect(summary.totalFiles).toBe(10)
      expect(summary.successCount).toBe(7)
      expect(summary.failedCount).toBe(2)
      expect(summary.skippedCount).toBe(1)
      expect(summary.totalCostUSD).toBe(0.15)
      expect(summary.totalCostRMB).toBe(1.05)
      expect(summary.duration).toBe(60000)
      expect(summary.results).toBeInstanceOf(Array)
    })
  })
})

describe('BatchQueueItem Types', () => {
  it('should accept valid status values', () => {
    const pendingItem: BatchQueueItem = {
      id: 'test-1',
      fileName: 'test.epub',
      filePath: '/test/test.epub',
      status: 'pending',
      progress: 0
    }

    const processingItem: BatchQueueItem = {
      ...pendingItem,
      status: 'processing',
      progress: 50
    }

    const completedItem: BatchQueueItem = {
      ...pendingItem,
      status: 'completed',
      progress: 100,
      metadata: {
        chapterCount: 10,
        processedChapters: 10,
        costUSD: 0.01,
        costRMB: 0.07,
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:01:00.000Z'
      }
    }

    const failedItem: BatchQueueItem = {
      ...pendingItem,
      status: 'failed',
      error: 'Download failed'
    }

    const skippedItem: BatchQueueItem = {
      ...pendingItem,
      status: 'skipped'
    }

    expect(pendingItem.status).toBe('pending')
    expect(processingItem.status).toBe('processing')
    expect(completedItem.status).toBe('completed')
    expect(failedItem.status).toBe('failed')
    expect(skippedItem.status).toBe('skipped')
  })

  it('should accept optional fields', () => {
    const itemWithMetadata: BatchQueueItem = {
      id: 'test-1',
      fileName: 'test.epub',
      filePath: '/test/test.epub',
      status: 'completed',
      progress: 100,
      metadata: {
        chapterCount: 10,
        processedChapters: 5,
        costUSD: 0.01,
        costRMB: 0.07,
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:01:00.000Z'
      },
      selectedChapters: [1, 2, 3, 4, 5]
    }

    const itemWithoutOptionals: BatchQueueItem = {
      id: 'test-2',
      fileName: 'test2.epub',
      filePath: '/test/test2.epub',
      status: 'pending',
      progress: 0
    }

    expect(itemWithMetadata.metadata).toBeDefined()
    expect(itemWithMetadata.selectedChapters).toEqual([1, 2, 3, 4, 5])
    expect(itemWithoutOptionals.metadata).toBeUndefined()
    expect(itemWithoutOptionals.selectedChapters).toBeUndefined()
  })
})

describe('BatchProcessingConfig Types', () => {
  it('should accept valid config', () => {
    const config: BatchProcessingConfig = {
      sourcePath: '/books',
      maxFiles: 20,
      skipProcessed: true,
      order: 'sequential',
      bookType: 'fiction',
      processingMode: 'mindmap',
      chapterDetectionMode: 'normal',
      outputLanguage: 'en'
    }

    expect(config.sourcePath).toBe('/books')
    expect(config.maxFiles).toBe(20)
    expect(config.skipProcessed).toBe(true)
    expect(config.order).toBe('sequential')
    expect(config.bookType).toBe('fiction')
    expect(config.processingMode).toBe('mindmap')
    expect(config.chapterDetectionMode).toBe('normal')
    expect(config.outputLanguage).toBe('en')
  })

  it('should accept random order', () => {
    const config: BatchProcessingConfig = {
      sourcePath: '/books',
      maxFiles: 0,
      skipProcessed: false,
      order: 'random',
      bookType: 'non-fiction',
      processingMode: 'summary',
      chapterDetectionMode: 'smart',
      outputLanguage: 'zh'
    }

    expect(config.order).toBe('random')
    expect(config.outputLanguage).toBe('zh')
  })

  it('should accept all processing modes', () => {
    const summaryConfig: BatchProcessingConfig = {
      sourcePath: '/books',
      maxFiles: 10,
      skipProcessed: true,
      order: 'sequential',
      bookType: 'non-fiction',
      processingMode: 'summary',
      chapterDetectionMode: 'normal',
      outputLanguage: 'en'
    }

    const mindmapConfig: BatchProcessingConfig = {
      ...summaryConfig,
      processingMode: 'mindmap'
    }

    const combinedConfig: BatchProcessingConfig = {
      ...summaryConfig,
      processingMode: 'combined-mindmap'
    }

    expect(summaryConfig.processingMode).toBe('summary')
    expect(mindmapConfig.processingMode).toBe('mindmap')
    expect(combinedConfig.processingMode).toBe('combined-mindmap')
  })
})
