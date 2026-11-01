import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { useIsDarkMode } from '@/components/useTheme'
import { Skeleton } from '@/components/ui/skeleton'
import { renderMermaid, svgToDataUri } from '@/lib/mermaidRender'
import { buildSandboxDoc, HEIGHT_MSG } from '@/lib/htmlSandbox'
import type { RichLang } from '@/lib/richBlocks'
import { parseGenUi } from './genui/schema'
import { GenUiView } from './genui/GenUi'

/** 渲染失败的统一回退：一行轻提示 + 源码（可读、可复制），绝不让一个坏块毁掉整章 */
function Fallback({ code, lang, reason }: { code: string; lang: string; reason: string }) {
  return (
    <div className="not-prose my-3 rounded-lg border border-dashed p-3" data-slot="rich-fallback">
      <div className="mb-1 text-xs text-muted-foreground">
        {lang} 块无法渲染（{reason}），以下为源码
      </div>
      <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">{code}</pre>
    </div>
  )
}

class Boundary extends Component<{ code: string; lang: string; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) }
  }
  componentDidUpdate(prev: { code: string }) {
    if (prev.code !== this.props.code && this.state.err) this.setState({ err: null })
  }
  render() {
    return this.state.err ? <Fallback code={this.props.code} lang={this.props.lang} reason={this.state.err} /> : this.props.children
  }
}

function MermaidView({ code }: { code: string }) {
  const dark = useIsDarkMode()
  const [res, setRes] = useState<{ svg: string } | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    setRes(null)
    void renderMermaid(code, dark).then((r) => live && setRes(r.ok ? { svg: r.svg } : { error: r.error }))
    return () => {
      live = false
    }
  }, [code, dark])
  if (!res) return <Skeleton variant="block" className="not-prose my-3 h-24" />
  if ('error' in res) return <Fallback code={code} lang="mermaid" reason={res.error} />
  return (
    <div className="not-prose my-3 overflow-x-auto rounded-lg border bg-card p-3 text-center" data-slot="mermaid">
      <img src={svgToDataUri(res.svg)} alt="图示" className="mx-auto max-w-full" />
    </div>
  )
}

function HtmlView({ code }: { code: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(120)
  const built = buildSandboxDoc(code)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || e.data?.type !== HEIGHT_MSG) return
      const v = Number(e.data.h)
      if (Number.isFinite(v)) setH(Math.min(Math.max(v, 40), 720))
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  if (!built.ok) return <Fallback code={code} lang="html" reason={built.error} />
  return (
    <iframe
      ref={ref}
      title="交互示意"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={built.doc}
      style={{ height: h }}
      className="not-prose my-3 w-full rounded-lg border bg-card"
      data-slot="html-block"
    />
  )
}

function GenUi({ code }: { code: string }) {
  const r = parseGenUi(code)
  return r.ok ? <GenUiView nodes={r.nodes} /> : <Fallback code={code} lang="genui" reason={r.error} />
}

export function RichBlock({ lang, code, truncated }: { lang: RichLang; code: string; truncated?: boolean }) {
  const l = lang.toLowerCase()
  // 输出被截断的未闭合块：源码不完整，直接回退，不去渲染半截内容
  if (truncated) return <Fallback code={code} lang={l} reason="内容不完整" />
  return (
    <Boundary code={code} lang={l}>
      {l === 'mermaid' ? <MermaidView code={code} /> : l === 'genui' ? <GenUi code={code} /> : <HtmlView code={code} />}
    </Boundary>
  )
}
