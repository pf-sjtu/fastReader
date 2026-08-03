import { describe, it, expect } from 'vitest'
import { wrapText, maxUnitsForWidth } from '@/charts/textWrap'

describe('wrapText', () => {
  it('中文按宽度换行且不省略', () => {
    const lines = wrapText('购买8008晶片与创立公司', 6)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe('购买8008晶片与创立公司')
    expect(lines.some((l) => l.includes('…'))).toBe(false)
  })

  it('短文本单行', () => {
    expect(wrapText('早期', 10)).toEqual(['早期'])
  })
})

describe('maxUnitsForWidth', () => {
  it('宽度越大可排越多', () => {
    expect(maxUnitsForWidth(120, 11)).toBeGreaterThan(maxUnitsForWidth(60, 11))
  })
})
