import { describe, it, expect } from 'vitest'
import { asHrefString, normalizeHref, hrefMatches } from '../../src/services/epub/utils'

describe('epub href helpers', () => {
  it('asHrefString 对 undefined/null 返回空串', () => {
    expect(asHrefString(undefined)).toBe('')
    expect(asHrefString(null)).toBe('')
    expect(asHrefString('Text/story-9.xhtml')).toBe('Text/story-9.xhtml')
  })

  it('normalizeHref 去掉 anchor 与 ./', () => {
    expect(normalizeHref('./Text/a.xhtml#sec1')).toBe('Text/a.xhtml')
    expect(normalizeHref(undefined)).toBe('')
  })

  it('hrefMatches 在任一侧 undefined 时不抛错且返回 false', () => {
    expect(() => hrefMatches(undefined, 'a.xhtml')).not.toThrow()
    expect(hrefMatches(undefined, 'a.xhtml')).toBe(false)
    expect(hrefMatches('Text/a.xhtml', undefined)).toBe(false)
  })

  it('hrefMatches 兼容路径前缀', () => {
    expect(hrefMatches('Text/story-9.xhtml', 'story-9.xhtml')).toBe(true)
    expect(hrefMatches('Text/story-9.xhtml', 'Text/story-9.xhtml#x')).toBe(true)
  })
})
