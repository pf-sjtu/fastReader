// 章节总结相关的prompt模板
export const getFictionChapterSummaryPrompt = (title: string, content: string, customPrompt?: string) => {
  const template = customPrompt || ''
  
  return template
    .replace('{{title}}', title)
    .replace('{{content}}', content)
}

export const getNonFictionChapterSummaryPrompt = (title: string, content: string, customPrompt?: string) => {
  const template = customPrompt || ''
  
  return template
    .replace('{{title}}', title)
    .replace('{{content}}', content)
}
