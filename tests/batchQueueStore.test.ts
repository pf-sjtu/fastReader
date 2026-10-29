/**
 * 批量队列 Store 测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  useBatchQueueStore,
  restoreBatchQueue,
  RUNNER_TIMEOUT_MS,
  type BatchProcessingConfig,
  type BatchRunnerLease,
  type QueueItemStatus,
} from '../src/stores/batchQueueStore'

describe('BatchQueueStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useBatchQueueStore.setState({
      queue: [],
      config: null,
      isProcessing: false,
      isPaused: false,
      currentItemIndex: -1,
      runner: null,
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

describe('restoreBatchQueue：刷新後恢复队列', () => {
  const item = (id: string, status: QueueItemStatus) => ({
    id, fileName: `${id}.epub`, filePath: `/b/${id}.epub`, status, progress: status === 'processing' ? 42 : 0
  })

  it('僵尸 processing → pending 并清进度，currentItemIndex 置 -1，stats 按队列重算', () => {
    useBatchQueueStore.getState().clearQueue()
    const current = useBatchQueueStore.getState()
    const restored = restoreBatchQueue(
      {
        queue: [item('a', 'processing'), item('b', 'pending'), item('c', 'processing')],
        config: null,
        currentItemIndex: 2,
        isPaused: true,
      },
      current
    )
    expect(restored.queue.map((i) => i.status)).toEqual(['pending', 'pending', 'pending'])
    expect(restored.queue[0].progress).toBe(0)
    expect(restored.currentItemIndex).toBe(-1)
    expect(restored.isProcessing).toBe(false)
    expect(restored.isPaused).toBe(true)
    expect(restored.stats.total).toBe(3)
  })

  it('stats 按恢复后的队列重新推导（completed / failed / skipped）', () => {
    const restored = restoreBatchQueue(
      {
        queue: [
          item('a', 'completed'),
          item('b', 'failed'),
          item('c', 'skipped'),
          item('d', 'processing'),
        ],
        stats: { total: 99, completed: 99, failed: 99, skipped: 99, totalCostUSD: 1, totalCostRMB: 7 },
      },
      useBatchQueueStore.getState()
    )
    expect(restored.stats).toMatchObject({ total: 4, completed: 1, failed: 1, skipped: 1 })
  })

  it('无持久化数据时原样返回当前状态', () => {
    const current = useBatchQueueStore.getState()
    expect(restoreBatchQueue(null, current)).toBe(current)
    expect(restoreBatchQueue(undefined, current)).toBe(current)
  })

  it('恢复后可再次启动并删除', () => {
    useBatchQueueStore.setState({
      ...restoreBatchQueue(
        { queue: [item('a', 'processing'), item('b', 'pending')] },
        useBatchQueueStore.getState()
      ),
    })
    useBatchQueueStore.getState().startProcessing()
    expect(useBatchQueueStore.getState().currentItemIndex).toBe(0)
    useBatchQueueStore.getState().removeFromQueue('a')
    expect(useBatchQueueStore.getState().stats.total).toBe(1)
  })
})

describe('执行租约（同一时刻只允许一个客户端跑队列）', () => {
  const lease = (clientId: string, ageMs = 0): BatchRunnerLease => {
    const at = new Date(Date.now() - ageMs).toISOString()
    return { clientId, startedAt: at, heartbeatAt: at }
  }

  beforeEach(() => {
    useBatchQueueStore.setState({ runner: null, queue: [], config: null })
  })

  it('空闲时 acquireRunner 成功并写入本客户端租约', () => {
    const state = useBatchQueueStore.getState()
    expect(state.acquireRunner()).toBe(true)
    const runner = useBatchQueueStore.getState().runner
    expect(runner?.clientId).toBe(state.clientId)
    expect(Date.parse(runner!.heartbeatAt)).toBeGreaterThan(0)
  })

  it('其他客户端持有新鲜租约时 acquireRunner 失败', () => {
    useBatchQueueStore.setState({ runner: lease('other-client') })
    expect(useBatchQueueStore.getState().acquireRunner()).toBe(false)
    // 失败不覆盖持有者
    expect(useBatchQueueStore.getState().runner?.clientId).toBe('other-client')
  })

  it('租约过期（心跳超过 2 分钟）后可被接管', () => {
    useBatchQueueStore.setState({ runner: lease('other-client', RUNNER_TIMEOUT_MS + 1000) })
    expect(useBatchQueueStore.getState().isRunnerStale()).toBe(true)
    expect(useBatchQueueStore.getState().acquireRunner()).toBe(true)
    expect(useBatchQueueStore.getState().runner?.clientId).toBe(useBatchQueueStore.getState().clientId)
  })

  it('自己已持有的租约重复 acquire 成功，且保留最初 startedAt', () => {
    const self = useBatchQueueStore.getState().clientId
    const original = lease(self, RUNNER_TIMEOUT_MS + 1000)
    useBatchQueueStore.setState({ runner: original })
    expect(useBatchQueueStore.getState().acquireRunner()).toBe(true)
    const runner = useBatchQueueStore.getState().runner!
    expect(runner.clientId).toBe(self)
    expect(runner.startedAt).toBe(original.startedAt)
    expect(Date.parse(runner.heartbeatAt)).toBeGreaterThan(Date.parse(original.heartbeatAt))
  })

  it('心跳非法或缺失视为过期', () => {
    useBatchQueueStore.setState({ runner: null })
    expect(useBatchQueueStore.getState().isRunnerStale()).toBe(true)
    useBatchQueueStore.setState({ runner: { clientId: 'x', startedAt: '', heartbeatAt: 'not-a-date' } })
    expect(useBatchQueueStore.getState().isRunnerStale()).toBe(true)
  })

  it('releaseRunner 清空租约；本无租约时也不报错', () => {
    useBatchQueueStore.getState().acquireRunner()
    useBatchQueueStore.getState().releaseRunner()
    expect(useBatchQueueStore.getState().runner).toBeNull()
    useBatchQueueStore.getState().releaseRunner()
    expect(useBatchQueueStore.getState().runner).toBeNull()
  })

  it('heartbeatRunner 只刷新持有者自己的心跳', () => {
    const stale = lease('other-client', 5000)
    useBatchQueueStore.setState({ runner: stale })
    useBatchQueueStore.getState().heartbeatRunner()
    expect(useBatchQueueStore.getState().runner).toEqual(stale)

    useBatchQueueStore.setState({ runner: null })
    const self = useBatchQueueStore.getState().clientId
    const own = lease(self, 5000)
    useBatchQueueStore.setState({ runner: own })
    useBatchQueueStore.getState().heartbeatRunner()
    const runner = useBatchQueueStore.getState().runner!
    expect(runner.clientId).toBe(self)
    expect(Date.parse(runner.heartbeatAt)).toBeGreaterThan(Date.parse(own.heartbeatAt))
    expect(runner.startedAt).toBe(own.startedAt)
  })
})

describe('BatchQueueItem types', () => {
  it('should accept valid status values', () => {
    const statuses: QueueItemStatus[] = ['pending', 'processing', 'completed', 'failed', 'skipped']
    expect(statuses.length).toBe(5)
  })
})
