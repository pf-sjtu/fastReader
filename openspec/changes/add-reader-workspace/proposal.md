# Change: 阅读工作台 + 全局对照 + 实体配色 + 书库选书 + AI 学习功能

## Why

实测线上站点（《门口的野蛮人》《2049》）与阅读代码后，发现以下已核实的问题：

- **无法对照阅读**：关键图表只是结果区第 4 个页签，与章节正文互斥（`ResultsSection.tsx`），读正文时看不到全局图谱/时间线。
- **主体难辨认**：图谱节点同为深色，时间线色板仅 6 个相近土褐色（`charts/theme.ts`），正文里的人名与图表之间没有任何视觉关联。
- **图谱溢出画布**：图谱在 `forceMount + hidden` 的 0×0 容器里初始化，之后 ResizeObserver 只调 `resize()` 不调 `fit()`；点节点弹 Sheet 还会遮住正文。
- **选书慢且不吸引人**：WebDAV 浏览器约 7 秒才出列表，只有文件名；选书后要经过「云缓存卡片 → 章节网格 → 开始」；历史链接被截断到 120px。
- **阅读界面噪声大**：每张章节卡 5 个图标按钮；原文预览固定占一个窄右栏；顶部品牌头 + 状态栏约占 190px。
- **学习深度不足**：只有"读总结"，缺少速读分层、自测、提问、笔记。

## What Changes

- **阅读工作台（新增能力 reader-workspace）**：结果页改为全高三栏（目录 | 正文 | 可拖拽对照栏）；对照栏内含图谱、时间线、人物志、综述、问书、自测、笔记、原文页签；专注模式；移动端对照栏为底部抽屉。单行顶栏替代品牌头 + 状态栏。
- **图表↔正文联动与实体配色（新增能力 entity-linking）**：全局统一 `--entity-*` 国色 token，同一实体在图谱/时间线/正文标注/人物志颜色一致，类型用形状区分；当前章实体高亮、点击跳章、正文实体标注与悬停卡、「截至本章」渐进模式。
- **产物关联跳转（新增能力 artifact-linking）**：正文/图谱/时间线/人物志/综述/原文之间的关联卡片与精确定位跳转；单击只选中、跳转需卡内明确操作（防误触）；到达高亮与"返回上一位置"；图谱可勾选「与正文同色」。
- **实体卡片与防剧透（新增能力 entity-card）**：正文悬停实体显示卡片（关系概括 + 重要事件）；所有信息项（节点/关系边/事件）关联章节（多对多，AI 的 `chapterHint` 优先、缺省客户端推导）；默认折叠"本章及之后"的信息，点击才展开，折叠内容不进 DOM。
- **阅读进度栏**可折叠为竖向进度条并可拖拽调宽。
- **书库（新增能力 library）**：首页改为书库，WebDAV 上 `.juhua/library.json` 索引 + 封面缓存，IndexedDB 本地镜像（先显示镜像再后台刷新）；已处理的书一键进入，未处理的书经「快速开始」；带完整生命周期（失效、懒补全、状态同步、GC、迁移、重建）。
- **AI 学习功能（新增能力 study-tools）**：学习包（每章一句话/要点/术语，三档阅读深度）、自测题与闪卡、基于全书综述 + 相关章节的问书。
- **笔记与导出（新增能力 notes）**：划线、批注、笔记页签、导出 Markdown 与离线学习包 HTML。
- **修改 markdown-rendering**：章节正文支持注入实体标注 remark 插件；章节卡按钮精简。
- **通用打磨**：命令面板、快捷键、断点续读、骨架屏、空状态、触控目标、焦点环、reduced-motion；排查结果页「暂无内容可上传」。

**BREAKING**：无外部接口破坏。内部 UI 结构变化会使若干 UI 测试断言需要同步更新（见 tasks.md）。mindmap / combined-mindmap 模式沿用旧结果布局。

## Impact

- Affected specs: 新增 `reader-workspace`、`entity-linking`、`artifact-linking`、`entity-card`、`library`、`study-tools`、`notes`；修改 `markdown-rendering`。
- Affected code: `src/App.tsx`（拆分）、`src/components/sections/ResultsSection.tsx`、`MarkdownCard.tsx`、`PreviewPanel.tsx`、`UnifiedStatusBar.tsx`、`src/charts/**`、`src/hooks/useChapterScrollSpy.ts`、`useReaderPanel.ts`、`src/index.css`；新增 `src/components/{workspace,home,layout}/`、`src/services/library/`、`src/services/study/`、`src/stores/readingFocus.ts`。
- WebDAV 新增文件：`.juhua/library.json`、`.juhua/covers/*.webp`、`{name}-学习包.json`、`{name}-笔记.json`。
- 新增 AI 调用（学习包、自测、问书）会产生费用，默认手动触发。
