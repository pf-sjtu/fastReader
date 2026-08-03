// Prompt模板统一导出文件
import { getSystemPrompt } from './config/promptLoader'

export {
  getFictionChapterSummaryPrompt,
  getNonFictionChapterSummaryPrompt
} from './chapterSummary'

export {
  getChapterConnectionsAnalysisPrompt
} from './connectionAnalysis'

export {
  getOverallSummaryPrompt
} from './overallSummary'

export {
  getKeyChartsPrompt
} from './keyCharts'

// 测试连接的prompt - 从YAML配置加载
export const getTestConnectionPrompt = () => getSystemPrompt('testConnection')

export {
  getChapterMindMapPrompt,
  getMindMapArrowPrompt
} from './mindmap'