# Change: 修复 Markdown 标点符号渲染问题

## Why

当前 `normalizeMarkdownTypography` 函数使用**零宽空格**（`\u200B`）在 Markdown 标记与标点符号之间插入分隔，但这种方式在某些渲染场景下仍然无法正确解析，特别是当 Markdown 作用域内部有中文标点字符时，例如：
- `**政治比较的本质在于以比较的视野将现实视为"一万种可能性之一"**`
- `**"一万种可能性之一"所说**`

零宽空格在某些 Markdown 解析器中无法提供足够的词边界提示，导致渲染失败。

## What Changes

- **修改** `normalizeMarkdownTypography` 函数，将零宽空格（`\u200B`）替换为普通空格（` `）
- **保持** 该函数作为渲染前的中间层，不影响原始 markdown 内容本身
- **更新** 两个位置的实现：
  - `src/lib/markdown.ts`（主应用）
  - `md_reader/src/lib/markdown.ts`（md_reader 子程序）
- **更新** 函数注释，反映新的行为

## Impact

- Affected specs: markdown-rendering
- Affected code:
  - `src/lib/markdown.ts`
  - `md_reader/src/lib/markdown.ts`
- 渲染表现变更：Markdown 标记与中文标点之间将有可见空格，确保正确解析
