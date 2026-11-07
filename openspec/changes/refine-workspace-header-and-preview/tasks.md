# Tasks: 顶栏按优先级降级 + 预览卡片表头溢出

## 1. 共享原语

- [x] 1.1 `src/components/ui/card.tsx`：`CardHeader` 基础类补 `grid-cols-1`，保留 `has-data-[slot=card-action]:grid-cols-[1fr_auto]`
- [x] 1.2 在浏览器确认 `CardHeader` 表头行宽 ≤ 卡片内宽（预览卡片 320px / 384px 两档）

## 2. 预览卡片

- [x] 2.1 `PreviewPanel`：表头标题区 `min-w-0` 收窄，控件 `shrink-0` 留在卡内（`sidebar` 与 `dock` 都验证）
- [x] 2.2 结构测试：`CardHeader` 基础类含单列轨道

## 3. 配置步去掉重复入口

- [x] 3.1 `ConfigStep`：删除「返回书库」按钮与 `onSelectSection` prop、清理 `ArrowLeft` / `Button` 无用导入
- [x] 3.2 `App.tsx`：不再向 `ConfigStep` 传 `onSelectSection`
- [x] 3.3 更新 `tests/components/configSections.test.tsx`（原来的「处理段留返回书库入口」改为「不再渲染返回书库」）

## 4. 工作台顶栏降级

- [x] 4.1 `AppHeader` compact：根节点加 `@container`；品牌字标 `< 512px` 隐藏、只留印章
- [x] 4.2 `BrandMark`：支持只显示印章（不渲染字标）
- [x] 4.3 `ModelSwitcher`：`< 992px` 只留图标；文案 / 思考强度 / 用量 / 箭头按阈值隐藏；`aria-label` 保留完整模型名
- [x] 4.4 `LanguageSwitcher` / `DarkModeToggle`：新增 `compact` 模式，文字 `< 736px` 隐藏（经典页头行为不变）
- [x] 4.5 新增 `HeaderCollapseMenu`：`< 512px` 折叠同步状态 / 语言 / 主题 / 登出；`SyncStatusIndicator` 抽出 `useSyncStatusView` 共用
- [x] 4.6 `UnifiedStatusBar`：`meta` 变体里的 `总结` 徽章 `< 512px` 隐藏；`full` 变体根节点加 `@container`（保证模型 chip 的容器查询生效）
- [x] 4.7 `ResultTitle`：`singleLine` 模式——不换行、标题与作者各自 truncate；作者 `< 640px` 隐藏
- [x] 4.8 `App.tsx`：书名区 `min-w-0`、`< 288px` 隐藏；传 `singleLine`

## 5. 测试

- [x] 5.1 结构守卫：`AppHeader` 折叠菜单、品牌字标阈值、模型 chip 阈值类名
- [x] 5.2 行为测试：`ModelSwitcher` 窄容器下文案隐藏但 `aria-label` 含模型名
- [x] 5.3 `pnpm exec vitest run` 相关文件通过
- [x] 5.4 `pnpm test` 全量 + `pnpm build`（含 tsc）通过

## 6. 真实浏览器验收

- [x] 6.1 390：顶栏不超过两行、书名可见且不折行、无越界元素
- [x] 6.2 512 / 736 / 992 / 1280：逐档确认降级顺序与阈值
- [x] 6.3 配置步预览卡片：长章节标题 + 字号控件不越界
- [x] 6.4 截图归档到验收记录

## 7. 文档与提交

- [x] 7.1 `openspec validate refine-workspace-header-and-preview --strict` 通过
- [x] 7.2 `AGENTS.md` 补「顶栏降级顺序与阈值」「CardHeader 单列轨道」
- [x] 7.3 清理临时验收夹具，`git add` 相关文件后 commit（pre-commit 自动 bump BUILD_VERSION）
- [x] 7.4 `git push -u origin HEAD` 并收尾汇报


