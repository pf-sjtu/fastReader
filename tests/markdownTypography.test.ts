import { describe, it, expect } from 'vitest'
import { normalizeMarkdownTypography } from '../src/lib/markdown'

describe('normalizeMarkdownTypography', () => {
  // 1. 后加：内部末尾有标点
  it('应该在内部末尾有标点时在作用域后加空格', () => {
    const input = '**文本。**'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe('**文本。** ')
  })

  // 2. 前后加：内部开头和末尾都有标点
  it('应该在内部开头和末尾都有标点时前后都加空格', () => {
    const input = '**"引用"**'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe(' **"引用"** ')
  })

  // 3. 前后加：内部开头和末尾都有标点（另一个例子）
  it('应该在内部开头和末尾都有标点时前后都加空格（另一例）', () => {
    const input = '**"文本"**'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe(' **"文本"** ')
  })

  // 4. 前加：内部开头有标点
  it('应该在内部开头有标点时在作用域前加空格', () => {
    const input = '**"一万种可能性之一"所说**'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe(' **"一万种可能性之一"所说**')
  })

  // 5. 不加：内部无标点
  it('应该在内部无标点时不加空格', () => {
    const input = '**正常文本**'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe('**正常文本**')
  })

  // 6. 后加：内部末尾有标点（斜体）
  it('应该在斜体内部末尾有标点时在作用域后加空格', () => {
    const input = '*这是"引用"*'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe('*这是"引用"* ')
  })

  // 额外边界测试
  it('应该处理下划线标记', () => {
    const input = '__测试文本。__'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe('__测试文本。__ ')
  })

  it('应该处理单下划线斜体', () => {
    const input = '_这是文本。_'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe('_这是文本。_ ')
  })

  it('应该处理空输入', () => {
    expect(normalizeMarkdownTypography('')).toBe('')
    expect(normalizeMarkdownTypography(undefined)).toBe('')
  })

  it('应该处理英文标点', () => {
    const input = '**"Hello World"**'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe(' **"Hello World"** ')
  })

  it('应该处理多个连续标记', () => {
    const input = '**粗体**和*斜体*。'
    const result = normalizeMarkdownTypography(input)
    expect(result).toBe('**粗体**和*斜体*。')
  })
})
