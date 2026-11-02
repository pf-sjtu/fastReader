/**
 * 指南里的 mermaid 示例与「标点要不要加引号」的说法，必须经**真实解析器**（生产同一套 mermaid 配置）验证。
 *
 * 为什么不放在 tests/richGuide.test.ts：那个文件跑在 node 环境，mermaid 需要 DOM；
 * 而 jsdom 又渲染不了图（缺 getBBox），所以本文件只做 `validateMermaid`（=生产里 mermaid.parse）这一半，
 * 「图真的画得出来」由 tests/tour/richDemo/ 的真实浏览器验收负责。
 */
import { describe, it, expect } from 'vitest'
import { getRichBlocksGuide } from '../src/services/prompts/richGuide'
import { listRichBlocks } from '../src/lib/richBlocks'
import { validateMermaid } from '../src/lib/mermaidRender'

/** 指南放行的图型（放行范围写在这里，指南里的示例必须落在其中） */
const ALLOWED = ['graph LR', 'graph TD', 'sequenceDiagram', 'timeline', 'mindmap', 'stateDiagram-v2', 'quadrantChart']
/** 每种图型至少要有一个示例骨架，模型才有东西可抄 */
const MUST_HAVE_EXAMPLE = ['graph', 'sequenceDiagram', 'timeline', 'mindmap', 'stateDiagram-v2', 'quadrantChart']

const examples = () => listRichBlocks(getRichBlocksGuide()).filter((b) => b.lang === 'mermaid')
const head = (code: string) => (code.split('\n').find((l) => l.trim()) ?? '').trim()
const kind = (code: string) => head(code).split(/\s+/)[0]

describe('指南的 mermaid 示例（真实解析器）', () => {
  it('每个示例都能被生产同款解析器接受，且首行是放行的图型', async () => {
    const blocks = examples()
    expect(blocks.length).toBeGreaterThanOrEqual(6)
    for (const b of blocks) {
      expect(ALLOWED, `首行不在放行范围内：${head(b.code)}`).toContain(head(b.code))
      expect(await validateMermaid(b.code), b.code).toBeNull()
    }
  })

  it('六种图型都有示例骨架，没有「说了支持却给不出写法」的', () => {
    const kinds = new Set(examples().map((b) => kind(b.code)))
    for (const k of MUST_HAVE_EXAMPLE) expect([...kinds], `缺少 ${k} 的示例`).toContain(k)
  })

  it('「节点文字含半角括号 / 引号必须加引号」与解析器的真实行为一致', async () => {
    // 不加引号真的会被拒绝（指南据此要求加引号）
    expect(await validateMermaid('graph LR\n  A[价格(含税)] --> B')).not.toBeNull()
    expect(await validateMermaid('graph LR\n  A[说"重点"] --> B')).not.toBeNull()
    // 加上引号就好了
    expect(await validateMermaid('graph LR\n  A["价格(含税)"] --> B')).toBeNull()
    // 其余标点不加引号也能解析——指南不再声称「中文标点都要加引号」，这里把真实行为钉住
    expect(await validateMermaid('graph LR\n  A[阶段：试点] --> B')).toBeNull()
    expect(await validateMermaid('graph LR\n  A[收入/成本] --> B')).toBeNull()
    expect(await validateMermaid('graph LR\n  A[甲，乙] --> B')).toBeNull()
  })

  it('箭头必须写 -->（指南里点名的常见错误）', async () => {
    expect(await validateMermaid('graph LR\n  A -> B')).not.toBeNull()
    expect(await validateMermaid('graph LR\n  A --> B')).toBeNull()
  })
})
