## ADDED Requirements

### Requirement: 语义化的文字角色
界面 SHALL 只通过有限的「文字角色」排版，角色由 `index.css` 的工具类（`.t-display / .t-title / .t-section / .t-label / .t-body / .t-caption`）承载，不得在业务组件里直接写 `text-lg`、`text-[13px]`、`font-medium` 等零散组合。角色定义：`t-display`（品牌/登录，衬线 24–36）、`t-title`（页面/弹窗/抽屉标题，衬线 18 semibold）、`t-section`（分部标题，无衬线 14 semibold，同一容器内统一）、`t-label`（表单与分组小标题，12 medium muted）、`t-body`（14/15）、`t-caption`（12 muted）。衬线 SHALL 只用于 display / title 与书名、章节名等「内容标题」，分部标题与按钮不用衬线。

#### Scenario: 同类标题同一外观
- **WHEN** 比较设置各页签、书库、对照栏、实体卡、弹窗中的「分部标题」
- **THEN** 字体、字号、字重、颜色、上下间距完全一致（现状：`h3 text-lg`、`h3 text-base font-medium`、`h4 text-sm`、`h3 text-xs muted`、CardTitle 默认各不相同）

#### Scenario: 业务组件不写零散字号
- **WHEN** 静态检查 `src/components/**`
- **THEN** 不出现 `text-lg|text-xl|text-2xl|text-[Npx]` 用在标题上；标题只用角色类（`CardTitle` / `DialogTitle` / `SheetTitle` 的默认样式即 `t-title`）

### Requirement: 统一的标题样式
`CardTitle`、`DialogTitle`、`SheetTitle` 的默认样式 SHALL 就是 `t-title`（在 `ui/` 层改默认值，业务处不覆写字号）；分部标题与分组小标题直接使用 `t-section` / `t-label`。图标与标题的间距、图标尺寸（标题处 16px）SHALL 统一。

#### Scenario: 新增一个面板
- **WHEN** 开发者新增面板
- **THEN** 使用 `CardTitle`/`DialogTitle` 即得到与其余面板一致的标题，无需手写 className

### Requirement: 状态色走语义 token
成功 / 警告 / 危险 / 信息 SHALL 使用 `--success / --warning / --danger / --info` 及其 `-foreground / -muted` token（深浅主题各一套），业务组件不得出现 `text-red-500`、`bg-green-50`、`text-amber-700` 等硬编码调色板色。`--danger` SHALL 是 `--destructive` 的别名（两者始终同值，`--danger-foreground / --danger-muted` 同理别名到 `--destructive-*`）：规格口径写 `--danger`，代码沿用 shadcn 的 `--destructive`。实心状态底色上的文字 SHALL 用对应 `-foreground`；淡底（`-muted`，由 `color-mix` 与 `--card` 混合而来，亮色 14% / 深色 18%）上的文字 SHALL 用状态色本身。深色主题下状态色已提亮，实心底上的文字改用墨色，`--destructive-foreground` 仍近白。

#### Scenario: 深色主题的成功提示
- **WHEN** 在深色主题显示成功状态
- **THEN** 颜色来自 `--success` token，对比度 ≥ 4.5:1，不依赖 `dark:` 手写变体

### Requirement: 形状与尺寸刻度
圆角 SHALL 只有三档：控件（按钮/输入/标签）`rounded-md`、容器（卡片/弹窗/面板）`rounded-lg`、胶囊与头像 `rounded-full`；不得出现裸 `rounded`、`rounded-sm`、`rounded-xl`、`rounded-2xl`（封面、图表画布等有明确理由的例外集中在 `design-exceptions.md` 登记）。图标默认 16px（`size-4`），紧凑工具栏 14px（`size-3.5`），不使用 12px 图标。同一工具栏内按钮高度 SHALL 一致（默认 `sm` = 32px，触控设备 ≥ 40px）。

#### Scenario: 同一工具栏
- **WHEN** 检查章节卡工具栏、图表工具栏、书库筛选行
- **THEN** 按钮高度、图标尺寸、圆角一致

### Requirement: 一致的容器与间距
卡片、面板、弹窗内边距 SHALL 取自 4 的倍数的有限刻度（8/12/16/24），分部之间的垂直间距统一为 `gap-4`（分部内 `gap-2`）；面板头部（标题 + 操作）、列表行、空状态、骨架屏 SHALL 各有一个共享组件，不得各页自拼。共享组件为 `ui/section-heading.tsx` 的 `SectionHeading`（分部标题/分组小标题）与 `PanelHeader`（标题 + 说明 + 操作）、`ui/list-row.tsx` 的 `ListRow`（行首 + 主次文本 + 行尾）、`ui/empty-state.tsx` 的 `EmptyState`、`ui/skeleton.tsx` 的 `Skeleton / SkeletonText / SkeletonList`；行列的间距、图标尺寸、内边距都在组件里定死，业务处只传内容与操作。

#### Scenario: 空状态
- **WHEN** 任一页签没有内容
- **THEN** 使用同一 `EmptyState` 组件，图标、标题、说明、操作的排布与字号一致

### Requirement: 设计一致性的自动守卫
系统 SHALL 提供测试 `tests/designSystem.test.ts`，静态扫描 `src/components/**/*.tsx` 与 `*.ts`（类名常写在常量表、`cn()` 拼接或样式映射里），对「硬编码调色板色与十六进制色 / 任意值颜色函数（`text-[rgb(...)]`、`bg-[#fff]`）、标题处零散字号、裸圆角、`CardTitle` 内覆写字号、`<Button>` 在 `className` 里覆写高度（应改用 `size` 档位）、各页自拼骨架屏 / 空状态容器」给出违规清单；清单 SHALL 随迁移逐步清零，新增违规使测试失败（允许在登记表中显式豁免并写明理由，例如独立 HTML/SVG/iframe 文档读不到宿主 CSS 变量的场景）。

#### Scenario: 新增硬编码色
- **WHEN** 有人在组件里新增 `text-red-500` 或 `bg-[#fff]`
- **THEN** `pnpm test` 失败并指出文件与行号

#### Scenario: 深色主题下的状态色前景
- **WHEN** 深色主题重新定义 `--success/--warning/--info/--destructive`
- **THEN** 四个实心底前景 token 取值同一墨色（近白前景在提亮后的深色状态色上对比不足），且由守卫测试锁定

### Requirement: 状态徽标与提示各只有一个实现
表示「状态 / 结果 / 分类」的小标签 SHALL 统一由 `ui/status-badge.tsx` 的 `StatusBadge` 渲染：入参是一个**语义状态**（`pending | processing | completed | skipped | failed | warning | info | success | neutral`，或分类色调 `tone`），而不是直接传颜色类；状态到颜色的映射 SHALL 只有一张表（`statusTone` 工具），业务组件不得各自拼 `bg-*/5|10` + `text-*` + `border-*` 组合。

「一行提示 / 框式警告 / 错误态」SHALL 统一由 `ui/hint.tsx` 的 `Hint` 渲染，`tone` 限定 `info | success | warning | danger`，形状限定「纯文字」与「带框」两种；无框用于旁注，带框用于需要用户注意的提示。`role` SHALL 由语义决定：成功 / 进行中的状态播报用 `status`，需要立刻注意的错误用 `alert`，普通旁注不加 role。业务组件 SHALL NOT 再自拼「`rounded-md border-warning/40 bg-warning/10`」这类一次性样式，也不得随意在 `status` / `note` / 无 role 之间挑选。

#### Scenario: 同一批处理状态在两处显示
- **WHEN** 同一批量任务的状态同时出现在队列表与队列面板
- **THEN** 两处用同一个 `StatusBadge` 与同一张映射表，颜色、图标、文案位置一致

#### Scenario: 错误提示的可达性
- **WHEN** 渲染一个需要用户立刻处理的错误（如密码错误、保存失败）
- **THEN** 使用 `<Hint tone="danger">`，其 `role` 为 `alert`；旁注类提示不得用 `alert`

### Requirement: 淡底只用 -muted token
状态的淡色背景 SHALL 使用对应的 `--*-muted` token（`--success-muted / --warning-muted / --info-muted / --destructive-muted`，由 `color-mix` 与卡片底色混合而来、随主题变化），SHALL NOT 用 `bg-success/5`、`bg-warning/10`、`bg-info/10`、`bg-destructive/5` 这类任意透明度叠色——透明度与卡片底色叠加后，同一语义在不同页面的浓淡不一致，也无法随主题自动调整。同理，带框提示的描边 SHALL 取自语义描边 token（`--primary-border` / `--success-border` / `--warning-border` / `--info-border` / `--destructive-border`，随主题给出可见的浓度），不得出现 `border-*/30|40|50|60` 四种不同浓度混用，也不得直接用状态色的透明度叠色。

#### Scenario: 同一语义的两种提示
- **WHEN** 比较书库的「缓存缺失」提示与设置页的「WebDAV 未配置」提示
- **THEN** 两者同为 warning 语义，淡底与描边的浓淡完全一致

#### Scenario: token 不再无人使用
- **WHEN** 检查 `index.css` 里定义的状态 token
- **THEN** `--*-muted` 至少在一个共享组件（`StatusBadge` / `Hint`）里被使用，守卫断言其不是死 token

#### Scenario: 状态色的浓度只有一档
- **WHEN** 全仓检索状态色类名
- **THEN** `bg-{primary,destructive,success,warning,info}/N` 与 `border-{同上}/N` 零出现（守卫 `tinted-surface`）；
输入框底、遮罩层与 `bg-accent/N`（accent 的透明度本身表达「更淡的 hover」）不在此列

### Requirement: 元件属性与命名一致
同类元件的属性名 SHALL 一致：控制可见性的弹层属性一律为 `open` / `onOpenChange`（不得出现 `isOpen` / `visible` / `show` 并存）；色调一律为 `tone`（`variant` 只用于 shadcn 按钮/徽标的形态变体）；尺寸一律为 `size` 且取值来自既有档位表。轻提示 API SHALL 只用一种（`toast.info` 表示中性提示，`toast.success` / `toast.error` 表达结果），不得 `toast.message` 与 `toast.info` 混用。

#### Scenario: 新增一个弹层
- **WHEN** 开发者新增一个受控弹层
- **THEN** 属性是 `open` / `onOpenChange`，与既有的 Dialog / Sheet / AlertDialog 一致

### Requirement: 图表与画布的颜色与主题对齐
图表（cytoscape / 自绘 SVG / 时间线布局）SHALL 从宿主 CSS 变量读色（`--primary`、`--foreground`、`--entity-N`、`--muted-foreground`、`--border`），并在主题切换时重新取色；读取失败的**回退值** SHALL 与当前亮色 token 的实际取值保持一致（不得停留在历史调色板），否则变量读取失败时图表会与正文脱色。回退值集中在一处（`charts/theme.ts` 的 `FALLBACK_LIGHT / FALLBACK_DARK`），并由守卫断言其与 `index.css` 的 token 同源。

#### Scenario: CSS 变量读不到
- **WHEN** 在无法读取 `getComputedStyle` 的环境（服务端渲染、导出脚本）渲染图表
- **THEN** 用的是与现行 token 一致的兜底色，画面不出现「正文朱砂、图表旧暖灰」的割裂
