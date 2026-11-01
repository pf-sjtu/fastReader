/**
 * html 块的沙箱文档：运行在 sandbox="allow-scripts"（无 same-origin）的 iframe 里，
 * CSP 禁一切网络与嵌套，只允许内联样式 / 脚本与 data: 图片；高度由页内脚本经 postMessage 回报。
 * 允许模型写交互（按钮、折叠、简单动画），不允许它联网、跳转、嵌套页面。
 */

export const HTML_MAX = 20000
export const HEIGHT_MSG = 'juhua:html-height'

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:"
/** 这些标签与 CSP 无关就能造成跳转 / 嵌套 / 改写文档：直接剔除（含内容） */
const BANNED = /<(iframe|object|embed|link|meta|base|frame|frameset|form)\b[\s\S]*?(?:<\/\1\s*>|>)/gi

export type SandboxDoc = { ok: true; doc: string } | { ok: false; error: string }

export function buildSandboxDoc(code: string): SandboxDoc {
  const src = code.trim()
  if (!src) return { ok: false, error: '内容为空' }
  if (src.length > HTML_MAX) return { ok: false, error: '内容过大' }
  const body = src.replace(BANNED, '')
  const reporter = `<script>(function(){function h(){parent.postMessage({type:'${HEIGHT_MSG}',h:document.documentElement.scrollHeight},'*')}` +
    `addEventListener('load',h);try{new ResizeObserver(h).observe(document.body)}catch(e){}})()</script>`
  const doc =
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<style>body{margin:0;padding:8px;font:14px/1.6 system-ui,sans-serif;color:#222;background:transparent}*{box-sizing:border-box;max-width:100%}</style></head>` +
    `<body>${body}${reporter}</body></html>`
  return { ok: true, doc }
}
