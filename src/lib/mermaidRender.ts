/**
 * mermaid 渲染：按需懒加载（体积大，只有真出现图时才下载），严格安全级别，串行排队 + 超时。
 * 输出 SVG 字符串；调用方以 <img data:> 展示，SVG 里即使混入脚本也不会执行。
 */

const RENDER_TIMEOUT_MS = 8000
const MAX_CODE = 8000

type Mermaid = typeof import('mermaid').default
let loading: Promise<Mermaid> | null = null
let lastTheme: 'dark' | 'default' | null = null
let seq = 0
/** mermaid 的 render 不可重入：串行执行，前一个失败不影响后一个 */
let queue: Promise<unknown> = Promise.resolve()

async function load(dark: boolean): Promise<Mermaid> {
  loading ??= import('mermaid').then((m) => m.default)
  const mermaid = await loading
  const theme = dark ? 'dark' : 'default'
  if (lastTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit', flowchart: { htmlLabels: false } })
    lastTheme = theme
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
    try {
      const mermaid = await load(dark)
      const { svg } = await withTimeout(mermaid.render(`mmd-${++seq}`, code))
      return { ok: true, svg }
    } catch (e) {
      return { ok: false, error: messageOf(e) }
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
