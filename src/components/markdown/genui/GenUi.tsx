import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { GenUiNode } from './schema'

/** 所有文字都以 React 文本节点渲染（自动转义）；颜色只用语义 token */

const Title = ({ children }: { children?: string }) => (children ? <div className="t-label mb-2 text-muted-foreground">{children}</div> : null)

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
                'rounded-md border px-3 py-1.5 text-left text-sm transition-colors',
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
      {picked !== null && node.explain && <div className="mt-2 text-sm text-muted-foreground">{node.explain}</div>}
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
            className={cn('rounded-md px-2.5 py-1 text-sm', k === i ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="text-sm leading-relaxed">{cur.body}</div>
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
                {s.detail && <div className="text-sm text-muted-foreground">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )
    case 'compare':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
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
      return (
        <ol className="m-0 list-none border-l-2 border-border p-0 pl-4">
          {node.items.map((t, i) => (
            <li key={i} className="relative pb-3 last:pb-0">
              <span className="absolute -left-[1.45rem] top-1.5 size-2 rounded-full bg-primary" />
              {t.time && <div className="text-xs text-muted-foreground">{t.time}</div>}
              <div className="font-medium">{t.label}</div>
              {t.detail && <div className="text-sm text-muted-foreground">{t.detail}</div>}
            </li>
          ))}
        </ol>
      )
    case 'cards':
      return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
          {node.items.map((c, i) => (
            <div key={i} className="rounded-md border bg-card p-3">
              {c.tag && <div className="mb-1 text-xs text-primary">{c.tag}</div>}
              <div className="font-medium">{c.title}</div>
              {c.body && <div className="mt-1 text-sm text-muted-foreground">{c.body}</div>}
            </div>
          ))}
        </div>
      )
    case 'callout':
      return (
        <div className={cn('rounded-md border-l-4 p-3', TONE[node.tone])}>
          {node.title && <div className="mb-1 font-medium">{node.title}</div>}
          <div className="text-sm leading-relaxed">{node.body}</div>
        </div>
      )
    case 'tabs':
      return <Tabs node={node} />
    case 'quiz':
      return <Quiz node={node} />
  }
}

export function GenUiView({ nodes }: { nodes: GenUiNode[] }) {
  return (
    <div className="not-prose my-3 flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" data-slot="genui">
      {nodes.map((n, i) => (
        <div key={i}>
          {'title' in n && <Title>{n.title}</Title>}
          <Node node={n} />
        </div>
      ))}
    </div>
  )
}
