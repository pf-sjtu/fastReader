# 离线学习包（单文件 HTML）

把一本书的「总结 + 笔记 + 自测」打包成一个 `.html`：不依赖网络、不引用任何外部资源，
双击就能看，打印出来也像样。入口是结果页标题栏里与「MD」并列的「HTML」按钮。

对应 openspec 任务 7.2；契约见
`openspec/changes/add-reader-workspace/specs/notes/spec.md` 的「导出」Requirement。

## 分工

| 文件 | 职责 |
|------|------|
| `src/study/pack/buildPack.ts` | 纯渲染：`PackData` → 一整份 HTML（内联 CSS、打印样式、全量转义） |
| `src/study/pack/collect.ts` | `collectPackData(input)`：把「书 + 笔记 + 自测 + 作答」整理成 `PackData` |
| `src/study/pack/captureImages.ts` | 把 mermaid 图块渲染成 SVG data URI（`captureDiagramImages`） |
| `src/study/exportPack.ts` | **接线层**：接真实数据（`BookSummary` / 笔记 store / 速读 store）、把 `var(--entity-N)` 映射到**固定亮色实体色表**、i18n 文案与 `<html lang>` |
| `src/study/exportFigures.ts` | 图谱与时间线**自绘 SVG** |
| `src/components/study/ExportPackButton.tsx` | 按钮：自己读书的两个 store，不往上层加 prop |

`src/study/pack/**` 不知道 React、不知道 store、不知道 i18n：它是「给数据就出 HTML」的纯函数，
所以 `tests/study/pack.test.ts` 能在 node 环境里直接断言。数据从哪来、色值是 `var()` 还是
`#rrggbb`、文案是中文还是英文，全由接线层负责。

## 数据来源

- 章节 / 总结 / 章节关联 / 全书综述：`BookSummary`（当前这本书）。
- 笔记：笔记 store。导出前先按当前章节**归位**（`resolveChapterIndex`：id → 标题 → 序号），
  总结重生成后章节标题变了也能落回正确的一节；实在认不出才用笔记自己记的标题。
- 自测与作答：速读 store（`study.data`，`q1…qN` 与 `answers` 对位）。
- 图谱 / 时间线：`charts`（`BookCharts`）。
- 人物志：`buildEntityStyles` 里形状为 `circle` 的实体（见 `shapeForType`）。

## 为什么图谱与时间线是自绘 SVG

阅读器里的两张图都不是「能截就截」的：

- 人物关系图是 cytoscape 画在 canvas 上的，实例是组件内部的局部 ref，而导出按钮所在的页签
  往往并没有挂载它；
- 实体时间线是纯 div，没有可序列化的矢量根，截图要引 html2canvas 一类新依赖。

所以用 `BookCharts` 的数据离线重绘：**时间线复用应用内 `layoutEntityTimeline` 的几何算法**
（同一套列宽 / 换行 / 行高规则），但**参数是按打印尺寸另配的一份 `TIMELINE_CONFIG`**
（`src/study/exportFigures.ts`：`colWidth 124` / `labelWidth 96` / `headerHeight 56` / `lineHeight 16`；
应用内是 `EntityTimelineChart.tsx` 的 `140 / 104 / 64 / 17`，并另注入 `theme.palette`），
所以列位置与换行点会和界面**略有出入**，
不是逐像素复刻；
**人物关系图用自写的圆环布局**（应用内是 cytoscape 的力导布局），节点、连线与关系文字都在，
位置不逐字复刻。零新依赖，也不改既有图表组件。

四条必须记住的约束：

1. 图里的颜色必须是十六进制：SVG 进了 `<img src="data:...">` 就是独立文档，读不到页面的
   `--pack-*` / `--entity-*` 变量，而 `readableTextOn` 也要 `#rrggbb` 才能算对比度。
2. **实体色固定取亮色表**：`exportPack.ts` 的 `PACK_ENTITY_PALETTE` 是 `src/index.css` 亮色
   `--entity-1..10` / `--entity-neutral` 的副本（`resolveEntityColor` 只查这张表，**不读
   `getComputedStyle`**）。学习包纸面固定亮色，而暗色主题会把 `--entity-N` 从 `L≈0.44–0.58`
   提亮到 `L≈0.68–0.80`，照着当前主题取值会让实体色对纸面的对比度掉到 1.69–2.57:1。
   改 token 要同步这张表（`tests/study/exportPack.test.ts` 逐字比对 `index.css`）。
3. 笔记四色的离线值写在 `buildPack.ts` 的 `NOTE_PALETTE`（同样是 `src/index.css` 亮色 token 的
   副本）。改 token 的颜色要同步这里，或者在调用时传 `noteColors` 覆盖。
4. 学习包固定亮色（它是要打印的），不跟随界面明暗主题。

## 导出流程

```
点「HTML」
  → figureImagesOf(charts)        自绘：人物关系图 → 实体时间线
  → mermaidSourcesOf(chapters)    取每章正文里的 mermaid 图块（截断的坏块不要）
  → captureDiagramImages(...)     逐张渲染成 SVG data URI，失败的收进 failed
  → collectPackData(...)          归位笔记、贴回作答、挑人物志
  → buildStudyPackHtml(data, { labels, lang })
  → triggerTextDownload(html, filename, 'text/html;charset=utf-8', false)
```

- 图片顺序：图谱 → 时间线 → 正文里的图块。
- 只有 `data:image/` 前缀的图能进包，外部链接一律丢弃（否则「断网可读」就是假的）。
- 某张图失败只提示（`study.pack.imagesFailed`），正文、笔记与自测照常导出。
- `images: false` 是「整包不出图」，连自绘的图谱也不画（测试与未来「只要文字」的入口用得上）。
- 文件名：`{书名}-{docTitleSuffix}.html`，经 `sanitizeFileName` 清掉文件系统非法字符；书名主干过长
  时按码点截到 80 字符（后缀保留，整个文件名 `≤85`），免得 AI 生成的长标题变成 130+ 字符的文件名。
- `lang`：`<html lang>` 跟随界面语言（`zh*` → `zh-CN`，其余 → `en`；`PackBuildOptions.lang` 可显式
  覆盖）。正文文案连同 `labels` 一起换，两者都由接线层决定。
- HTML 不带 BOM：`<!doctype>` 前面多一个零宽字符是自找麻烦。

## 文案

包里没有任何键名：固定文案走 i18n 的 `study.pack.*`（`packLabels(t)` 逐键构造 `PackLabels`，
缺键退回 `DEFAULT_PACK_LABELS` 的中文），因为离线包是要给人看、甚至打印的。
en 界面下的学习包因此是英文（`<html lang>` 也跟着走）——这也是 `PackLabels` 存在的理由。

## 测试

- `tests/study/pack.test.ts`：纯渲染（34 例，含 `<html lang>` 缺省与覆盖）。
- `tests/study/exportPack.test.ts`：接线（笔记归位、人物志、mermaid 来源、**亮色实体色表与
  `index.css` 逐字同步 / 不读当前主题**、`packLangOf` 映射、语言接线、文件名与截断、文案、
  图谱入包与 `images: false` 的行为）。
- `tests/study/exportFigures.test.ts`：自绘 SVG（含实体名 / 关系文字 / 颜色是否真的写进 SVG、
  **颜色里的引号不构造新属性**、无外链、HTML 转义、同一对实体的多条关系各自成线、没有数据时
  返回 null）。

## 已知取舍

- 时间线很宽（实体多）时靠 CSS `max-width: 100%` 等比缩到页面宽，字会变小；包内不做分栏或
  横向滚动，需要看清可以在浏览器里放大或用打印的横向版式。
- 人物关系图最多画两行标签，节点很多时会有标签重叠（垫了纸色底）。
- 书里的实体时间线若本身没有事件，或图谱不足两个节点，该图直接不出现（空图不如没有）。
- 章节总结只做**最小 Markdown 处理**（`renderMinimalMarkdown`：标题与无序列表）：代码围栏、
  表格、引用块不解析，按原样文字显示。总结是给打印看的散文，上完整 Markdown 渲染器要么引新
  依赖、要么让 `pack/**` 沾上 React。
- 学习包不包含思维导图（应用内是第三方组件的画布）与问书对话（有意不持久化）。
