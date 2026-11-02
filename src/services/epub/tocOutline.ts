/**
 * 扁平目录的层级还原（纯函数，无 epubjs 运行时 / AI 依赖）。
 *
 * 背景：Mobi 转 EPUB、部分出版社的 NCX 把「部 / 章 / 节 / 小节」全部摊平在同一层。epub-toc 模式的「目录层级」选项
 * 因此失效——要么一百多章，要么一章都不剩。这里按标题自带的编号体系推断层级，再把层级回挂到**原始目录项**
 * （href / 锚点原样保留，正文区间仍由 epubProcessor 按锚点切），所以无论层级来自算法还是 LLM，切出来的内容都是确定的。
 *
 * 层级约定（levels[i]）：0 = 部 / 篇 / 卷（只做分组，不单独成章，但保留为区间边界）；1 = 章（用户通常整章去读的单位）；
 * 2 = 节；3 = 小节……前言 / 附录等无编号条目取 1（与章并列）。
 *
 * 分工：编号体系清晰 → 算法直接出结果（零成本）；编号体系混杂、或「几个章标题 + 一大堆无编号小标题」这类算法拿不准的
 * → 标 llmCandidate，交给 LLM 判层级（LLM 只回答「第几级」，回挂仍由算法完成，并做覆盖率 / 章数校验）。
 */
import type { NavItem } from '@ssshooter/epubjs'

export type LabelKind =
  | 'part'
  | 'chapter'
  | 'jie'
  | 'cnOrd'
  | 'bare'
  | 'roman'
  | 'paren'
  | 'dec2'
  | 'dec3'
  | 'dec4'
  | 'other'

/** 编号体系由大到小的惯例顺序；同一本书里出现的种类按此顺序依次定级 */
const ORDER: readonly Exclude<LabelKind, 'other' | 'part'>[] = ['chapter', 'jie', 'cnOrd', 'bare', 'roman', 'paren', 'dec2', 'dec3', 'dec4']

const CN = '零〇一二三四五六七八九十百千两'
const NUM = `(?:\\d+|[${CN}]+)`
const WORDNUM = '(?:\\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)'

const PART_PREFIX = new RegExp(`^(?:第\\s*${NUM}\\s*(?:部分|部|篇|卷|编)|[上中下前后]篇|[上中下]卷|(?:part|book|volume)\\s+${WORDNUM}\\b)\\s*[：:.、-]?\\s*`, 'i')
const RE_CHAPTER = new RegExp(`^(?:第\\s*${NUM}\\s*[章回讲课封]|chapter\\s+${WORDNUM}\\b)`, 'i')
const RE_JIE = new RegExp(`^第\\s*${NUM}\\s*节`)
const RE_CNORD = new RegExp(`^[${CN}]+\\s*[、,.，]`)
const RE_PAREN = new RegExp(`^[(（]\\s*(?:\\d+|[${CN}]+)\\s*[)）]`)
const RE_DEC = /^(\d{1,3}(?:\.\d{1,3}){1,3})(?![\d])/
// 「1 战略」「2．企业」「3、…」；只靠空白分隔时排除数量 / 日期（「20 世纪」「30 %」「5 月」），
// 带点号 / 顿号 / 右括号的是明确的序号（「2.世界不是平的」不能被「世纪」的「世」误伤）
const RE_BARE = /^(\d{1,3})(?:\s*[.、)]\s*\S|\s+(?![年月日世%\d])\S)/
const RE_ROMAN = /^[IVXLC]{1,6}(?:\s*[.、)]\s*\S|\s*$)/

/** NFKC 把全角数字 / 点号 / 括号统一成半角，再去掉行首的装饰符（︱ ｜ • 等） */
function normalizeLabel(label: string): string {
  return (label ?? '').normalize('NFKC').replace(/^[\s\u3000•·\-–—*#>|︱｜\u2502]+/, '')
}

export function classifyLabel(label: string): LabelKind {
  const s = normalizeLabel(label)
  if (!s) return 'other'
  const prefix = PART_PREFIX.exec(s)
  if (prefix) {
    // 「第一篇 第二章 xxx」其实是章：篇号只是前缀
    const rest = s.slice(prefix[0].length)
    return RE_CHAPTER.test(rest) ? 'chapter' : 'part'
  }
  if (RE_CHAPTER.test(s)) return 'chapter'
  if (RE_JIE.test(s)) return 'jie'
  const dec = RE_DEC.exec(s)
  if (dec) {
    const depth = dec[1].split('.').length
    return depth >= 4 ? 'dec4' : (`dec${depth}` as 'dec2' | 'dec3')
  }
  if (RE_PAREN.test(s)) return 'paren'
  if (RE_CNORD.test(s)) return 'cnOrd'
  if (RE_ROMAN.test(s)) return 'roman'
  if (RE_BARE.test(s)) return 'bare'
  return 'other'
}

/** 扁平目录：条目够多且没有任何嵌套 */
export function isFlatToc(toc: readonly NavItem[], minEntries = 10): boolean {
  return toc.length >= minEntries && toc.every((t) => !t.subitems || t.subitems.length === 0)
}

export interface InferredOutline {
  /** 各条目的层级；null = 没有可还原的层级（编号体系 < 2 种，扁平本来就是对的） */
  levels: number[] | null
  /** 算法是否足够确定 */
  confident: boolean
  /** 值得请 LLM 判一次层级（算法拿不准，或编号信息不足但目录很长） */
  llmCandidate: boolean
  /** 没有 LLM / LLM 失败时，是否仍采用算法给出的 levels（拿不准且证据弱的情形保持扁平） */
  applyWithoutLlm: boolean
  /** 诊断：参与定级的种类与计数 */
  kinds: Partial<Record<LabelKind, number>>
}

/** 夹在编号条目中间的无编号条目占比超过它，就认为算法没把握 */
const MAX_MID_OTHER_RATIO = 0.15
/** 完全没有编号信息时，目录至少这么长才值得问一次 LLM */
export const LLM_MIN_ENTRIES = 30

export function inferOutline(labels: readonly string[]): InferredOutline {
  const n = labels.length
  const raw = labels.map(classifyLabel)
  const counts: Partial<Record<LabelKind, number>> = {}
  for (const k of raw) counts[k] = (counts[k] ?? 0) + 1

  // 零星出现的编号种类（<2 条或 <3%）更像噪声，不参与定级
  const minCount = Math.max(2, Math.ceil(n * 0.03))
  const kinds = raw.map((k) => (k !== 'other' && (counts[k] ?? 0) < minCount ? 'other' : k))
  const kept: Partial<Record<LabelKind, number>> = {}
  for (const k of kinds) kept[k] = (kept[k] ?? 0) + 1

  const hasPart = (kept.part ?? 0) > 0
  const present = ORDER.filter((k) => (kept[k] ?? 0) > 0)
  const rankedKinds = present.length + (hasPart ? 1 : 0)

  const first = kinds.findIndex((k) => k !== 'other')
  let last = -1
  for (let i = n - 1; i >= 0; i--) {
    if (kinds[i] !== 'other') {
      last = i
      break
    }
  }
  const midOtherCount = kinds.reduce((c, k, i) => c + (k === 'other' && i > first && i < last ? 1 : 0), 0)
  const midRatio = n ? midOtherCount / n : 0

  // 编号信息不足：没有层级可还原；但目录很长时，无编号的标题层级只有 LLM 能判
  if (rankedKinds === 0) {
    return { levels: null, confident: false, llmCandidate: n >= LLM_MIN_ENTRIES, applyWithoutLlm: false, kinds: kept }
  }

  const rank = new Map<LabelKind, number>()
  if (hasPart) rank.set('part', 0)
  present.forEach((k, i) => rank.set(k, i + 1))
  const maxRank = Math.max(present.length, 1)

  const build = (): number[] => {
    const levels: number[] = new Array(n).fill(1)
    for (let i = 0; i < n; i++) {
      const k = kinds[i]
      if (k !== 'other') levels[i] = rank.get(k) ?? 1
      else if (i < first || i > last) levels[i] = 1 // 前言 / 版权页 / 后记 / 致谢：与章并列
      // 夹在编号条目中间的无编号标题（副标题、「论快乐」之类）：当作上一条的下一级
      else levels[i] = Math.min(Math.max(levels[i - 1], 0) + 1, maxRank + 1)
    }
    return levels
  }

  if (rankedKinds >= 2) {
    const confident = midRatio <= MAX_MID_OTHER_RATIO
    return { levels: build(), confident, llmCandidate: !confident, applyWithoutLlm: true, kinds: kept }
  }

  // 只有一种编号（典型：几十个「第N章」+ 一大堆无编号小标题，或干净的纯章目录）
  const only = hasPart ? 'part' : present[0]
  if (midRatio <= MAX_MID_OTHER_RATIO || only === 'part') {
    return { levels: null, confident: true, llmCandidate: false, applyWithoutLlm: false, kinds: kept }
  }
  return { levels: build(), confident: false, llmCandidate: true, applyWithoutLlm: false, kinds: kept }
}

/**
 * 校验并规整 LLM 返回的层级：必须覆盖绝大多数条目、层级为合理整数、至少 2 个「章」。
 * 缺失的条目沿用前一条的层级（等价于「和上一条同级」）。不合格返回 null，调用方保持扁平。
 */
export function normalizeLlmLevels(answers: readonly { id: number; level: number }[], n: number): number[] | null {
  const byId = new Map<number, number>()
  for (const a of answers) {
    if (Number.isInteger(a?.id) && a.id >= 0 && a.id < n && Number.isInteger(a.level) && a.level >= 0 && a.level <= 6) byId.set(a.id, a.level)
  }
  if (byId.size < n * 0.9) return null
  const levels: number[] = []
  for (let i = 0; i < n; i++) levels.push(byId.get(i) ?? levels[i - 1] ?? 1)
  return validateLevels(levels) ? levels : null
}

/** 至少 2 个章级（1）条目，且存在层级差（否则没必要重建） */
export function validateLevels(levels: readonly number[]): boolean {
  const chapters = levels.filter((l) => l === 1).length
  return chapters >= 2 && new Set(levels).size >= 2
}

/** 部 / 篇节点：不成章，但它的锚点仍是前一章的右边界（否则前一章会把下一部的扉页吞进去） */
const boundaryNodes = new WeakSet<object>()
export const isBoundaryNode = (item: unknown): boolean => !!item && typeof item === 'object' && boundaryNodes.has(item)

/**
 * 把层级回挂到原始目录项：0 级（部 / 篇）作为「边界节点」留在根上，其余按栈嵌套。
 * 条目对象浅拷贝后挂 subitems，href / 锚点 / label 原样保留。章级不足返回 null。
 */
export function buildOutlineTree(toc: readonly NavItem[], levels: readonly number[]): NavItem[] | null {
  if (toc.length !== levels.length || !validateLevels(levels)) return null
  const roots: NavItem[] = []
  const stack: { level: number; node: NavItem }[] = []
  for (let i = 0; i < toc.length; i++) {
    const level = levels[i]
    const node: NavItem = { ...toc[i], subitems: [] }
    if (level <= 0) {
      boundaryNodes.add(node)
      roots.push(node)
      stack.length = 0 // 新的一部开始，上一章的嵌套到此为止
      continue
    }
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    const parent = stack[stack.length - 1]?.node
    if (parent) (parent.subitems as NavItem[]).push(node)
    else roots.push(node)
    stack.push({ level, node })
  }
  return roots.filter((r) => !isBoundaryNode(r)).length >= 2 ? roots : null
}

/** 分批：条目过多时每批带上前一批末尾的已定级条目作上下文，保证批间层级口径一致 */
export const LLM_BATCH = 500
export const LLM_CONTEXT = 12

export interface OutlineEntry {
  id: number
  label: string
}
export interface OutlinePrior extends OutlineEntry {
  level: number
}
export type AskLevels = (entries: OutlineEntry[], prior: OutlinePrior[]) => Promise<{ id: number; level: number }[]>

/** 对整本目录逐批调用 ask，合并后校验；任一批失败 / 不合格 → null（保持扁平，不写半截结果） */
export async function refineWithLlm(labels: readonly string[], ask: AskLevels, signal?: AbortSignal): Promise<number[] | null> {
  const n = labels.length
  const merged = new Map<number, number>()
  for (let start = 0; start < n; start += LLM_BATCH) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const entries = labels.slice(start, start + LLM_BATCH).map((label, i) => ({ id: start + i, label }))
    const prior: OutlinePrior[] = []
    for (let i = Math.max(0, start - LLM_CONTEXT); i < start; i++) prior.push({ id: i, label: labels[i], level: merged.get(i) ?? 1 })
    const answers = await ask(entries, prior)
    const ids = new Set(entries.map((e) => e.id))
    for (const a of answers) if (ids.has(a.id)) merged.set(a.id, a.level)
  }
  return normalizeLlmLevels([...merged].map(([id, level]) => ({ id, level })), n)
}

/** 缓存键输入：目录文本本身（LLM 判层级只依赖标题序列）；调用方再拼模型 / 提示词版本 */
export const outlineCacheInput = (labels: readonly string[]): string => labels.map((l) => (l ?? '').trim()).join('\n')
