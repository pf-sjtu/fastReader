import { describe, it, expect } from 'vitest'
import { resolveActiveChapterId } from '@/hooks/useChapterScrollSpy'

describe('resolveActiveChapterId', () => {
  const chapters = [
    { id: 'c1', top: 50, bottom: 250 },
    { id: 'c2', top: 300, bottom: 500 },
    { id: 'c3', top: 600, bottom: 800 },
  ]

  it('空列表返回空串', () => {
    expect(resolveActiveChapterId([], 0)).toBe('')
  })

  it('初始视口选中第一个可见章', () => {
    // 锚点 = 0 + 96 = 96；c1 top=50 → distance=46
    expect(resolveActiveChapterId(chapters, 0)).toBe('c1')
  })

  it('滚动后选中越过锚点且最近的章', () => {
    // 模拟滚到 c2 顶部落在锚点附近
    const scrolled = [
      { id: 'c1', top: -150, bottom: 50 },
      { id: 'c2', top: 40, bottom: 240 },
      { id: 'c3', top: 400, bottom: 600 },
    ]
    // 锚点 96；c1 dist=246；c2 dist=56 → c2
    expect(resolveActiveChapterId(scrolled, 0)).toBe('c2')
  })

  it('全部在锚点下方时取第一个 bottom 越过阈值的章', () => {
    const below = [
      { id: 'c1', top: 200, bottom: 400 },
      { id: 'c2', top: 450, bottom: 650 },
    ]
    // 锚点 96，均未越过；fallback c1 (bottom 400 > 40)
    expect(resolveActiveChapterId(below, 0)).toBe('c1')
  })

  it('深入滚动到最后一章', () => {
    const deep = [
      { id: 'c1', top: -800, bottom: -600 },
      { id: 'c2', top: -550, bottom: -350 },
      { id: 'c3', top: 20, bottom: 220 },
    ]
    expect(resolveActiveChapterId(deep, 0)).toBe('c3')
  })
})
