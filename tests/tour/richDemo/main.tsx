import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import './demo.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import { richMarkdownComponents } from '@/components/markdown/richComponents'
import { remarkTailQuestions } from '@/components/markdown/remarkTailQuestions'
import { demoMarkdown } from './sample'

const md = demoMarkdown

createRoot(document.getElementById('root')!).render(
  <ThemeProvider defaultTheme={(new URLSearchParams(location.search).get('theme') as 'light' | 'dark') || 'light'} storageKey="rich-demo-theme">
  <div style={{ maxWidth: 820, margin: '0 auto', padding: 24 }}>
    <div className="markdown-card-content prose prose-sm max-w-none overflow-x-auto" id="demo">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkTailQuestions]} components={richMarkdownComponents}>
        {md}
      </ReactMarkdown>
    </div>
  </div>
  </ThemeProvider>,
)
