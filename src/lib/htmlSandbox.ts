/**
 * html 块的沙箱文档。
 *
 * 为什么不用 srcdoc：srcdoc / blob 这类「本地文档」会继承父页面的 CSP，而站点 CSP 是 `script-src 'self'`，
 * 内联脚本全被拦掉——按钮没反应、高度回报失效（真实浏览器 + 生产响应头下复现过，jsdom 看不出来）。
 * 所以 html 块加载独立的同源沙箱页 `/rich-sandbox/`（public/ 下，自带 CSP：default-src 'none'，
 * 只放行内联脚本 / 样式与 data: 图片，且仅同源可嵌），iframe 为 sandbox="allow-scripts"（不含 same-origin → opaque origin，
 * 碰不到站点的存储与 Cookie），握手后由父页面 postMessage 下发整份文档。
 * 允许模型写交互（按钮、折叠、简单动画），不允许它联网、跳转、嵌套页面；高度由文档内脚本回报。
 */

export const HTML_MAX = 20000
export const SANDBOX_URL = '/rich-sandbox/'
/** 消息名：与 public/rich-sandbox.js 逐字一致（tests/richSandbox.test.ts 守卫） */
export const READY_MSG = 'juhua:html-ready'
export const DOC_MSG = 'juhua:html-doc'
export const HEIGHT_MSG = 'juhua:html-height'
/** 沙箱页在这么久内没有握手 → 视为不可用，回退为源码 */
export const READY_TIMEOUT_MS = 5000

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:"
/** 这些标签与 CSP 无关就能造成跳转 / 嵌套 / 改写文档：直接剔除（含内容） */
const BANNED = /<(iframe|object|embed|link|meta|base|frame|frameset|form)\b[\s\S]*?(?:<\/\1\s*>|>)/gi

export type SandboxDoc = { ok: true; doc: string } | { ok: false; error: string }

export function buildSandboxDoc(code: string, dark = false): SandboxDoc {
  const src = code.trim()
  if (!src) return { ok: false, error: '内容为空' }
  if (src.length > HTML_MAX) return { ok: false, error: '内容过大' }
  const body = src.replace(BANNED, '')
  const reporter = `<script>(function(){function h(){var b=document.body,c=getComputedStyle(b),x=b.offsetHeight+(parseFloat(c.marginTop)||0)+(parseFloat(c.marginBottom)||0),d=document.documentElement;parent.postMessage({type:'${HEIGHT_MSG}',h:Math.max(x,d.scrollHeight>d.clientHeight?d.scrollHeight:0)},'*')}` +
    `addEventListener('load',h);try{new ResizeObserver(h).observe(document.body)}catch(e){}})()</script>`
  // 默认文字色跟随主题（模型自己写了颜色则以它为准）；背景透明，透出卡片底色
  const color = dark ? '#e8e4dc' : '#222'
  const doc =
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<style>body{margin:0;padding:8px;font:14px/1.6 system-ui,sans-serif;color:${color};background:transparent}*{box-sizing:border-box;max-width:100%}</style></head>` +
    `<body>${body}${reporter}</body></html>`
  return { ok: true, doc }
}
