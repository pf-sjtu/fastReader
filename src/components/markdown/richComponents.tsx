import { isValidElement, type ComponentProps } from 'react'
import type { Components } from 'react-markdown'
import { isRichLang } from '@/lib/richBlocks'
import { RichBlock } from './RichBlock'

const textOf = (n: unknown): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join('') : '')

/** 只接管 mermaid / genui / html 围栏；其余代码块与行内代码保持默认渲染。模块级常量，避免 ReactMarkdown 重复处理 */
export const richMarkdownComponents: Components = {
  pre(props: ComponentProps<'pre'>) {
    const child = Array.isArray(props.children) ? props.children[0] : props.children
    if (isValidElement<{ className?: string; children?: unknown }>(child)) {
      const lang = /language-(\w+)/.exec(child.props.className ?? '')?.[1]
      if (isRichLang(lang)) return <RichBlock lang={lang} code={textOf(child.props.children).replace(/\n$/, '')} />
    }
    return <pre {...props} />
  },
}
