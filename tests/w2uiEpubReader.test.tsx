import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../src/i18n'
import { mount, click, findButton, flush, waitFor, type Mounted } from './uiTestUtils'

// 边界 mock：epubjs 解析
const { getSingleChapterHTML } = vi.hoisted(() => ({ getSingleChapterHTML: vi.fn() }))
vi.mock('../src/services/epubProcessor', () => ({
  EpubProcessor: class {
    getSingleChapterHTML = getSingleChapterHTML
  },
}))

import { EpubReader } from '../src/components/EpubReader'
import type { EpubBookData } from '../src/types/chapter'

const t = (k: string) => i18n.t(k)
const byTitle = (title: string) => document.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
const shadowText = (c: HTMLElement) =>
  c.querySelector('.epub-reader-content > div')?.shadowRoot?.querySelector('div')?.textContent ?? null
const chapter = { id: 'a', title: 'A', content: '<p>原始内容</p>', href: 'a.xhtml' }
const bookData = { title: 't', author: 'x', book: {} } as unknown as EpubBookData

let m: Mounted | null = null
beforeEach(() => {
  getSingleChapterHTML.mockReset()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('EpubReader 交互', () => {
  it('内部字号：上下限 12–24', () => {
    m = mount(<EpubReader chapter={chapter} onClose={vi.fn()} />)
    const host = () => m!.container.querySelector<HTMLElement>('.epub-reader-content > div')!
    for (let i = 0; i < 6; i++) click(byTitle(t('reader.epub.increaseFontSize')))
    expect(m.container.textContent).toContain('24px')
    expect(byTitle(t('reader.epub.increaseFontSize'))!.disabled).toBe(true)
    expect(host().style.getPropertyValue('--reader-font-size')).toBe('24px')
    for (let i = 0; i < 8; i++) click(byTitle(t('reader.epub.decreaseFontSize')))
    expect(m.container.textContent).toContain('12px')
    expect(byTitle(t('reader.epub.decreaseFontSize'))!.disabled).toBe(true)
  })

  it('外部控制字号/全屏时不显示内部按钮；全屏按钮交给回调', () => {
    const onToggle = vi.fn()
    m = mount(<EpubReader chapter={chapter} onClose={vi.fn()} externalFontSize={18} onToggleFullscreen={onToggle} />)
    expect(byTitle(t('reader.epub.increaseFontSize'))).toBeNull()
    click(byTitle(t('reader.epub.enterFullscreen')))
    expect(onToggle).toHaveBeenCalled()
    m.rerender(<EpubReader chapter={chapter} onClose={vi.fn()} externalFullscreen={false} showHeader={false} />)
    expect(byTitle(t('reader.epub.enterFullscreen'))).toBeNull()
  })

  it('内部全屏：进入、监听状态、按窗口高度调整、退出', () => {
    const request = vi.fn()
    const exit = vi.fn()
    HTMLElement.prototype.requestFullscreen = request as never
    document.exitFullscreen = exit as never
    const onClose = vi.fn()
    m = mount(<EpubReader chapter={chapter} onClose={onClose} />)
    click(byTitle(t('reader.epub.enterFullscreen')))
    expect(request).toHaveBeenCalled()

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.body })
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    const scroll = m.container.querySelector<HTMLElement>('[data-slot="scroll-area"]') ?? m.container.querySelector<HTMLElement>('.h-\\[80vh\\]')
    expect(scroll?.style.height).toBe(`${window.innerHeight - 120}px`)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    click(byTitle(t('reader.epub.exitFullscreen')))
    expect(exit).toHaveBeenCalled()
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(byTitle(t('reader.epub.enterFullscreen'))).toBeTruthy()
    click(findButton(t('reader.epub.close')))
    expect(onClose).toHaveBeenCalled()
  })

  it('带前缀的全屏 API 兜底', () => {
    const webkitReq = vi.fn()
    // @ts-expect-error 测试中移除标准 API
    HTMLElement.prototype.requestFullscreen = undefined
    ;(HTMLElement.prototype as unknown as { webkitRequestFullscreen: () => void }).webkitRequestFullscreen = webkitReq
    m = mount(<EpubReader chapter={chapter} onClose={vi.fn()} />)
    click(byTitle(t('reader.epub.enterFullscreen')))
    expect(webkitReq).toHaveBeenCalled()
    delete (HTMLElement.prototype as unknown as { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen
  })

  it('加载章节 HTML：成功写入、空内容或失败时回退原始内容', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    getSingleChapterHTML.mockResolvedValueOnce('<p>章节HTML</p>')
    m = mount(<EpubReader chapter={chapter} bookData={bookData} onClose={vi.fn()} />)
    expect(m.container.textContent).toContain(t('reader.epub.loadingContent'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    vi.useRealTimers()
    await waitFor(() => expect(shadowText(m!.container)).toBe('章节HTML'))
    m.unmount()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSingleChapterHTML.mockResolvedValueOnce('   ')
    m = mount(<EpubReader chapter={{ ...chapter, id: 'b' }} bookData={bookData} onClose={vi.fn()} />)
    await waitFor(() => expect(shadowText(m!.container)).toBe('原始内容'))
    warn.mockRestore()
    m.unmount()

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    getSingleChapterHTML.mockRejectedValueOnce(new Error('bad epub'))
    m = mount(<EpubReader chapter={{ ...chapter, id: 'c' }} bookData={bookData} onClose={vi.fn()} />)
    await waitFor(() => expect(shadowText(m!.container)).toBe('原始内容'))
    await flush()
    err.mockRestore()
  })
})
