# Tasks: 修复设置对话框窄屏溢出与「获取章节」事件传参

## 1. 规格

- [x] 1.1 写 `proposal.md` / `design.md` / 两个能力 delta（`settings-dialog`、`book-upload`）
- [x] 1.2 `openspec validate fix-settings-overflow-and-extract-action --strict` 通过

## 2. 修复「获取章节」

- [x] 2.1 `FileUploadCard` 的 `onClick` 改为 `() => onExtractChapters()`（不把事件当文件）
- [x] 2.2 `tests/components/uploadCardUi.test.tsx` 加回归：有文件时点击，处理函数收到的实参长度为 0；无文件时按钮禁用、不触发
- [x] 2.3 真实 EPUB（`tmp/acceptance-book.epub`）实测：选中后自动提取成功（共 1 章），再点「获取章节」无「不支持的文件格式」

## 3. 修复设置对话框溢出

- [x] 3.1 `src/components/ui/dialog.tsx` 的 `DialogContent` 基类补 `grid-cols-1`（单列 minmax(0,1fr) 轨道），加一行注释说明原因
- [x] 3.2 `ConfigDialog`：`DialogContent` / `ScrollArea` / `Tabs` / `TabsContent` 补 `min-w-0` 约束，页签条换行后不撑宽
- [x] 3.3 结构守卫测试：断言 `DialogContent` 基类含 `grid-cols-1`（防重新生成 shadcn 组件时回退）
- [x] 3.4 页签条移出滚动区（模型列表滚到底部仍能切页签）；切换页签用 `key={tab}` 让内容回到顶部
- [x] 3.5 页签触发器高度写死 `h-9`：基类 `h-[calc(100%-1px)]` 在折行容器里按整条高度算，第二行会压住内容区
- [x] 3.6 `AlertDialogContent` 同样补 `grid-cols-1`（长文件名/URL 的确认框有同样风险），加结构守卫
- [x] 3.7 模型行右控件（温度/开关/删除）加 `ml-auto`：窄屏换行时贴右，不再吊在左半边

## 4. 真实浏览器验收（jsdom 测不到宽度）

- [x] 4.1 390×844：逐页签（AI 服务商 / 处理设置 / 提示词编辑器 / WebDAV / 字体 / 导出导入）量 `dialog.scrollWidth === clientWidth`（369 = 369）、无元素 right > 视口，六个页签都在
- [x] 4.2 390×844：展开 Navira 的「模型 (10)」：列表 287 = 287、13 行无误、右控件右边界 314 < 337
- [x] 4.3 390×844：打开服务商向导（两步均量）与内嵌的章节预览，`dialog` 369 = 369、无越界
- [x] 4.4 1280×900：逐页签复测（`dialog` 672、页签单行 44px、无越界），桌面排版未回归
- [x] 4.5 验收中发现的其他溢出就地修复并记录：页签条随内容滚走（→ 常驻）、触发器折行重叠（→ `h-9`）、右控件换行后左吊（→ `ml-auto`）
- [x] 4.6 修复 dev server 被临时文件拖崩：`vite.config.ts` 的 `server.watch.ignored` 排除 `tmp/`、`.tmp/`、`output/`、`log/`、`openspec/` 与 `*.tmpdir`（代理原子写的临时目录会让 chokidar EBUSY 退出）

## 5. 测试与文档

- [x] 5.1 `pnpm test`：181 文件 / 2494 用例全过（JSDOM 结构守卫 + 真 EPUB 端到端）
- [x] 5.2 `pnpm build`（含 `tsc`）通过
- [x] 5.3 `AGENTS.md` 补三条：对话框基础类保留 `grid-cols-1`；页签折行时触发器高度写死、页签条放滚动区外；新增对话框在 390px 验收 `scrollWidth === clientWidth`
- [x] 5.4 清理 `tmp/qa` 夹具与验收用 EPUB、关闭 QA dev server 后台任务（`tmp/` 已被 .gitignore 覆盖）

## 6. 提交

- [ ] 6.1 `git add` 相关文件（不含 tmp/qa、output/），提交信息写动机与根因
- [ ] 6.2 `git push -u origin HEAD`
