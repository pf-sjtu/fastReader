// Prompt工具函数
import i18n from '@/i18n'

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
  switch (resolved) {
    case 'zh':
      return '请用中文回复。'
    case 'ja':
      return '日本語で回答してください。'
    case 'fr':
      return 'Veuillez répondre en français.'
    case 'de':
      return 'Bitte antworten Sie auf Deutsch.'
    case 'es':
      return 'Por favor responda en español.'
    case 'ru':
      return 'Пожалуйста, отвечайте на русском языке.'
    case 'en':
    default:
      return 'Please respond in English.'
  }
}
