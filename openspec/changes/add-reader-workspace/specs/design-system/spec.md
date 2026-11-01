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
系统 SHALL 提供测试 `tests/designSystem.test.ts`，静态扫描 `src/components/**/*.tsx` 与 `*.ts`（类名常写在常量表、`cn()` 拼接或样式映射里），对「硬编码调色板色、标题处零散字号、裸圆角、`CardTitle` 内覆写字号、各页自拼骨架屏 / 空状态容器」给出违规清单；清单 SHALL 随迁移逐步清零，新增违规使测试失败（允许在登记表中显式豁免并写明理由）。

#### Scenario: 新增硬编码色
- **WHEN** 有人在组件里新增 `text-red-500`
- **THEN** `pnpm test` 失败并指出文件与行号
