import { describe, it, expect } from 'vitest'
import { planDockLayout, type DockLayoutInput } from '@/components/workspace/dockLayout'

const ids = ['graph', 'timeline', 'people', 'study', 'ask', 'quiz']
// 主要：graph / study / ask；次要：timeline / people / quiz
const base: Omit<DockLayoutInput, 'available'> = {
  ids,
  primary: new Set(['graph', 'study', 'ask']),
  fullWidth: { graph: 100, timeline: 100, people: 80, study: 70, ask: 70, quiz: 70 }, // 全图文合计 490 + 间距 10
  iconWidth: 36,
  moreFullWidth: 64,
  moreIconWidth: 36,
  gap: 2,
  active: 'graph',
}
const plan = (available: number, over: Partial<DockLayoutInput> = {}) => planDockLayout({ ...base, available, ...over })
const modes = (p: ReturnType<typeof plan>) => Object.fromEntries(p.visible.map((v) => [v.id, v.mode]))

describe('planDockLayout：按顺序退让，尽量少折叠', () => {
  it('宽度够（或尚未测量 = 无限）：全部图标 + 文字，不出现「…」', () => {
    for (const w of [Infinity, 500]) {
      const p = plan(w)
      expect(p.overflow).toEqual([])
      expect(p.more).toBeNull()
      expect(p.visible.every((v) => v.mode === 'full')).toBe(true)
    }
  })

  it('略窄：先让次要页签只剩图标，主要页签仍带文字', () => {
    // 次要→图标：主要 240 + 次要 3×36 + 间距 10 = 358
    const p = plan(400)
    expect(p.more).toBeNull()
    expect(modes(p)).toEqual({ graph: 'full', study: 'full', ask: 'full', timeline: 'icon', people: 'icon', quiz: 'icon' })
  })

  it('更窄：主要页签也只剩图标（全部 6 个图标 = 6×36 + 10 = 226）', () => {
    const p = plan(300)
    expect(p.more).toBeNull()
    expect(p.visible).toHaveLength(6)
    expect(p.visible.every((v) => v.mode === 'icon')).toBe(true)
  })

  it('再窄：才折进「…」；次要的先折、靠后的先折，主要页签与当前页签留在外面', () => {
    const p = plan(200) // 全图标 226 放不下
    expect(p.more).not.toBeNull()
    expect(p.overflow).toContain('quiz') // 次要里靠后的最先折
    // 主要页签不在菜单里（只折一两个次要的就够了）
    for (const id of ['graph', 'study', 'ask']) expect(p.overflow).not.toContain(id)
    // 折叠时外面的页签只有图标
    expect(p.visible.every((v) => v.mode === 'icon')).toBe(true)
  })

  it('折叠得越少越好：只折 1 个不省空间（「…」与图标页签同宽），所以从折 2 个起；再窄才折 3 个', () => {
    expect(plan(226).overflow).toEqual([]) // 全图标恰好放得下
    expect(plan(225).overflow).toHaveLength(2) // 4×36 + 3×2 + 2 + 「…」36 = 188
    expect(plan(188).overflow).toHaveLength(2)
    expect(plan(187).overflow).toHaveLength(3)
  })

  it('当前页签永不折叠：即使它是次要的、本该最先折', () => {
    const p = plan(120, { active: 'quiz' })
    expect(p.visible.map((v) => v.id)).toContain('quiz')
    expect(p.overflow).not.toContain('quiz')
  })

  it('「…」按钮：放得下就图标 + 文字，空间不够只剩图标', () => {
    // 折 2 个后外面 4 个图标 = 150，+ 间距 2 + 「…」：图文 64 → 216，仅图标 36 → 188
    expect(plan(216).more).toBe('full')
    expect(plan(215).more).toBe('icon')
    expect(plan(215).overflow).toHaveLength(2) // 「…」缩成图标并没有多折页签
  })

  it('极窄：把能折的都折了，只剩当前页签 + 图标版「…」，不会出现负数 / 空外层', () => {
    const p = plan(10)
    expect(p.visible.map((v) => v.id)).toEqual(['graph'])
    expect(p.overflow).toHaveLength(ids.length - 1)
    expect(p.more).toBe('icon')
  })

  it('未测量到的页签（宽度 0 / 缺失）按图标宽度估算，不会算出 NaN', () => {
    const p = plan(300, { fullWidth: {} })
    expect(p.visible.every((v) => v.mode === 'full')).toBe(true) // 6×36 + 10 = 226 ≤ 300
  })

  it('只有一个页签：不折叠', () => {
    const p = planDockLayout({ ...base, ids: ['graph'], available: 10 })
    expect(p.more).toBeNull()
    expect(p.visible).toHaveLength(1)
  })
})
