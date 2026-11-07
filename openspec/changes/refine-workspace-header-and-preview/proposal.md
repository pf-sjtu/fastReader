# Change: 顶栏按优先级降级 + 预览卡片表头溢出（并去掉重复的书库入口）

## Why

三个已核实的问题（第一、三个来自用户截图与原话，第二个来自源码与浏览器几何测量）：

1. **预览卡片表头溢出**（用户截图，2202×1404）：`PreviewPanel` 的表头把「— 16px +」、全屏、关闭挤到卡片右边界之外，贴着视口右缘被裁切。
   - 根因是共享原语：`src/components/ui/card.tsx` 的 `CardHeader` 基础类带 `grid`、`grid-rows-[auto_auto]`，但没有列轨道；隐式单列是 `minmax(auto, max-content)`，于是标题行（`truncate` 的 max-content 是整行不换行标题 + 右侧 `shrink-0` 的 5 个控件）直接把轨道撑到内容宽度，固定宽度卡片（`w-80` / `lg:w-96`）被撑破，控件溢出到卡外。
   - 与上一轮设置弹窗同一个根因：只写 `grid` 的容器不设列轨道时，子项的 min/max-content 会决定轨道宽度。修复应落在共享原语上，而不是给预览卡片单独打补丁。

2. **工作台顶栏在窄宽度下折行严重**（用户截图 + 原话「缩小展示的时候，头部的自适应还需要优化，比如首先应该把模型选择给 icon 化，然后是其他，然后再折叠，最后才不显示书名」「对了，应用名称也可以优先影藏」）：
   - 顶栏右侧是 `shrink-0` 的固定组：`总结` 徽章 → 模型 chip（模型名 + 思考强度 + token 用量）→ 同步状态 + 登出 → 语言（国旗 + 文字）→ 主题（图标 + 文字）。
   - 书名块用 `min-w-0 shrink`，于是所有压缩都落在它身上：书名被压成约 110px 宽的窄列、`break-words` 让每行只放两三个字，「《邓小平时代》解析结果 / 作者:傅高义 | 共 1 章」折成 4 行，页头高度失控。
   - 期望的降级顺序（用户明确给出）：**模型选择器先 icon 化 → 其它控件 icon 化 → 收进折叠菜单 → 最后才隐藏书名**；品牌字标（咀华 / JUHUA）可以比书名更早隐藏。

3. **配置步有重复的书库入口**（用户截图 + 原话「这里右边第一个圈内是不需要的因为左上角已经可回到书库了」）：`ConfigStep` 在 `FileUploadCard` 之前渲染一个右对齐的「← 返回书库」按钮；而顶部三阶段导航「书库 / 设置 / 处理」已经承担同一件事，同屏两个入口只会占地方。

## What Changes

- **新增能力 `workspace-header`**：工作台顶栏按固定优先级降级，全部用容器查询（容器 = 顶栏自身宽度），不用 JS 测量、不产生布局抖动：
  - `< 992px`：模型切换器 icon 化（只留图标，模型名 / 思考强度 / 用量 / 箭头隐藏，`aria-label` 仍带完整模型名）；
  - `< 736px`：语言只留国旗、主题只留图标（其它控件同步 icon 化）；
  - `< 512px`：同步 / 语言 / 主题折叠进一个「更多操作」菜单，品牌字标隐藏（只留印章），`总结` 徽章隐藏；
  - `< 288px`：才隐藏书名。
  - 书名单行显示（`truncate`，不再 `break-words` 折行）；作者与章数在 `< 640px` 时先隐藏。
- **新增能力 `preview-panel`**：预览卡片（侧栏 `sidebar` 与对照栏 `dock`）的表头不得横向溢出；`CardHeader` 使用单列轨道，标题按省略号收窄，字号 / 全屏 / 关闭控件留在卡片内。
- **新增能力 `config-step`**：书库入口只由三阶段导航提供，配置步不再渲染「返回书库」按钮，并清掉随之无用的 props 接线。
- **共享原语修正**：`CardHeader` 基础类补 `grid-cols-1`（等价 `minmax(0,1fr)`），与上一轮 `DialogContent` / `AlertDialogContent` 一致；`has-data-[slot=card-action]` 的两列变体保留。
- **测试**：
  - 结构守卫：`CardHeader` 基础类必须含单列轨道；`ConfigStep` 不再出现「返回书库」；顶栏降级类名与折叠菜单存在；`ModelSwitcher` 文案在窄容器隐藏而 `aria-label` 保留。
  - 真实浏览器验收：390 / 512 / 736 / 992 / 1280 五档宽度下，顶栏不高过一行（允许两行内），书名栏不出现 4 行折行，控件不越界。

## Impact

- Affected specs: 新增 `workspace-header`、`preview-panel`、`config-step`
- Affected code: `src/components/ui/card.tsx`、`src/components/sections/PreviewPanel.tsx`、`src/components/app/AppHeader.tsx`（新增折叠菜单）、`src/components/BrandMark.tsx`、`src/components/ModelSwitcher.tsx`、`src/components/LanguageSwitcher.tsx`、`src/components/DarkModeToggle.tsx`、`src/components/SyncStatusIndicator.tsx`、`src/components/UnifiedStatusBar.tsx`、`src/components/sections/ResultTopBar.tsx`、`src/App.tsx`、`src/components/app/ConfigStep.tsx`、`tests/components/*`、`tests/fixUiE2e.test.tsx`、`tests/designSystem.test.ts`
- 不影响数据结构、接口、存储与服务端；纯前端布局与导航入口收敛。
- 复用上一轮的验收方式：本机 Windows ARM64 缺 `@cloudflare/workerd-windows-64`，无法 `wrangler pages dev`，用 mock `/api/*` 的 vite 夹具 + Playwright 做同口径验收，验收后清理。
