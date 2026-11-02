/**
 * 演示页样本的守卫：它曾把九种 genui 组件塞进一个围栏，被 `GENUI_LIMITS.nodes = 8` 静默截掉第 9 个，
 * 而验收记录照样写了「九种组件可见」。这里把「每个围栏都读得全」钉死。
 */
import { describe, it, expect } from 'vitest'
import { listRichBlocks } from '@/lib/richBlocks'
import { GENUI_LIMITS, parseGenUi } from '@/components/markdown/genui/schema'
import { genuiNodes, genuiFences, demoMarkdown, GENUI_NODES_PER_FENCE } from './sample'

describe('richDemo 样本', () => {
  it('每个 genui 围栏的节点数都在上限内，且九种组件一个不少', () => {
    const fences = genuiFences()
    expect(fences.length).toBeGreaterThan(1)
    const seen: string[] = []
    for (const f of fences) {
      const block = listRichBlocks(f)[0]
      expect(block?.lang).toBe('genui')
      const nodes = JSON.parse(block.code)
      expect(nodes.length).toBeLessThanOrEqual(GENUI_LIMITS.nodes)
      expect(nodes.length).toBeLessThanOrEqual(GENUI_NODES_PER_FENCE)
      seen.push(...nodes.map((n: { type: string }) => n.type))
    }
    expect(seen).toEqual(genuiNodes.map((n) => n.type))
    expect(new Set(seen).size).toBe(9)
  })

  it('正文里的 genui 块能被解析器原样读全（没有被截断的那半个）', () => {
    const types = listRichBlocks(demoMarkdown)
      .filter((b) => b.lang === 'genui' && !b.truncated)
      .flatMap((b) => {
        const r = parseGenUi(b.code)
        return r.ok ? r.nodes.map((n) => n.type) : ['<坏块，预期之内>']
      })
    for (const t of genuiNodes.map((n) => n.type)) expect(types).toContain(t)
  })

  it('六种放行图型与一个坏块都在样本里', () => {
    const mermaid = listRichBlocks(demoMarkdown).filter((b) => b.lang === 'mermaid')
    const heads = mermaid.map((b) => (b.code.split('\n').find((l) => l.trim()) ?? '').trim().split(/\s+/)[0])
    for (const k of ['graph', 'mindmap', 'stateDiagram-v2', 'quadrantChart', 'sequenceDiagram', 'timeline']) {
      expect(heads, `样本缺少 ${k}`).toContain(k)
    }
  })
})
