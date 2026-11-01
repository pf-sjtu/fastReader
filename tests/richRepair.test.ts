import { describe, it, expect, vi } from 'vitest'
import { listRichBlocks, mapRichBlocks, stripRichBlocks } from '@/lib/richBlocks'
import { REPAIR_BATCH, repairRichBlocks, type RepairFn, type Validators } from '@/services/pipeline/richRepair'

const F = '```'
const validators: Validators = { mermaid: async (c) => (/graph (LR|TD)/.test(c) && !c.includes('???') ? null : 'Parse error') }
const GOOD_GENUI = '{"type":"callout","body":"好"}'
const md = (prose: string, ...blocks: string[]) => [prose, ...blocks.map((b) => b)].join('\n\n')
const block = (lang: string, code: string) => `${F}${lang}\n${code}\n${F}`

describe('mapRichBlocks / listRichBlocks', () => {
  it('枚举闭合块与未闭合尾块，带 raw / 截断标记', () => {
    const t = md('前', block('mermaid', 'graph LR\nA-->B'), '中', `${F}genui\n{"type":`)
    const l = listRichBlocks(t)
    expect(l.map((b) => [b.lang, b.truncated])).toEqual([['mermaid', false], ['genui', true]])
    expect(l[0].code).toBe('graph LR\nA-->B')
    expect(l[0].raw).toBe(block('mermaid', 'graph LR\nA-->B'))
  })
  it('原样返回 raw 时文本不变；返回空串删除块、正文保留', () => {
    const t = md('前文', block('html', '<p>x</p>'), '后文')
    expect(mapRichBlocks(t, (b) => b.raw)).toBe(t)
    expect(stripRichBlocks(mapRichBlocks(t, () => ''))).toContain('前文')
  })
})

describe('repairRichBlocks：生成后统一修复', () => {
  it('没有坏块：不调用 LLM，原样返回', async () => {
    const repair = vi.fn()
    const s = md('正文', block('mermaid', 'graph LR\nA-->B'), block('genui', GOOD_GENUI))
    const r = await repairRichBlocks([s], repair, { validators })
    expect(repair).not.toHaveBeenCalled()
    expect(r.summaries[0]).toBe(s)
    expect(r.changed).toEqual([])
    expect(r.stats).toEqual({ bad: 0, fixed: 0, dropped: 0 })
  })

  it('跨章节的坏块合并成一次调用；修好的替换，好的块与正文逐字不变', async () => {
    const a = md('第一章正文。', block('mermaid', 'graph ???'), block('genui', GOOD_GENUI))
    const b = md('第二章正文。', block('genui', '{坏'))
    const repair = vi.fn<RepairFn>(async (items) => items.map((it) => ({ id: it.id, code: it.lang === 'mermaid' ? 'graph LR\nA-->B' : GOOD_GENUI })))
    const r = await repairRichBlocks([a, b], repair, { validators })
    expect(repair).toHaveBeenCalledTimes(1)
    expect(repair.mock.calls[0][0]).toHaveLength(2)
    expect(repair.mock.calls[0][0][0]).toMatchObject({ lang: 'mermaid', error: 'Parse error', context: expect.stringContaining('第一章正文') })
    expect(r.stats).toEqual({ bad: 2, fixed: 2, dropped: 0 })
    expect(r.changed.sort()).toEqual([0, 1])
    expect(r.summaries[0]).toContain('graph LR\nA-->B')
    expect(r.summaries[0]).toContain(block('genui', GOOD_GENUI)) // 好块原样
    // 正文逐字不变：修复只动块
    expect(stripRichBlocks(r.summaries[0])).toBe(stripRichBlocks(a))
    expect(stripRichBlocks(r.summaries[1])).toBe(stripRichBlocks(b))
  })

  it('修复结果仍不合格 / LLM 给 null / 没返回该 id → 删除该块，正文不变', async () => {
    const s = md('正文。', block('mermaid', 'graph ???'), block('genui', '{坏'), block('html', ' '))
    const repair: RepairFn = async (items) => [{ id: items[0].id, code: 'graph ???' }, { id: items[1].id, code: null }]
    const r = await repairRichBlocks([s], repair, { validators })
    expect(r.stats).toEqual({ bad: 3, fixed: 0, dropped: 3 })
    expect(listRichBlocks(r.summaries[0])).toHaveLength(0)
    expect(r.summaries[0].trim()).toBe('正文。')
  })

  it('截断的未闭合块：诊断为坏；修好则补全围栏', async () => {
    const s = md('正文。', `${F}genui\n{"type":"callout","bo`)
    const repair: RepairFn = async (items) => [{ id: items[0].id, code: GOOD_GENUI }]
    const r = await repairRichBlocks([s], repair, { validators })
    expect(r.stats.fixed).toBe(1)
    expect(listRichBlocks(r.summaries[0])).toMatchObject([{ lang: 'genui', truncated: false, code: GOOD_GENUI }])
  })

  it('LLM 调用抛错：只影响这一批，坏块被删，不抛出', async () => {
    const s = md('正文。', block('genui', '{坏'))
    const r = await repairRichBlocks([s], async () => { throw new Error('网络') }, { validators })
    expect(r.stats).toEqual({ bad: 1, fixed: 0, dropped: 1 })
  })

  it('超过一批的坏块分批调用，且 id 在批内重新编号', async () => {
    const many = Array.from({ length: REPAIR_BATCH + 2 }, () => block('genui', '{坏')).join('\n\n')
    const repair = vi.fn<RepairFn>(async (items) => items.map((it) => ({ id: it.id, code: GOOD_GENUI })))
    const r = await repairRichBlocks([md('正文', many)], repair, { validators })
    expect(repair).toHaveBeenCalledTimes(2)
    expect(repair.mock.calls[1][0].map((i) => i.id)).toEqual([0, 1])
    expect(r.stats.fixed).toBe(REPAIR_BATCH + 2)
  })

  it('失败占位章节 / 空章节被跳过；已取消则抛 AbortError', async () => {
    const repair = vi.fn<RepairFn>(async () => [])
    await repairRichBlocks(['', '⚠️ 处理失败'], repair, { validators })
    expect(repair).not.toHaveBeenCalled()
    const ac = new AbortController()
    ac.abort()
    await expect(repairRichBlocks([md('正文', block('genui', '{坏'))], repair, { validators, signal: ac.signal })).rejects.toThrow()
  })
})
