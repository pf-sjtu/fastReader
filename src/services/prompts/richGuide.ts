/**
 * 「富内容块能力说明」：告诉模型有 mermaid / genui / html 三种块可用，附选型规则与 few-shot。
 * 正文是前后端共用的 config/rich-blocks-guide.md（CLI：src/cli/prompts.py expand_rich_guide）；
 * 章节总结模板里写 `{{richBlocksGuide}}` 即引用它。
 *
 * 说明分两层（渐进披露）：决策层（能力 / 何时用与不用 / 选型 / 硬规则）在前，
 * 参考层（每种块的语法骨架与示例）从 REFERENCE_HEADING 起。`{{richBlocksGuide}}` 展开全文，
 * `{{richBlocksGuideBrief}}` 只展开决策层——不想让每章都背语法细节时可以换用它（省一半输入）。
 *
 * 这里是**预展开**而不是 renderPrompt 的变量：renderPrompt 对「模板没引用的变量」会追加到末尾，
 * 用户自定义的旧提示词没有这个占位符，就不该被塞进一大段说明——预展开则没有占位符就什么都不做。
 */
import guide from './config/rich-blocks-guide.md?raw'

/** 决策层与参考层的分界（前后端共用；改这里要同步 src/cli/prompts.py） */
export const REFERENCE_HEADING = '## 各块写法（参考）'

/** 全文占位符与精简占位符是两个不同的名字，不会互相误匹配 */
export const RICH_GUIDE_PLACEHOLDER = /\{\{\s*richBlocksGuide\s*\}\}/g
export const RICH_GUIDE_BRIEF_PLACEHOLDER = /\{\{\s*richBlocksGuideBrief\s*\}\}/g

const clean = (text: string): string => text.replace(/^\uFEFF/, '').trim()

/** 说明全文 */
export const getRichBlocksGuide = (): string => clean(guide)

/** 只保留决策层（参考层从 REFERENCE_HEADING 起到文末）；没有分界标题时退回全文，不会给出半截说明 */
export function briefOf(full: string): string {
  const at = full.indexOf(REFERENCE_HEADING)
  return at > 0 ? full.slice(0, at).trim() : full
}

export const getRichBlocksGuideBrief = (): string => briefOf(getRichBlocksGuide())

/** 把模板里的两个占位符展开成对应正文；用函数做替换，避免正文里的 `$` 被当成替换模式 */
export const expandRichGuide = (template: string): string =>
  (template || '')
    .replace(RICH_GUIDE_PLACEHOLDER, () => getRichBlocksGuide())
    .replace(RICH_GUIDE_BRIEF_PLACEHOLDER, () => getRichBlocksGuideBrief())
