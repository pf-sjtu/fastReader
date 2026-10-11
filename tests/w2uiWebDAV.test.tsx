import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../src/i18n'
import { mount, click, findButton, flush, pressKey, typeInto, waitFor, stubDomForRadix, selectOption, type Mounted } from './uiTestUtils'

// 网络边界：webdavService / cloudCacheService / 批量引擎 / toast
const dav = vi.hoisted(() => ({
  isInitialized: vi.fn(),
  initialize: vi.fn(),
  getDirectoryContents: vi.fn(),
  downloadFileAsFile: vi.fn(),
  testConnection: vi.fn(),
  disconnect: vi.fn(),
}))
const { fetchStatus, engine, toastFn } = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  engine: { processItem: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), resetStopFlag: vi.fn() },
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('../src/services/webdavService', () => ({ webdavService: dav }))
vi.mock('../src/services/cloudCacheService', () => ({
  cloudCacheService: {
    fetchCacheFileNamesStatus: fetchStatus,
    getCacheFileName: (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`,
    isCachedByFileName: (n: string, set: Set<string>) => set.has(`${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`),
  },
}))
vi.mock('../src/services/batchProcessingEngine', () => ({
  batchProcessingEngine: engine,
  assertBatchModeSupported: (mode: string) => {
    if (mode !== 'summary') throw new Error('unsupported mode')
  },
}))
vi.mock('sonner', () => ({ toast: toastFn }))

import { WebDAVFileBrowser } from '../src/components/project/WebDAVFileBrowser'
import { WebDAVConfig } from '../src/components/project/WebDAVConfig'
import { BatchProcessingDialog } from '../src/components/project/BatchProcessingDialog'
import { BatchQueuePanel } from '../src/components/project/BatchQueuePanel'
import { parentPath, sortEntries, filterEntries, directoryPath, extOf } from '../src/components/project/webdav/fileListUtils'
import { useConfigStore } from '../src/stores/configStore'
import { useBatchQueueStore } from '../src/stores/batchQueueStore'
import type { WebDAVFileInfo } from '../src/services/webdavService'

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o)
const cfg = () => useConfigStore.getState()
const byId = <T extends Element = HTMLInputElement>(id: string) => document.getElementById(id) as T | null
const entry = (filename: string, type: 'file' | 'directory', lastmod = '2024-01-01', size = 2048): WebDAVFileInfo =>
  ({ filename, basename: filename.split('/').filter(Boolean).pop()!, type, size, lastmod }) as WebDAVFileInfo

const LISTING = [
  entry('/books/sub', 'directory'),
  entry('/books/b.pdf', 'file', '2024-03-01'),
  entry('/books/a.epub', 'file', '2024-02-01'),
  entry('/books/notes.docx', 'file'),
]

function enableWebDAV() {
  const s = cfg()
  s.setWebDAVEnabled(true)
  s.setWebDAVServerUrl('https://dav.example.com/dav/')
  s.setWebDAVUsername('u')
  s.setWebDAVPassword('p')
  s.setWebDAVBrowsePath('/books/')
}

// Radix 弹层 + 多次异步交互，全量并行跑时单测可能超过默认 5s
vi.setConfig({ testTimeout: 30000 })

let m: Mounted | null = null
beforeEach(() => {
  stubDomForRadix()
  vi.clearAllMocks()
  cfg().resetWebDAVConfig()
  dav.isInitialized.mockReturnValue(true)
  dav.initialize.mockResolvedValue({ success: true })
  dav.getDirectoryContents.mockResolvedValue({ success: true, data: LISTING })
  fetchStatus.mockResolvedValue({ status: 'ok', names: new Set(['a-完整摘要.md']) })
})
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('fileListUtils', () => {
  it('路径工具', () => {
    expect(parentPath('/')).toBeNull()
    expect(parentPath('')).toBeNull()
    expect(parentPath('/a/')).toBe('/')
    expect(parentPath('/a/b/')).toBe('/a/')
    expect(directoryPath(entry('/a/b', 'directory'))).toBe('/a/b/')
    expect(extOf('X.EPUB')).toBe('.epub')
  })

  it('过滤与排序：目录在前；按时间降序；乱序可复现', () => {
    const filtered = filterEntries(LISTING, '', ['.epub', '.pdf'])
    expect(filtered.map((f) => f.basename)).toEqual(['sub', 'b.pdf', 'a.epub'])
    expect(filterEntries(LISTING, 'A.E', []).map((f) => f.basename)).toEqual(['a.epub'])
    expect(sortEntries(filtered, 'name', 'asc').map((f) => f.basename)).toEqual(['sub', 'a.epub', 'b.pdf'])
    expect(sortEntries(filtered, 'time', 'desc').map((f) => f.basename)).toEqual(['sub', 'b.pdf', 'a.epub'])
    const many = Array.from({ length: 8 }, (_, i) => entry(`/f${i}.epub`, 'file'))
    const r1 = sortEntries(many, 'random', 'asc', 42).map((f) => f.basename)
    expect(sortEntries(many, 'random', 'asc', 42).map((f) => f.basename)).toEqual(r1)
    expect([...r1].sort()).toEqual(many.map((f) => f.basename).sort())
  })
})

describe('WebDAVFileBrowser', () => {
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] [role="button"][tabindex="0"]'))

  it('未初始化时按配置给出统一错误文案', async () => {
    dav.isInitialized.mockReturnValue(false)
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.errors.disabled')))
    m.unmount()

    cfg().setWebDAVEnabled(true)
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.errors.incomplete')))
    m.unmount()

    enableWebDAV()
    dav.initialize.mockResolvedValueOnce({ success: false, error: '401' })
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.errors.initFailed', { error: '401' })))
    m.unmount()

    dav.initialize.mockRejectedValueOnce(new Error('net'))
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.errors.initException', { error: 'net' })))
  })

  it('列目录失败 / 抛异常时显示错误', async () => {
    dav.getDirectoryContents.mockResolvedValueOnce({ success: false })
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.errors.loadFailed')))
    dav.getDirectoryContents.mockRejectedValueOnce(new Error('boom'))
    click(document.querySelector(`[aria-label="${t('webdav.browser.refresh')}"]`))
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.errors.loadException', { error: 'boom' })))
  })

  it('目录导航：进入、上级、后退、前进', async () => {
    enableWebDAV()
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(rows().length).toBe(3))
    expect(dav.getDirectoryContents).toHaveBeenLastCalledWith('/books/')
    click(rows()[0])
    await waitFor(() => expect(dav.getDirectoryContents).toHaveBeenLastCalledWith('/books/sub/'))
    click(findButton(t('webdav.browser.up')))
    await waitFor(() => expect(dav.getDirectoryContents).toHaveBeenLastCalledWith('/books/'))
    click(document.querySelector(`[aria-label="${t('webdav.browser.back')}"]`))
    await waitFor(() => expect(dav.getDirectoryContents).toHaveBeenLastCalledWith('/books/sub/'))
    click(document.querySelector(`[aria-label="${t('webdav.browser.forward')}"]`))
    await waitFor(() => expect(dav.getDirectoryContents).toHaveBeenLastCalledWith('/books/'))
    expect(document.body.textContent).toContain(t('webdav.browser.currentPath', { path: '/books/' }))
  })

  it('设置中的浏览路径变化后回到新起点', async () => {
    enableWebDAV()
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(rows().length).toBe(3))
    act(() => cfg().setWebDAVBrowsePath('/other/'))
    await waitFor(() => expect(dav.getDirectoryContents).toHaveBeenLastCalledWith('/other/'))
  })

  it('搜索、排序切换与乱序', async () => {
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(rows().length).toBe(3))
    typeInto(document.querySelector<HTMLInputElement>(`input[placeholder="${t('webdav.browser.searchPlaceholder')}"]`)!, 'zzz')
    expect(document.body.textContent).toContain(t('webdav.noSearchResults'))
    typeInto(document.querySelector<HTMLInputElement>(`input[placeholder="${t('webdav.browser.searchPlaceholder')}"]`)!, '')
    click(document.querySelector(`[aria-label="${t('webdav.browser.toggleOrder')}"]`))
    expect(rows().map((r) => r.querySelector('.font-medium')?.textContent)).toEqual(['sub', 'b.pdf', 'a.epub'])
    await selectOption(document.querySelector(`[aria-label="${t('webdav.browser.sortBy')}"]`), t('webdav.browser.sortRandom'))
    click(document.querySelector(`[aria-label="${t('webdav.browser.reshuffle')}"]`))
    expect(rows()).toHaveLength(3)
  })

  it('选中文件后下载并交给父组件；失败时提示', async () => {
    const onFileSelect = vi.fn()
    const onClose = vi.fn()
    m = mount(<WebDAVFileBrowser isOpen onClose={onClose} onFileSelect={onFileSelect} />)
    await waitFor(() => expect(rows().length).toBe(3))
    pressKey(rows().find((r) => r.textContent?.includes('a.epub'))!, 'Enter')
    expect(document.body.textContent).toContain(t('webdav.browser.size', { size: '2 KB' }))

    dav.downloadFileAsFile.mockResolvedValueOnce({ success: false })
    click(findButton(t('webdav.browser.selectFile')))
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.browser.downloadFailed')))

    dav.downloadFileAsFile.mockRejectedValueOnce(new Error('x'))
    click(findButton(t('webdav.browser.selectFile')))
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.browser.selectFailed')))

    const file = new File(['e'], 'a.epub')
    dav.downloadFileAsFile.mockResolvedValueOnce({ success: true, data: file })
    click(findButton(t('webdav.browser.selectFile')))
    await waitFor(() => expect(onFileSelect).toHaveBeenCalledWith(file))
    expect(onClose).toHaveBeenCalled()
  })

  it('行内下载按钮触发浏览器下载', async () => {
    const createURL = vi.fn(() => 'blob:x')
    const revokeURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createURL, revokeObjectURL: revokeURL }))
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    dav.downloadFileAsFile.mockResolvedValueOnce({ success: true, data: new File(['e'], 'a.epub') })
    m = mount(<WebDAVFileBrowser isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />)
    await waitFor(() => expect(rows().length).toBe(3))
    click(document.querySelector(`[aria-label="${t('webdav.browser.downloadFileNamed', { name: 'a.epub' })}"]`))
    await waitFor(() => expect(anchorClick).toHaveBeenCalled())
    expect(revokeURL).toHaveBeenCalledWith('blob:x')
    anchorClick.mockRestore()
    vi.unstubAllGlobals()
  })
})

describe('WebDAVConfig', () => {
  it('启用开关、字段写入 store、显示/隐藏密码', () => {
    m = mount(<WebDAVConfig />)
    expect(byId('server-url')).toBeNull()
    click(byId('webdav-enabled'))
    typeInto(byId('server-url')!, 'https://d/')
    typeInto(byId('username')!, 'me')
    typeInto(byId('app-name')!, 'app')
    typeInto(byId('browse-path')!, '/b/')
    typeInto(byId('sync-path')!, '/s')
    click(byId('auto-sync'))
    expect(cfg().webdavConfig).toMatchObject({ enabled: true, serverUrl: 'https://d/', username: 'me', appName: 'app', browsePath: '/b/', syncPath: '/s' })
    expect(byId('password')!.type).toBe('password')
    click(document.querySelector(`[aria-label="${t('webdav.config.showPassword')}"]`))
    expect(byId('password')!.type).toBe('text')
    expect(document.body.textContent).toContain(t('webdav.config.status.disconnected'))
  })

  it('凭据不完整时手动测试只提示', () => {
    cfg().setWebDAVEnabled(true)
    m = mount(<WebDAVConfig />)
    click(findButton(t('config.testConnection')))
    expect(document.body.textContent).toContain(t('webdav.config.fillAll'))
    expect(dav.initialize).not.toHaveBeenCalled()
  })

  it('凭据完整后防抖自动测试一次；成功后状态为已连接', async () => {
    vi.useFakeTimers()
    dav.testConnection.mockResolvedValue({ success: true })
    enableWebDAV()
    m = mount(<WebDAVConfig />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    vi.useRealTimers()
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.config.testSuccess')))
    expect(dav.initialize).toHaveBeenCalledTimes(1)
    expect(cfg().webdavConfig.connectionStatus).toBe('connected')
    expect(document.body.textContent).toContain(t('webdav.config.status.connected'))
  })

  it('手动测试：初始化失败 / 探测失败 / 异常；重置', async () => {
    enableWebDAV()
    m = mount(<WebDAVConfig />)
    const btn = () => findButton(t('config.testConnection'))!

    dav.initialize.mockResolvedValueOnce({ success: false, error: 'bad' })
    click(btn())
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.errors.initFailed', { error: 'bad' })))
    expect(cfg().webdavConfig.connectionStatus).toBe('error')

    dav.testConnection.mockResolvedValueOnce({ success: false })
    await waitFor(() => expect(btn().disabled).toBe(false))
    click(btn())
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.config.testFailed')))

    dav.testConnection.mockRejectedValueOnce(new Error('kaboom'))
    click(btn())
    await waitFor(() => expect(document.body.textContent).toContain(t('webdav.config.testException', { error: 'kaboom' })))

    click(findButton(t('webdav.config.reset')))
    expect(dav.disconnect).toHaveBeenCalled()
    expect(cfg().webdavConfig.enabled).toBe(false)
  })
})

describe('BatchProcessingDialog', () => {
  beforeEach(() => {
    useBatchQueueStore.setState({
      queue: [],
      config: null,
      isProcessing: false,
      isPaused: false,
      currentItemIndex: -1,
      stats: { total: 0, completed: 0, failed: 0, skipped: 0, totalCostUSD: 0, totalCostRMB: 0 },
    })
    enableWebDAV()
    cfg().setProcessingMode('summary')
  })

  const open = async () => {
    m = mount(<BatchProcessingDialog />)
    click(findButton(t('batch.trigger')))
    await waitFor(() => expect(document.body.textContent).toContain('a.epub'))
    await waitFor(() => expect(document.body.textContent).toContain(t('batch.cached')))
  }

  it('列出书籍并标注缓存；全选跳过已缓存；开始后加入队列并启动', async () => {
    await open()
    expect(document.body.textContent).not.toContain('notes.docx')
    expect(document.body.textContent).toContain(t('batch.unprocessed'))
    click(byId('select-all'))
    expect(document.body.textContent).toContain(t('batch.fileCount', { count: 1 }))
    click(findButton(t('batch.startBatch', { count: 1 })))
    await waitFor(() => expect(useBatchQueueStore.getState().isProcessing).toBe(true))
    expect(useBatchQueueStore.getState().queue.map((i) => i.fileName)).toEqual(['b.pdf'])
    expect(useBatchQueueStore.getState().config).toMatchObject({ sourcePath: '/books/', skipProcessed: true })
    expect(engine.resetStopFlag).toHaveBeenCalled()
    expect(document.body.textContent).toContain(t('batch.queueTitle', { count: 1 }))
  })

  it('逐个点选与取消；进入子目录；关闭跳过后全选包含已缓存', async () => {
    await open()
    const row = (name: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] .cursor-pointer')).find((r) => r.textContent?.includes(name))!
    click(row('a.epub'))
    expect(document.body.textContent).toContain(t('batch.fileCount', { count: 1 }))
    click(row('a.epub'))
    expect(document.body.textContent).toContain(t('batch.fileCount', { count: 0 }))
    click(byId('batch-skip-processed'))
    click(byId('select-all'))
    expect(document.body.textContent).toContain(t('batch.fileCount', { count: 2 }))
    click(byId('select-all'))
    expect(document.body.textContent).toContain(t('batch.fileCount', { count: 0 }))
    await selectOption(byId('batch-max-files'), t('batch.rangeFirst', { count: 5 }))
    await selectOption(byId('batch-order'), t('batch.orderRandom'))
    click(row('sub'))
    await waitFor(() => expect(dav.getDirectoryContents).toHaveBeenLastCalledWith('/books/sub/'))
    click(findButton(t('webdav.browser.up')))
    await waitFor(() => expect(dav.getDirectoryContents).toHaveBeenLastCalledWith('/books/'))
  })

  it('云端缓存状态未知时提醒；导图模式拒绝开始', async () => {
    fetchStatus.mockResolvedValue({ status: 'unknown', error: '401' })
    m = mount(<BatchProcessingDialog />)
    click(findButton(t('batch.trigger')))
    await waitFor(() => expect(toastFn.warning).toHaveBeenCalledWith(t('batch.cacheUnknown'), { description: '401' }))
    click(byId('select-all'))
    act(() => cfg().setProcessingMode('mindmap'))
    click(findButton(t('batch.startBatch', { count: 2 })))
    await flush()
    expect(toastFn.error).toHaveBeenCalledWith('unsupported mode')
    expect(useBatchQueueStore.getState().queue).toHaveLength(0)
  })

  it('队列页：暂停/继续/停止/清空与移除', async () => {
    useBatchQueueStore.getState().addToQueue([
      { fileName: 'x.epub', filePath: '/x.epub' },
      { fileName: 'y.epub', filePath: '/y.epub' },
    ])
    m = mount(<BatchProcessingDialog />)
    click(findButton(t('batch.trigger')))
    await flush()
    click(findButton(new RegExp(t('batch.tabQueue'))))
    click(document.querySelector(`[aria-label="${t('batch.removeItemNamed', { name: 'y.epub' })}"]`))
    expect(useBatchQueueStore.getState().queue).toHaveLength(1)
    click(document.querySelector(`[aria-label="${t('common.collapse')}"]`))
    expect(document.body.textContent).not.toContain('x.epub')
    click(document.querySelector(`[aria-label="${t('common.expand')}"]`))

    act(() => useBatchQueueStore.getState().startProcessing())
    click(findButton(t('batch.pause')))
    expect(engine.pause).toHaveBeenCalled()
    expect(document.body.textContent).toContain(t('batch.paused'))
    click(findButton(t('batch.resume')))
    expect(engine.resume).toHaveBeenCalled()
    click(findButton(t('batch.stop')))
    expect(engine.stop).toHaveBeenCalled()
    click(findButton(t('batch.clearQueue')))
    expect(useBatchQueueStore.getState().queue).toHaveLength(0)
    expect(document.body.textContent).toContain(t('batch.queueEmpty'))
  })

  it('未选文件不能开始', async () => {
    await open()
    expect(findButton(t('batch.startBatch', { count: 0 }))!.disabled).toBe(true)
    click(findButton(t('common.cancel')))
  })
})

describe('BatchQueuePanel 控制', () => {
  beforeEach(() => {
    useBatchQueueStore.setState({
      queue: [],
      config: null,
      isProcessing: false,
      isPaused: false,
      currentItemIndex: -1,
      stats: { total: 0, completed: 0, failed: 0, skipped: 0, totalCostUSD: 0, totalCostRMB: 0 },
    })
  })

  it('无待处理项时提示；暂停/继续/停止/清空；不完整与移除', async () => {
    useBatchQueueStore.getState().addToQueue([{ fileName: 'a.epub', filePath: '/a.epub' }, { fileName: 'b.epub', filePath: '/b.epub' }])
    const [a] = useBatchQueueStore.getState().queue
    useBatchQueueStore.getState().markItemCompleted(a.id, {
      chapterCount: 1, processedChapters: 1, skippedChapters: 1, startTime: '', endTime: '', costUSD: 0, costRMB: 1.5, isPartial: true,
    })
    m = mount(<BatchQueuePanel />)
    click(m.container.querySelector('button[aria-expanded]'))
    expect(document.body.textContent).toContain(t('batch.partial'))
    expect(document.body.textContent).toContain('¥1.50')
    click(document.querySelector(`[aria-label="${t('batch.removeItemNamed', { name: 'b.epub' })}"]`))
    click(findButton(t('batch.startProcessing')))
    await waitFor(() => expect(toastFn.info).toHaveBeenCalledWith(t('batch.noPending')))

    act(() => useBatchQueueStore.getState().addToQueue([{ fileName: 'c.epub', filePath: '/c.epub' }]))
    engine.processItem.mockImplementation(() => new Promise(() => {}))
    fetchStatus.mockResolvedValue({ status: 'ok', names: new Set() })
    click(findButton(t('batch.startProcessing')))
    await waitFor(() => expect(findButton(t('batch.pause'))).toBeTruthy())
    click(findButton(t('batch.pause')))
    click(findButton(t('batch.resume')))
    click(findButton(t('batch.stop')))
    expect(toastFn).toHaveBeenCalledWith(t('batch.toast.stopped'), expect.anything())
    click(document.querySelector(`[aria-label="${t('batch.clearQueue')}"]`))
    expect(useBatchQueueStore.getState().queue).toHaveLength(0)
  })
})
