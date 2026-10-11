// 全书总结默认 prompt（用户未配置时的兜底，取默认版本 YAML 模板）
import { getOverallSummaryPrompt as getOverallSummaryPromptTemplate } from './config/promptLoader'
import { DEFAULT_PROMPT_VERSION } from './templates'

export const getOverallSummaryPrompt = (): string => getOverallSummaryPromptTemplate(DEFAULT_PROMPT_VERSION)
