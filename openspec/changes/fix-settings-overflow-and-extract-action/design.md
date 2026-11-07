# Design: 设置对话框溢出与「获取章节」事件传参

## Context

- 弹窗是 shadcn/ui 的 `Dialog`，`DialogContent` 基础类是 `grid`（无显式列）。CSS Grid 的隐式列在 `grid-template-columns` 未声明时按 `auto` 轨道参与尺寸计算：单列 auto 轨道会按子项 **max-content** 定宽，再把弹窗撑宽。
- 设置页签条用 `flex flex-wrap w-full h-auto` + 每项 `flex-1 min-w-fit`：整体 max-content ≈ 621px（6 个中文标签 + 内边距），因此窄屏时轨道把整个弹窗拉到 621px 宽，内部所有块跟着变宽、超出 95vw。
- jsdom 没有布局引擎，`scrollWidth` 恒为 0，无法在单测里量宽度；项目已有的 UI 测试用 `react-dom/client + act` 手写（无 @testing-library），移动端守卫靠断言结构性类（如 `tests/fixUiE2e.test.tsx` 的 PromptEditor 页签网格）。
- 本机无法跑 `wrangler pages dev`（ARM64 缺 workerd），真实浏览器验收走 `tmp/qa/vite.qa.config.mjs` + mock `/api/*` + Playwright。

## Goals / Non-Goals

- Goals:
  - 窄屏（390 / 360）打开设置、切完 6 个页签、展开 10 个模型、打开服务商向导，都没有元素越出视口。
  - 「获取章节」点击不再把事件对象当文件。
  - 溢出修复发生在**共享原语**上，未来新增对话框不再重复踩坑。
- Non-Goals:
  - 不重做设置的信息架构、不新增页签、不调整配色与视觉风格。
  - 不引入 Playwright/cypress 作为单测依赖（体积与 CI 成本不成比例）。
  - 不改动 `Grid/Tabs` 的交互语义。

## Decisions

1. **在 `DialogContent` 基类补 `grid-cols-1`，而不是逐个弹窗加 `overflow-hidden`**
   - `grid-cols-1` 展开为 `grid-template-columns: repeat(1, minmax(0, 1fr))`，轨道不再由 max-content 决定，子项也拿到 `min-width: 0` 的语义（可收缩、可换行），这是根治。
   - `cn()` 是 tailwind-merge：显式写了 `grid-cols-N` 或 `flex` 的弹窗（如 `BatchProcessingDialog` 用 `flex flex-col`）仍以自身 className 为准，不会被基础类覆盖。
   - 备选：给每个 `DialogContent` 单独加 `overflow-x-hidden` —— 只是把溢出藏起来，里面的 tab 仍被裁切（已实测 tab 条目右侧被切），否决。

2. **页签条保持 `flex-wrap` 换行，不改成横向滚动**
   - 恢复 minmax(0,1fr) 后，6 个 `min-w-fit` 触发项在 335px 内容宽下自然排成 2 行（每行 3 个），全部可见、可点。
   - 备选：`overflow-x-auto` 单行横滚 —— 会藏起一半页签，窄屏用户不易发现「提示词编辑器/WebDAV」，否决。

3. **「获取章节」在调用点包一层 `() => onExtractChapters()`**
   - 保持 `FileUploadCard` 的 `onExtractChapters: () => void` 契约不变；不在 hook 里加 `instanceof File` 防御（`src` 审计后只有这一处会传事件，加防御属于过度设计，且遮住真正的调用点错误）。
   - 回归测试放在 `tests/components/uploadCardUi.test.tsx`：点按钮后断言 spy 的 `mock.calls[0]` 长度为 0。修复前该测试失败（收到 SyntheticEvent），修复后通过，是真正的行为守卫。

4. **溢出用两层验收**
   - 单测：结构守卫（`DialogContent` 基类含 `grid-cols-1`）+ 组件行为（点击不传参）。
   - 真机：Playwright 在 390 / 1280 量 `scrollWidth` 与越界元素，逐页签记录；这是 jsdom 测不到的部分，作为验收证据写进 commit 说明。

## Risks / Trade-offs

- `grid-cols-1` 可能改变个别弹窗的排版（例如原本靠 auto 轨道让子项自然宽度）→ 逐个弹窗回归：设置、书库详情、处理历史、批量处理、WebDAV 浏览器、产物清理；其中用 `flex` 的不受影响。
- 页签换行会让弹窗头部变高约 36px → 内容区 `max-h-[60vh]` 仍可滚动，小屏滚动一次即可，可接受。
- 结构守卫断言 className 字符串，属于「脆测试」；但它锁的是 shadcn 原语被重新生成时的关键差异，与项目既有的结构性移动端守卫一致。

## Migration Plan

无数据迁移。回滚只需还原 `dialog.tsx` 与 `FileUploadCard.tsx` 两处（各 1 行），测试随之失败。

## Open Questions

- 无。页签换行 vs 横滚已按「全部可见」定案；如需横滚交互再另开变更。
