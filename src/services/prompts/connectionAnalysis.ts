// 章节关联分析默认 prompt（用户未配置时的兜底，取 v1 YAML 模板）
import { getConnectionAnalysisPrompt } from './config/promptLoader'

export const getChapterConnectionsAnalysisPrompt = (): string => getConnectionAnalysisPrompt('v1')
