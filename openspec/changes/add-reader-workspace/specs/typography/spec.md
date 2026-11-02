## ADDED Requirements

### Requirement: 系统字体栈与回退
系统 SHALL 不下载任何字体文件，界面、衬线标题/品牌与代码分别使用集中定义的系统字体栈（CSS 变量 `--font-sans`、`--font-serif`、`--font-mono`），栈内按优先级排列常见中文字体并以通用族名收尾。全站基础字号 SHALL 为 15px，阅读正文行高 SHALL 为 1.8，章节标题不得大于正文字号的 1.2 倍。

#### Scenario: 设备缺少首选字体
- **WHEN** 设备未安装栈内第一个字体
- **THEN** 浏览器依次回退到后续字体，直至通用族名，界面不出现缺字方块

#### Scenario: 字体栈单一来源
- **WHEN** 需要调整字体优先级
- **THEN** 只需修改 `index.css` 中的变量，设置页的检测列表随之变化，无需改动组件

### Requirement: 字体设置与安装检测
设置对话框 SHALL 提供「字体」页签，按角色（界面与正文、标题与品牌、代码）列出字体优先级，逐项标注「已安装 / 未安装 / 系统通用回退 / 无法检测」，并标出「当前生效」的第一个已安装字体。检测 SHALL 通过 canvas 文本测量实现；无法测量时 SHALL 标为「无法检测」而非「未安装」。页签 SHALL 提供「重新检测」按钮，并说明推荐安装哪些字体。

#### Scenario: 栈内字体都未安装
- **WHEN** 某角色的具名字体全部未安装
- **THEN** 该角色下提示将使用系统默认字体，且不标记任何「当前生效」

#### Scenario: 刚装完字体
- **WHEN** 用户安装字体后点击「重新检测」
- **THEN** 列表按最新环境重新测量

### Requirement: 正文阅读字体偏好
用户 SHALL 能在字体页签切换正文阅读字体为无衬线（默认）或衬线；该偏好只影响章节总结等阅读正文，随阅读偏好持久化，存档中的非法值 SHALL 归一为无衬线。

#### Scenario: 切换为衬线
- **WHEN** 用户选择「衬线」
- **THEN** `<html>` 的 `data-reading-font` 为 `serif`，正文使用 `--font-serif`，界面其余部分不变

### Requirement: 图内文字与正文同栈同字号
图（mermaid、html 沙箱块、离线学习包与导出的 SVG）SHALL 与正文使用**同一个字体栈**（`--font-sans` 的值）与**同一号字**（`--base-font-size` × `--font-scale`），而不是各自一套。这些产物脱离宿主样式表（SVG 进 `data:` URI、沙箱文档在独立文档里、学习包是独立 HTML），继承不到 CSS 变量，因此 SHALL 由一个共享常量提供字体栈（`src/lib/figureType.ts` 的 `FIGURE_FONT_STACK`，值 MUST 与 `index.css` 的 `--font-sans` 逐字一致），其余地方 MUST NOT 再写一套字体栈。

图 SHALL NOT 被放大到容器宽度：mermaid MUST 关闭默认的 `useMaxWidth`（它会把小图拉满容器，实测同一页里 16px 的文字被显示成 15.1–54.3px，而正文只有 15px）；缩放 SHALL 由 `figureFit` 决定——不放大、缩到不低于 11px、再宽则由容器横向滚动。用户调整「字体大小」后图 SHALL 重新渲染（字号是写进产物里的，不会自动跟随）；正文里的说明小字 SHALL 用相对正文的角色类 `t-note`，而不是固定 rem 的字号。

#### Scenario: 同一页里所有图的字都与正文一致
- **WHEN** 一页里有不同原始尺寸的图（窄的状态图、宽的流程图、时间线）
- **THEN** 每张图的渲染宽/原始宽为 1.00（只有超宽图略小），图内 `font-size` 等于正文基准字号，卡片内不出现多余的横向滚动

#### Scenario: 改字号
- **WHEN** 用户把字号调到 1.3 倍
- **THEN** 图重新渲染为 19.5px（15 × 1.3），html 沙箱文档里的默认字号同步变化

#### Scenario: 字体栈只有一处具体值
- **WHEN** 有人给某个图重新写一份 `system-ui, …` 字体栈
- **THEN** `tests/figureType.test.ts` 失败（常量必须等于 `--font-sans`，且四个产物文件必须引用同一来源）

### Requirement: 明暗主题的对比度与 token 单一来源
两套主题的语义 token SHALL 满足可读性：正文与次要文字压在其实际使用的底色上（含 `--muted`、`--accent`、`--*-muted` 淡底）对比度 ≥ 4.5；实心状态底上的前景色 ≥ 4.5；焦点环压在底色上 ≥ 3:1。装饰性边框与实体色只做「可见/可分辨」要求（≥1.2 与 ≥3:1），不得为凑 3:1 而加粗到压过内容的程度。两套主题的 token SHALL 一一对应（`.dark` 不得引入 `:root` 没有的 token）。

组件 SHALL NOT 用「复制一条 `.dark` 规则改颜色」的方式做主题适配——颜色差异只能来自 token；写死的 `white/black` SHALL 配 `dark:` 变体（遮罩、图上的白字等确需场景 SHALL 在守卫里登记理由）。正文里的链接、引用、高亮、马克笔底色 SHALL 走 `--link*` / `--mark*` / `--marker` token，不得写调色板 hex 或 rgba。凡覆盖 Tailwind Typography 的正文样式，SHALL 写在 `@layer components`（高于 base 的 `.prose`、低于 utilities），不得依赖无层样式（无层会连工具类一起压掉）。行内元素的字号 SHALL 只写 `em`，不得再乘 `--font-scale`（父级已缩放，二次相乘会让行内代码在放大字号时超出正文）。

#### Scenario: 次要文字压在淡底上
- **WHEN** 渲染 `bg-muted text-muted-foreground` 的 Tabs 容器或分类胶囊
- **THEN** 两套主题下对比度都不低于 4.5

#### Scenario: 改 token 时越界会被发现
- **WHEN** 有人把某个 token 的明度调低到让上述配对跌破阈值
- **THEN** `tests/themeContrast.test.ts` 失败并指出是哪个 token 对哪个背景

#### Scenario: 不靠 .dark 副本
- **WHEN** 需要让某个元素在深色下换色
- **THEN** 改 token（或它的 `-foreground`/`-muted` 配套），而不是再加一条 `.dark …` 规则
