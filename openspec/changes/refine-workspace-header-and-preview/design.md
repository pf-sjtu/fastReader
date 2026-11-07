# Design: 顶栏降级顺序与卡片表头轨道

## 决策 1：用容器查询，而不是视口断点或 JS 测量

顶栏的可用宽度并不等于视口宽度：外层 `px`、品牌区、工具组都先吃掉一截，窗口宽但工具组占得多时照样挤。视口断点（`sm:` / `md:`）会把「窗口 800px 但顶栏只剩 300px 可用」误判成宽屏；JS 测量（`ResizeObserver` 写入 state）会引入首帧错误宽度与重渲染，且 SSR / 测试环境难复现。

因此：在 `AppHeader` 的 compact 根节点上加 `@container`，所有降级类用 `@[Npx]:` 变体，由 CSS 自己算「这块容器现在多宽」。项目已在 `ResultTopBar` / `ExportPackButton` / `ReaderWorkspace` 用了同一套写法（`@[390px]:`、`@[540px]:`），沿用即可。

注意：容器查询只在有 `container-type` 祖先时生效。经典布局的 `UnifiedStatusBar` 也用了 `ModelSwitcher`，所以它的根节点同样加 `@container`；否则 `@[992px]:` 永远不会匹配，模型名会永久隐藏。

## 决策 2：阈值与降级顺序

容器宽度 ≈ 视口宽度减去外边距；取整到熟悉的尺寸：

| 阈值 | 动作 | 理由 |
| --- | --- | --- |
| `< 992px` | 模型 chip → 图标（`Brain`，`aria-label` 保留完整模型名）；思考强度、token 用量、箭头隐藏 | 模型名最长（`deepseek/deepseek-v4.1-flash-eco` 一类），是顶栏第一大头；用户要求它最先 icon 化 |
| `< 736px` | 语言只留国旗、主题只留图标；`总结` 徽章保留（还很短） | 「其它控件 icon 化」阶段 |
| `< 512px` | 同步 / 语言 / 主题折进「更多操作」菜单；品牌字标（咀华 / JUHUA）隐藏、只留印章；`总结` 徽章隐藏 | 「然后是折叠」阶段；品牌字标按用户要求比书名先隐藏 |
| `< 640px` | 作者与章数隐藏 | 书名的附注，比书名本身次要 |
| `< 288px` | 书名整块隐藏 | 「最后才不显示书名」；实际上手机窄屏（≥ 352px）仍能看到书名 |

书名单行：`ResultTitle` 加 `singleLine`，去掉 `flex-wrap` 与 `break-words`，标题与作者各自 `truncate`。这样任何宽度下都不会出现「每行两三个字」的折行堆叠。

## 决策 3：折叠菜单共享同一份状态，不复制逻辑

`HeaderCollapseMenu` 里的语言 / 主题 / 同步状态 / 登出都复用现有 store 与 i18n：
- 语言：`i18n.changeLanguage`，选项与 `LanguageSwitcher` 同一份 `languages` 清单（导出复用）。
- 主题：`useTheme` + `useIsDarkMode`，与 `DarkModeToggle` 同语义（基于实际生效主题取反）。
- 同步状态：把 `SyncStatusIndicator` 的状态映射抽成 `useSyncStatusView()`，菜单与图标指示器共用，避免两处文案漂移。
- 登出：`sharedApi.logout()` 后整页刷新（与指示器一致）。

## 决策 4：`CardHeader` 补单列轨道，而不是逐个卡片加 `overflow-hidden`

溢出的根因是「`grid` 没写列轨道 → 隐式 auto 轨道按 max-content 定宽」，与上一轮 `DialogContent` 完全同构。逐个卡片加 `overflow-hidden` 只能裁掉被推出去的控件（看起来像控件消失），并不能让标题 truncate 生效——因为 flex 行本身已经被撑到卡外了。

所以改共享原语：`CardHeader` 基础类补 `grid-cols-1`（`minmax(0,1fr)`）。`CardAction` 的两列布局靠 `has-data-[slot=card-action]:grid-cols-[1fr_auto]` 变体保留；全仓库目前没有使用 `CardAction` 的卡片，改完在浏览器确认无回归即可。

## 决策 5：删掉配置步的「返回书库」

三阶段导航 `书库 / 设置 / 处理` 是唯一入口：从「处理」段点「书库」会切段并回到书库视图。配置步的按钮是历史遗留，删按钮的同时把 `onSelectSection` prop 与 `App.tsx` 的传参一并清掉，避免留下无用接口。

## 风险

- 容器查询在 jsdom 里不生效，结构测试只能断言类名存在，真实几何必须靠浏览器验收兜底（沿用上一轮 Playwright + mock API 的做法）。
- 顶栏降级后，`@container` 的 inline-size 包容可能影响 flex 换行计算——需在 390 / 512 / 736 / 992 / 1280 实测页头高度与越界元素，而不只断言类名。
- 模型 chip icon 化后仍必须可点开换模型；`aria-label` 与 `title` 要保住可发现性。
