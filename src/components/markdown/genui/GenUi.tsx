import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { GenUiNode } from './schema'

/** 所有文字都以 React 文本节点渲染（自动转义）；颜色只用语义 token */
// 注：「例：」「反例：」这类提示文字是中文硬编码，与 RichBlock.tsx 的回退文案一致——
// 富块层故意不依赖 i18n：演示页（tests/tour/richDemo）与单测直接挂 ReactMarkdown，没有 i18n provider。
// 离线学习包那一路不同：文案由 exportPack 从 i18n 传入（study.pack.example|contrast）。

const Title = ({ children }: { children?: string }) => (children ? <div className="t-label mb-2 text-muted-foreground">{children}</div> : null)

/** 层级缩进：level 已被解析夹到 1..4，这里只用静态类名（不写内联像素值） */
const LEVEL_INDENT = ['', 'ml-0', 'ml-4', 'ml-8', 'ml-12']

const TONE: Record<'info' | 'warn' | 'key', string> = {
  info: 'border-info/40 bg-info/10',
  warn: 'border-warning/40 bg-warning/10',
  key: 'border-primary/40 bg-primary/10',
}

function Quiz({ node }: { node: Extract<GenUiNode, { type: 'quiz' }> }) {
  const [picked, setPicked] = useState<number | null>(null)
  return (
    <div>
      <div className="mb-2 font-medium">{node.question}</div>
      <div className="flex flex-col gap-1.5">
        {node.options.map((o, i) => {
          const done = picked !== null
          const right = done && i === node.answer
          const wrong = done && i === picked && i !== node.answer
          return (
            <button
              key={i}
              type="button"
              disabled={done}
              onClick={() => setPicked(i)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-left transition-colors',
                !done && 'hover:bg-muted',
                right && 'border-success/50 bg-success/10',
                wrong && 'border-destructive/50 bg-destructive/10'
              )}
            >
              {o}
            </button>
          )
        })}
      </div>
      {picked !== null && node.explain && <div className="t-note mt-2">{node.explain}</div>}
    </div>
  )
}

function Tabs({ node }: { node: Extract<GenUiNode, { type: 'tabs' }> }) {
  const [i, setI] = useState(0)
  const cur = node.tabs[Math.min(i, node.tabs.length - 1)]
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1" role="tablist">
        {node.tabs.map((t, k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === i}
            onClick={() => setI(k)}
            className={cn('rounded-md px-2.5 py-1', k === i ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="t-note">{cur.body}</div>
    </div>
  )
}

function Node({ node }: { node: GenUiNode }) {
  switch (node.type) {
    case 'steps':
      return (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {node.items.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{i + 1}</span>
              <div>
                <div className="font-medium">{s.label}</div>
                {s.detail && <div className="t-note">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )
    case 'compare':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border-b p-2 text-left" />
                {node.columns.map((c, i) => (
                  <th key={i} className="border-b p-2 text-left font-medium">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((r, i) => (
                <tr key={i}>
                  <td className="border-b p-2 font-medium text-muted-foreground">{r.label}</td>
                  {node.columns.map((_, k) => (
                    <td key={k} className="border-b p-2">{r.cells[k] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'timeline':
      // 竖线与圆点必须共用同一条中心线。原先用 `absolute -left-[1.45rem]` 手算偏移，而 li 的起点由
      // ol 的 border(2px) + padding(16px) 决定，算出来圆点中心比竖线偏左 2px（实测竖线中心 x=249、
      // 圆点中心 x=247），看上去就是圆点挂在线上、没套正。现在圆点是 flex 的第一个子元素
      // （左边缘 0、宽 8px → 中心 4px），竖线照这个中心摆放（left 3px + 宽 2px），两者都由圆点尺寸推导，
      // 不再依赖 padding/border 的组合。
      return (
        <ol className="relative m-0 list-none p-0" data-slot="genui-timeline">
          {/* 竖线是绝对定位元素，会绘制在静态内容之上——不给圆点定位的话竖线会把圆点盖成两半，
              所以圆点也带 `relative`（DOM 在竖线之后，同层按顺序后绘制）。 */}
          <span aria-hidden className="absolute top-2 bottom-2 left-[3px] w-0.5 rounded-full bg-border" />
          {node.items.map((t, i) => (
            <li key={i} className="flex gap-3 pb-3 last:pb-0">
              <span aria-hidden className="relative mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
              <div>
                {t.time && <div className="t-note">{t.time}</div>}
                <div className="font-medium">{t.label}</div>
                {t.detail && <div className="t-note">{t.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )
    case 'cards':
      return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
          {node.items.map((c, i) => (
            <div key={i} className="rounded-md border bg-card p-3">
              {c.tag && <div className="mb-1 t-note text-primary">{c.tag}</div>}
              <div className="font-medium">{c.title}</div>
              {c.body && <div className="t-note mt-1">{c.body}</div>}
            </div>
          ))}
        </div>
      )
    case 'callout':
      return (
        <div className={cn('rounded-md border-l-4 p-3', TONE[node.tone])}>
          {node.title && <div className="mb-1 font-medium">{node.title}</div>}
          <div className="t-note">{node.body}</div>
        </div>
      )
    case 'concept':
      return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
          {node.items.map((c, i) => (
            <div key={i} className="rounded-md border bg-card p-3">
              <div className="font-medium">{c.term}</div>
              <div className="t-note">{c.definition}</div>
              {c.example && <div className="t-note mt-1">例：{c.example}</div>}
              {c.contrast && <div className="t-note mt-1">反例：{c.contrast}</div>}
            </div>
          ))}
        </div>
      )
    case 'hierarchy':
      return (
        <ul className="m-0 list-none p-0">
          {node.items.map((h, i) => (
            <li key={i} className={cn('flex gap-2', LEVEL_INDENT[h.level])}>
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
              <div>
                <span>{h.label}</span>
                {h.detail && <div className="t-note">{h.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
      )
    case 'tabs':
      return <Tabs node={node} />
    case 'quiz':
      return <Quiz node={node} />
  }
}

export function GenUiView({ nodes }: { nodes: GenUiNode[] }) {
  return (
    <div className="not-prose my-3 flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 text-foreground" data-slot="genui">
      {nodes.map((n, i) => (
        <div key={i}>
          {'title' in n && <Title>{n.title}</Title>}
          <Node node={n} />
        </div>
      ))}
    </div>
  )
}
