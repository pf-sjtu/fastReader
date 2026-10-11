import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../src/i18n'
import { mount, click, findButton, waitFor, type Mounted } from './uiTestUtils'

const { processItem, fetchStatus, toastFn } = vi.hoisted(() => ({
  processItem: vi.fn(),
  fetchStatus: vi.fn(),
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: toastFn }))
vi.mock('../src/services/batchProcessingEngine', () => ({
  batchProcessingEngine: { processItem, stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), resetStopFlag: vi.fn() },
  assertBatchModeSupported: (mode: string) => {
    if (mode !== 'summary') throw new Error('批量处理暂不支持思维导图模式')
  },
}))
vi.mock('../src/services/cloudCacheService', () => ({
  cloudCacheService: { fetchCacheFileNamesStatus: fetchStatus },
}))

import { BatchQueuePanel } from '../src/components/project/BatchQueuePanel'
import { useBatchQueueStore } from '../src/stores/batchQueueStore'
import { useConfigStore } from '../src/stores/configStore'

let m: Mounted | null = null

describe('BatchQueuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBatchQueueStore.setState({
      queue: [],
      config: null,
      isProcessing: false,
      isPaused: false,
      currentItemIndex: -1,
      stats: { total: 0, completed: 0, failed: 0, skipped: 0, totalCostUSD: 0, totalCostRMB: 0 },
    })
    useBatchQueueStore.getState().addToQueue([
      { fileName: 'a.epub', filePath: '/a.epub' },
      { fileName: 'b.epub', filePath: '/b.epub' },
    ])
    useConfigStore.getState().setProcessingMode('summary')
  })
  afterEach(() => {
    m?.unmount()
    m = null
    document.body.innerHTML = ''
  })

  it('折叠触发器是可聚焦的 button', () => {
    m = mount(<BatchQueuePanel />)
    const trigger = m.container.querySelector('button[aria-expanded]')
    expect(trigger?.tagName).toBe('BUTTON')
    expect(trigger?.textContent).toContain(i18n.t('batch.panelTitle'))
  })

  it('云端缓存状态未知时不开始处理', async () => {
    fetchStatus.mockResolvedValue({ status: 'unknown', error: '401' })
    m = mount(<BatchQueuePanel />)
    click(m.container.querySelector('button[aria-expanded]'))
    click(findButton(i18n.t('batch.startProcessing')))
    await waitFor(() => expect(toastFn.error).toHaveBeenCalled())
    expect(useBatchQueueStore.getState().isProcessing).toBe(false)
    expect(processItem).not.toHaveBeenCalled()
  })

  it('思维导图模式直接拒绝开始', async () => {
    useConfigStore.getState().setProcessingMode('mindmap')
    m = mount(<BatchQueuePanel />)
    click(m.container.querySelector('button[aria-expanded]'))
    click(findButton(i18n.t('batch.startProcessing')))
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith('批量处理暂不支持思维导图模式'))
    expect(fetchStatus).not.toHaveBeenCalled()
  })

  it('开始后循环逐本处理直到完成（完成项数变化不重启循环）', async () => {
    fetchStatus.mockResolvedValue({ status: 'ok', names: new Set() })
    processItem.mockImplementation(async (item: { fileName: string }) => ({
      success: true,
      fileName: item.fileName,
      metadata: { chapterCount: 1, processedChapters: 1, skippedChapters: 0, costUSD: 0, costRMB: 0, startTime: '', endTime: '' },
    }))
    m = mount(<BatchQueuePanel />)
    click(m.container.querySelector('button[aria-expanded]'))
    click(findButton(i18n.t('batch.startProcessing')))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(i18n.t('batch.toast.finished'), expect.anything()))
    expect(processItem).toHaveBeenCalledTimes(2)
    expect(useBatchQueueStore.getState().queue.every((i) => i.status === 'completed')).toBe(true)
  })
})
