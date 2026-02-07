## MODIFIED Requirements

### Requirement: Markdown 标点符号预处理
The system SHALL 在渲染 Markdown 内容前，检测 Markdown 强调标记（`**`, `__`, `*`, `_`）内部是否包含标点符号，并在对应侧的作用域外添加空格：

- 标记**内部开头**有标点 → 在作用域**前**加空格
- 标记**内部末尾**有标点 → 在作用域**后**加空格

此函数作为渲染前的中间层，不影响原始 Markdown 内容本身。

#### Scenario: 内部末尾有标点（后加）
- **GIVEN** Markdown 内容为 `**文本。**`
- **WHEN** 调用 `normalizeMarkdownTypography` 预处理
- **THEN** 返回 `**文本。** `
- **AND** ReactMarkdown 能正确渲染加粗效果

#### Scenario: 内部开头和末尾都有标点（前后加）
- **GIVEN** Markdown 内容为 `**"引用"**`
- **WHEN** 调用 `normalizeMarkdownTypography` 预处理
- **THEN** 返回 ` **"引用"** `
- **AND** ReactMarkdown 能正确渲染加粗效果

#### Scenario: 内部开头有标点（前加）
- **GIVEN** Markdown 内容为 `**"一万种可能性之一"所说**`
- **WHEN** 调用 `normalizeMarkdownTypography` 预处理
- **THEN** 返回 ` **"一万种可能性之一"所说**`
- **AND** ReactMarkdown 能正确渲染加粗效果

#### Scenario: 内部无标点（不加）
- **GIVEN** Markdown 内容为 `**正常文本**`
- **WHEN** 调用 `normalizeMarkdownTypography` 预处理
- **THEN** 返回 `**正常文本**`（保持不变）

#### Scenario: 斜体标记处理
- **GIVEN** Markdown 内容为 `*这是"引用"*`
- **WHEN** 调用 `normalizeMarkdownTypography` 预处理
- **THEN** 返回 `*这是"引用"* `（内部末尾有引号，后加空格）

#### Scenario: 不影响原始内容
- **GIVEN** 用户从 WebDAV 加载的原始 Markdown 内容
- **WHEN** 在渲染流程中调用 `normalizeMarkdownTypography`
- **THEN** 仅影响渲染时的临时输出
- **AND** 原始文件内容保持不变
