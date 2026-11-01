/**
 * 总结里的富内容块 → 学习包里的静态 HTML（断网可读、可打印、无脚本）。
 *
 * - genui：每种组件都有静态版，测验直接给出答案与解析（离线包不交互，读者要的是内容）；
 * - mermaid：正文里以源码呈现（渲染失败 / 关闭图片 / 来自综述时也不会丢信息）；渲染成功的图另在「图谱与时间线」区；
 * - html：交互小部件离线没法安全执行，换成一行说明。
 *
 * 入参 `esc` 是 buildPack 的 `escapeHtml`：本文件只拼自己生成的标签，所有文本都经它转义。
 */
import { parseGenUi, type GenUiNode } from '@/components/markdown/genui/schema'
import { mapRichBlocks } from '@/lib/richBlocks'

export interface RichStaticLabels {
  /** html 块与解析失败的 genui 块的替代说明 */
  interactiveOnline: string
  /** mermaid 块的标注（离线包里以源码呈现；渲染好的图若成功会另在「图谱与时间线」区） */
  diagramBelow: string
  correctAnswer: string
  explanation: string
}

type Esc = (text: string) => string

function nodeHtml(n: GenUiNode, esc: Esc, L: RichStaticLabels): string {
  const title = 'title' in n && n.title ? `<div class="gu-title">${esc(n.title)}</div>` : ''
  switch (n.type) {
    case 'steps':
      return `${title}<ol class="gu-steps">${n.items.map((i) => `<li><strong>${esc(i.label)}</strong>${i.detail ? `<span>${esc(i.detail)}</span>` : ''}</li>`).join('')}</ol>`
    case 'compare':
      return `${title}<table class="gu-table"><thead><tr><th></th>${n.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${n.rows
        .map((r) => `<tr><th>${esc(r.label)}</th>${n.columns.map((_, i) => `<td>${esc(r.cells[i] ?? '')}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`
    case 'timeline':
      return `${title}<ul class="gu-timeline">${n.items.map((i) => `<li><span class="gu-time">${esc(i.time)}</span><strong>${esc(i.label)}</strong>${i.detail ? `<span>${esc(i.detail)}</span>` : ''}</li>`).join('')}</ul>`
    case 'cards':
      return `${title}<div class="gu-cards">${n.items.map((i) => `<div class="gu-card"><strong>${esc(i.title)}</strong>${i.tag ? ` <span class="gu-tag">${esc(i.tag)}</span>` : ''}<p>${esc(i.body)}</p></div>`).join('')}</div>`
    case 'callout':
      return `<div class="gu-callout gu-${n.tone}">${title}<p>${esc(n.body)}</p></div>`
    case 'tabs':
      // 静态版把每个分面直接展开
      return `${title}${n.tabs.map((t) => `<div class="gu-card"><strong>${esc(t.label)}</strong><p>${esc(t.body)}</p></div>`).join('')}`
    case 'quiz':
      return [
        `<div class="gu-quiz"><p><strong>${esc(n.question)}</strong></p>`,
        `<ul>${n.options.map((o, i) => `<li${i === n.answer ? ' class="is-answer"' : ''}>${String.fromCharCode(65 + i)}. ${esc(o)}${i === n.answer ? ` <span class="gu-tag">${esc(L.correctAnswer)}</span>` : ''}</li>`).join('')}</ul>`,
        n.explain ? `<p class="gu-explain">${esc(L.explanation)}：${esc(n.explain)}</p>` : '',
        `</div>`,
      ].join('')
  }
}

/** 把 summary 里的富内容块换成「可直接嵌进正文的 HTML 片段」，返回的文本里片段已被占位符标记，其余正文原样 */
export function richBlocksToStatic(summary: string, esc: Esc, L: RichStaticLabels): { text: string; fragments: string[] } {
  const fragments: string[] = []
  const hold = (html: string) => {
    fragments.push(html)
    // 占位符只含字母数字，不会被转义或被最小 Markdown 当成标题 / 列表
    return `\n\nRICHFRAG${fragments.length - 1}END\n\n`
  }
  const text = mapRichBlocks(summary, (b) => {
    if (b.truncated) return ''
    if (b.lang === 'mermaid') return hold(`<div class="gu-card"><div class="gu-tag">${esc(L.diagramBelow)}</div><pre class="gu-src">${esc(b.code.trim())}</pre></div>`)
    if (b.lang === 'html') return hold(`<p class="empty">${esc(L.interactiveOnline)}</p>`)
    const r = parseGenUi(b.code)
    return hold(r.ok ? `<div class="genui">${r.nodes.map((n) => nodeHtml(n, esc, L)).join('')}</div>` : `<p class="empty">${esc(L.interactiveOnline)}</p>`)
  })
  return { text, fragments }
}

/** 渲染后的 HTML 里把占位符（被最小 Markdown 包成 <p>…</p>）换回片段 */
export function restoreFragments(html: string, fragments: readonly string[]): string {
  return html.replace(/<p>RICHFRAG(\d+)END<\/p>/g, (_, i: string) => fragments[Number(i)] ?? '')
}

export const PACK_RICH_STYLE = `
.genui { margin: 12px 0; display: grid; gap: 10px; }
.gu-title { font-weight: 600; margin-bottom: 4px; }
.gu-steps, .gu-timeline { margin: 0; padding-left: 20px; }
.gu-steps li, .gu-timeline li { margin: 4px 0; }
.gu-steps li span, .gu-timeline li span:not(.gu-time) { display: block; color: var(--pack-muted-fg); font-size: 13px; }
.gu-time { color: var(--pack-muted-fg); margin-right: 8px; font-variant-numeric: tabular-nums; }
.gu-table { border-collapse: collapse; width: 100%; font-size: 14px; }
.gu-table th, .gu-table td { border: 1px solid var(--pack-border); padding: 6px 8px; text-align: left; vertical-align: top; }
.gu-cards { display: grid; gap: 8px; }
.gu-card { border: 1px solid var(--pack-border); border-radius: 8px; padding: 8px 10px; break-inside: avoid; }
.gu-card p, .gu-callout p, .gu-quiz p { margin: 4px 0 0; }
.gu-src { margin: 4px 0 0; white-space: pre-wrap; font-size: 12px; }
.gu-tag { color: var(--pack-muted-fg); font-size: 12px; }
.gu-callout { border-left: 3px solid var(--pack-border); padding: 6px 10px; background: rgba(0,0,0,0.03); }
.gu-warn { border-left-color: #b45309; }
.gu-key { border-left-color: #a13a24; }
.gu-quiz { border: 1px dashed var(--pack-border); border-radius: 8px; padding: 8px 10px; break-inside: avoid; }
.gu-quiz ul { margin: 4px 0; padding-left: 20px; list-style: none; }
.gu-quiz li.is-answer { font-weight: 600; }
.gu-explain { color: var(--pack-muted-fg); font-size: 13px; }
`
