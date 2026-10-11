import { describe, it, expect, vi } from 'vitest'

const i18nMock = vi.hoisted(() => ({ language: 'zh' as string | undefined }))
vi.mock('@/i18n', () => ({ default: i18nMock }))

import { getLanguageInstruction, resolveAutoLanguage } from '../src/services/prompts/utils'

describe('getLanguageInstruction auto（跟随界面语言）', () => {
  it.each([
    ['zh', '请用中文回复。'],
    ['zh-CN', '请用中文回复。'],
    ['en', 'Please respond in English.'],
    ['en-US', 'Please respond in English.'],
    ['ja', 'Please respond in English.'],
    [undefined, 'Please respond in English.'],
  ])('界面语言 %s', (lang, expected) => {
    i18nMock.language = lang
    expect(getLanguageInstruction('auto')).toBe(expected)
  })

  it('resolveAutoLanguage 只返回 zh/en', () => {
    i18nMock.language = 'ZH-tw'
    expect(resolveAutoLanguage()).toBe('zh')
    i18nMock.language = 'fr'
    expect(resolveAutoLanguage()).toBe('en')
  })

  it('显式语言不受界面语言影响', () => {
    i18nMock.language = 'zh'
    expect(getLanguageInstruction('en')).toBe('Please respond in English.')
    expect(getLanguageInstruction('ja')).toBe('日本語で回答してください。')
    expect(getLanguageInstruction('fr')).toContain('français')
    expect(getLanguageInstruction('de')).toContain('Deutsch')
    expect(getLanguageInstruction('es')).toContain('español')
    expect(getLanguageInstruction('ru')).toContain('русском')
    expect(getLanguageInstruction()).toBe('Please respond in English.')
  })
})
