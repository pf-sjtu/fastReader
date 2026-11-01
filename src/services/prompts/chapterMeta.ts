/**
 * v3 章节输出 = 正文 Markdown + 分隔符 + 一段 JSON 旁路（元数据）。
 * 这里负责三件事：拆分、清理（程序化修复 AI 常见的格式违规）、质量判定。
 * CLI 等价实现：src/cli/chapter_meta.py；跨端用例 tests/fixtures/prompts-v3/meta-cases.json
 */

import { proseLength, splitByFences } from '@/lib/richBlocks'

export const META_MARK = '<!--juhua:meta-->'
/** 容忍模型改动空白/大小写 */
const META_MARK_RE = /<!--\s*juhua:meta\s*-->/i

export interface ChapterEntity {
  /** 规范名（全书统一写法） */
  name: string
  type?: string
  aliases: string[]
  role?: string
}

export interface ChapterMeta {
  oneLine: string
  takeaways: string[]
  entities: ChapterEntity[]
  terms: string[]
  /** 仅小说：本章关键事件，spoiler 供「截至本章」渐进模式使用 */
  events?: { label: string; spoiler: 'low' | 'high' }[]
}

export interface SplitResult {
  text: string
  meta: ChapterMeta | null
  /** 有旁路但解析失败时给出原因（用于诊断，不影响正文） */
  metaError?: string
}

const asStr = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const asStrList = (v: unknown, maxItems: number, maxLen = 80) =>
  Array.isArray(v) ? v.map((x) => asStr(x, maxLen)).filter(Boolean).slice(0, maxItems) : []

/** 取第一个平衡的 {...}；容忍围栏与前后杂文字 */
function firstJsonObject(raw: string): string | null {
  const text = raw.replace(/```(?:json)?/gi, '')
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

export function coerceMeta(obj: unknown): ChapterMeta | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const entities: ChapterEntity[] = Array.isArray(o.entities)
    ? o.entities
        .map((e): ChapterEntity | null => {
          if (!e || typeof e !== 'object') return null
          const r = e as Record<string, unknown>
          const name = asStr(r.name, 60)
          if (!name) return null
          return { name, type: asStr(r.type, 20) || undefined, aliases: asStrList(r.aliases, 6, 60), role: asStr(r.role, 60) || undefined }
        })
        .filter((e): e is ChapterEntity => e !== null)
        .slice(0, 20)
    : []
  const events = Array.isArray(o.events)
    ? o.events
        .map((e) => {
          const r = (e ?? {}) as Record<string, unknown>
          const label = asStr(r.label, 60)
          return label ? { label, spoiler: r.spoiler === 'high' ? ('high' as const) : ('low' as const) } : null
        })
        .filter((e): e is { label: string; spoiler: 'low' | 'high' } => e !== null)
        .slice(0, 12)
    : undefined
  const meta: ChapterMeta = {
    oneLine: asStr(o.oneLine, 80),
    takeaways: asStrList(o.takeaways, 5, 120),
    entities,
    terms: asStrList(o.terms, 12, 40),
    ...(events ? { events } : {}),
  }
  // 什么都没有：当作无旁路
  return meta.oneLine || meta.takeaways.length || meta.entities.length || meta.terms.length || meta.events?.length ? meta : null
}

/** 拆出正文与旁路；永不抛错，旁路损坏时 meta 为 null 且给出 metaError */
export function splitChapterMeta(raw: string): SplitResult {
  const s = raw ?? ''
  // 取最后一个标记：正文里即使出现标记字样（如讲 HTML 注释的章节），真正的旁路也在末尾
  let m: RegExpExecArray | null = null
  for (const hit of s.matchAll(new RegExp(META_MARK_RE.source, 'gi'))) m = hit
  if (!m) return splitTrailingFence(s)
  let text = s.slice(0, m.index).trimEnd()
  const after = s.slice(m.index + m[0].length)
  const json = firstJsonObject(after)
  if (!text) {
    // 模型把旁路写在了正文前面：旁路之后剩下的才是正文
    text = (json ? after.replace(json, '') : after).replace(/```(?:json)?/gi, '').trim()
  }
  if (!json) return { text, meta: null, metaError: '旁路里没有 JSON 对象' }
  try {
    const meta = coerceMeta(JSON.parse(json))
    return meta ? { text, meta } : { text, meta: null, metaError: '旁路内容为空' }
  } catch (e) {
    return { text, meta: null, metaError: `旁路 JSON 解析失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 模型漏写标记、只在末尾给了 ```json 元数据代码块：识别出来，避免 JSON 原样留在正文里被上传 */
const TRAILING_FENCE_RE = /```json\s*(\{[\s\S]*?\})\s*```\s*$/i
function splitTrailingFence(s: string): SplitResult {
  const m = TRAILING_FENCE_RE.exec(s)
  if (m) {
    try {
      const meta = coerceMeta(JSON.parse(m[1]))
      if (meta) return { text: s.slice(0, m.index).trimEnd(), meta }
    } catch {
      /* 不是我们的元数据：当作正文里的普通代码块 */
    }
  }
  return { text: s.trimEnd(), meta: null }
}

/** 正文 + 旁路 → 可缓存的单个字符串（读取时再 split） */
export function joinChapterMeta(text: string, meta: ChapterMeta | null): string {
  return meta ? `${text}\n\n${META_MARK}\n${JSON.stringify(meta)}` : text
}

/** 每章加粗上限（规格 prompts-v3） */
export const MAX_BOLD_PER_CHAPTER = 6

const BOLD_RE = /(?<!\*)\*\*(?!\*)([^*\n]+?)(?<!\*)\*\*(?!\*)/g

/**
 * 程序化修复：不重试、不花钱。
 * - 去掉 Markdown 标题符号与分割线（提示词禁止，模型仍偶尔输出）
 * - 加粗斜体降为加粗；行内反引号（非代码）去掉
 * - 加粗超过上限：保留最短的几处（主旨句通常短），其余去掉加粗
 */
export function sanitizeSummary(text: string): string {
  // 围栏代码块（含 mermaid / genui / html 富内容块）整体不动：里面的 # 是注释、--- 是内容、** 是源码，不是被滥用的格式
  const parts = splitByFences(text).map((part, i) => (i % 2 === 1 ? part : sanitizeProse(part)))

  // 加粗上限只数正文里的（富内容块里的 ** 不计入，也不会被改写）；超限时保留最短的几处（主旨句通常短）
  const prose = parts.filter((_, i) => i % 2 === 0)
  const bolds = prose.flatMap((part) => [...part.matchAll(BOLD_RE)])
  if (bolds.length > MAX_BOLD_PER_CHAPTER) {
    const keep = new Set(
      bolds
        .map((b, i) => ({ i, len: b[1].length }))
        .sort((a, b) => a.len - b.len || a.i - b.i)
        .slice(0, MAX_BOLD_PER_CHAPTER)
        .map((x) => x.i)
    )
    let idx = -1
    for (let k = 0; k < parts.length; k += 2) {
      parts[k] = parts[k].replace(BOLD_RE, (m, inner: string) => (keep.has(++idx) ? m : inner))
    }
  }
  return parts.join('').replace(/\n{3,}/g, '\n\n').replace(GREETING_LINE_RE, '').trim()
}

export type QualityIssue = 'tooShort' | 'noMeta'

/** 开头的客套话（带标点的短语）：本地剥掉，不为它付费重写 */
const GREETING_LINE_RE = /^[ \t]*(?:(?:好的|当然|没问题|收到|可以)[，,！!。.:：][^\n]{0,30}|(?:以下是|下面是)[^。\n]{0,30}(?:总结|摘要)[：:。.]?)[ \t]*\n+/

function sanitizeProse(part: string): string {
  return part
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, '**$1**')
    // 反引号里没有代码特征（括号/等号/分号/花括号/斜杠）的，当作被滥用的「专有名词标记」
    .replace(/`([^`\n]{1,40})`/g, (m, inner: string) => (/[(){}=;<>/\\]/.test(inner) ? m : inner))
}

/** 质量判定：inputChars 为送入模型的原文长度（原文很长而总结极短才算过短） */
export function checkSummaryQuality(text: string, inputChars: number, opts: { expectMeta: boolean; hasMeta: boolean }): QualityIssue[] {
  const issues: QualityIssue[] = []
  const body = text.trim()
  // 字数只看文字：富内容块（mermaid / genui / html）不计入，否则「图很长、文字很短」会蒙混过关
  const proseChars = proseLength(body)
  // 「无需总结」可能带引号/说明/译成英文：没有旁路的短输出一律不当作「过短」——
  // 只有模型按 v3 格式给了旁路、正文却极短，才是值得付费重写的真问题
  if (/^[\s"“'「《]*无需总结/.test(body)) return issues
  if (opts.hasMeta && inputChars >= 1500 && proseChars < 150) issues.push('tooShort')
  if (opts.expectMeta && !opts.hasMeta) issues.push('noMeta')
  return issues
}

/** 合并各章旁路里的实体 → 全书实体表文本（规范名取最先出现的写法；别名去重并并入） */
export function buildEntityTable(metas: Array<ChapterMeta | null | undefined>, maxEntities = 80): string {
  const byKey = new Map<string, { name: string; type?: string; aliases: Set<string>; chapters: number }>()
  const keyOf = (s: string) => s.trim().toLowerCase()
  const alias = new Map<string, string>() // 任一写法 → 规范 key
  for (const meta of metas) {
    if (!meta) continue
    for (const e of meta.entities) {
      const names = [e.name, ...e.aliases]
      const hit = names.map(keyOf).map((k) => alias.get(k)).find(Boolean)
      const key = hit ?? keyOf(e.name)
      const cur = byKey.get(key) ?? { name: e.name, type: e.type, aliases: new Set<string>(), chapters: 0 }
      cur.chapters++
      cur.type ||= e.type
      for (const n of names) if (keyOf(n) !== keyOf(cur.name)) cur.aliases.add(n)
      byKey.set(key, cur)
      for (const n of names) alias.set(keyOf(n), key)
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.chapters - a.chapters)
    .slice(0, maxEntities)
    .map((e) => `- ${e.name}${e.type ? `（${e.type}）` : ''}${e.aliases.size ? `｜别名：${[...e.aliases].join('、')}` : ''}`)
    .join('\n')
}
