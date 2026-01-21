// 章节关联分析相关的prompt模板
export const getChapterConnectionsAnalysisPrompt = (chapterSummaries: string, customPrompt?: string) => {
  const template = customPrompt || ''
  
  return template.replace('{{chapterSummaries}}', chapterSummaries)
}
