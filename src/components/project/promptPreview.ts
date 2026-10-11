// 提示词预览：与真实请求走同一个 renderPrompt 与同一套变量定义（名称/标签/顺序），只把值换成示例文本
import { renderPrompt, type PromptVar } from '../../services/prompts/render'
import { chapterVars, combinedMindMapVars, connectionVars, overallVars } from '../../services/ai/promptInputs'

export type PromptTab = 'chapterSummary' | 'mindmap' | 'connectionAnalysis' | 'overallSummary'

/** 各变量的示例值，键为占位符名 */
export type PreviewSamples = Partial<Record<string, string>>

function varsFor(tab: PromptTab, combinedMindmap: boolean): PromptVar[] {
  switch (tab) {
    case 'chapterSummary':
      return chapterVars('', '')
    case 'mindmap':
      return combinedMindmap ? combinedMindMapVars('', []) : chapterVars('', '')
    case 'connectionAnalysis':
      return connectionVars([])
    case 'overallSummary':
      return overallVars('', [], '')
  }
}

export function buildPromptPreview(
  tab: PromptTab,
  template: string,
  samples: PreviewSamples,
  combinedMindmap = false
): string {
  const vars = varsFor(tab, combinedMindmap).map((v) => ({ ...v, value: samples[v.name] ?? v.value }))
  return renderPrompt(template, vars)
}
