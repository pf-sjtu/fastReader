# 阅读工作台 · 交接说明

> 对应 openspec 变更：`openspec/changes/add-reader-workspace/`（任务勾选见 `tasks.md`，规格见 `specs/*`）。
> 最后更新：2026-10-31。分支 `master`，均已推送。

## 1. 已完成（均有测试，已在真实浏览器验证）

| 阶段 | 内容 | 关键位置 |
|---|---|---|
| 实体配色 | `--entity-1..10` token；形状=类型；正文标注同色 | `src/index.css`、`src/charts/linking/entityColors.ts`、`remarkEntityMark.ts` |
| 工作台 | 目录 / 正文 / 可拖拽对照栏三栏独立滚动；专注模式 `\`；移动端抽屉 | `src/components/workspace/` |
| 联动 | 悬停(300ms)/单击展开实体卡、事件卡；**防剧透折叠（折叠内容不进 DOM）**；跳转到正文第 N 次出现/时间线/图谱，到达闪烁，「返回上一位置」 | `useArtifactNavigation.ts`、`EntityCard.tsx`、`charts/linking/entityCard.ts` |
| 图谱/时间线 | 与正文同色、类型图例过滤、本章高亮、「截至本章」渐进模式、点击展开卡片 | `charts/plugins/person-graph/*`、`entity-timeline/` |
| 目录栏 | 拖宽 160–360、折叠为 14px 竖向圆点进度条（每章一点；>40 章只画线）、状态持久化；对照栏页签过多时横向滚动并自动滚入当前页签（`CompanionDock`） | `NavRail.tsx`、`ResizeHandle.tsx`(`edge`) |
| 书库 | WebDAV 索引全生命周期（迁移/合并/失效/GC/体积上限/镜像 SWR）、封面墙、继续阅读、已精读书一键直达 | `src/services/library/*`、`src/components/library/*`、`src/hooks/useLibraryOpen.ts` |
| 书架组织 | 分类/排序/带种子随机推荐/换一批/与继续阅读去重 | `libraryOrganize.ts`、`LibraryView.tsx` |
| 书卡设计 | 书名·作者·章数在封面内部底部阴影层；EPUB 与体积不占位 | `BookCard.tsx`、`BookCover.tsx` |
| 元数据与封面 | 用户触发补全（并发 2、可取消）；EPUB 自带 ZIP 读 OPF；真实封面 webp 懒加载（队列并发 2）；索引 gzip 单文件 | `bookMeta.ts`、`libraryFill.ts`、`coverLoader.ts`、`gzip.ts` |
| 选章页 | token/费用预估（价格未知不估金额，不估耗时） | `services/runEstimate.ts` |
| 学习功能 | 速读包/自测/问书：提示词、zod 解析、`AIService` 方法、检索与引用、store+持久化、三个页签与三档阅读深度 | `src/study/*`、`src/components/study/*`、`services/prompts/study.ts`、`aiService.ts` |

## 2. 验证命令（交接后先跑一遍）

```bash
pnpm test            # 1296 通过（entityLinking 的 300 章耗时断言在全量并行时偶发超时，单跑稳定） / 21 跳过
pnpm exec tsc -b
pnpm lint
pnpm build
pnpm check:functions
pnpm dlx @fission-ai/openspec validate add-reader-workspace --strict
```

提交约定见根 `CLAUDE.md`（修改 → 测试 → 提交 → 推送；`src/buildInfo.ts` 由 pre-commit 自动 bump；不要 stage `.claude/settings.local.json`、`output/`、`.claude/launch.json`）。

## 3. 未完成（按优先级）

### 3.1 阶段 6 的剩余项（主体已完成并接线）
- 已完成：速读/自测/问书三个对照栏页签 + 正文顶部三档深度切换；学习数据存 IndexedDB（键 = 书名+章节总结长度的指纹，总结变了自动失效）；生成均手动触发、可取消、生成前显示用量预估；换书后旧结果丢弃。
- **未做**：`{name}-学习包.json` 云同步（仿 `autoSyncService.syncChartsJson`）；闪卡；错题并入笔记页签（依赖阶段 7）；选中正文后"问书"；问书流式输出（需先给 provider 层加流式接口）。
- 入口与结构：`src/study/`（schema/retrieve/depth/persistence/studyStore）、`src/components/study/`（DepthSwitch、StudyKitPanel、QuizPanel、AskPanel）、`ReaderWorkspace.tsx`（`tabs` 与 `displaySummary`）。
- **端到端未测**：没有用真实模型跑过三个生成方法；提示词效果（尤其自测题质量、问书依据不足时的措辞）需要用真实模型人工验收。

### 3.2 阶段 7：笔记与导出
划线/批注（锚点 = 章节 id + 片段 + 前后文）、`{name}-笔记.json`、Markdown 导出、离线 HTML、命令面板 Ctrl/⌘+K、j/k 等快捷键、断点续读。**尚未开始**。

### 3.3 阶段 8 与遗留
- **5.1 顶栏单行化**（`AppTopBar` 分段导航「书库 · 阅读」+ 处理进度胶囊）未做。`App.tsx` 拆分已完成（369 行；子视图在 `src/components/app/`，副作用在 `src/hooks/useApp*.ts`）；拆分只在 jsdom 冒烟 + tsc/lint/build 下验证，**移动端抽屉与工作台模式没在真实浏览器里走过**。
- 「暂无内容可上传」已修：从云缓存/历史/书库打开的书没有本地 `File`，上传按钮改为此时不渲染（`UploadToWebDAVButton`）。
- 时间线未做「读到此处之后」的未来事件变淡；章节卡（`LinkCard` 的章节变体）未做。
- 触控目标：书架筛选 chip 高 32px，< 40px 标准；亮色主题下图谱/卡片、手机底部抽屉里的卡片未走查。
- 防误触守卫（触屏不开悬停卡 / 框选文字不开卡）只测了判断函数，事件接线无集成测试。
- **端到端未测**：真实 WebDAV 上的书库刷新/补全/封面同步（只有内存 IO + 夹具页验证）；学习功能没有真实模型调用验证。
- 收尾：更新 `README.md` 与项目 `CLAUDE.md`（书库、学习功能、`.juhua/` 目录约定）；阶段结束后按全局规范 fan out 独立 Reviewer（devils_advocate，需指定模型）。

## 4. 设计要点与坑（避免重复踩）

- **防剧透口径**：严格 `e < c`（当前章及之后折叠；章节未知=折叠）。图谱渐进模式是 `e ≤ c`（含当前章），界面上有说明。折叠内容必须不进模型/DOM（测试有泄漏断言）。
- **书库 GC**：写回时先与远端合并，**合并之后**再剔除 `removed`，否则远端旧副本会让 GC 失效（有回归测试）。扫描失败绝不 GC。
- **WebDAV**：`webdavService` 内部 `runExclusive` 串行；所有批量动作（封面、补全）都限并发 2；列目录用 `getDirectoryContents(syncPath, true)`；写文件自动逐级建目录。
- **颜色**：`getComputedStyle` 对 `oklch()` 返回原串，`cssColorToHex` 现用 canvas 读回 sRGB（jsdom 无 canvas 时回落 DOM 解析）。
- **react-refresh 规则**：组件文件只导出组件；纯函数放同目录 `.ts`（`anchor.ts`、`coverSlot.ts`、`labels.ts`）。
- **测试**：无 testing-library，用 `tests/uiTestUtils.tsx`；jsdom 无 `Blob.stream()`，压缩工具走 `CompressionStream` 的 writer（`gzip.ts#pipeBytes`）；断言中文文案的 UI 测试要先 `i18n.changeLanguage('zh')`。
- **变异验证**：新增测试后临时破坏被测逻辑确认会失败再还原（已对防剧透、GC、拖拽方向、自动载入竞态、换一批等做过）。
- **浏览器验证**：隐藏窗格里 rAF/滚动事件不触发；用 `resize_window` + JS 探针；临时夹具页放 `tmp/`，**lint/提交前删除**（会触发 react-refresh 规则）。wrangler 本地在 ARM64 缺 workerd，改用 vite 夹具。
- **Windows 脚本**：含 `\n`/正则的 Python 补丁先落盘 `tmp/*.py` 再执行，且字符串里的 `\n` 要写成 `\\n`（否则被转成真换行，曾破坏过源码）。
