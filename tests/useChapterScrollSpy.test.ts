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

  describe('滚到底部', () => {
    // 复现：c8 很高，书尾 c9–c11 是折叠的矮卡片，滚到底时它们的顶边都够不到锚点(96)
    const tail = [
      { id: 'c8', top: -500, bottom: 120 },
      { id: 'c9', top: 160, bottom: 230 },
      { id: 'c10', top: 250, bottom: 320 },
      { id: 'c11', top: 340, bottom: 410 },
    ]

    it('不在底部：沿用锚点规则，卡在 c8（这正是要修的现象，用来对照）', () => {
      expect(resolveActiveChapterId(tail, 0, 96, { atBottom: false, containerBottom: 624 })).toBe('c8')
    })

    it('在底部：取顶边已进入视口的最后一章', () => {
      expect(resolveActiveChapterId(tail, 0, 96, { atBottom: true, containerBottom: 624 })).toBe('c11')
    })

    it('在底部但最后几章仍在视口之外：只算已进入视口的', () => {
      const partial = [...tail, { id: 'c12', top: 900, bottom: 970 }]
      expect(resolveActiveChapterId(partial, 0, 96, { atBottom: true, containerBottom: 624 })).toBe('c11')
    })

    it('不传 bottom 参数时行为不变（向后兼容）', () => {
      expect(resolveActiveChapterId(tail, 0)).toBe('c8')
    })

    it('在底部但没有任何章节进入视口时回退到锚点规则', () => {
      const none = [{ id: 'c1', top: 700, bottom: 800 }]
      expect(resolveActiveChapterId(none, 0, 96, { atBottom: true, containerBottom: 624 })).toBe('c1')
    })
  })
})
