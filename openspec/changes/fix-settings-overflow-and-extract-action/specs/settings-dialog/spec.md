## ADDED Requirements

### Requirement: 设置对话框在窄屏不得横向溢出

设置对话框 SHALL 把页签条、页签内容、模型列表与服务商向导都约束在对话框自身宽度内；对话框 SHALL NOT 出现横向滚动。

#### Scenario: 窄屏打开设置

- **WHEN** 视口宽 390px、用户打开「配置」对话框
- **THEN** `[role="dialog"]` 的 `scrollWidth` 与 `clientWidth` 之差不超过 1px
- **AND** 页签条与其中每个页签的右边界都不超出视口
- **AND** 六个页签全部可见、标签文字不被裁切

#### Scenario: 展开长模型列表

- **WHEN** 在 390px 视口展开某服务商的「模型 (10)」，且模型 id 普遍很长
- **THEN** 每个模型行的左块（名称/id/上下文/价格）与右控件（温度输入、启用开关、删除按钮）都不越出对话框
- **AND** 列表仍可纵向滚动、筛选框与「添加模型」行不越界

#### Scenario: 服务商向导与章节预览

- **WHEN** 在窄屏打开 ProviderWizard 或「处理设置」中内嵌的章节预览
- **THEN** 对话框内容不越出视口，按钮行按 `flex-wrap` 换行而不是被裁切

#### Scenario: 桌面排版不回归

- **WHEN** 视口宽 1280px
- **THEN** 设置对话框宽度仍按 `max-w-2xl` 封顶，逐页签无越界元素（`truncate` 的标签按设计省略号是预期行为）

### Requirement: 设置页签条在窄屏换行而非撑宽

页签条 SHALL 在可用宽度不足时换行，且 SHALL NOT 以自身内容宽度把对话框撑宽。

#### Scenario: 窄屏两行排布

- **WHEN** 视口宽 390px、设置对话框打开
- **THEN** 页签条高度大于单行高度（6 个页签折成多行）
- **AND** 每个页签仍可点击、`aria-selected` 语义正确、标题跟随选中页签变化

#### Scenario: 桌面单行

- **WHEN** 视口宽 1280px
- **THEN** 六个页签仍在一行内等分排布

### Requirement: 页签条常驻滚动区之外

设置对话框的页签条 SHALL 位于内容滚动区之外；滚动长内容时页签条 SHALL 保持可见、可点击。

#### Scenario: 模型列表滚到底部

- **WHEN** 390px 视口展开「模型 (10)」并把列表滚到底部
- **THEN** 页签条仍停在对话框顶部、可见且可点击
- **AND** 在底部直接切换页签成功；新页签内容从顶部开始（滚动位置归零）

#### Scenario: 折行不遮挡内容

- **WHEN** 页签条折成两行
- **THEN** 每个页签的高度是单行触发器高度，不按整条页签栏高度拉伸
- **AND** 页签条底边与下方内容区不重叠，内容不会拦截页签的点击

### Requirement: 模态对话框基础轨道为单列

对话框与确认框的基础容器 SHALL 使用单列轨道（`grid-cols-1` = `minmax(0,1fr)`），容器宽度 SHALL NOT 由内容的 max-content 决定。

#### Scenario: 长不可断文本

- **WHEN** 对话框内含长 URL、长文件名或长模型 id（不可断行）
- **THEN** 容器 `scrollWidth` 与 `clientWidth` 之差不超过 1px
- **AND** 文本按 `truncate` 省略或换行，而不是把容器撑出视口
