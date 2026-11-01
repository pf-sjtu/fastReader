/**
 * 实体 ↔ 章节索引（纯函数，不依赖 DOM / React / AI）
 * - 在章节总结文本里按实体名（及变体）扫描出现位置
 * - 把时间线事件的 chapterHint 映射到章节
 */

export interface EntityRef {
  id: string
  name: string
  /** 其它写法（缩写 / 全称 / 别名）：优先级低于所有实体的主名，不会抢走别人的名字 */
  aliases?: readonly string[]
}

export interface IndexChapter {
  id: string
  title: string
  /** 用于匹配的文本（章节总结） */
  text: string
}

export interface EntityMatch {
  start: number
  end: number
  entityId: string
}

interface Variant {
  text: string
  entityId: string
  /** 拉丁词需要词边界，避免 "Ross" 命中 "Crossing" */
  latin: boolean
}

export interface EntityMatcher {
  byFirst: Map<string, Variant[]>
  size: number
}

const CJK = /[㐀-鿿豈-﫿]/
const WORD = /[A-Za-z0-9]/
const NAME_SPLIT = /[·•・/／、，,]/

function isLatinOnly(s: string): boolean {
  return !CJK.test(s)
}

function cjkLength(s: string): number {
  return [...s].length
}

/**
 * 名称变体：全名、括号内外两部分、按 · / 等拆分的片段。
 * CJK 至少 2 字、拉丁至少 3 字符，过短的片段误报率太高直接丢弃。
 */
export function nameVariants(name: string): string[] {
  const out = new Set<string>()
  const add = (raw: string) => {
    const s = raw.trim()
    if (!s) return
    const min = isLatinOnly(s) ? 3 : 2
    if (cjkLength(s) < min) return
    out.add(s)
  }

  const full = name.trim()
  add(full)

  const parts: string[] = []
  const m = full.match(/^(.*?)[（(]([^）)]*)[）)]\s*$/)
  if (m) {
    parts.push(m[1], m[2])
    add(m[1])
    add(m[2])
  } else {
    parts.push(full)
  }
  for (const p of parts) {
    if (NAME_SPLIT.test(p)) {
      for (const seg of p.split(NAME_SPLIT)) add(seg)
    }
  }
  return [...out]
}

/**
 * 构建匹配器。entities 的顺序即优先级：同一变体被多个实体占用时，保留靠前者。
 */
export function buildEntityMatcher(entities: readonly EntityRef[]): EntityMatcher {
  const taken = new Map<string, string>()
  // 先全体主名，再别名：别名与另一实体的主名撞车时，主名赢
  for (const e of entities) {
    for (const v of nameVariants(e.name)) {
      const key = v.toLowerCase()
      if (!taken.has(key)) taken.set(key, e.id)
    }
  }
  for (const e of entities) {
    for (const alias of e.aliases ?? []) {
      for (const v of nameVariants(alias)) {
        const key = v.toLowerCase()
        if (!taken.has(key)) taken.set(key, e.id)
      }
    }
  }
  const byFirst = new Map<string, Variant[]>()
  for (const [text, entityId] of taken) {
    const first = text[0]
    const list = byFirst.get(first) ?? []
    list.push({ text, entityId, latin: isLatinOnly(text) })
    byFirst.set(first, list)
  }
  // 长名优先：同一起点先试长的，避免"约翰逊"吃掉"罗斯·约翰逊"
  for (const list of byFirst.values()) list.sort((a, b) => b.text.length - a.text.length)
  return { byFirst, size: taken.size }
}

/**
 * 扫描文本，返回不重叠的命中（从左到右，同起点最长优先）。
 * 首字符分桶：每个位置只比较少量候选，书再长也近似线性。
 */
export function findEntityMatches(matcher: EntityMatcher, text: string): EntityMatch[] {
  if (!matcher.size || !text) return []
  const lowered = text.toLowerCase()
  // 个别字符小写后长度会变（如 İ），此时放弃大小写不敏感以保证下标可用
  const hay = lowered.length === text.length ? lowered : text
  const out: EntityMatch[] = []
  for (let i = 0; i < hay.length; i++) {
    const cands = matcher.byFirst.get(hay[i])
    if (!cands) continue
    for (const v of cands) {
      if (!hay.startsWith(v.text, i)) continue
      const end = i + v.text.length
      if (v.latin) {
        if (i > 0 && WORD.test(hay[i - 1])) continue
        if (end < hay.length && WORD.test(hay[end])) continue
      }
      out.push({ start: i, end, entityId: v.entityId })
      i = end - 1
      break
    }
  }
  return out
}

/** 某实体在某章的第 ordinal 次出现（1 起）；snippet 是去掉 Markdown 记号后的前后文摘录 */
export interface EntityOccurrence {
  chapterId: string
  ordinal: number
  start: number
  end: number
  snippet: string
}

export interface EntityChapterIndex {
  /** 实体 → 出现的章节（按章节顺序）与次数 */
  entityToChapters: Map<string, { chapterId: string; count: number }[]>
  chapterToEntities: Map<string, Set<string>>
  /** 实体 → 全部出现位置（章节顺序 + 章内顺序），关联卡片据此精确跳转 */
  occurrences: Map<string, EntityOccurrence[]>
  /** 实体在全书的总出现次数（供配色排序） */
  totals: Map<string, number>
}

export const SNIPPET_CONTEXT = 18

/** 摘录：取命中前后各约 SNIPPET_CONTEXT 字，去掉 Markdown 记号并折叠空白 */
export function makeSnippet(text: string, start: number, end: number, context = SNIPPET_CONTEXT): string {
  const clean = (s: string) => s.replace(/[*_`#>~|]+/g, '').replace(/\s+/g, ' ')
  const before = clean(text.slice(Math.max(0, start - context), start))
  const hit = clean(text.slice(start, end))
  const after = clean(text.slice(end, end + context))
  return `${start - context > 0 ? '…' : ''}${before}${hit}${after}${end + context < text.length ? '…' : ''}`
}

export function indexEntityChapters(
  matcher: EntityMatcher,
  chapters: readonly IndexChapter[]
): EntityChapterIndex {
  const entityToChapters = new Map<string, { chapterId: string; count: number }[]>()
  const chapterToEntities = new Map<string, Set<string>>()
  const occurrences = new Map<string, EntityOccurrence[]>()
  const totals = new Map<string, number>()

  for (const ch of chapters) {
    const counts = new Map<string, number>()
    for (const m of findEntityMatches(matcher, ch.text)) {
      const ordinal = (counts.get(m.entityId) ?? 0) + 1
      counts.set(m.entityId, ordinal)
      const list = occurrences.get(m.entityId) ?? []
      list.push({
        chapterId: ch.id,
        ordinal,
        start: m.start,
        end: m.end,
        snippet: makeSnippet(ch.text, m.start, m.end),
      })
      occurrences.set(m.entityId, list)
    }
    chapterToEntities.set(ch.id, new Set(counts.keys()))
    for (const [id, count] of counts) {
      const list = entityToChapters.get(id) ?? []
      list.push({ chapterId: ch.id, count })
      entityToChapters.set(id, list)
      totals.set(id, (totals.get(id) ?? 0) + count)
    }
  }
  return { entityToChapters, chapterToEntities, occurrences, totals }
}

/* ---------------- chapterHint → 章节 ---------------- */

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** 中文数字（到 999）或阿拉伯数字 → number；无法解析返回 null */
export function parseChapterNumber(raw: string): number | null {
  const s = raw.trim()
  if (/^\d+$/.test(s)) return Number(s)
  let total = 0
  let current = 0
  let seen = false
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      current = CN_DIGIT[ch]
      seen = true
    } else if (ch === '十' || ch === '百') {
      const unit = ch === '十' ? 10 : 100
      total += (current || 1) * unit
      current = 0
      seen = true
    } else {
      return null
    }
  }
  return seen ? total + current : null
}

const NUM_PATTERNS: RegExp[] = [
  /第\s*([零〇一二两三四五六七八九十百\d]+)\s*[章节回篇部]/,
  /chapter\s*(\d+)/i,
  /\bch\.?\s*(\d+)/i,
]

/** 从提示/标题里取章节序号：第N章 → Chapter N → 标题开头的数字（"01 镜像世界"） */
export function extractChapterNumber(text: string, allowLeading = false): number | null {
  const s = text.normalize('NFKC')
  for (const re of NUM_PATTERNS) {
    const m = s.match(re)
    if (m) {
      const n = parseChapterNumber(m[1])
      if (n !== null) return n
    }
  }
  if (allowLeading) {
    const m = s.match(/^\s*(\d{1,3})(?!\d)/)
    if (m) return Number(m[1])
  }
  return null
}

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function bigrams(s: string): string[] {
  const out: string[] = []
  const chars = [...s]
  for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1])
  return out
}

function dice(a: string, b: string): number {
  const x = bigrams(a)
  const y = bigrams(b)
  if (!x.length || !y.length) return 0
  const pool = new Map<string, number>()
  for (const g of y) pool.set(g, (pool.get(g) ?? 0) + 1)
  let hit = 0
  for (const g of x) {
    const n = pool.get(g)
    if (n) {
      hit++
      pool.set(g, n - 1)
    }
  }
  return (2 * hit) / (x.length + y.length)
}

export const HINT_DICE_THRESHOLD = 0.5

/**
 * 把自由文本的章节提示映射到章节 id；映射不上返回 null（UI 置灰，不猜）。
 * 顺序：序号 → 标题包含 → 二元组 Dice。numberOnly 只走序号（用于 timeLabel 这类易误配的字段）。
 */
export function matchChapterHint(
  hint: string | undefined,
  chapters: readonly { id: string; title: string }[],
  opts: { numberOnly?: boolean } = {}
): string | null {
  const h = (hint ?? '').trim()
  if (!h || !chapters.length) return null

  const num = extractChapterNumber(h)
  if (num !== null) {
    const hits = chapters.filter((c) => extractChapterNumber(c.title, true) === num)
    if (hits.length === 1) return hits[0].id
  }
  if (opts.numberOnly) return null

  const nh = normalize(h)
  if (cjkLength(nh) < 2) return null

  const contained = chapters
    .filter((c) => {
      const nt = normalize(c.title)
      return nt.length >= 2 && (nt.includes(nh) || (nt.length >= 3 && nh.includes(nt)))
    })
    .sort((a, b) => normalize(b.title).length - normalize(a.title).length)
  if (contained.length) return contained[0].id

  let best: { id: string; score: number } | null = null
  for (const c of chapters) {
    const score = dice(nh, normalize(c.title))
    if (!best || score > best.score) best = { id: c.id, score }
  }
  return best && best.score >= HINT_DICE_THRESHOLD ? best.id : null
}

/** 事件 → 章节：先看 chapterHint，再用 timeLabel 兜底（仅序号） */
export function indexEventChapters(
  events: readonly { id: string; chapterHint?: string; timeLabel?: string }[],
  chapters: readonly { id: string; title: string }[]
): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const ev of events) {
    out.set(
      ev.id,
      matchChapterHint(ev.chapterHint, chapters) ??
        matchChapterHint(ev.timeLabel, chapters, { numberOnly: true })
    )
  }
  return out
}
