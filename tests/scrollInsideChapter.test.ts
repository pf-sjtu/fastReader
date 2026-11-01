import { describe, it, expect, afterEach, vi } from 'vitest'
import { chapterReadOffset, registerScrollContainer, scrollInsideChapter } from '@/utils/scrollTo'

/** jsdom 没有布局：用假的 rect / offsetHeight 模拟「容器上沿 0、章节上沿 top、章节高 height」 */
function setup(top: number, height: number) {
  const box = document.createElement('div')
  const el = document.createElement('div')
  el.id = 'chapter-summary-c1'
  box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  el.getBoundingClientRect = () => ({ top }) as DOMRect
  Object.defineProperty(el, 'offsetHeight', { value: height })
  document.body.append(box, el)
  const scrollTo = vi.fn()
  box.scrollTo = scrollTo as never
  registerScrollContainer(box)
  return { box, el, scrollTo }
}

afterEach(() => {
  registerScrollContainer(null)
  document.body.innerHTML = ''
})

describe('章内阅读偏移', () => {
  it('chapterReadOffset：章节上沿在对齐线（80）之上多少像素；还没滚到 → 0', () => {
    setup(-420, 2000)
    expect(chapterReadOffset('c1')).toBe(500)
    document.body.innerHTML = ''
    setup(300, 2000)
    expect(chapterReadOffset('c1')).toBe(0)
    expect(chapterReadOffset('nope')).toBe(0)
  })

  it('scrollInsideChapter：在对齐位置上再往下 px；不超过章节高度；找不到章节 / px≤0 不动', () => {
    const { box, scrollTo } = setup(200, 2000)
    box.scrollTop = 1000
    expect(scrollInsideChapter('c1', 500)).toBe(true)
    // 目标 = scrollTop + (章顶 - 容器顶) - 80 + 500 = 1000 + 200 - 80 + 500
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1620, behavior: 'auto' })
    scrollInsideChapter('c1', 99999)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000 + 200 - 80 + (2000 - 80), behavior: 'auto' })
    scrollTo.mockClear()
    expect(scrollInsideChapter('c1', 0)).toBe(false)
    expect(scrollInsideChapter('nope', 100)).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
