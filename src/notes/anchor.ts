/**
 * 笔记锚点：把一条笔记引用的原文片段重新定位到「当前这一版的章节正文」上。
 *
 * 为什么需要它：章节总结是会重新生成的，正文措辞会变（重排、润色、换模型、换 prompt），
 * 用户当初划的那句话往往不再逐字出现。锚点解析回答「在哪里、以多大把握找到」，
 * 调用方据此决定是画回划线，还是标成「已失去定位」——笔记本身绝不因此删掉。
 *
 * 三级判定，越往后越宽松、也越可能找错：
 *   1. exact    归一化后逐字命中（最可信）
 *   2. tolerant 再折叠掉大小写与标点后命中（正文被重新排版 / 标点规范化的常见情形）
 *   3. fuzzy    滑窗 bigram Dice 相似度达标（正文被改写过几个字）
 * 三级都不中返回 null。
 *
 * 全程纯函数：不碰 DOM / React / 存储，输入输出只有字符串与数字，
 * 才能在 store、service 与单测里共用。
 *
 * 所有下标都挂在 `normalizeText(chapterText)` 这个坐标系上：与 notes.ts 记录
 * quote/prefix/suffix 的那套归一化同源，调用方拿到 start/end 可以直接去切同一份文本。
 *
 * 「哪部分正文可以定位」不在本模块：见 `noteText.ts`（与正文高亮共用同一份判定）。
 */

export type NoteAnchorKind = 'exact' | 'tolerant' | 'fuzzy'

export interface NoteAnchor {
  /** 命中方式：exact 最可信；fuzzy 的划线位置需要 UI 更克制地提示 */
  kind: NoteAnchorKind
  /** 在 `normalizeText(chapterText)` 上的起始下标（含） */
  start: number
  /** 在 `normalizeText(chapterText)` 上的结束下标（不含） */
  end: number
  /** 把握程度：exact = 1、tolerant = 0.9、fuzzy = 该窗口的 bigram Dice 分数 */
  score: number
}

/** 模糊命中阈值：低于它的窗口宁可不画——划线画错位置比不画更糟 */
const FUZZY_MIN_SCORE = 0.6
/** 有前后文时，只在上下文命中点前后这么多字以内找模糊窗口 */
const FUZZY_CONTEXT_RANGE = 40
/** 兜底粗扫的目标窗口数：步长 = ceil(长度 / 这个数) */
const LONG_TEXT_WINDOWS = 4000
/** 候选窗口数上限：罕见 bigram 通常只指向个位数位置，这里只是防御整章同一句话之类的病态文本 */
const FUZZY_MAX_CANDIDATES = 400
/** 候选太少时多取几条 bigram 反查，宁可贵一点也别漏掉真正的窗口 */
const FUZZY_MIN_CANDIDATES = 8

/** 空白折叠为单空格并 trim。与 notes.ts 里的 squash 同语义，两处必须保持一致 */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** 折叠时丢弃的字符：空白与标点 / 符号（保留字母、数字、CJK） */
const FOLD_DROP = /[\s\p{P}\p{S}]/u

interface FoldedText {
  /** 折叠结果：小写、无空白与标点符号 */
  folded: string
  /** 折叠结果第 i 个字符在原归一化文本中的下标；删除是逐字符的，所以能一对一回溯 */
  map: number[]
}

/**
 * 折叠文本，并保留「折叠后下标 → 归一化文本下标」的映射。
 * tolerant / fuzzy 都在折叠文本上算，命中后必须靠 map 换回调用方认得的坐标系。
 */
const foldWithMap = (s: string): FoldedText => {
  const text = normalizeText(s)
  let folded = ''
  const map: number[] = []
  let at = 0
  for (const ch of text) {
    const here = at
    at += ch.length
    if (FOLD_DROP.test(ch)) continue
    // 少数语言小写化后会变长（如 'İ'）：展开成多个字符，但都记回同一个源下标
    for (const c of ch.toLowerCase()) {
      folded += c
      map.push(here)
    }
  }
  return { folded, map }
}

/** 归一化 + 小写 + 去掉所有空白与标点符号；用于「不在乎大小写和标点」的比对 */
export function foldText(s: string): string {
  return foldWithMap(s).folded
}

/** 归一化文本里 needle 的全部出现位置（允许重叠：逐字符推进，宁可多给几个候选） */
const findAll = (text: string, needle: string): number[] => {
  const out: number[] = []
  if (!needle) return out
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) out.push(at)
  return out
}

/** 匹配点之前的尾部与 prefix 从后往前逐字符重合的长度 */
const prefixOverlap = (text: string, at: number, prefix: string): number => {
  const n = Math.min(at, prefix.length)
  let i = 0
  while (i < n && text.charCodeAt(at - 1 - i) === prefix.charCodeAt(prefix.length - 1 - i)) i++
  return i
}

/** 匹配点之后的头部与 suffix 从前往后逐字符重合的长度 */
const suffixOverlap = (text: string, at: number, suffix: string): number => {
  const n = Math.min(text.length - at, suffix.length)
  let i = 0
  while (i < n && text.charCodeAt(at + i) === suffix.charCodeAt(i)) i++
  return i
}

/**
 * 同一片段在正文里出现多次时，用笔记自带的前后文挑最像原文的那一处。
 * 上下文为空（旧笔记没记前后文）时所有候选同分，取最靠前的——与 notes.ts
 * `captureContext` 的「第一次出现」语义一致，至少是稳定、可预期的。
 */
const pickByContext = (text: string, starts: readonly number[], len: number, prefix: string, suffix: string): number => {
  let best = starts[0]
  let bestScore = -1
  for (const at of starts) {
    const score = prefixOverlap(text, at, prefix) + suffixOverlap(text, at + len, suffix)
    if (score > bestScore) {
      bestScore = score
      best = at
    }
  }
  return best
}

/** 源文本 at 处那个码点占几个 UTF-16 单元（折叠后的单个字符看不出这件事） */
const codePointLength = (text: string, at: number): number => {
  const cp = text.codePointAt(at)
  return cp !== undefined && cp > 0xffff ? 2 : 1
}

/**
 * 折叠命中段 → 归一化文本上的 [start, end)。
 * 只看首末两个保留字符：中间被折叠掉的标点与空白本来就落在选区里，不必特判。
 */
const foldRangeToText = (map: readonly number[], at: number, len: number, text: string): { start: number; end: number } => {
  const start = map[at]
  const last = map[at + len - 1]
  return { start, end: last + codePointLength(text, last) }
}

/** 字符 bigram 计数（保留重复计数的多重集，Dice 取交集时按最小计数算） */
const bigramCounts = (s: string): Map<string, number> => {
  const counts = new Map<string, number>()
  for (let i = 0; i + 1 < s.length; i++) {
    const gram = s.slice(i, i + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

/** bigram Dice 系数：2|A∩B| / (|A|+|B|)；0 毫无共同点，1 完全一致 */
const diceScore = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number => {
  let sizeA = 0
  for (const n of a.values()) sizeA += n
  let sizeB = 0
  for (const n of b.values()) sizeB += n
  if (sizeA + sizeB === 0) return 0
  let inter = 0
  for (const [gram, n] of a) {
    const m = b.get(gram)
    if (m !== undefined) inter += Math.min(n, m)
  }
  return (2 * inter) / (sizeA + sizeB)
}

interface FuzzyHit {
  start: number
  len: number
  score: number
}

/** 折叠文本的 bigram → 全部起点（升序）。只在真要 fuzzy 时才建 */
type BigramIndex = Map<string, number[]>

const buildBigramIndex = (folded: string): BigramIndex => {
  const index: BigramIndex = new Map()
  for (let i = 0; i + 1 < folded.length; i += 1) {
    const gram = folded.slice(i, i + 2)
    const list = index.get(gram)
    if (list) list.push(i)
    else index.set(gram, [i])
  }
  return index
}

/**
 * 用 quote 里「在正文中出现次数最少」的若干条 bigram 反查候选窗口起点。
 *
 * 这是把长章节 fuzzy 从「全篇逐字滑窗」压成「只看几十个位置」的关键：
 * 现实里两万字中文散文，全篇步长 1 的滑窗每条笔记要 300ms 量级（几十条就是十几秒），
 * 而按罕见 bigram 反查后候选通常不到 10 个。取够 `FUZZY_MIN_CANDIDATES` 个候选为止，
 * 避免短引文只取三条 bigram 时漏掉真正的窗口。
 */
const fuzzyCandidates = (index: BigramIndex, foldedQuote: string): number[] => {
  const grams: { gram: string; at: number; hits: number }[] = []
  for (let i = 0; i + 1 < foldedQuote.length; i += 1) {
    const gram = foldedQuote.slice(i, i + 2)
    grams.push({ gram, at: i, hits: index.get(gram)?.length ?? 0 })
  }
  grams.sort((a, b) => a.hits - b.hits)
  const starts = new Set<number>()
  for (const { gram, at } of grams) {
    for (const pos of index.get(gram) ?? []) {
      const start = pos - at
      if (start < 0) continue
      starts.add(start)
      if (starts.size >= FUZZY_MAX_CANDIDATES) break
    }
    if (starts.size >= FUZZY_MIN_CANDIDATES || starts.size >= FUZZY_MAX_CANDIDATES) break
  }
  return [...starts].sort((a, b) => a - b)
}

/**
 * 在折叠文本上找与 quote 最相似的一段。
 *
 * 长度取 quote 长度的 100% / 90% / 110%：正文被改写时引用可能多几个字或少几个字。
 *
 * 打分顺序（先便宜后昂贵）：
 *   1. `fuzzyCandidates` 反查出来的候选窗口——现实数据里这一步就能命中，代价是与候选数成正比；
 *   2. 有前后文时，第一步只看上下文附近的候选（字面更像但位置不对的窗口不该赢）；
 *      附近都不达标再放开到全部候选；
 *   3. 候选全部落空才做一遍粗扫兜底（步长 = ceil(长度 / `LONG_TEXT_WINDOWS`)，窗口数上限约 4000），
 *      再在粗扫赢家前后各一个步长内用步长 1 精修，把首尾对齐找回来。
 */
const fuzzySearch = (
  folded: string,
  index: BigramIndex,
  foldedQuote: string,
  foldedPrefix: string,
  foldedSuffix: string
): FuzzyHit | null => {
  const len = foldedQuote.length
  // 单个字符没有 bigram；而且这种情形 tolerant 早就该命中了
  if (len < 2) return null
  const target = bigramCounts(foldedQuote)
  const lengths = [...new Set([len, Math.round(len * 0.9), Math.round(len * 1.1)])].filter((l) => l >= 2 && l <= folded.length)
  if (!lengths.length) return null

  /*
   * 上限预筛：多重集交集 ≤ Σ min(引用里该 bigram 的个数, 正文里该 bigram 的总数)，
   * 拿它能达到的最好 Dice 与最有利的窗口长度比一下——不可能达标就直接判 null，
   * 省掉下面的全篇粗扫。「整章都没有的句子」这类引文在这里瞬间返回（审查的 MUST-4 场景）。
   */
  let overlapCap = 0
  let targetTotal = 0
  for (const [gram, count] of target) {
    targetTotal += count
    overlapCap += Math.min(count, index.get(gram)?.length ?? 0)
  }
  const smallestWindow = Math.min(...lengths) - 1
  if (targetTotal + smallestWindow <= 0 || (2 * overlapCap) / (targetTotal + smallestWindow) < FUZZY_MIN_SCORE) {
    return null
  }

  // 上下文命中点：prefix 之后 / suffix 之前，就是原引用大致该在的位置
  const anchors: number[] = []
  if (foldedPrefix) {
    const at = folded.indexOf(foldedPrefix)
    if (at >= 0) anchors.push(at + foldedPrefix.length)
  }
  if (foldedSuffix) {
    const at = folded.indexOf(foldedSuffix)
    if (at >= 0) anchors.push(at)
  }
  const nearContext = (start: number, winLen: number): boolean =>
    anchors.some((a) => Math.abs(start - a) <= FUZZY_CONTEXT_RANGE || Math.abs(start + winLen - a) <= FUZZY_CONTEXT_RANGE)

  const best: FuzzyHit = { start: -1, len: 0, score: 0 }
  const scoreAt = (start: number, winLen: number): void => {
    if (start < 0 || winLen > folded.length || start + winLen > folded.length) return
    const score = diceScore(target, bigramCounts(folded.slice(start, start + winLen)))
    if (score > best.score) {
      best.score = score
      best.start = start
      best.len = winLen
    }
  }

  const candidates = fuzzyCandidates(index, foldedQuote)
  const scoreCandidates = (filter?: (start: number, winLen: number) => boolean): void => {
    for (const start of candidates) {
      for (const winLen of lengths) {
        if (filter && !filter(start, winLen)) continue
        scoreAt(start, winLen)
      }
    }
  }

  if (anchors.length) {
    scoreCandidates(nearContext)
    // 附近的候选是全体的子集，再扫一遍只会把 best 抬得更高，不会选错
    if (best.score < FUZZY_MIN_SCORE) scoreCandidates()
  } else {
    scoreCandidates()
  }

  /*
   * 兜底粗扫：走到这里说明候选机制没覆盖住（罕见 bigram 恰好都落在被改写掉的那部分里），
   * 宁可贵一点也别把一条本来找得到的笔记判成「已失去定位」。
   */
  const step = Math.max(1, Math.ceil(folded.length / LONG_TEXT_WINDOWS))
  if (best.score < FUZZY_MIN_SCORE) {
    for (const winLen of lengths) {
      const last = folded.length - winLen
      for (let start = 0; start <= last; start += step) scoreAt(start, winLen)
    }
    // 粗扫的赢家往往只是「网格上最接近」的那一个，前后各一个步长内用步长 1 精修
    if (step > 1 && best.start >= 0) {
      const from = Math.max(0, best.start - step)
      const to = Math.min(folded.length, best.start + step)
      for (const winLen of lengths) {
        for (let start = from; start <= to && start + winLen <= folded.length; start += 1) scoreAt(start, winLen)
      }
    }
  }

  return best.start < 0 || best.score < FUZZY_MIN_SCORE ? null : best
}

/** 一条笔记的定位器接口：见 `createNoteResolver` */
export interface NoteResolver {
  resolve(note: { quote: string; prefix?: string; suffix?: string }): NoteAnchor | null
}

/**
 * 预先归一化 / 折叠同一段正文，再反复定位多条笔记。
 *
 * 为什么要这个工厂：`resolveNote` 每次都重新归一化并（tolerant / fuzzy 时）重新折叠整章，
 * 笔记页签与正文高亮都要「拿一章的正文去除以每条笔记」，几十条笔记乘两万字就是几十次全章扫描，
 * 每次还各建一份折叠映射。这里把 `text` 与 `folded/map` 缓存成只算一次，逐条定位只做匹配。
 *
 * 命中判定与 `resolveNote` 完全一致（exact → tolerant → fuzzy 与阈值都不变）。
 */
export function createNoteResolver(chapterText: string): NoteResolver {
  const text = normalizeText(chapterText)
  // 折叠映射与 bigram 索引只在真的需要 tolerant / fuzzy 时才算：纯 exact 的笔记不该付这份钱
  let folded: FoldedText | null = null
  let index: BigramIndex | null = null
  const foldedText = (): FoldedText => (folded ??= foldWithMap(text))
  const gramIndex = (folded_: string): BigramIndex => (index ??= buildBigramIndex(folded_))

  return {
    resolve(note) {
      const quote = normalizeText(note.quote)
      // 空引用无从找起
      if (!quote) return null

      // 1. exact：逐字命中；同一句出现多次时靠笔记里的前后文挑最像的那一处
      const starts = findAll(text, quote)
      if (starts.length) {
        const at = pickByContext(text, starts, quote.length, normalizeText(note.prefix ?? ''), normalizeText(note.suffix ?? ''))
        return { kind: 'exact', start: at, end: at + quote.length, score: 1 }
      }

      const { folded: foldedText_, map } = foldedText()
      const foldedQuote = foldText(note.quote)
      if (!foldedQuote) return null
      const foldedPrefix = foldText(note.prefix ?? '')
      const foldedSuffix = foldText(note.suffix ?? '')

      // 2. tolerant：忽略大小写与标点后逐字命中
      const foldedStarts = findAll(foldedText_, foldedQuote)
      if (foldedStarts.length) {
        const at = pickByContext(foldedText_, foldedStarts, foldedQuote.length, foldedPrefix, foldedSuffix)
        const range = foldRangeToText(map, at, foldedQuote.length, text)
        return { kind: 'tolerant', start: range.start, end: range.end, score: 0.9 }
      }

      // 3. fuzzy：正文被改写，逐字已对不上，用相似度找最像的一段
      const hit = fuzzySearch(foldedText_, gramIndex(foldedText_), foldedQuote, foldedPrefix, foldedSuffix)
      if (!hit) return null
      const range = foldRangeToText(map, hit.start, hit.len, text)
      return { kind: 'fuzzy', start: range.start, end: range.end, score: hit.score }
    },
  }
}

/**
 * 把笔记的引用片段定位到当前章节正文上；找不到返回 null（调用方显示「已失去定位」）。
 *
 * 判定顺序 exact → tolerant → fuzzy，前者永远优先：能逐字命中就不该退到相似度，
 * 那会把一条本来很确定的笔记挪到别处去。
 *
 * 只定位一条时用这个；要定位多条（笔记页签、正文高亮）用 `createNoteResolver`，避免重复折叠正文。
 */
export function resolveNote(note: { quote: string; prefix?: string; suffix?: string }, chapterText: string): NoteAnchor | null {
  return createNoteResolver(chapterText).resolve(note)
}
