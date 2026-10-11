import { beforeEach, describe, expect, it, vi } from 'vitest'

// 只 mock 网络/引擎边界；store 用真实实现
const { processItem, fetchStatus, engineStop, toastFn } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  })
  return {
    processItem: vi.fn(),
    fetchStatus: vi.fn(),
    engineStop: vi.fn(),
    toastFn,
  }
})

vi.mock('sonner', () => ({ toast: toastFn }))
vi.mock('../src/services/batchProcessingEngine', () => ({
  batchProcessingEngine: { processItem, stop: engineStop },
}))
vi.mock('../src/services/cloudCacheService', () => ({
  cloudCacheService: { fetchCacheFileNamesStatus: fetchStatus },
}))

import { useBatchQueueStore } from '../src/stores/batchQueueStore'
import { processNextPendingItem, runBatchQueue, type CachedNamesRef } from '../src/components/project/batchQueueRunner'

function resetStore() {
  useBatchQueueStore.setState({
    queue: [],
    config: null,
    isProcessing: false,
    isPaused: false,
    currentItemIndex: -1,
    stats: { total: 0, completed: 0, failed: 0, skipped: 0, totalCostUSD: 0, totalCostRMB: 0 },
  })
}

function enqueue(...names: string[]) {
  useBatchQueueStore.getState().addToQueue(names.map((n) => ({ fileName: n, filePath: `/books/${n}` })))
}

const ok = (fileName: string) => ({ success: true, fileName, metadata: { chapterCount: 3, processedChapters: 3, skippedChapters: 0, costUSD: 0, costRMB: 0, startTime: '', endTime: '' } })

describe('批量队列执行（batchQueueRunner）', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
    fetchStatus.mockResolvedValue({ status: 'ok', names: new Set<string>() })
  })

  it('逐本处理全部 pending 项，完成 toast 读取最新 stats（而非闭包旧值）', async () => {
    enqueue('a.epub', 'b.epub', 'c.epub')
    processItem
      .mockResolvedValueOnce(ok('a.epub'))
      .mockResolvedValueOnce({ success: false, fileName: 'b.epub', error: 'AI 失败' })
      .mockResolvedValueOnce(ok('c.epub'))
    useBatchQueueStore.getState().startProcessing()

    await runBatchQueue({ current: null })

    const state = useBatchQueueStore.getState()
    expect(processItem).toHaveBeenCalledTimes(3)
    expect(state.isProcessing).toBe(false)
    expect(state.queue.map((i) => i.status)).toEqual(['completed', 'failed', 'completed'])
    expect(toastFn).toHaveBeenCalledWith('处理完成', {
      description: '批量处理已完成，成功 2 个，失败 1 个',
    })
  })

  it('result.fatal 时停止整个队列，不再处理下一本', async () => {
    enqueue('a.epub', 'b.epub')
    processItem.mockResolvedValueOnce({ success: false, fileName: 'a.epub', error: '无法确认云端缓存状态', fatal: true })
    useBatchQueueStore.getState().startProcessing()

    await runBatchQueue({ current: null })

    const state = useBatchQueueStore.getState()
    expect(processItem).toHaveBeenCalledTimes(1)
    expect(engineStop).toHaveBeenCalled()
    expect(state.isProcessing).toBe(false)
    expect(state.queue[0].status).toBe('failed')
    expect(state.queue[1].status).toBe('pending')
    expect(toastFn.error).toHaveBeenCalledWith('批量处理已停止', { description: '无法确认云端缓存状态' })
  })

  it('云端缓存状态 unknown 时不开始处理任何一本', async () => {
    enqueue('a.epub')
    fetchStatus.mockResolvedValueOnce({ status: 'unknown', error: '401' })
    useBatchQueueStore.getState().startProcessing()

    const cache: CachedNamesRef = { current: null }
    expect(await processNextPendingItem(cache)).toBe(false)
    expect(processItem).not.toHaveBeenCalled()
    expect(cache.current).toBeNull()
    expect(useBatchQueueStore.getState().queue[0].status).toBe('pending')
    expect(useBatchQueueStore.getState().isProcessing).toBe(false)
  })

  it('已获取的缓存集合会复用并传给引擎；「已跳过」标为 skipped', async () => {
    enqueue('a.epub')
    const names = new Set(['a-完整摘要.md'])
    processItem.mockResolvedValueOnce({ success: true, fileName: 'a.epub', error: '已跳过（已有缓存）' })
    useBatchQueueStore.getState().startProcessing()

    await runBatchQueue({ current: names })

    expect(fetchStatus).not.toHaveBeenCalled()
    expect(processItem.mock.calls[0][2]).toBe(names)
    expect(useBatchQueueStore.getState().queue[0].status).toBe('skipped')
  })

  it('暂停后循环在当前项结束时退出，剩余项保持 pending', async () => {
    enqueue('a.epub', 'b.epub')
    processItem.mockImplementationOnce(async () => {
      useBatchQueueStore.getState().pauseProcessing()
      return ok('a.epub')
    })
    useBatchQueueStore.getState().startProcessing()

    await runBatchQueue({ current: null })

    expect(processItem).toHaveBeenCalledTimes(1)
    expect(useBatchQueueStore.getState().queue[1].status).toBe('pending')
  })

  it('处理中被用户停止：退出循环且不报「处理完成」', async () => {
    enqueue('a.epub', 'b.epub')
    processItem.mockImplementationOnce(async () => {
      useBatchQueueStore.getState().stopProcessing()
      return { success: false, fileName: 'a.epub', error: '用户停止处理' }
    })
    useBatchQueueStore.getState().startProcessing()

    await runBatchQueue({ current: null })

    expect(processItem).toHaveBeenCalledTimes(1)
    expect(toastFn).not.toHaveBeenCalledWith('处理完成', expect.anything())
    expect(useBatchQueueStore.getState().queue[1].status).toBe('pending')
  })

  it('引擎抛异常时标记失败并继续下一本', async () => {
    enqueue('a.epub', 'b.epub')
    processItem.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(ok('b.epub'))
    useBatchQueueStore.getState().startProcessing()

    await runBatchQueue({ current: null })

    const q = useBatchQueueStore.getState().queue
    expect(q[0].status).toBe('failed')
    expect(q[0].error).toBe('boom')
    expect(q[1].status).toBe('completed')
  })
})
