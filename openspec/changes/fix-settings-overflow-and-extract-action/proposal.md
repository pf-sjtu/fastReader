# Change: 修复设置对话框窄屏溢出与「获取章节」把点击事件当文件

## Why

两个已核实的问题（均在真实浏览器 / 源码复现，不是猜测）：

1. **设置对话框在窄屏横向溢出**（实测 390×844，Playwright + mock API）：
   - `[role="dialog"]` 宽 371（left 10 / right 380），但 `scrollWidth` = 653；`[role="tablist"]` 宽 621、right 647，越出视口 257px；全弹窗 74 个元素 right > 视口宽。
   - 根因是共享原语：`src/components/ui/dialog.tsx` 的 `DialogContent` 基础类带 `grid` 但没给列轨道，隐式单列按 max-content 定宽；`ConfigDialog` 的 6 个 `flex-1 min-w-fit` 页签触发项 min-content 合计约 621px，把这条轨道撑到 621，连带 DialogHeader / ScrollArea / 各页签内容一起被拉宽（与哪个页签无关）。
   - 桌面 1280×900 复测：dialog 672、tab 条 623、模型列表 596，全部在视口内，唯一 `scrollWidth > clientWidth` 的是 `truncate` 标签（预期行为）。**只有窄屏（约 <700px）会炸。**
   - 展开「模型 (10)」后越界元素从 74 涨到 217：模型行左块 374 + 右控件 176 = 550，在 311px 可用宽度内侧溢。

2. **点击「获取章节」报「不支持的文件格式，请选择 EPUB、PDF、TXT 或 MD」**：
   - `src/components/sections/FileUploadCard.tsx:112` 把 `onExtractChapters` 处理函数直接挂在 `onClick` 上：`<Button onClick={onExtractChapters}>`。
   - `useBookFile.extractChapters(overrideFile?: File)` 的第一个形参本意是「用这张文件而不是 hook 里的 file」，React 却把点击事件对象传了进去；`detectBookFormat(SyntheticEvent)` 读不到 `name/type` 返回 null，`isPlainTextBook(event)` 也 false，于是抛出文案。
   - 同类审计：`src` 下 40+ 处 `onClick={handler}` 只有这一处的处理函数接受可选参数，其余都是 `() => void`（所以只有这个按钮炸）。

## What Changes

- **新增能力 `settings-dialog`**：设置对话框与其中所有内容（6 个页签、模型列表、服务商向导）在窄屏下不得把对话框横向撑出视口；页签条在窄屏换行而不是横向溢出。
- **新增能力 `book-upload`**：点击「获取章节」必须以当前已选文件为输入，点击事件对象不得被当作文件；无文件 / 提取中 / 处理中按钮保持禁用。
- **共享原语修正**：`DialogContent` 基础类补 `grid-cols-1`（等价 `minmax(0,1fr)`），让所有对话框的子项都不能按 min-content 撑宽弹窗；这是结构性的根治，而不是给某一个弹窗打补丁。
- **回归测试**：
  - 组件行为测试：渲染 `FileUploadCard` 并点击「获取章节」，断言处理函数**收到的实参为空**（修复前收到的是 SyntheticEvent）。
  - 结构守卫：`DialogContent` 基础类必须含单列轨道，防止将来重新生成 shadcn 组件时把溢出问题带回来。
- **真实浏览器验收**：390（窄屏）、1280（桌面）逐页签 + 展开 10 个模型 + 打开服务商向导复测 `scrollWidth`/越界元素；发现的其他溢出就地修。

## Impact

- Affected specs: 新增 `settings-dialog`、`book-upload`
- Affected code: `src/components/ui/dialog.tsx`、`src/components/sections/FileUploadCard.tsx`、`src/components/project/ConfigDialog.tsx`、`tests/components/uploadCardUi.test.tsx`、`tests/fixUiE2e.test.tsx`
- 不影响数据结构、接口、存储与服务端；纯前端布局与事件接线。
- 验收工具限制：本机 Windows ARM64 缺 `@cloudflare/workerd-windows-64`，无法 `wrangler pages dev`；用 `tmp/qa/vite.qa.config.mjs`（mock `/api/*`）+ Playwright 做同口径验收，验收后清理。
