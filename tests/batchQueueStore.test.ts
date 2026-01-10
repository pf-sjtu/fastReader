/**
 * 批量队列 Store 测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useBatchQueueStore, type BatchQueueItem, type BatchProcessingConfig, type QueueItemStatus } from '../src/stores/batchQueueStore'

describe('BatchQueueStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useBatchQueueStore.setState({
      queue: [],
      config: null,
      isProcessing: false,
      isPaused: false,
      currentItemIndex: -1,
      stats: {
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        totalCostUSD: 0,
        totalCostRMB: 0
      }
    })
  })

  describe('initial state', () => {
    it('should have empty queue', () => {
      const state = useBatchQueueStore.getState()
      expect(state.queue).toEqual([])
    })

    it('should not be processing', () => {
      const state = useBatchQueueStore.getState()
      expect(state.isProcessing).toBe(false)
      expect(state.isPaused).toBe(false)
    })

    it('should have zero stats', () => {
      const state = useBatchQueueStore.getState()
      expect(state.stats.total).toBe(0)
      expect(state.stats.completed).toBe(0)
      expect(state.stats.failed).toBe(0)
      expect(state.stats.skipped).toBe(0)
    })
  })

  describe('setConfig', () => {
    it('should set config', () => {
      const config: BatchProcessingConfig = {
        sourcePath: '/test',
        maxFiles: 10,
        skipProcessed: true,
        order: 'sequential',
        bookType: 'fiction',
        processingMode: 'summary',
        chapterDetectionMode: 'normal',
        outputLanguage: 'en'
      }

      useBatchQueueStore.getState().setConfig(config)

      const state = useBatchQueueStore.getState()
      expect(state.config).toEqual(config)
    })
  })

  describe('addToQueue', () => {
    it('should add items to queue', () => {
      const items = [
        { fileName: 'test1.epub', filePath: '/test/test1.epub' },
        { fileName: 'test2.epub', filePath: '/test/test2.epub' }
      ]

      useBatchQueueStore.getState().addToQueue(items)

      const state = useBatchQueueStore.getState()
      expect(state.queue.length).toBe(2)
      expect(state.stats.total).toBe(2)
    })

    it('should set default status and progress', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)

      const item = useBatchQueueStore.getState().queue[0]
      expect(item.status).toBe('pending')
      expect(item.progress).toBe(0)
      expect(item.id).toBeDefined()
    })
  })

  describe('removeFromQueue', () => {
    it('should remove item from queue', () => {
      const items = [
        { fileName: 'test1.epub', filePath: '/test/test1.epub' },
        { fileName: 'test2.epub', filePath: '/test/test2.epub' }
      ]
      useBatchQueueStore.getState().addToQueue(items)

      const queue = useBatchQueueStore.getState().queue
      const itemId = queue[0].id
      useBatchQueueStore.getState().removeFromQueue(itemId)

      const state = useBatchQueueStore.getState()
      expect(state.queue.length).toBe(1)
      expect(state.stats.total).toBe(1)
    })

    it('should update stats when removing completed item', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)

      // Mark as completed
      const item = useBatchQueueStore.getState().queue[0]
      useBatchQueueStore.getState().markItemCompleted(item.id, {
        chapterCount: 10,
        processedChapters: 10,
        costUSD: 0.01,
        costRMB: 0.07,
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:01:00.000Z'
      })

      // Remove the completed item
      useBatchQueueStore.getState().removeFromQueue(item.id)

      const state = useBatchQueueStore.getState()
      expect(state.stats.completed).toBe(0)
      expect(state.stats.total).toBe(0)
    })
  })

  describe('clearQueue', () => {
    it('should clear all items', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)
      useBatchQueueStore.getState().clearQueue()

      const state = useBatchQueueStore.getState()
      expect(state.queue.length).toBe(0)
      expect(state.stats.total).toBe(0)
    })
  })

  describe('startProcessing', () => {
    it('should not start if queue is empty', () => {
      useBatchQueueStore.getState().startProcessing()
      const state = useBatchQueueStore.getState()
      expect(state.isProcessing).toBe(false)
    })

    it('should start processing when items exist', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)
      useBatchQueueStore.getState().startProcessing()

      const state = useBatchQueueStore.getState()
      expect(state.isProcessing).toBe(true)
      expect(state.isPaused).toBe(false)
      expect(state.currentItemIndex).toBe(0)
    })
  })

  describe('pause/resume', () => {
    it('should pause processing', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)
      useBatchQueueStore.getState().startProcessing()

      useBatchQueueStore.getState().pauseProcessing()

      const state = useBatchQueueStore.getState()
      expect(state.isPaused).toBe(true)
    })

    it('should resume processing', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)
      useBatchQueueStore.getState().startProcessing()
      useBatchQueueStore.getState().pauseProcessing()

      useBatchQueueStore.getState().resumeProcessing()

      const state = useBatchQueueStore.getState()
      expect(state.isPaused).toBe(false)
    })
  })

  describe('stopProcessing', () => {
    it('should stop processing', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)
      useBatchQueueStore.getState().startProcessing()

      useBatchQueueStore.getState().stopProcessing()

      const state = useBatchQueueStore.getState()
      expect(state.isProcessing).toBe(false)
      expect(state.isPaused).toBe(false)
    })
  })

  describe('updateItem', () => {
    it('should update item properties', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)

      const item = useBatchQueueStore.getState().queue[0]
      useBatchQueueStore.getState().updateItem(item.id, { progress: 50 })

      const updatedItem = useBatchQueueStore.getState().queue.find(i => i.id === item.id)
      expect(updatedItem?.progress).toBe(50)
    })
  })

  describe('markItemCompleted', () => {
    it('should mark item as completed and update stats', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)

      const item = useBatchQueueStore.getState().queue[0]
      useBatchQueueStore.getState().markItemCompleted(item.id, {
        chapterCount: 10,
        processedChapters: 10,
        costUSD: 0.01,
        costRMB: 0.07,
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:01:00.000Z'
      })

      const state = useBatchQueueStore.getState()
      const completedItem = state.queue.find(i => i.id === item.id)

      expect(completedItem?.status).toBe('completed')
      expect(completedItem?.progress).toBe(100)
      expect(state.stats.completed).toBe(1)
      expect(state.stats.totalCostUSD).toBe(0.01)
      expect(state.stats.totalCostRMB).toBe(0.07)
    })
  })

  describe('markItemFailed', () => {
    it('should mark item as failed and update stats', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)

      const item = useBatchQueueStore.getState().queue[0]
      useBatchQueueStore.getState().markItemFailed(item.id, 'Download failed')

      const state = useBatchQueueStore.getState()
      const failedItem = state.queue.find(i => i.id === item.id)

      expect(failedItem?.status).toBe('failed')
      expect(failedItem?.error).toBe('Download failed')
      expect(state.stats.failed).toBe(1)
    })
  })

  describe('markItemSkipped', () => {
    it('should mark item as skipped and update stats', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)

      const item = useBatchQueueStore.getState().queue[0]
      useBatchQueueStore.getState().markItemSkipped(item.id)

      const state = useBatchQueueStore.getState()
      const skippedItem = state.queue.find(i => i.id === item.id)

      expect(skippedItem?.status).toBe('skipped')
      expect(state.stats.skipped).toBe(1)
    })
  })

  describe('nextItem', () => {
    it('should move to next pending item', () => {
      const items = [
        { fileName: 'test1.epub', filePath: '/test/test1.epub' },
        { fileName: 'test2.epub', filePath: '/test/test2.epub' }
      ]
      useBatchQueueStore.getState().addToQueue(items)
      useBatchQueueStore.getState().startProcessing()

      // Mark first item as completed
      const firstItem = useBatchQueueStore.getState().queue[0]
      useBatchQueueStore.getState().markItemCompleted(firstItem.id, {
        chapterCount: 10,
        processedChapters: 10,
        costUSD: 0.01,
        costRMB: 0.07,
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:01:00.000Z'
      })

      useBatchQueueStore.getState().nextItem()

      const state = useBatchQueueStore.getState()
      expect(state.currentItemIndex).toBe(1)
    })

    it('should stop processing when no more items', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)
      useBatchQueueStore.getState().startProcessing()

      // Mark as completed
      const item = useBatchQueueStore.getState().queue[0]
      useBatchQueueStore.getState().markItemCompleted(item.id, {
        chapterCount: 10,
        processedChapters: 10,
        costUSD: 0.01,
        costRMB: 0.07,
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:01:00.000Z'
      })

      useBatchQueueStore.getState().nextItem()

      const state = useBatchQueueStore.getState()
      expect(state.isProcessing).toBe(false)
      expect(state.currentItemIndex).toBe(-1)
    })
  })

  describe('getNextPendingItem', () => {
    it('should return next pending item', () => {
      const items = [
        { fileName: 'test1.epub', filePath: '/test/test1.epub' },
        { fileName: 'test2.epub', filePath: '/test/test2.epub' }
      ]
      useBatchQueueStore.getState().addToQueue(items)

      const nextPending = useBatchQueueStore.getState().getNextPendingItem()
      expect(nextPending?.fileName).toBe('test1.epub')
    })

    it('should return null when no pending items', () => {
      const nextPending = useBatchQueueStore.getState().getNextPendingItem()
      expect(nextPending).toBeNull()
    })
  })

  describe('getCurrentItem', () => {
    it('should return current item', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)
      useBatchQueueStore.getState().startProcessing()

      const currentItem = useBatchQueueStore.getState().getCurrentItem()
      expect(currentItem?.fileName).toBe('test.epub')
    })

    it('should return null when no current item', () => {
      const currentItem = useBatchQueueStore.getState().getCurrentItem()
      expect(currentItem).toBeNull()
    })
  })

  describe('resetStats', () => {
    it('should reset stats while keeping queue', () => {
      const items = [{ fileName: 'test.epub', filePath: '/test/test.epub' }]
      useBatchQueueStore.getState().addToQueue(items)
      useBatchQueueStore.getState().markItemCompleted(items[0].fileName, {
        chapterCount: 10,
        processedChapters: 10,
        costUSD: 0.01,
        costRMB: 0.07,
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:01:00.000Z'
      })

      useBatchQueueStore.getState().resetStats()

      const state = useBatchQueueStore.getState()
      expect(state.queue.length).toBe(1)
      expect(state.stats.completed).toBe(0)
    })
  })
})

describe('BatchQueueItem types', () => {
  it('should accept valid status values', () => {
    const statuses: QueueItemStatus[] = ['pending', 'processing', 'completed', 'failed', 'skipped']
    expect(statuses.length).toBe(5)
  })
})
