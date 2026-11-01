/**
 * 富内容块的「生成后统一修复」：章节总结跑完后，把所有坏块（mermaid 语法错 / genui JSON 坏 / html 不合规 / 被截断）
 * 收集起来，**一次**（分批）交给 LLM 修一遍。修复只依据生成内容本身（块源码 + 错误信息 + 前后一两句），不回看原书：
 * 问题是格式而不是信息。修好并通过校验的才采用；仍然坏的块直接删掉——块是锦上添花，正文不受影响。
 * 块不计字数，所以修复前后的正文逐字不变（测试里断言这一点）。
 */
import { fenceRichBlock, listRichBlocks, mapRichBlocks, type RichBlockInfo } from '@/lib/richBlocks'
import { buildSandboxDoc } from '@/lib/htmlSandbox'
import { parseGenUi } from '@/components/markdown/genui/schema'
import { isUsableText } from '@/utils/resultStatus'

export const REPAIR_BATCH = 6
const CONTEXT_CHARS = 80

export interface RepairItem {
  id: number
  lang: string
  error: string
  code: string
  /** 块前面一小段正文，帮助模型理解这张图想表达什么 */
  context: string
}
export interface RepairAnswer {
  id: number
  /** null / 空 = 放弃这个块 */
  code: string | null
}
export type RepairFn = (items: RepairItem[]) => Promise<RepairAnswer[]>
export type Validators = { mermaid: (code: string) => Promise<string | null> }

/** mermaid 校验用懒加载：没有 mermaid 块的书永远不会加载它 */
const defaultValidators: Validators = {
  mermaid: async (code) => (await import('@/lib/mermaidRender')).validateMermaid(code),
}

/** 返回问题描述；null = 没问题 */
export async function diagnoseBlock(b: Pick<RichBlockInfo, 'lang' | 'code' | 'truncated'>, validators: Validators = defaultValidators): Promise<string | null> {
  if (b.truncated) return '代码块没有结束围栏（输出被截断）'
  if (b.lang === 'genui') {
    const r = parseGenUi(b.code)
    return r.ok ? null : r.error
  }
  if (b.lang === 'html') {
    const r = buildSandboxDoc(b.code)
    return r.ok ? null : r.error
  }
  return validators.mermaid(b.code)
}

export interface RepairStats {
  /** 发现的坏块数 */
  bad: number
  fixed: number
  dropped: number
}
export interface RepairResult {
  /** 与输入等长；没改动的章节原样（同一个引用） */
  summaries: string[]
  /** 被改动的章节下标，调用方据此更新缓存 */
  changed: number[]
  stats: RepairStats
}

/** 块前文：取块之前最近一小段正文（去围栏块、折叠空白） */
function contextBefore(md: string, code: string): string {
  const at = md.indexOf(code)
  const head = (at > 0 ? md.slice(0, at) : md).replace(/`{3,}[\s\S]*?(`{3,}|$)/g, ' ').replace(/\s+/g, ' ').trim()
  return head.slice(-CONTEXT_CHARS)
}

export async function repairRichBlocks(
  summaries: string[],
  repair: RepairFn,
  opts: { validators?: Validators; signal?: AbortSignal } = {}
): Promise<RepairResult> {
  const validators = opts.validators ?? defaultValidators
  const stats: RepairStats = { bad: 0, fixed: 0, dropped: 0 }
  const out = [...summaries]

  // 1) 逐章诊断；key = `${章下标}:${块序号}`
  type Bad = { key: string; ch: number; idx: number; block: RichBlockInfo; error: string; context: string }
  const bad: Bad[] = []
  for (let ch = 0; ch < summaries.length; ch++) {
    const md = summaries[ch]
    if (!isUsableText(md)) continue
    const blocks = listRichBlocks(md)
    for (let idx = 0; idx < blocks.length; idx++) {
      const error = await diagnoseBlock(blocks[idx], validators)
      if (error) bad.push({ key: `${ch}:${idx}`, ch, idx, block: blocks[idx], error, context: contextBefore(md, blocks[idx].code) })
    }
  }
  stats.bad = bad.length
  if (!bad.length) return { summaries: out, changed: [], stats }

  // 2) 统一修复：分批，一批一次调用；调用失败 / 被取消只影响这一批
  const verdict = new Map<string, string | null>() // key → 修好的源码；null = 放弃
  for (let i = 0; i < bad.length; i += REPAIR_BATCH) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const batch = bad.slice(i, i + REPAIR_BATCH)
    let answers: RepairAnswer[] = []
    try {
      answers = await repair(batch.map((b, id) => ({ id, lang: b.block.lang, error: b.error, code: b.block.code, context: b.context })))
    } catch (e) {
      if (opts.signal?.aborted) throw e
    }
    for (const [id, b] of batch.entries()) {
      const fixed = answers.find((a) => a.id === id)?.code?.trim()
      // 修好的必须重新通过同一套诊断才算数
      if (fixed && !(await diagnoseBlock({ lang: b.block.lang, code: fixed, truncated: false }, validators))) verdict.set(b.key, fixed)
      else verdict.set(b.key, null)
    }
  }

  // 3) 写回：修好的替换、仍坏的删掉；只动块
  const changed = new Set<number>()
  const badKeys = new Set(bad.map((b) => b.key))
  for (const ch of new Set(bad.map((b) => b.ch))) {
    out[ch] = mapRichBlocks(summaries[ch], (b, idx) => {
      const key = `${ch}:${idx}`
      if (!badKeys.has(key)) return b.raw
      changed.add(ch)
      const fixed = verdict.get(key)
      if (fixed) {
        stats.fixed++
        return fenceRichBlock(b.lang, fixed)
      }
      stats.dropped++
      return ''
    }).replace(/\n{3,}/g, '\n\n')
  }
  return { summaries: out, changed: [...changed], stats }
}
