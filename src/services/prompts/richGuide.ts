/**
 * 「富内容块能力说明」：告诉模型有 mermaid / genui / html 三种块可用，附选型规则与 few-shot。
 * 正文是前后端共用的 config/rich-blocks-guide.md（CLI：src/cli/prompts.py expand_rich_guide）；
 * 章节总结模板里写 `{{richBlocksGuide}}` 即引用它。
 *
 * 这里是**预展开**而不是 renderPrompt 的变量：renderPrompt 对「模板没引用的变量」会追加到末尾，
 * 用户自定义的旧提示词没有这个占位符，就不该被塞进一大段说明——预展开则没有占位符就什么都不做。
 */
import guide from './config/rich-blocks-guide.md?raw'

export const RICH_GUIDE_PLACEHOLDER = /\{\{\s*richBlocksGuide\s*\}\}/g

export const getRichBlocksGuide = (): string => guide.replace(/^\uFEFF/, '').trim()

/** 把模板里的 `{{richBlocksGuide}}` 展开成说明正文；用函数做替换，避免正文里的 `$` 被当成替换模式 */
export const expandRichGuide = (template: string): string => (template || '').replace(RICH_GUIDE_PLACEHOLDER, () => getRichBlocksGuide())
