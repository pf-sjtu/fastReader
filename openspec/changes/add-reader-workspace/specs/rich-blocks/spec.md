## ADDED Requirements

### Requirement: 总结可携带富内容块，且不计入字数
章节总结 SHALL 允许模型在**确有助于理解复杂或抽象内容**时附带至多 2 个富内容块：围栏 `mermaid`（图，限 `graph LR/TD`、`sequenceDiagram`、`timeline`、`mindmap`、`stateDiagram-v2`、`quadrantChart` 六种图型）、`genui`（JSON 描述的原生组件：steps / compare / timeline / hierarchy / concept / cards / callout / tabs / quiz）、`html`（沙箱内的交互片段）。块是可选增强：模型不写不是缺陷，写了也 SHALL NOT 替代文字。块 SHALL NOT 计入任何字数口径——质量闸、压缩阈值、加粗上限、下游 prompt 的输入、字数展示一律先剔除块再计算；文字部分的篇幅与质量要求 SHALL 与没有块时完全相同。前端 `src/lib/richBlocks.ts` 与 CLI `src/cli/rich_blocks.py` SHALL 对同一输入给出相同的剔除、枚举与 genui 校验结果，由共享夹具 `tests/fixtures/rich-blocks/cases.json` 锁定。

#### Scenario: 块不计字数
- **WHEN** 一章文字只有 80 字、却带了一个 5000 字的 genui 块
- **THEN** 质量闸按 80 字判定为过短并触发一次定向重写，而不是因为总长度够而放行

#### Scenario: 下游只喂正文
- **WHEN** 生成关联分析、全书总结、速读包、自测或问书上下文
- **THEN** 送入提示词的章节文字已剔除全部富内容块；展示与云端上传仍保留含块的原文

### Requirement: 让模型知道有哪些展示方式（独立的提示词 / 上下文工程）
富内容块的使用说明 SHALL 作为**独立、前端与 CLI 共享**的上下文模块维护（`services/prompts/config/rich-blocks-guide.md`，经 `{{richBlocksGuide}}` 预展开进章节总结提示词（全书综述 / 关联分析只读正文、块被剔除，不注入）），而不是散落在各提示词里的零碎句子。该模块 SHALL 包含：① 能力介绍（读者会看到什么、渲染环境的限制）；② 选型规则（什么内容用哪种块、什么情况不用，含数量上限与「不计字数但不得压缩文字」的约束）；③ 每种块的**精确语法**与常见错误；④ few-shot：**每一种 genui 组件与每一种放行的 mermaid 图型至少一个正例**（含 steps / concept / callout 与横向、纵向流程图），以及一个「不该画图」的反例。选型清单对小说与非虚构保持中性（人物关系 / 因果链 / 流程 / 对比 / 时间线 / 层级 / 状态）。

说明 SHALL 分两层以支持渐进披露：**决策层**（能力 / 何时用与不用 / 选型 / 硬规则）在前，**参考层**（语法骨架与示例）从两端共用的分界标题起；`{{richBlocksGuideBrief}}` SHALL 只展开决策层（不含任何围栏示例），两个占位符 SHALL NOT 互相误匹配、展开顺序无影响；分界标题缺失时 SHALL 退回全文而不是给出半截说明。提示词编辑器 SHALL 把两个占位符都列出来（让自定义提示词的用户知道它们存在、删掉就会失去该能力）。

mermaid 示例 SHALL 经**生产同款真实解析器**验证（不只是正则启发式），且说明里关于标点与箭头的要求 SHALL 与解析器的真实行为一致。用户自定义的章节提示词若不含占位符，SHALL 不自动注入（避免破坏用户对输出格式的控制；也因此该说明是**预展开**而不是渲染变量——变量会被追加到末尾）；提示词预览按真实请求展开。

#### Scenario: 模型能做出正确选择
- **WHEN** 章节内容是「按阶段推进的流程」「两种方案的多维度对比」「纯观点论述」
- **THEN** 模型分别倾向用 mermaid 或 steps、compare、不画图，而不是对每章都附一个块

#### Scenario: 词汇长出来就要教它怎么写
- **WHEN** 新增一种 genui 组件或放行一种 mermaid 图型
- **THEN** 说明里同步给出该类型的正例，`tests/richGuide.test.ts` 因缺少示例而失败，除非补上

#### Scenario: 精简版只给规则
- **WHEN** 自定义提示词写 `{{richBlocksGuideBrief}}`
- **THEN** 展开结果包含选型与硬规则、不含任何围栏示例；`{{richBlocksGuide}}` 仍展开全文，两者可同时出现

#### Scenario: 真实模型实测留痕
- **WHEN** 用同一批章节分别带说明与不带说明各跑若干次（MiniMax-M3，`tests/tour/eval_rich_guide.py`；章节含非虚构与小说、含流程 / 对比 / 概念 / 层级 / 线性叙述）
- **THEN** 结构性章节出块率显著高于 0%（实测 87.5% vs 0%）、线性叙述章节以「不配块」为主（实测误画 25%）、正文长度不因配块而缩水；
- **AND** 报告 SHALL 分开列出「出块率」与「**选型合适率**」（块是否落在该章节期望的语义上），不得只报出块率；
- **AND** 产物里的 mermaid 块 SHALL 再用生产同款真解析器复检（`tests/tour/evalMermaid.test.ts`），CLI 的结构启发式不得作为「块合法」的唯一依据；
- **AND** 说明措辞的每次迭代 SHALL 记录「改了什么 → 前后指标」，而不是只留下最后一次的数字

#### Scenario: 单一来源
- **WHEN** 调整选型规则或更换 few-shot
- **THEN** 只改共享的说明文件，网页与 CLI 同时生效；守卫测试断言 v3 提示词里不再内联一份说明

### Requirement: 每个渲染入口都接入富内容块
凡把章节总结、关联分析或全书综述渲染为 Markdown 的界面 SHALL 经同一个 `richMarkdownComponents` 渲染富内容块，并经同一个 `remarkTailQuestions` 区隔章末提问；SHALL NOT 出现某些页面把块显示成普通代码、另一些页面渲染成组件的不一致。未闭合的块（输出被截断）SHALL 直接回退为源码，不渲染半截内容。

#### Scenario: 结果页与阅读工作台一致
- **WHEN** 同一章分别在结果页与阅读工作台对照栏打开
- **THEN** mermaid / genui / html 块的呈现方式与回退方式完全一致

### Requirement: 渲染失败一律可读回退
任何块在解析、渲染、超时、超长、脚本异常时 SHALL 回退为「一行轻提示（含原因）+ 可读可复制的源码」，且 SHALL NOT 影响同章其余内容的渲染；`genui` 解析 SHALL 宽容（尾逗号、行注释、字段别名、坏的单项丢弃），全部读不出才回退；`quiz` 的答案不在选项内或为 `null` SHALL 丢弃整题。

#### Scenario: 一个坏块不毁掉整章
- **WHEN** 同一章里有一个 JSON 损坏的 genui 块和一个好的 mermaid 块
- **THEN** 好块正常渲染，坏块显示回退提示与源码，正文完整

### Requirement: html 块在生产 CSP 下真实可交互
html 块 SHALL 运行在 `sandbox="allow-scripts"`（不含 `allow-same-origin`）的 iframe 中，且 SHALL 在站点生产响应头（`public/_headers`）下**实际可用**：内联脚本可执行、iframe 高度随内容自适应。因 `srcdoc` / 本地文档会继承父页面 CSP（`script-src 'self'` 会拦截内联脚本），html 块 SHALL 通过独立的同源沙箱页 `/rich-sandbox/` 加载，由父页面经 `postMessage` 下发内容；该页 SHALL 带自己的 CSP：`default-src 'none'`（禁一切网络与嵌套）、仅允许内联脚本与样式、`img-src data:`、`frame-ancestors 'self'`。沙箱页 SHALL 校验消息来源为父窗口；父页面 SHALL 校验高度回报来自该 iframe；内容 SHALL 先剔除 `iframe / object / embed / link / meta / base / form`，并限制大小。

#### Scenario: 交互可用
- **WHEN** 总结里的 html 块含一个按钮与内联脚本，且页面带生产 CSP
- **THEN** 点击按钮后脚本生效，iframe 高度等于内容高度，没有内部滚动条

#### Scenario: 无法联网与逃逸
- **WHEN** html 块里的脚本尝试 `fetch` 外部地址、嵌套 iframe、改写顶层页面或读取站点存储
- **THEN** 均被 CSP 或沙箱拒绝，主页面不受影响

#### Scenario: 响应头被守卫
- **WHEN** 修改 `public/_headers`
- **THEN** 守卫测试断言 `/rich-sandbox/` 的 CSP 同时满足「允许内联脚本」「`default-src 'none'`」「`frame-ancestors 'self'`」，且全站 CSP 未被放宽

### Requirement: 深浅主题下可读
genui 与回退块 SHALL 显式使用语义前景色 token（不依赖从 `prose` 继承的灰色），mermaid SHALL 随当前主题切换配色，html 沙箱 SHALL 按主题给默认文字色；深色下所有文字对比度 SHALL 达到可读。

#### Scenario: 深色主题
- **WHEN** 切到深色主题查看含 genui 对比表与卡片的总结
- **THEN** 表头、单元格、卡片标题与正文文字均清晰可读

### Requirement: 坏块在生成后统一修复
章节总结完成后，系统 SHALL 收集所有校验不通过的富内容块，分批（每批至多 6 个）、每批一次 LLM 调用地修复：只发送坏块源码、错误信息与块前 80 字，**不发送正文也不回看原书**；使用结构化输出（共享 `rich-repair.schema.json`）只回传 `{id, code}`；修好的块复检通过才写回（同步更新章节缓存），仍不通过则删除该块，正文逐字不变；修复调用失败 SHALL NOT 使任何章节失败。网页（`richRepair.ts`）与 CLI（`rich_repair.py`）SHALL 同语义，唯一允许的差异是 mermaid 语法校验（网页用真实解析器，CLI 只做结构检查）。

#### Scenario: 一批一次
- **WHEN** 全书有 5 个坏块分布在 3 章
- **THEN** 只发起一次修复调用，请求体不含任何章节正文

### Requirement: 功能必须在真实环境验收
富内容块的验收 SHALL 包含：① 真实浏览器（非 jsdom）中、带生产 CSP 的演示页，覆盖 mermaid / genui / html（含交互与高度）/ 回退 / 章末提问，浅色与深色各一遍；② 至少一个真实模型对真实章节的生成实测，记录块出现率、块合规率、正文长度相对「无块提示词」基线的变化；③ 离线学习包不得把块显示成无法理解的原始代码。

#### Scenario: 验收留痕
- **WHEN** 声明本能力完成
- **THEN** `tasks.md` 记录真实浏览器验收与真实模型实测的结果与已知差异，而不是只记录单元测试通过

### Requirement: 离线学习包对富内容块的处理
离线学习包 HTML SHALL 把 `genui` 块输出为静态组件（steps / compare / timeline / hierarchy / concept / cards / callout / tabs 的全部内容可见，quiz 显示题目与答案），`mermaid` 块输出为带说明的源码块，`html` 块省略并注明「交互内容仅在线可用」；SHALL NOT 把原始 JSON 或脚本当作正文输出。

#### Scenario: 断网阅读
- **WHEN** 导出含三种块的总结为学习包并断网打开
- **THEN** genui 内容完整可读，mermaid 以源码呈现，html 位置有说明，无脚本被执行
