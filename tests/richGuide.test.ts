/**
 * 「富内容块能力说明」守卫：few-shot 示例必须是我们自己的解析器认可的写法（否则是在教模型写坏块）；
 * 说明只有一个来源（config/rich-blocks-guide.md），章节总结模板通过 {{richBlocksGuide}} 引用，没有内联副本。
 *
 * 说明分两层（决策层 + 参考层），这里同时守住「渐进披露」：`{{richBlocksGuideBrief}}` 只展开决策层（不含任何围栏示例），
 * 且两个占位符互不误匹配。mermaid 示例的真解析见 tests/mermaidGuide.test.ts（要 DOM，本文件跑在 node 环境）。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getRichBlocksGuide, getRichBlocksGuideBrief, expandRichGuide, briefOf, REFERENCE_HEADING } from '../src/services/prompts/richGuide'
import { getFictionChapterSummaryPrompt, getNonFictionChapterSummaryPrompt } from '../src/services/prompts/chapterSummary'
import { listRichBlocks } from '../src/lib/richBlocks'
import { parseGenUi } from '../src/components/markdown/genui/schema'

const guide = getRichBlocksGuide()
const brief = getRichBlocksGuideBrief()
/** 解析器认识的 genui 组件（新增组件时这里会红，逼着补 few-shot） */
const GENUI_TYPES = ['steps', 'compare', 'timeline', 'hierarchy', 'concept', 'cards', 'callout', 'tabs', 'quiz']

describe('富内容块能力说明', () => {
  it('few-shot 示例：每个块都闭合，genui 能被解析，mermaid 是受支持的图类型', () => {
    const blocks = listRichBlocks(guide)
    expect(blocks.length).toBeGreaterThanOrEqual(10)
    for (const b of blocks) {
      expect(b.truncated).toBe(false)
      if (b.lang === 'genui') expect(parseGenUi(b.code), b.code).toMatchObject({ ok: true })
      if (b.lang === 'mermaid') expect(b.code.trim()).toMatch(/^(graph (LR|TD)|sequenceDiagram|timeline|mindmap|stateDiagram-v2|quadrantChart)\b/)
    }
    expect(blocks.some((b) => b.lang === 'mermaid')).toBe(true)
    expect(blocks.some((b) => b.lang === 'html')).toBe(true)
  })

  it('每种 genui 组件都有正例（词汇表长出来就要教它怎么写）', () => {
    const types = listRichBlocks(guide)
      .filter((b) => b.lang === 'genui')
      .map((b) => JSON.parse(b.code).type)
    for (const t of GENUI_TYPES) expect(types, `缺少 ${t} 的示例`).toContain(t)
  })

  it('决策层点名了每种块（选型清单覆盖全部词汇，不只覆盖示例）', () => {
    for (const name of [...GENUI_TYPES, 'graph LR', 'sequenceDiagram', 'timeline', 'mindmap', 'stateDiagram-v2', 'quadrantChart', 'html']) {
      expect(brief, `决策层没有提到 ${name}`).toContain(name)
    }
  })

  it('讲清了：用 / 不用、不计字数、上限、反例', () => {
    for (const k of ['什么时候用', '不用', '不计入字数', '最多 2 个', '反例', '不得编造']) expect(guide).toContain(k)
  })

  it('两层结构：决策层在前、参考层从固定标题起，精简版不含任何围栏示例', () => {
    expect(guide).toContain(REFERENCE_HEADING)
    expect(guide.indexOf('什么时候用')).toBeLessThan(guide.indexOf(REFERENCE_HEADING))
    expect(brief.length).toBeLessThan(guide.length)
    expect(brief).not.toContain(REFERENCE_HEADING)
    // 精简版只剩决策规则：没有围栏示例，但选型与硬规则都在
    expect(listRichBlocks(brief)).toHaveLength(0)
    expect(brief).not.toContain('```')
    for (const k of ['选型', '什么时候用', '最多 2 个', '不计入字数']) expect(brief).toContain(k)
  })

  it('分界标题缺失 / 为空时退回全文，不给半截说明', () => {
    expect(briefOf('没有分界标题的一段说明')).toBe('没有分界标题的一段说明')
    expect(briefOf('')).toBe('')
    expect(briefOf(`${REFERENCE_HEADING} 开头的文件`)).toBe(`${REFERENCE_HEADING} 开头的文件`)
  })

  it('小说 / 社科章节总结模板都引用占位符，且没有内联副本', () => {
    for (const t of [getFictionChapterSummaryPrompt(), getNonFictionChapterSummaryPrompt()]) {
      expect(t).toContain('{{richBlocksGuide}}')
      expect(t).not.toContain('steps（流程）')
      expect(t).not.toContain('```mermaid')
    }
  })

  it('预展开：全文 / 精简两个占位符各展开各的；没有占位符的自定义提示词原样返回（不追加）', () => {
    const t = getNonFictionChapterSummaryPrompt()
    const out = expandRichGuide(t)
    expect(out).toContain(guide)
    expect(out).not.toContain('{{richBlocksGuide}}')
    expect(out).toContain('{{title}}') // 其余占位符留给 renderPrompt
    // 两种写法：全文 / 精简（含花括号内空白）
    expect(expandRichGuide('{{ richBlocksGuide }}')).toBe(guide)
    expect(expandRichGuide('{{richBlocksGuideBrief}}')).toBe(brief)
    // 两个占位符互不误匹配：只写 brief 时不会顺带塞进全文
    const onlyBrief = expandRichGuide('前缀 {{richBlocksGuideBrief}} 后缀')
    expect(onlyBrief).toContain(brief)
    expect(onlyBrief).not.toContain(REFERENCE_HEADING)
    const both = expandRichGuide('{{richBlocksGuideBrief}}\n{{richBlocksGuide}}')
    expect(both).toBe(`${brief}\n${guide}`)
    const custom = '自定义提示词 {{title}} {{content}}'
    expect(expandRichGuide(custom)).toBe(custom)
  })

  it('Python 端读的是同一份文件', () => {
    const raw = readFileSync(join(__dirname, '..', 'src', 'services', 'prompts', 'config', 'rich-blocks-guide.md'), 'utf8')
    expect(raw.trim()).toBe(guide)
  })
})
