import i18n from '../../src/i18n'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { act } from 'react'
import { mount, click, typeInto, flush } from '../uiTestUtils'

const downloadFileAsFile = vi.fn()
const readyListeners = vi.hoisted(() => new Set<() => void>())
vi.mock('@/services/webdavService', () => ({
  webdavService: {
    downloadFileAsFile: (...a: unknown[]) => downloadFileAsFile(...a),
    isInitialized: () => false,
    onInitialized: (fn: () => void) => {
      readyListeners.add(fn)
      return () => readyListeners.delete(fn)
    },
  },
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
      connecting: false,
      refresh: vi.fn().mockResolvedValue(undefined),
    })
  })
  const cards = () => Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>('button.group'))

  it('进入时 WebDAV 还没连上（unavailable）：不显示；连上后自动补刷一次', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    useLibraryStore.setState({ unavailable: true, refresh })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    expect(mounted.container.innerHTML).toBe('')
    refresh.mockClear()
    act(() => readyListeners.forEach((fn) => fn()))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('扫描失败且没有任何缓存：显示失败原因与重试，而不是「还没有书」', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    useLibraryStore.setState({ index: emptyIndex(0), fresh: false, error: '获取目录内容失败: Invalid response: 403', refresh })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    const text = mounted.container.textContent ?? ''
    expect(text).toContain('读取同步目录失败：获取目录内容失败: Invalid response: 403')
    expect(text).not.toContain('还没有书')
    expect(text).not.toContain('显示的是缓存内容') // 没有任何缓存可显示，不该这么说
    refresh.mockClear()
    click(Array.from(mounted.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '重试'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('「补全书籍信息」只统计 EPUB/PDF：全是 md 时不出现这个空操作按钮', () => {
    const idx = applyScan(emptyIndex(0), [{ path: '/s/笔记.md', size: 1, mtime: 'm' }], { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index
    useLibraryStore.setState({ index: idx, fresh: true, error: null })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    expect(mounted.container.textContent).not.toContain('补全书籍信息')
    const withEpub = applyScan(idx, [{ path: '/s/笔记.md', size: 1, mtime: 'm' }, { path: '/s/书.epub', size: 1, mtime: 'm' }], { now: 2, summaryNameOf: sum, summaryNames: new Set() }).index
    useLibraryStore.setState({ index: withEpub })
    mounted.rerender(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    expect(mounted.container.textContent).toContain('补全书籍信息（1）')
  })

  it('有推荐/继续阅读时，下面的网格叫「其余书籍」且不重复它们；没有推荐/继续阅读时不加标题', () => {
    const files = Array.from({ length: 12 }, (_, i) => ({ path: `/s/书${String(i).padStart(2, '0')}.epub`, size: 1, mtime: 'm' }))
    useLibraryStore.setState({ index: applyScan(emptyIndex(0), files, { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    expect(mounted.container.textContent).toContain('其余书籍')
    expect(mounted.container.textContent).not.toContain('全部书籍')
    // 12 本里 6 本推荐 + 6 本在「其余」里：同一本书不会在相邻两个区块各出现一次
    const titles = Array.from(mounted.container.querySelectorAll<HTMLButtonElement>('button.group')).map((b) => b.getAttribute('aria-label')?.split('，')[0])
    expect(titles).toHaveLength(12)
    expect(new Set(titles).size).toBe(12)
    useLibraryStore.setState({ index: applyScan(emptyIndex(0), [{ path: '/s/甲.epub', size: 1, mtime: 'm' }], { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index })
    mounted.rerender(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    expect(mounted.container.textContent).not.toContain('其余书籍')
  })

  it('书很少、全被「继续阅读/推荐」展示了：网格为空也不报「没有符合条件的书」', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    expect(mounted.container.textContent).toContain('随机推荐')
    expect(mounted.container.textContent).not.toContain('没有符合条件')
    expect(mounted.container.textContent).not.toContain('其余书籍')
  })

  it('「补全书籍信息」按钮的提示写明要下载的总量；超过 200MB 先确认，取消则不下载', () => {
    const mb = 1024 * 1024
    const files = Array.from({ length: 3 }, (_, i) => ({ path: `/s/书${i}.epub`, size: 100 * mb, mtime: 'm' }))
    const fillMetadata = vi.fn().mockResolvedValue(undefined)
    useLibraryStore.setState({ index: applyScan(emptyIndex(0), files, { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index, fillMetadata })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    const btn = mounted.container.querySelector<HTMLButtonElement>('button[title*="将下载"]')!
    expect(btn.title).toContain('3 本')
    expect(btn.title).toContain('300 MB')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    click(btn)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toContain('300 MB')
    expect(fillMetadata).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    click(btn)
    expect(fillMetadata).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('补全总量很小（<200MB）时不弹确认，直接开始', () => {
    const fillMetadata = vi.fn().mockResolvedValue(undefined)
    useLibraryStore.setState({ index: applyScan(emptyIndex(0), [{ path: '/s/书.epub', size: 1024, mtime: 'm' }], { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index, fillMetadata })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    const confirm = vi.spyOn(window, 'confirm')
    click(mounted.container.querySelector<HTMLButtonElement>('button[title*="将下载"]'))
    expect(confirm).not.toHaveBeenCalled()
    expect(fillMetadata).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('连接中且没有镜像：显示「正在连接云端」，不能误报「还没有书」', () => {
    useLibraryStore.setState({ index: emptyIndex(0), connecting: true, fresh: false, error: null })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    expect(mounted.container.textContent).toContain('正在连接云端')
    expect(mounted.container.textContent).not.toContain('还没有书')
  })

  it('连接中但有镜像：先显示上次的书架，并提示正在连接', () => {
    useLibraryStore.setState({ connecting: true, fresh: false })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    expect(cards().length).toBeGreaterThan(0)
    expect(mounted.container.textContent).toContain('正在连接云端，先显示上次的书架')
    expect(mounted.container.textContent).not.toContain('显示的是缓存内容')
  })

  it('书很多时分页：首屏 24 本，「显示更多」每次追加 48 本，改排序回到首屏', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ path: `/s/书${String(i).padStart(3, '0')}.epub`, size: 1, mtime: 'm' }))
    useLibraryStore.setState({ index: applyScan(emptyIndex(0), files, { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    const gridCount = () => {
      const grids = mounted!.container.querySelectorAll('.grid')
      return grids[grids.length - 1].querySelectorAll('button.group').length
    }
    const more = () => Array.from(mounted!.container.querySelectorAll('button')).find((b) => b.textContent?.includes('显示更多'))
    expect(gridCount()).toBe(24)
    // 100 本里 6 本在「随机推荐」中，网格是其余 94 本
    expect(more()?.textContent).toContain('还有 70 本')
    expect(mounted.container.textContent).toContain('其余书籍94') // 标题数量是总数，不是本页数量

    click(more())
    expect(gridCount()).toBe(72)
    expect(more()?.textContent).toContain('还有 22 本')
    click(more())
    expect(gridCount()).toBe(94)
    expect(more()).toBeUndefined()

    const sel = mounted.container.querySelector<HTMLSelectElement>('select[aria-label="排序"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'name')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(gridCount()).toBe(24) // 换了排序就回到首屏，不会一下渲染 100 张
  })

  it('目录确实是空的（无错误）：才显示「还没有书」', () => {
    useLibraryStore.setState({ index: emptyIndex(0), fresh: true, error: null })
    mounted = mount(<LibraryView onOpenBook={() => {}} openingPath={null} />)
    expect(mounted.container.textContent).toContain('还没有书')
    expect(mounted.container.textContent).not.toContain('读取同步目录失败')
  })

  it('进入即触发刷新；展示全部书、状态角标、章数与进度条', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(useLibraryStore.getState().refresh).toHaveBeenCalled()
    const text = mounted.container.textContent ?? ''
    for (const t of ['甲', '乙', '丙', '已精读', '12 章']) expect(text).toContain(t)
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
    onAuto?: (autoOpening: boolean) => void
  }) {
    const { openBook, autoOpening } = useLibraryOpen({
      file: props.file,
      cloudCacheContent: props.cloud,
      isCheckingCloudCache: props.checking,
      handleWebDAVFileSelect: props.select,
      handleLoadFromCloudCache: props.load,
    })
    props.expose(openBook)
    props.onAuto?.(autoOpening)
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

  it('autoOpening：已精读的书在「选文件 → 缓存检查」期间为真（界面显示骨架），结束后为假', async () => {
    const seen: boolean[] = []
    const file = new File(['x'], '甲.epub')
    downloadFileAsFile.mockResolvedValue({ success: true, data: file })
    let open!: (e: LibraryEntry) => Promise<void>
    let resolveSelect!: () => void
    const select = vi.fn(() => new Promise<void>((r) => (resolveSelect = r)))
    const base = { select, load: vi.fn(), expose: (o: typeof open) => (open = o), onAuto: (v: boolean) => void seen.push(v) }
    mounted = mount(<Harness {...base} file={null} cloud={null} checking={false} />)
    expect(seen.at(-1)).toBe(false)
    let p!: Promise<void>
    await act(async () => {
      p = open(entry('done'))
      await flush(1)
    })
    expect(seen.at(-1)).toBe(true)
    mounted.rerender(<Harness {...base} file={file} cloud="# 摘要" checking={false} />)
    await act(async () => {
      resolveSelect()
      await p
    })
    expect(seen.at(-1)).toBe(false)
  })

  it('autoOpening：未处理的书不进入过渡态（走正常的选章节流程）', async () => {
    const seen: boolean[] = []
    downloadFileAsFile.mockResolvedValue({ success: true, data: new File(['x'], '甲.epub') })
    let open!: (e: LibraryEntry) => Promise<void>
    const base = { select: vi.fn(async () => {}), load: vi.fn(), expose: (o: typeof open) => (open = o), onAuto: (v: boolean) => void seen.push(v) }
    mounted = mount(<Harness {...base} file={null} cloud={null} checking={false} />)
    await act(async () => {
      await open(entry('unprocessed'))
    })
    expect(seen.every((v) => v === false)).toBe(true)
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

  it('选文件流程抛错：autoOpening 回到假，骨架屏不会一直挂着', async () => {
    const seen: boolean[] = []
    downloadFileAsFile.mockResolvedValue({ success: true, data: new File(['x'], '甲.epub') })
    let open!: (e: LibraryEntry) => Promise<void>
    let rejectSelect!: (e: Error) => void
    const select = vi.fn(() => new Promise<void>((_, rej) => (rejectSelect = rej)))
    mounted = mount(<Harness file={null} cloud={null} checking={false} select={select} load={vi.fn()} expose={(o) => (open = o)} onAuto={(v) => void seen.push(v)} />)
    let p!: Promise<void>
    await act(async () => {
      p = open(entry('done'))
      p.catch(() => {})
      await flush(1)
    })
    expect(seen.at(-1)).toBe(true) // 选文件进行中：过渡态
    await act(async () => {
      rejectSelect(new Error('解析失败'))
      await p.catch(() => {})
    })
    expect(seen.at(-1)).toBe(false) // 出错后必须退出
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

describe('书架：分类 / 排序 / 推荐 / 补全', () => {
  function bigIndex(n = 14) {
    const files = Array.from({ length: n }, (_, i) => ({ path: `/s/书${String(i).padStart(2, '0')}.epub`, size: 1000 + i, mtime: 'm' }))
    return applyScan(emptyIndex(0), files, { now: 1, summaryNameOf: sum, summaryNames: new Set([sum('书00.epub')]) }).index
  }
  const setSelect = (label: string, value: string) => {
    const sel = mounted!.container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    act(() => {
      setter.call(sel, value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  const headings = () => Array.from(mounted!.container.querySelectorAll('h3')).map((h) => h.textContent ?? '')
  const recPaths = () =>
    Array.from(mounted!.container.querySelectorAll('[aria-label="随机推荐"] button.group')).map((b) => b.textContent ?? '')

  beforeEach(() => {
    useLibraryStore.setState({
      index: bigIndex(),
      refreshing: false,
      fresh: true,
      error: null,
      unavailable: false,
      fillProgress: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('按状态分组：出现带数量的组标题；不分组时没有组标题', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(headings().some((h) => h.includes('未精读'))).toBe(false)
    setSelect('分类', 'status')
    const hs = headings().join('|')
    expect(hs).toContain('未精读13')
    expect(hs).toContain('已精读1')
  })

  it('按作者分组：没有作者信息时归入"未知作者"', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    setSelect('分类', 'author')
    expect(headings().join('|')).toContain('未知作者14')
  })

  it('排序下拉：按书名后列表顺序变化（最近排序不保证字典序）', () => {
    useLibraryStore.setState({ index: patchEntry(bigIndex(), '/s/书13.epub', { lastOpenedAt: 99 }, 2) })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    // 用搜索关闭「继续阅读/推荐」，网格才是完整列表（否则推荐是随机的，会让首位书不确定）
    typeInto(mounted.container.querySelector<HTMLInputElement>('input')!, '书')
    const firstGridTitle = () => mounted!.container.querySelectorAll('.grid')[mounted!.container.querySelectorAll('.grid').length - 1].querySelector('button.group span.line-clamp-3')!.textContent
    expect(firstGridTitle()).toBe('书13') // 最近打开的在前
    setSelect('排序', 'name')
    expect(firstGridTitle()).toBe('书00')
  })

  it('推荐行：6 本；"换一批"后与上一批不重叠（书库够大时）', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    const first = recPaths()
    expect(first).toHaveLength(6)
    click(Array.from(mounted.container.querySelectorAll('button')).find((b) => b.textContent?.includes('换一批')))
    const second = recPaths()
    expect(second).toHaveLength(6)
    expect(second.filter((x) => first.includes(x))).toEqual([])
  })

  it('推荐行带理由；搜索/筛选时隐藏；书太少（<3）不推荐', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(recPaths().every((t) => /还没翻开|打开过|接着读|回头再看|你读过的作者/.test(t))).toBe(true)
    typeInto(mounted.container.querySelector('input')!, '书0')
    expect(mounted.container.querySelector('[aria-label="随机推荐"]')).toBeNull()
    useLibraryStore.setState({ index: patchEntry(emptyIndex(0), '/x', {}, 1) })
    mounted.rerender(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.querySelector('[aria-label="随机推荐"]')).toBeNull()
  })

  it('补全按钮：显示待补全数量，点击触发；进行中显示进度与取消', () => {
    const fill = vi.fn().mockResolvedValue(null)
    useLibraryStore.setState({ fillMetadata: fill })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    const btn = Array.from(mounted.container.querySelectorAll('button')).find((b) => b.textContent?.includes('补全书籍信息'))!
    expect(btn.textContent).toContain('14')
    click(btn)
    expect(fill).toHaveBeenCalledTimes(1)

    const cancel = vi.fn()
    useLibraryStore.setState({ fillProgress: { done: 3, total: 14 }, cancelFill: cancel })
    mounted.rerender(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.textContent).toContain('正在补全 3/14')
    click(Array.from(mounted.container.querySelectorAll('button')).find((b) => b.textContent === '取消'))
    expect(cancel).toHaveBeenCalled()
  })

  it('没有待补全条目时不显示补全按钮；已补全的作者显示在卡片上', () => {
    const idx = bigIndex(3)
    for (const e of Object.values(idx.entries)) e.stale = false
    idx.entries['/s/书01.epub'].author = '某作者'
    useLibraryStore.setState({ index: idx })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    expect(mounted.container.textContent).not.toContain('补全书籍信息')
    expect(mounted.container.textContent).toContain('某作者')
  })
})

describe('monogramOf（生成式封面的装饰首字）', () => {
  it('跳过书名号/引号/空白取第一个字；英文转大写；空串兜底为"书"', async () => {
    const { monogramOf } = await import('@/components/library/coverSlot')
    expect(monogramOf('《门口的野蛮人》')).toBe('门')
    expect(monogramOf('  “三体”')).toBe('三')
    expect(monogramOf("the Innovator's Dilemma")).toBe('T')
    expect(monogramOf('2049')).toBe('2')
    expect(monogramOf('')).toBe('书')
    expect(monogramOf('《》')).toBe('书')
  })
})

describe('书卡信息布局：常见格式与体积不占位', () => {
  // 同一本书可能同时出现在推荐行和主列表：取主列表（最后一个）里的那张，不受推荐理由胶囊影响
  const cardFor = (title: string) =>
    Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>('button.group')).filter((b) => b.textContent?.includes(title)).pop()!
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

  it('EPUB 不显示格式标签；PDF 等少数派才有格式小胶囊', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    // 分组视图下网格显示全部书（不排除推荐），卡片上是格式胶囊而不是推荐理由
    const sel = mounted.container.querySelector<HTMLSelectElement>('select[aria-label="分类"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'status')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(cardFor('甲').textContent).not.toContain('EPUB')
    expect(cardFor('丙').textContent).toContain('PDF')
  })

  it('体积默认不显示在卡片上，只在悬停提示里；章数显示在卡片上', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    const yi = cardFor('乙')
    expect(yi.textContent).not.toContain('MB')
    expect(yi.textContent).toContain('12 章')
    expect(yi.title).toContain('2.0 MB')
    expect(yi.title).toContain('EPUB')
    expect(yi.title).toContain('12 章')
    expect(yi.getAttribute('aria-label')).toContain('2.0 MB')
  })

  it('按"大小"排序时体积才直接显示在卡片上', () => {
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    const sel = mounted.container.querySelector<HTMLSelectElement>('select[aria-label="排序"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'size')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(cardFor('甲').textContent).toContain('2.0 MB')
  })

  it('推荐理由胶囊优先于格式胶囊（同一位置只放一个）', () => {
    useLibraryStore.setState({ index: applyScan(emptyIndex(0), Array.from({ length: 8 }, (_, i) => ({ path: `/s/b${i}.pdf`, size: 1000, mtime: 'm' })), { now: 1, summaryNameOf: sum, summaryNames: new Set() }).index })
    mounted = mount(<LibraryView onOpenBook={() => {}} />)
    const rec = mounted.container.querySelector('[aria-label="随机推荐"] button.group')!
    expect(rec.textContent).toMatch(/还没翻开|打开过|你读过的作者|回头再看/)
    expect(rec.textContent).not.toContain('PDF')
  })
})
