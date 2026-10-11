// 全书总结默认 prompt（用户未配置时的兜底，取 v1 YAML 模板）
import { getOverallSummaryPrompt as getOverallSummaryPromptTemplate } from './config/promptLoader'

export const getOverallSummaryPrompt = (): string => getOverallSummaryPromptTemplate('v1')
