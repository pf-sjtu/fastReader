/**
 * mermaid 渲染：按需懒加载（体积大，只有真出现图时才下载），严格安全级别，串行排队 + 超时。
 * 输出 SVG 字符串；调用方以 <img data:> 展示，SVG 里即使混入脚本也不会执行。
 *
 * **排版**（见 lib/figureType.ts）：图以图片文档呈现，继承不到宿主 CSS，所以字体栈与字号必须
 * 写进 SVG 自身；同时关掉 mermaid 默认的 `useMaxWidth: true`（它会给 SVG 写 `width:100%`，
 * 把小图拉满容器——实测 stateDiagram 被放大 3.39×、文字 54px，而正文只有 15px）。
 * 缩放交给调用方的 figureFit()：不放大、缩到不低于 11px、再宽就横滚。
 */

import { FIGURE_FONT_STACK, readFigureType } from './figureType'

const RENDER_TIMEOUT_MS = 8000
const MAX_CODE = 8000

type Mermaid = typeof import('mermaid').default
let loading: Promise<Mermaid> | null = null
let lastInit: string | null = null
let seq = 0
/** mermaid 的 render 不可重入：串行执行，前一个失败不影响后一个 */
let queue: Promise<unknown> = Promise.resolve()

/** 图型各自关掉「拉满容器宽」；与指南放行的六种图型对应，其余类型不受影响 */
const NO_STRETCH = { useMaxWidth: false } as const

async function load(dark: boolean): Promise<Mermaid> {
  loading ??= import('mermaid').then((m) => m.default)
  const mermaid = await loading
  const theme = dark ? 'dark' : 'default'
  // 主题或字号变了都要重新 initialize：字号写进 SVG，不重建就还是旧字号
  const textPx = readFigureType().textPx
  const initKey = `${theme}:${textPx}`
  if (lastInit !== initKey) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      fontFamily: FIGURE_FONT_STACK,
      themeVariables: { fontFamily: FIGURE_FONT_STACK, fontSize: `${textPx}px` },
      flowchart: { htmlLabels: false, ...NO_STRETCH },
      sequence: { ...NO_STRETCH },
      state: { ...NO_STRETCH },
      timeline: { ...NO_STRETCH },
      mindmap: { ...NO_STRETCH },
      quadrantChart: { ...NO_STRETCH },
    })
    lastInit = initKey
  }
  return mermaid
}

const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('渲染超时')), RENDER_TIMEOUT_MS)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    )
  })

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200)

export type MermaidResult = { ok: true; svg: string } | { ok: false; error: string }

export function renderMermaid(code: string, dark: boolean): Promise<MermaidResult> {
  if (!code.trim()) return Promise.resolve({ ok: false, error: '图为空' })
  if (code.length > MAX_CODE) return Promise.resolve({ ok: false, error: '图过大' })
  const job = queue.then(async (): Promise<MermaidResult> => {
    const id = `mmd-${++seq}`
    try {
      const mermaid = await load(dark)
      // 先只做语法校验：语法错在这里抛出。直接 render 失败时 mermaid 会把「Syntax error」炸弹图留在 <body> 里，污染整个页面
      await withTimeout(mermaid.parse(code))
      const { svg } = await withTimeout(mermaid.render(id, code))
      return { ok: true, svg }
    } catch (e) {
      return { ok: false, error: messageOf(e) }
    } finally {
      // 兜底：无论成败都清掉 mermaid 留在 body 里的临时节点（容器 `d<id>` 与 svg `<id>`）
      document.getElementById(`d${id}`)?.remove()
      document.getElementById(id)?.remove()
    }
  })
  queue = job
  return job
}

/** 只校验语法、不渲染（生成后的坏块修复用） */
export async function validateMermaid(code: string): Promise<string | null> {
  if (!code.trim()) return '图为空'
  if (code.length > MAX_CODE) return '图过大'
  try {
    const mermaid = await load(false)
    await withTimeout(mermaid.parse(code))
    return null
  } catch (e) {
    return messageOf(e)
  }
}

export const svgToDataUri = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
