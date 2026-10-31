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
- [ ] 3.1 `ResizeHandle` + `useResizableWidth`
- [ ] 3.2 `ReaderWorkspace` + `CompanionDock` + `MobileCompanionDrawer`
- [ ] 3.3 `ResultsSection` 瘦身；`PreviewPanel variant="dock"`；`MarkdownCard` 按钮精简与排版
- [ ] 3.4 专注模式

## 4. 联动与标注
- [ ] 4.1 图谱高亮/淡化/居中、渐进模式、图例与类型过滤
- [ ] 4.2 时间线本章高亮、点事件跳章
- [ ] 4.3 `EntityDetailPane`、人物志、本章出场条
- [ ] 4.4 正文标注 + `EntityHoverCard`

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
