/**
 * genui：模型用 JSON 描述一个小组件，由前端用自己的组件渲染（不执行模型写的任何代码，也不渲染模型给的 HTML）。
 * 词汇表刻意很小，每一种都对应一类「把抽象内容具象化」的需求：
 *   steps     流程 / 步骤        compare   对比表        timeline  时间线
 *   cards     并列概念卡片       callout   要点 / 提醒    tabs      分面切换（交互）
 *   quiz      一道随堂小测（交互）
 *   concept   术语 + 定义 + 例子 + 反例（讲抽象概念）
 *   hierarchy 概念层级 / 包含关系（level 表示缩进层级）
 * 解析原则同关键图表：模型输出不可信——宽容地读，坏的单项丢弃，一个都读不出来才报错（由调用方回退为源码）。
 * 宽容清单里有一条专门留给实测出来的写法：模型常把类型名单独写在围栏第一行、JSON 从第二行开始
 * （`compare` ↵ `{"columns":…}`，且 JSON 里可能就不再写 type）；这种写法按「类型名 + JSON」接受。
 */

export type GenUiNode =
  | { type: 'steps'; title?: string; items: { label: string; detail?: string }[] }
  | { type: 'compare'; title?: string; columns: string[]; rows: { label: string; cells: string[] }[] }
  | { type: 'timeline'; title?: string; items: { time: string; label: string; detail?: string }[] }
  | { type: 'cards'; title?: string; items: { title: string; body: string; tag?: string }[] }
  | { type: 'callout'; tone: 'info' | 'warn' | 'key'; title?: string; body: string }
  | { type: 'tabs'; title?: string; tabs: { label: string; body: string }[] }
  | { type: 'quiz'; question: string; options: string[]; answer: number; explain?: string }
  | { type: 'concept'; title?: string; items: { term: string; definition: string; example?: string; contrast?: string }[] }
  | { type: 'hierarchy'; title?: string; items: { label: string; detail?: string; level: number }[] }

export const GENUI_LIMITS = { nodes: 8, items: 12, columns: 6, options: 6, text: 300, label: 60 } as const

export type GenUiResult = { ok: true; nodes: GenUiNode[] } | { ok: false; error: string }

/** 控制字符去掉、首尾空白去掉、限长；非字符串（数字也接受）转文本 */
const text = (v: unknown, max: number = GENUI_LIMITS.text): string => {
  const s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max)
}
const opt = (v: unknown, max?: number) => text(v, max) || undefined
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function parseNode(raw: unknown): GenUiNode | null {
  const r = obj(raw)
  const L = GENUI_LIMITS
  switch (text(r.type, 20).toLowerCase()) {
    case 'steps': {
      const items = arr(r.items ?? r.steps)
        .map((i) => (typeof i === 'string' ? { label: text(i, L.label) } : { label: text(obj(i).label ?? obj(i).title, L.label), detail: opt(obj(i).detail ?? obj(i).body) }))
        .filter((i) => i.label)
        .slice(0, L.items)
      return items.length ? { type: 'steps', title: opt(r.title, L.label), items } : null
    }
    case 'compare': {
      const columns = arr(r.columns).map((c) => text(c, L.label)).filter(Boolean).slice(0, L.columns)
      const rows = arr(r.rows)
        .map((row) => {
          const o = obj(row)
          return { label: text(o.label ?? o.name, L.label), cells: arr(o.cells).map((c) => text(c)).slice(0, columns.length) }
        })
        .filter((row) => row.label)
        .slice(0, L.items)
      return columns.length && rows.length ? { type: 'compare', title: opt(r.title, L.label), columns, rows } : null
    }
    case 'timeline': {
      const items = arr(r.items)
        .map((i) => ({ time: text(obj(i).time ?? obj(i).date, L.label), label: text(obj(i).label ?? obj(i).title, L.label), detail: opt(obj(i).detail ?? obj(i).body) }))
        .filter((i) => i.label)
        .slice(0, L.items)
      return items.length ? { type: 'timeline', title: opt(r.title, L.label), items } : null
    }
    case 'cards': {
      const items = arr(r.items ?? r.cards)
        .map((i) => ({ title: text(obj(i).title ?? obj(i).label, L.label), body: text(obj(i).body ?? obj(i).detail), tag: opt(obj(i).tag, 20) }))
        .filter((i) => i.title)
        .slice(0, L.items)
      return items.length ? { type: 'cards', title: opt(r.title, L.label), items } : null
    }
    case 'callout': {
      const body = text(r.body ?? r.text)
      const tone = ['info', 'warn', 'key'].includes(text(r.tone, 10)) ? (text(r.tone, 10) as 'info' | 'warn' | 'key') : 'info'
      return body ? { type: 'callout', tone, title: opt(r.title, L.label), body } : null
    }
    case 'tabs': {
      const tabs = arr(r.tabs)
        .map((t) => ({ label: text(obj(t).label ?? obj(t).title, 30), body: text(obj(t).body ?? obj(t).text, 600) }))
        .filter((t) => t.label && t.body)
        .slice(0, L.options)
      return tabs.length >= 1 ? { type: 'tabs', title: opt(r.title, L.label), tabs } : null
    }
    case 'concept': {
      // 术语 + 定义是必需项：缺定义的那一条整条丢掉（只剩术语没有解释价值）
      const items = arr(r.items ?? r.concepts)
        .map((i) => {
          const o = obj(i)
          return {
            term: text(o.term ?? o.label ?? o.title, L.label),
            definition: text(o.definition ?? o.desc ?? o.body ?? o.detail),
            example: opt(o.example ?? o.ex),
            contrast: opt(o.contrast ?? o.counter ?? o.negExample),
          }
        })
        .filter((i) => i.term && i.definition)
        .slice(0, L.items)
      return items.length ? { type: 'concept', title: opt(r.title, L.label), items } : null
    }
    case 'hierarchy': {
      const items = arr(r.items ?? r.nodes ?? r.tree)
        .map((i) => {
          const o = obj(i)
          const lv = o.level ?? o.depth
          return {
            label: text(o.label ?? o.title, L.label),
            detail: opt(o.detail ?? o.body),
            // 层级只认整数：缺失 / 小数 / 字符串一律当第 1 层，再夹进 1..4（缩进只有四档）
            level: Math.min(4, Math.max(1, typeof lv === 'number' && Number.isInteger(lv) ? lv : 1)),
          }
        })
        .filter((i) => i.label)
        .slice(0, L.items)
      return items.length ? { type: 'hierarchy', title: opt(r.title, L.label), items } : null
    }
    case 'quiz': {
      const options = arr(r.options).map((o) => text(o, 120)).filter(Boolean).slice(0, L.options)
      // 只认数字或非空数字字符串（Number(null) / Number('') / Number(true) 会得到 0 / 1，不能当作「选第 0 项」）
      const answer = typeof r.answer === 'number' || (typeof r.answer === 'string' && r.answer.trim() !== '') ? Number(r.answer) : NaN
      // 答案必须落在选项里：否则这道题没法判分，宁可整题丢掉
      if (!text(r.question) || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null
      return { type: 'quiz', question: text(r.question), options, answer, explain: opt(r.explain ?? r.explanation) }
    }
    default:
      return null
  }
}

/** 解析器认识的组件名（新增组件时这里与 GENUI_LIMITS 一起看） */
const KNOWN_TYPES = new Set(['steps', 'compare', 'timeline', 'hierarchy', 'concept', 'cards', 'callout', 'tabs', 'quiz'])

/**
 * 剥掉「单独占一行的类型名」：模型实测里会写成
 *   compare
 *   {"columns":[…],"rows":[…]}   ← JSON 里甚至不再写 type
 * 把它当作类型声明，JSON 里没有 type 时用这个词补上；不是已知组件名的词不动（宁可报错也不乱猜）。
 */
function splitLeadingType(code: string): { rest: string; type?: string } {
  const m = /^\s*([A-Za-z][A-Za-z-]{2,19})[ \t]*\r?\n/.exec(code)
  const word = m?.[1].toLowerCase()
  return m && word && KNOWN_TYPES.has(word) ? { rest: code.slice(m[0].length), type: word } : { rest: code }
}

/** 去掉模型常加的尾逗号 / 行注释，再尝试解析：宽容但不改变语义 */
function lenientJson(code: string): unknown {
  try {
    return JSON.parse(code)
  } catch {
    const cleaned = code
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(cleaned)
  }
}

export function parseGenUi(code: string): GenUiResult {
  const { rest, type } = splitLeadingType(code)
  let data: unknown
  try {
    data = lenientJson(rest)
  } catch {
    return { ok: false, error: 'JSON 无法解析' }
  }
  // 首行写了类型名、JSON 里没写 type：补回去（数组则逐个补）
  if (type) {
    const withType = (v: unknown): unknown => {
      const o = obj(v)
      return text(o.type, 20) ? v : { ...o, type }
    }
    data = Array.isArray(data) ? data.map(withType) : withType(data)
  }
  // 三种写法都认：单个节点 {type:…}、数组 [{…},{…}]、{blocks:[…]}
  const rawNodes = Array.isArray(data) ? data : Array.isArray(obj(data).blocks) ? (obj(data).blocks as unknown[]) : [data]
  const nodes = rawNodes.map(parseNode).filter((n): n is GenUiNode => n !== null).slice(0, GENUI_LIMITS.nodes)
  return nodes.length ? { ok: true, nodes } : { ok: false, error: '没有可渲染的组件' }
}
