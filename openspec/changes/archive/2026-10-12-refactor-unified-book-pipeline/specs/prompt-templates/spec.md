## ADDED Requirements
### Requirement: Prompt 模板占位符替换
前端与 CLI MUST 以同一语义渲染 prompt 模板：模板中的已知占位符全部替换，渲染结果不含字面 `{{...}}`，正文只出现一次。

#### Scenario: 章节总结模板
- **WHEN** 使用含 `{{title}}` 与 `{{content}}` 的模板生成章节总结
- **THEN** 发给模型的 prompt 中标题与正文各出现一次且不含 `{{`
