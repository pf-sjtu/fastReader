import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, click, typeInto, flush } from '../uiTestUtils'

const downloadFileAsFile = vi.fn()
vi.mock('@/services/webdavService', () => ({
  webdavService: { downloadFileAsFile: (...a: unknown[]) => downloadFileAsFile(...a), isInitialized: () => false },
}))
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }))

import { LibraryView } from '@/components/library/LibraryView'
import { coverSlot } from '@/components/library/coverSlot'
import { useLibraryOpen } from '@/hooks/useLibraryOpen'
import { useLibraryStore } from '@/services/library/libraryStore'
import { applyScan, emptyIndex, patchEntry } from '@/services/library/libraryIndex'
import type { LibraryEntry } from '@/services/library/types'

let prevLang = i18n.language
beforeAll(async () => {
  prevLang = i18n.language
  await i18n.changeLanguage('zh')
})
afterAll(async () => {
  await i18n.changeLanguage(prevLang)
})

let mounted: ReturnType<typeof mount> | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.clearAllMocks()
})

const sum = (n: string) => `${n.replace(/\.[^/.]+$/, '')}-完整摘要.md`
function seededIndex() {
  const files = ['甲.epub', '乙.epub', '丙.pdf'].map((n) => ({ path: `/s/${n}`, size: 2_097_152, mtime: 'm' }))
  let idx = applyScan(emptyIndex(0), files, { now: 1, summaryNameOf: sum, summaryNames: new Set([sum('乙.epub')]) }).index
  idx = patchEntry(idx, '/s/乙.epub', { lastOpenedAt: 50, chapterCount: 12, readProgress: { chapterId: 'c3', pct: 40 } }, 2)
  return idx
}

describe('coverSlot', () => {
  it('确定性且落在 1..10', () => {
    expect(coverSlot('/s/甲.epub')).toBe(coverSlot('/s/甲.epub'))
    for (const s of ['a', 'b', '门口的野蛮人', '/x/y.epub', '']) {
      const v = coverSlot(s)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(10)
    }
    // 不是常量：不同种子应能落到不同色槽
    expect(new Set(Array.from({ length: 40 }, (_, i) => coverSlot(`book-${i}`))).size).toBeGreaterThan(4)
  })
})

describe('LibraryView', () => {
  beforeEach(() => {
    useLibraryStore.setState({
      index: seededIndex(),
      refreshing: false,
      fresh: true,
      error: null,
      unavailable: false,
      refresh: vi.fn().mockResolvedValue(undefined),
    })
  })
  const cards = () => Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>('button.group'))

  it('进入即触发刷新；展示全部书、状态角标、章数与进度条', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(useLibraryStore.getState().refresh).toHaveBeenCalled()
    const text = mounted.container.textContent ?? ''
    for (const t of ['甲', '乙', '丙', '已精读', '12 章', 'EPUB · 2.0 MB', 'PDF · 2.0 MB']) expect(text).toContain(t)
    expect(mounted.container.querySelector('[style*="width: 40%"]')).not.toBeNull()
  })

  it('"继续阅读"只列打开过且未读完的已处理书；筛选/搜索时隐藏该区', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.textContent).toContain('继续阅读')
    typeInto(mounted.container.querySelector('input')!, '甲')
    expect(mounted.container.textContent).not.toContain('继续阅读')
    expect(cards()).toHaveLength(1)
  })

  it('筛选：已精读 / 未精读；无匹配时给出提示', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    const btn = (label: string) =>
      Array.from(mounted!.container.querySelectorAll('button')).find((b) => b.textContent === label && b.hasAttribute('aria-pressed'))
    click(btn('已精读'))
    expect(btn('已精读')!.getAttribute('aria-pressed')).toBe('true')
    expect(cards().map((c) => c.textContent)).toEqual([expect.stringContaining('乙')])
    typeInto(mounted.container.querySelector('input')!, '不存在的书')
    expect(mounted.container.textContent).toContain('没有符合条件的书')
  })

  it('点击书卡回调该条目；打开中时全部卡片禁用（防重复点击）', () => {
    const onOpen = vi.fn()
    mounted = mount(<LibraryView onOpenBook={onOpen} />)
    click(cards().find((c) => c.textContent?.includes('丙')))
    expect((onOpen.mock.calls[0][0] as LibraryEntry).path).toBe('/s/丙.pdf')
    mounted.rerender(<LibraryView onOpenBook={onOpen} openingPath="/s/丙.pdf" />)
    expect(cards().every((c) => c.disabled)).toBe(true)
  })

  it('扫描失败/过期时提示"可能不是最新"；WebDAV 不可用时整块不渲染', () => {
    useLibraryStore.setState({ fresh: false })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.textContent).toContain('可能不是最新')
    useLibraryStore.setState({ unavailable: true })
    mounted.rerender(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.textContent).toBe('')
  })

  it('空书库给出引导文案', () => {
    useLibraryStore.setState({ index: emptyIndex(0) })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.textContent).toContain('同步目录里还没有书')
  })
})

describe('useLibraryOpen', () => {
  const entry = (status: LibraryEntry['status']): LibraryEntry => ({
    ...seededIndex().entries['/s/甲.epub'],
    status,
  })

  /** 把外部状态（file / 云缓存）当作 props，模拟 useBookProcessing 的异步更新 */
  function Harness(props: {
    file: File | null
    cloud: string | null
    checking: boolean
    select: (f: File) => Promise<void>
    load: () => void
    expose: (open: (e: LibraryEntry) => Promise<void>) => void
  }) {
    const { openBook } = useLibraryOpen({
      file: props.file,
      cloudCacheContent: props.cloud,
      isCheckingCloudCache: props.checking,
      handleWebDAVFileSelect: props.select,
      handleLoadFromCloudCache: props.load,
    })
    props.expose(openBook)
    return null
  }

  async function run(status: LibraryEntry['status'], after: { cloud: string | null; sameFile?: boolean }) {
    const file = new File(['x'], '甲.epub')
    downloadFileAsFile.mockResolvedValue({ success: true, data: file })
    const load = vi.fn()
    let open!: (e: LibraryEntry) => Promise<void>
    // 模拟选文件：resolve 之前，宿主已把 file/云缓存状态更新好
    let resolveSelect!: () => void
    const select = vi.fn(() => new Promise<void>((r) => (resolveSelect = r)))
    const base = { select, load, expose: (o: typeof open) => (open = o) }
    mounted = mount(<Harness {...base} file={null} cloud={null} checking={false} />)
    let p!: Promise<void>
    await act(async () => {
      p = open(entry(status))
      await flush(1)
    })
    // 宿主状态更新：file 就绪、云缓存检查完成
    mounted.rerender(<Harness {...base} file={after.sameFile === false ? new File(['y'], '别的.epub') : file} cloud={after.cloud} checking={false} />)
    expect(load).not.toHaveBeenCalled() // 选文件流程没结束前不能下结论
    await act(async () => {
      resolveSelect()
      await p
    })
    return { load, select }
  }

  it('已精读 + 有云缓存：流程结束后自动进入工作台（恰好一次）', async () => {
    const { load, select } = await run('done', { cloud: '# 摘要' })
    expect(select).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('已精读但云缓存没读到：不自动进入，停在选章节页', async () => {
    const { load } = await run('done', { cloud: null })
    expect(load).not.toHaveBeenCalled()
  })

  it('未处理的书即使有残留缓存也不自动进入', async () => {
    const { load } = await run('unprocessed', { cloud: '# 摘要' })
    expect(load).not.toHaveBeenCalled()
  })

  it('期间文件被换成别的：放弃自动进入，不误伤手动选择', async () => {
    const { load } = await run('done', { cloud: '# 摘要', sameFile: false })
    expect(load).not.toHaveBeenCalled()
  })

  it('下载失败：提示错误，不走选文件流程', async () => {
    downloadFileAsFile.mockResolvedValue({ success: false, error: '404' })
    const select = vi.fn()
    let open!: (e: LibraryEntry) => Promise<void>
    mounted = mount(<Harness file={null} cloud={null} checking={false} select={select} load={vi.fn()} expose={(o) => (open = o)} />)
    await act(async () => {
      await open(entry('done'))
    })
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('404'))
    expect(select).not.toHaveBeenCalled()
  })
})
