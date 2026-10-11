// 章节关联分析默认 prompt（用户未配置时的兜底，取默认版本 YAML 模板）
import { getConnectionAnalysisPrompt } from './config/promptLoader'
import { DEFAULT_PROMPT_VERSION } from './templates'

export const getChapterConnectionsAnalysisPrompt = (): string => getConnectionAnalysisPrompt(DEFAULT_PROMPT_VERSION)
