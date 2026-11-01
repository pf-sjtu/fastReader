// Prompt工具函数
import i18n from '@/i18n'
import languageInstructions from './config/language-instructions.json'

/**
 * 语言类型定义
 */
export type SupportedLanguage = 'en' | 'zh' | 'ja' | 'fr' | 'de' | 'es' | 'ru' | 'auto'

/**
 * auto（C8）：前端跟随当前界面语言（zh* → 中文，其它 → 英文）
 */
export function resolveAutoLanguage(): 'zh' | 'en' {
  const lang = (i18n?.language || '').toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

/**
 * 获取语言指令
 * @param language 输出语言
 * @returns 对应语言的指令文本
 */
export const getLanguageInstruction = (language: SupportedLanguage = 'en'): string => {
  const resolved = language === 'auto' ? resolveAutoLanguage() : language
  const table = languageInstructions as Record<string, string>
  return table[resolved] ?? table.en
}
