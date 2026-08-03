import { describe, it, expect } from 'vitest'
import { cssColorToHex } from '@/charts/theme'

describe('cssColorToHex', () => {
  it('保留合法 hex', () => {
    expect(cssColorToHex('#4a433c')).toBe('#4a433c')
    expect(cssColorToHex('#abc')).toBe('#aabbcc')
  })

  it('空值回退', () => {
    expect(cssColorToHex('', '#123456')).toBe('#123456')
  })

  it('解析 rgb()', () => {
    // jsdom 对 oklch 支持有限；rgb 必过
    if (typeof document === 'undefined') return
    const hex = cssColorToHex('rgb(74, 67, 60)', '#000000')
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(hex).toBe('#4a433c')
  })
})
