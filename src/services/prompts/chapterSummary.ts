// 章节总结默认 prompt（用户未配置时的兜底，取默认版本 YAML 模板）
import { getChapterSummaryPrompt } from './config/promptLoader'
import { DEFAULT_PROMPT_VERSION } from './templates'

export const getFictionChapterSummaryPrompt = (): string => getChapterSummaryPrompt(DEFAULT_PROMPT_VERSION, 'fiction')

export const getNonFictionChapterSummaryPrompt = (): string => getChapterSummaryPrompt(DEFAULT_PROMPT_VERSION, 'nonFiction')
