import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import './demo.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import { richMarkdownComponents } from '@/components/markdown/richComponents'
import { remarkTailQuestions } from '@/components/markdown/remarkTailQuestions'

const F = '```'
const genui = JSON.stringify([
  { type: 'steps', title: '企业生命周期', items: [{ label: '孕育期', detail: '想法与资源' }, { label: '婴儿期', detail: '活下来' }, { label: '学步期', detail: '过度扩张' }] },
  { type: 'compare', title: '两种路径', columns: ['内生增长', '并购'], rows: [{ label: '风险', cells: ['低', '高'] }, { label: '速度', cells: ['慢', '快'] }] },
  { type: 'timeline', items: [{ time: '1990', label: '创立', detail: '三人合伙' }, { time: '1998', label: '上市' }] },
  { type: 'cards', items: [{ title: '概念甲', body: '一句话解释', tag: '核心' }, { title: '概念乙', body: '另一句话' }] },
  { type: 'callout', tone: 'key', title: '要点', body: '增长不是目的，可持续才是。' },
  { type: 'tabs', tabs: [{ label: '财务', body: '现金流是生命线。' }, { label: '组织', body: '权责要清晰。' }] },
  { type: 'quiz', question: '学步期最大的风险是？', options: ['缺钱', '过度扩张', '没客户'], answer: 1, explain: '学步期容易盲目多元化。' },
])
const html = `<div style="padding:8px"><button id="b" style="padding:6px 12px">点我 +1</button> <span id="n">0</span>
<div style="height:140px;background:#eee;margin-top:8px">内容很高（用来测高度回报）</div></div>
<script>var c=0;document.getElementById('b').onclick=function(){c++;document.getElementById('n').textContent=c}</script>`

const md = `这一章讲企业像生命体一样经历阶段。**每个阶段**都有不同的风险。

${F}mermaid
graph LR
  A[孕育期] --> B[婴儿期] --> C[学步期]
${F}

下面是并列的 genui 组件：

${F}genui
${genui}
${F}

交互示意（html 块，带脚本）：

${F}html
${html}
${F}

一个坏的 genui 块（应回退为源码）：

${F}genui
{坏的 json
${F}

一个坏的 mermaid 块：

${F}mermaid
这根本不是图 ???
${F}

结尾的正文段落。

为什么学步期最危险？
如何在扩张中保持现金流健康？
这对今天的创业者意味着什么？`

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
