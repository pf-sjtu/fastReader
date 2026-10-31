# 任务清单

## 0. 提案
- [x] 0.1 本提案经 `openspec validate add-reader-workspace --strict` 通过

## 1. 实体配色与索引（纯函数）
- [x] 1.1 `index.css` 新增 `--entity-1..10`（light/dark，oklch）（对比度校验见阶段 8 走查）
- [x] 1.2 `charts/linking/entityColors.ts`：合并节点与时间线实体、分配颜色与形状
- [x] 1.3 `charts/linking/entityIndex.ts`：名称变体、首字符分桶扫描、entityToChapters/chapterToEntities、matchChapterHint
- [x] 1.4 `charts/linking/remarkEntityMark.ts`
- [x] 1.5 `charts/theme.ts` palette 改读 token
- [x] 1.6 单测（含 300 章 × 50 实体性能用例）

## 2. 滚动 ref 化与图谱修复
- [x] 2.1 `useChapterScrollSpy` 增加 container 参数；`utils/scrollTo.ts`
- [x] 2.2 `stores/readingFocus.ts`
- [x] 2.3 `ChartPluginProps` 扩展（可选字段，向后兼容）
- [x] 2.4 图谱 0→有尺寸时 fit；"适应画布"按钮；布局后按每节点面积等比压紧（防重叠下限）并放宽 minZoom

## 3. 阅读工作台
- [x] 3.1 `ResizeHandle`（指针拖拽 + 键盘 + 双击复位，不另设 hook）
- [x] 3.2 `ReaderWorkspace` + `CompanionDock`（移动端抽屉内置于工作台）
- [x] 3.3 `ResultsSection variant="body"`；`PreviewPanel variant="dock"`；章节卡「清除缓存」收进更多菜单；正文限宽居中（衬线正文切换留到阶段 8）
- [x] 3.4 专注模式
- [ ] 3.5 阅读进度栏：可折叠为竖向进度条、可拖拽/键盘调宽（160–360px）、状态记忆

## 4. 联动与标注
- [x] 4.1 图谱高亮/淡化/居中、渐进模式、图例与类型过滤
- [x] 4.2 时间线本章高亮、点事件跳章
- [x] 4.3 `EntityDetailPane`、人物志、本章出场条
- [x] 4.4 正文标注 + `EntityHoverCard`（悬停 300ms 延迟）
- [ ] 4.5 `entityIndex` 记录每次出现的位置与摘录；`LinkCard`（实体/事件/章节三种卡）（实体卡、事件卡已完成；章节卡推迟）
- [x] 4.6 统一 `navigateTo`：自动展开/切页签 → 精确定位 → 到达高亮 → 历史栈与"返回上一位置"
- [x] 4.7 防误触：单击仅选中、拖动不触发、触屏无悬停、双击快捷；Esc/点空白关闭并还焦点
- [x] 4.8 图谱「与正文同色」开关 + 图例 + 类型过滤（偏好记忆）
- [x] 4.9 信息项章节归属：节点/边/事件可选 `chapterHint`（schema + prompt，旧缓存兼容）+ 客户端推导（边=两端共现章节）
- [x] 4.10 `buildEntityCardModel` 纯函数：剧透折叠（e<c 可见；折叠区只给条数，内容不进 DOM）+ 关系概括 + 重要事件
- [x] 4.11 悬停实体卡片（可移入、300ms 延迟、200ms 关闭延迟）+ 折叠区展开；正文悬停取标注所在章为"本章"
- [x] 4.12 图谱渐进模式口径（e≤c）与界面说明

## 5. 顶栏与书库
- [ ] 5.1 `AppTopBar`；`App.tsx` 拆分
- [ ] 5.2 `services/library/`（index/scanner/gc）与 IndexedDB 镜像
- [ ] 5.3 `LibraryView`、继续阅读、封面墙、`QuickStartSheet`（智能勾选 + 费用预估）
- [ ] 5.4 设置：重建/清空书库索引

## 6. AI 学习功能
- [ ] 6.1 学习包（studyKit）生成、持久化、三档阅读深度
- [ ] 6.2 自测与闪卡
- [ ] 6.3 问书

## 7. 笔记与导出
- [ ] 7.1 划线/批注、锚点重定位、`{name}-笔记.json` 同步
- [ ] 7.2 笔记页签与 Markdown 导出；离线学习包 HTML
- [ ] 7.3 命令面板、快捷键、断点续读

## 8. 打磨与验收
- [ ] 8.1 排查并修复"暂无内容可上传"
- [ ] 8.2 同步更新受影响测试：`uiRender`、`uiComponents`、`fixUiE2e`、`w2pipeHook`
- [ ] 8.3 i18n zh/en 补齐；明暗主题与 375/768/1440 走查
- [ ] 8.4 `pnpm test`、`pnpm build`、`pnpm check:functions` 通过
- [ ] 8.5 独立 Reviewer（devils_advocate）审查并处理结论
- [ ] 8.6 更新 README 与项目 CLAUDE.md
