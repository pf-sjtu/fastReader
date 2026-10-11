// 章节总结默认 prompt（用户未配置时的兜底，取 v1 YAML 模板）
import { getChapterSummaryPrompt } from './config/promptLoader'

export const getFictionChapterSummaryPrompt = (): string => getChapterSummaryPrompt('v1', 'fiction')

export const getNonFictionChapterSummaryPrompt = (): string => getChapterSummaryPrompt('v1', 'nonFiction')
