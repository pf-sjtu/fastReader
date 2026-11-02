import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import './demo.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import { richMarkdownComponents } from '@/components/markdown/richComponents'
import { remarkTailQuestions } from '@/components/markdown/remarkTailQuestions'
import { remarkRichTruncation } from '@/components/markdown/remarkRichTruncation'
import { demoMarkdown } from './sample'

const md = demoMarkdown

createRoot(document.getElementById('root')!).render(
  <ThemeProvider defaultTheme={(new URLSearchParams(location.search).get('theme') as 'light' | 'dark') || 'light'} storageKey="rich-demo-theme">
  <div style={{ maxWidth: 820, margin: '0 auto', padding: 24 }}>
    {/*
      与 MarkdownCard 同一层 DOM：`[data-slot="card-content"]` 上的 `font-size: … !important`
      才是线上正文的 15px（留在外面的 .prose 会退成 prose-sm 的 14px，量的数字就不代表线上了）。
    */}
    <div data-slot="card-content">
      <div className="markdown-card-content prose prose-sm max-w-none overflow-x-auto" id="demo">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkTailQuestions, remarkRichTruncation]} components={richMarkdownComponents}>
          {md}
        </ReactMarkdown>
        <div id="truncated-demo">
          <ReactMarkdown remarkPlugins={[remarkRichTruncation]} components={richMarkdownComponents}>
            {'```html\n<button>未闭合的示例</button>'}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  </div>
  </ThemeProvider>,
)
