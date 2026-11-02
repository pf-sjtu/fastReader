/**
 * 验收演示页的样本内容（与渲染无关，抽出来是为了让测试能守卫它）。
 *
 * 为什么要有这个文件：`GENUI_LIMITS.nodes = 8`——一个 genui 围栏里放超过 8 个节点，多出来的会被
 * `parseGenUi` 静默丢掉。演示页曾把九种组件塞进同一个围栏，结果第 9 个（quiz）根本没渲染，
 * 而「九种组件都在」的验收记录却是照着清单写的。现在由 `sample.test.ts` 守住：
 * 每个围栏都 ≤8 个节点、九种组件一个不少。
 */
import type { GenUiNode } from '@/components/markdown/genui/schema'

/** 与 parseGenUi 的上限一致（一个围栏最多 8 个节点） */
export const GENUI_NODES_PER_FENCE = 8

const F = '```'

/** 九种 genui 组件各一例 */
export const genuiNodes: GenUiNode[] = [
  { type: 'steps', title: '企业生命周期', items: [{ label: '孕育期', detail: '想法与资源' }, { label: '婴儿期', detail: '活下来' }, { label: '学步期', detail: '过度扩张' }] },
  { type: 'compare', title: '两种路径', columns: ['内生增长', '并购'], rows: [{ label: '风险', cells: ['低', '高'] }, { label: '速度', cells: ['慢', '快'] }] },
  { type: 'timeline', items: [{ time: '1990', label: '创立', detail: '三人合伙' }, { time: '1998', label: '上市' }] },
  { type: 'hierarchy', title: '知识分层', items: [{ label: '显性知识', level: 1 }, { label: '事实性', level: 2 }, { label: '程序性', level: 2 }, { label: '隐性知识', level: 1 }, { label: '经验直觉', level: 2 }] },
  { type: 'concept', title: '两个常被混用的成本', items: [{ term: '沉没成本', definition: '已经付出、无法收回的支出', example: '已投入的研发费用', contrast: '决策时应忽略，却常被用来为继续投入辩护' }, { term: '机会成本', definition: '为当前选择而放弃的次优选项的价值', example: '把同一笔钱买债的利息', contrast: '看不见，但必须计入决策' }] },
  { type: 'cards', items: [{ title: '概念甲', body: '一句话解释', tag: '核心' }, { title: '概念乙', body: '另一句话' }] },
  { type: 'callout', tone: 'key', title: '要点', body: '增长不是目的，可持续才是。' },
  { type: 'tabs', tabs: [{ label: '财务', body: '现金流是生命线。' }, { label: '组织', body: '权责要清晰。' }] },
  { type: 'quiz', question: '学步期最大的风险是？', options: ['缺钱', '过度扩张', '没客户'], answer: 1, explain: '学步期容易盲目多元化。' },
]

/** ≥3 个分支的 mindmap（单链 mindmap 会被渲染器拉成竖排长条，见 README 的验收记录） */
export const mermaidSamples: Record<string, string> = {
  graph: 'graph LR\n  A["孕育期"] --> B["婴儿期"] --> C["学步期"]',
  mindmap: 'mindmap\n  root((知识分类))\n    显性知识\n      事实性\n      程序性\n    隐性知识\n      认知类\n      技术类\n    集体默契\n      团队配合',
  state: 'stateDiagram-v2\n  [*] --> 待审\n  待审 --> 通过: 同意\n  待审 --> [*]: 退回',
  quadrant: 'quadrantChart\n  x-axis 低风险 --> 高风险\n  y-axis 低收益 --> 高收益\n  债券: [0.2, 0.3]\n  股票: [0.8, 0.7]',
  sequence: 'sequenceDiagram\n  起草人->>法务: 送审\n  法务-->>起草人: 退回',
  timeline: 'timeline\n  1990 : 创立\n  1998 : 上市',
}

export const htmlSample = `<div style="padding:8px"><button id="b" style="padding:6px 12px">点我 +1</button> <span id="n">0</span>
<div style="height:140px;background:#eee;margin-top:8px">内容很高（用来测高度回报）</div></div>
<script>var c=0;document.getElementById('b').onclick=function(){c++;document.getElementById('n').textContent=c}</script>`

const fence = (lang: string, code: string) => `${F}${lang}\n${code}\n${F}`

/** genui 按上限切成多个围栏（保留 n+1 的意图：平摊而不是把多出来的丢掉） */
export function genuiFences(nodes: GenUiNode[] = genuiNodes, per = GENUI_NODES_PER_FENCE): string[] {
  const out: string[] = []
  for (let i = 0; i < nodes.length; i += per) out.push(fence('genui', JSON.stringify(nodes.slice(i, i + per))))
  return out
}

/** 演示页正文 */
export const demoMarkdown = `这一章讲企业像生命体一样经历阶段。**每个阶段**都有不同的风险。

${fence('mermaid', mermaidSamples.graph)}

下面是并列的 genui 组件（一个围栏最多 ${GENUI_NODES_PER_FENCE} 个节点，所以九种分成两栏）：

${genuiFences().join('\n\n')}

交互示意（html 块，带脚本）：

${fence('html', htmlSample)}

一个坏的 genui 块（应回退为源码）：

${fence('genui', '{坏的 json')}

新词汇的三种 mermaid 图型（mindmap / stateDiagram-v2 / quadrantChart）与另外两种放行图型（sequenceDiagram / timeline）：

${fence('mermaid', mermaidSamples.mindmap)}

${fence('mermaid', mermaidSamples.state)}

${fence('mermaid', mermaidSamples.quadrant)}

${fence('mermaid', mermaidSamples.sequence)}

${fence('mermaid', mermaidSamples.timeline)}

正文里的行内元素（验证链接 / 引用 / 行内代码 / 高亮 / 上下标是否跟随主题 token）：
一句话里既有 [一个链接](https://example.com) 也有 \`行内代码\`，还有 **加粗** 与 *斜体*，以及 <mark>高亮</mark> 与 H<sub>2</sub>O、x<sup>2</sup>。

> 引用块：颜色取 --muted-foreground，左边框取 --border，深浅主题各自跟随。

---

一个坏的 mermaid 块：

${fence('mermaid', '这根本不是图 ???')}

结尾的正文段落。

为什么学步期最危险？
如何在扩张中保持现金流健康？
这对今天的创业者意味着什么？`
