import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/i18n'
import i18n from '../src/i18n'
import { mount, click, findButton, flush, waitFor, type Mounted } from './uiTestUtils'

// ---- 边界 mock：epub 解析（重型依赖）、mind-elixir（canvas/SVG 渲染）、章节预览服务 ----
const { getSingleChapterHTML, meInstances, MockMindElixir, previewChapters } = vi.hoisted(() => {
  const meInstances: Array<Record<string, ReturnType<typeof vi.fn>> & { opts: Record<string, unknown> }> = []
  class MockMindElixir {
    static THEME = { name: 'light' }
    static DARK_THEME = { name: 'dark' }
    opts: Record<string, unknown>
    map = { style: {} as Record<string, string> }
    init = vi.fn()
    refresh = vi.fn()
    toCenter = vi.fn()
    scale = vi.fn()
    scaleFit = vi.fn()
    install = vi.fn()
    destroy = vi.fn()
    changeTheme = vi.fn()
    constructor(opts: Record<string, unknown>) {
      this.opts = opts
      meInstances.push(this as never)
    }
  }
  return {
    getSingleChapterHTML: vi.fn(),
    meInstances,
    MockMindElixir,
    previewChapters: vi.fn(),
  }
})

vi.mock('../src/services/epubProcessor', () => ({
  EpubProcessor: class {
    getSingleChapterHTML = getSingleChapterHTML
  },
}))
vi.mock('mind-elixir', () => ({ default: MockMindElixir }))
vi.mock('mind-elixir/style.css', () => ({}))
vi.mock('../src/services/chapterPreviewService', () => ({
  chapterPreviewService: { previewChapters },
}))

import { EpubReader } from '../src/components/EpubReader'
import MindElixirReact from '../src/components/project/MindElixirReact'
import { ThemeProviderContext } from '../src/components/useTheme'
import { ConfigDialog } from '../src/components/project/ConfigDialog'
import type { EpubBookData } from '../src/types/chapter'

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const shadowDiv = (container: HTMLElement) =>
  container.querySelector('.epub-reader-content > div')?.shadowRoot?.querySelector('div') ?? null

describe('EpubReader', () => {
  beforeEach(() => getSingleChapterHTML.mockReset())

  it('书籍 HTML 写入 Shadow DOM 前净化（去掉事件属性与脚本）', () => {
    m = mount(
      <EpubReader
        chapter={{ id: '1', title: 'c', content: '<p>正文</p><img src="a.png" onerror="alert(1)"><script>alert(2)</script>' }}
        onClose={vi.fn()}
      />
    )
    const div = shadowDiv(m.container)!
    expect(div.textContent).toContain('正文')
    expect(div.innerHTML).not.toContain('onerror')
    expect(div.querySelector('script')).toBeNull()
  })

  it('改字号只更新 CSS 变量，不重建 Shadow DOM 内容', () => {
    const chapter = { id: '1', title: 'c', content: '<p>正文</p>' }
    m = mount(<EpubReader chapter={chapter} onClose={vi.fn()} externalFontSize={16} />)
    const before = shadowDiv(m.container)
    const host = m.container.querySelector<HTMLElement>('.epub-reader-content > div')!
    expect(host.style.getPropertyValue('--reader-font-size')).toBe('16px')

    m.rerender(<EpubReader chapter={chapter} onClose={vi.fn()} externalFontSize={20} />)
    expect(shadowDiv(m.container)).toBe(before)
    expect(host.style.getPropertyValue('--reader-font-size')).toBe('20px')
  })

  it('快速切章：旧章节晚到的结果不会覆盖新章节', async () => {
    const a = deferred<string>()
    const b = deferred<string>()
    getSingleChapterHTML.mockImplementation((_book: unknown, href: string) => (href === 'a' ? a.promise : b.promise))
    const bookData = { title: 't', author: 'x', book: {} } as unknown as EpubBookData

    m = mount(<EpubReader chapter={{ id: 'a', title: 'A', content: 'A', href: 'a' }} bookData={bookData} onClose={vi.fn()} />)
    await waitFor(() => expect(getSingleChapterHTML).toHaveBeenCalledWith({}, 'a'))
    m.rerender(<EpubReader chapter={{ id: 'b', title: 'B', content: 'B', href: 'b' }} bookData={bookData} onClose={vi.fn()} />)
    await waitFor(() => expect(getSingleChapterHTML).toHaveBeenCalledWith({}, 'b'))

    await act(async () => b.resolve('<p>章节B</p>'))
    const mounted = m
    await waitFor(() => expect(shadowDiv(mounted.container)?.textContent).toBe('章节B'))
    await act(async () => a.resolve('<p>章节A</p>'))
    await flush()

    expect(shadowDiv(m.container)?.textContent).toBe('章节B')
  })
})

describe('MindElixirReact 生命周期', () => {
  const data = { nodeData: { id: 'root', topic: '根', children: [] } } as never

  beforeEach(() => {
    meInstances.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('卸载时 destroy；options 变化先 destroy 旧实例再重建', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const opts1 = { direction: 1 } as never
    const opts2 = { direction: 2 } as never
    m = mount(<MindElixirReact data={data} options={opts1} />)
    expect(meInstances).toHaveLength(1)
    expect(meInstances[0].init).toHaveBeenCalledTimes(1)
    // 初始化后不应立刻重复 refresh
    expect(meInstances[0].refresh).not.toHaveBeenCalled()

    m.rerender(<MindElixirReact data={data} options={opts2} />)
    expect(meInstances).toHaveLength(2)
    expect(meInstances[0].destroy).toHaveBeenCalledTimes(1)

    m.unmount()
    m = null
    expect(meInstances[1].destroy).toHaveBeenCalledTimes(1)
  })

  it('懒挂载：进入视口前不创建实例', () => {
    let trigger: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null
    const disconnect = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: typeof trigger) {
          trigger = cb
        }
        observe() {}
        disconnect = disconnect
      }
    )
    m = mount(<MindElixirReact data={data} />)
    expect(meInstances).toHaveLength(0)

    act(() => trigger?.([{ isIntersecting: true }]))
    expect(meInstances).toHaveLength(1)
    expect(disconnect).toHaveBeenCalled()
  })

  it('跟随应用内主题开关（ThemeProvider），而非仅系统主题', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const ctx = (theme: 'dark' | 'light') => ({ theme, setTheme: vi.fn() })
    m = mount(
      <ThemeProviderContext.Provider value={ctx('dark')}>
        <MindElixirReact data={data} />
      </ThemeProviderContext.Provider>
    )
    expect(meInstances[0].opts.theme).toBe(MockMindElixir.DARK_THEME)

    m.rerender(
      <ThemeProviderContext.Provider value={ctx('light')}>
        <MindElixirReact data={data} />
      </ThemeProviderContext.Provider>
    )
    expect(meInstances[0].changeTheme).toHaveBeenLastCalledWith(MockMindElixir.THEME)
    expect(meInstances).toHaveLength(1)
  })
})

describe('ConfigDialog 章节预览', () => {
  beforeEach(() => {
    previewChapters.mockReset()
    previewChapters.mockResolvedValue([{ title: '第一章', preview: '内容' }])
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('对话框关闭时不解析文件；打开后才预览，换文件取消旧请求', async () => {
    const f1 = new File(['1'], 'a.epub')
    const f2 = new File(['2'], 'b.epub')
    m = mount(<ConfigDialog processing={false} file={f1} />)
    await flush()
    expect(previewChapters).not.toHaveBeenCalled()

    click(findButton(i18n.t('config.title')))
    await waitFor(() => expect(previewChapters).toHaveBeenCalledTimes(1))
    const firstSignal = previewChapters.mock.calls[0][5] as AbortSignal
    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(firstSignal.aborted).toBe(false)

    m.rerender(<ConfigDialog processing={false} file={f2} />)
    await waitFor(() => expect(previewChapters).toHaveBeenCalledTimes(2))
    expect(firstSignal.aborted).toBe(true)
    expect(previewChapters.mock.calls[1][0]).toBe(f2)
    // ConfigDialog 子树很重，全量并行跑时首次渲染较慢
  }, 30000)
})
