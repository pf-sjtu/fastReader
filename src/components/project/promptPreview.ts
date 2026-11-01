// 提示词预览：与真实请求走同一个 renderPrompt 与同一套变量定义（名称/标签/顺序），只把值换成示例文本
import { renderPrompt, type PromptVar } from '../../services/prompts/render'
import { expandRichGuide } from '../../services/prompts/richGuide'
import {
  arrowVars,
  chapterVars,
  combinedMindMapVars,
  connectionVars,
  overallVars,
} from '../../services/ai/promptInputs'

export type PromptTab = 'chapterSummary' | 'mindmap' | 'connectionAnalysis' | 'overallSummary'

/** 导图下的具体模板 */
export type MindmapVariant = 'chapter' | 'arrow' | 'combined'

/** 各变量的示例值，键为占位符名 */
export type PreviewSamples = Partial<Record<string, string>>

function varsFor(tab: PromptTab, mindmap: MindmapVariant): PromptVar[] {
  switch (tab) {
    case 'chapterSummary':
      return chapterVars('', '')
    case 'mindmap':
      if (mindmap === 'combined') return combinedMindMapVars('', [])
      if (mindmap === 'arrow') return arrowVars([])
      return chapterVars('', '')
    case 'connectionAnalysis':
      return connectionVars([])
    case 'overallSummary':
      return overallVars('', [], '')
  }
}

/**
 * @param mindmap 导图模板：布尔值兼容旧调用（true = 整书导图）
 */
export function buildPromptPreview(
  tab: PromptTab,
  template: string,
  samples: PreviewSamples,
  mindmap: boolean | MindmapVariant = false
): string {
  const variant: MindmapVariant = mindmap === true ? 'combined' : mindmap === false ? 'chapter' : mindmap
  const vars = varsFor(tab, variant).map((v) => ({ ...v, value: samples[v.name] ?? v.value }))
  return renderPrompt(expandRichGuide(template), vars)
}
