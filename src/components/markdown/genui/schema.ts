/**
 * genui：模型用 JSON 描述一个小组件，由前端用自己的组件渲染（不执行模型写的任何代码，也不渲染模型给的 HTML）。
 * 词汇表刻意很小，每一种都对应一类「把抽象内容具象化」的需求：
 *   steps     流程 / 步骤        compare   对比表        timeline  时间线
 *   cards     并列概念卡片       callout   要点 / 提醒    tabs      分面切换（交互）
 *   quiz      一道随堂小测（交互）
 * 解析原则同关键图表：模型输出不可信——宽容地读，坏的单项丢弃，一个都读不出来才报错（由调用方回退为源码）。
 */

export type GenUiNode =
  | { type: 'steps'; title?: string; items: { label: string; detail?: string }[] }
  | { type: 'compare'; title?: string; columns: string[]; rows: { label: string; cells: string[] }[] }
  | { type: 'timeline'; title?: string; items: { time: string; label: string; detail?: string }[] }
  | { type: 'cards'; title?: string; items: { title: string; body: string; tag?: string }[] }
  | { type: 'callout'; tone: 'info' | 'warn' | 'key'; title?: string; body: string }
  | { type: 'tabs'; title?: string; tabs: { label: string; body: string }[] }
  | { type: 'quiz'; question: string; options: string[]; answer: number; explain?: string }

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
    case 'quiz': {
      const options = arr(r.options).map((o) => text(o, 120)).filter(Boolean).slice(0, L.options)
      const answer = Number(r.answer)
      // 答案必须落在选项里：否则这道题没法判分，宁可整题丢掉
      if (!text(r.question) || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null
      return { type: 'quiz', question: text(r.question), options, answer, explain: opt(r.explain ?? r.explanation) }
    }
    default:
      return null
  }
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
  let data: unknown
  try {
    data = lenientJson(code)
  } catch {
    return { ok: false, error: 'JSON 无法解析' }
  }
  // 三种写法都认：单个节点 {type:…}、数组 [{…},{…}]、{blocks:[…]}
  const rawNodes = Array.isArray(data) ? data : Array.isArray(obj(data).blocks) ? (obj(data).blocks as unknown[]) : [data]
  const nodes = rawNodes.map(parseNode).filter((n): n is GenUiNode => n !== null).slice(0, GENUI_LIMITS.nodes)
  return nodes.length ? { ok: true, nodes } : { ok: false, error: '没有可渲染的组件' }
}
