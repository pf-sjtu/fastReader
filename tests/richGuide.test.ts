/**
 * 「富内容块能力说明」守卫：few-shot 示例必须是我们自己的解析器认可的写法（否则是在教模型写坏块）；
 * 说明只有一个来源（config/rich-blocks-guide.md），章节总结模板通过 {{richBlocksGuide}} 引用，没有内联副本。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getRichBlocksGuide, expandRichGuide } from '../src/services/prompts/richGuide'
import { getFictionChapterSummaryPrompt, getNonFictionChapterSummaryPrompt } from '../src/services/prompts/chapterSummary'
import { listRichBlocks } from '../src/lib/richBlocks'
import { parseGenUi } from '../src/components/markdown/genui/schema'

const guide = getRichBlocksGuide()

describe('富内容块能力说明', () => {
  it('few-shot 示例：每个块都闭合，genui 能被解析，mermaid 是受支持的图类型', () => {
    const blocks = listRichBlocks(guide)
    expect(blocks.length).toBeGreaterThanOrEqual(4)
    for (const b of blocks) {
      expect(b.truncated).toBe(false)
      if (b.lang === 'genui') expect(parseGenUi(b.code), b.code).toMatchObject({ ok: true })
      if (b.lang === 'mermaid') expect(b.code.trim()).toMatch(/^(graph (LR|TD)|sequenceDiagram|timeline)\b/)
    }
    // 至少覆盖 mermaid 与多种 genui
    expect(blocks.some((b) => b.lang === 'mermaid')).toBe(true)
    const types = blocks.filter((b) => b.lang === 'genui').map((b) => JSON.parse(b.code).type)
    expect(new Set(types).size).toBeGreaterThanOrEqual(3)
  })

  it('讲清了：用 / 不用、不计字数、上限、反例', () => {
    for (const k of ['什么时候用', '不用', '不计入字数', '最多 2 个', '反例', '不得编造']) expect(guide).toContain(k)
  })

  it('小说 / 社科章节总结模板都引用占位符，且没有内联副本', () => {
    for (const t of [getFictionChapterSummaryPrompt(), getNonFictionChapterSummaryPrompt()]) {
      expect(t).toContain('{{richBlocksGuide}}')
      expect(t).not.toContain('steps（流程）')
      expect(t).not.toContain('```mermaid')
    }
  })

  it('预展开：占位符换成正文；没有占位符的自定义提示词原样返回（不追加）', () => {
    const t = getNonFictionChapterSummaryPrompt()
    const out = expandRichGuide(t)
    expect(out).toContain(guide)
    expect(out).not.toContain('{{richBlocksGuide}}')
    expect(out).toContain('{{title}}') // 其余占位符留给 renderPrompt
    const custom = '自定义提示词 {{title}} {{content}}'
    expect(expandRichGuide(custom)).toBe(custom)
    // 正文里的 $& 之类不被当成替换模式
    expect(expandRichGuide('{{ richBlocksGuide }}')).toBe(guide)
  })

  it('Python 端读的是同一份文件', () => {
    const raw = readFileSync(join(__dirname, '..', 'src', 'services', 'prompts', 'config', 'rich-blocks-guide.md'), 'utf8')
    expect(raw.trim()).toBe(guide)
  })
})
