import { describe, it, expect } from 'vitest'
import {
  normalizeMarkdownTypography,
  prepareMarkdownForRender,
  repairLooseMarkdownEmphasis,
  repairMidParagraphBlockquotes,
} from '../src/lib/markdown'

describe('normalizeMarkdownTypography', () => {
  it('应该在内部末尾有标点时在作用域后加空格', () => {
    expect(normalizeMarkdownTypography('**文本。**')).toBe('**文本。** ')
  })

  it('应该在内部开头和末尾都有标点时前后都加空格', () => {
    expect(normalizeMarkdownTypography('**"引用"**')).toBe(' **"引用"** ')
  })

  it('应该在内部开头有标点时在作用域前加空格', () => {
    expect(normalizeMarkdownTypography('**"一万种可能性之一"所说**')).toBe(
      ' **"一万种可能性之一"所说**'
    )
  })

  it('应该在内部无标点时不加空格', () => {
    expect(normalizeMarkdownTypography('**正常文本**')).toBe('**正常文本**')
  })

  it('应该处理斜体内部末尾标点', () => {
    expect(normalizeMarkdownTypography('*这是"引用"*')).toBe('*这是"引用"* ')
  })

  it('应该处理空输入', () => {
    expect(normalizeMarkdownTypography('')).toBe('')
    expect(normalizeMarkdownTypography(undefined)).toBe('')
  })

  it('应该处理多个连续标记', () => {
    expect(normalizeMarkdownTypography('**粗体**和*斜体*。')).toBe('**粗体**和*斜体*。')
  })

  /**
   * 回归：旧逻辑把 *** 当 ** 配对，且 * 算标点 → 出现 `。 *** 文***`
   * 与用户截图「专案。 *** 但那次…」一致。
   */
  it('不得拆坏合法的 ***加粗斜体***', () => {
    const input = '专案。***但那次健行中写下的程式已经烙印在我脑海里***。'
    const out = normalizeMarkdownTypography(input)
    expect(out).not.toMatch(/。\s+\*\*\*/)
    expect(out).toContain('***但那次健行中写下的程式已经烙印在我脑海里***')
    // 整句应仍可被识别为成对 ***
    expect(out.match(/\*\*\*/g)?.length).toBe(2)
  })

  it('融合句中的 ***洞见*** 应保持成对且无误加前导空格', () => {
    const input = '事件完成融合：***极度不适的外部环境反而成为深度心智工作的催化剂***。'
    const out = normalizeMarkdownTypography(input)
    expect(out).toContain('：***极度不适的外部环境反而成为深度心智工作的催化剂***')
    expect(out).not.toMatch(/：\s+\*\*\*/)
  })
})

describe('repairLooseMarkdownEmphasis', () => {
  it('去掉成对标记内侧首尾空白', () => {
    expect(repairLooseMarkdownEmphasis('前 *** 洞见 *** 后')).toBe('前 ***洞见*** 后')
    expect(repairLooseMarkdownEmphasis('前 * 斜体 * 后')).toBe('前 *斜体* 后')
    expect(repairLooseMarkdownEmphasis('前 ** 粗体 ** 后')).toBe('前 **粗体** 后')
  })

  it('不改合法无空白标记', () => {
    const s = '***洞见***和**主旨**与*细节*'
    expect(repairLooseMarkdownEmphasis(s)).toBe(s)
  })
})

describe('repairMidParagraphBlockquotes', () => {
  it('句号后的 > 提成独立引用行', () => {
    const input = '需要哪些步骤。> 小是关键。当时PDP-8'
    const out = repairMidParagraphBlockquotes(input)
    expect(out).toContain('步骤。\n\n> 小是关键')
  })
})

describe('prepareMarkdownForRender', () => {
  it('完整管道：合法 *** 不被拆 + 松散空白被修', () => {
    const input =
      '专案。***但那次健行中写下的程式、公式求值器及其优雅设计，已经烙印在我脑海里***。' +
      '融合： *** 极度不适的外部环境反而成为深度心智工作的催化剂 *** 。'
    const out = prepareMarkdownForRender(input)
    expect(out).toContain('***但那次健行中写下的程式、公式求值器及其优雅设计，已经烙印在我脑海里***')
    expect(out).toContain('***极度不适的外部环境反而成为深度心智工作的催化剂***')
    expect(out).not.toMatch(/。\s+\*\*\*\s+但/)
  })

  it('不破坏行内 code', () => {
    const input = '使用 `***` 作为标记，以及 **粗体**。'
    const out = prepareMarkdownForRender(input)
    expect(out).toContain('`***`')
    expect(out).toContain('**粗体**')
  })
})
