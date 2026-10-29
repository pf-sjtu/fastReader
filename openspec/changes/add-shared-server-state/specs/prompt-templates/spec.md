# prompt-templates Delta

## ADDED Requirements

### Requirement: 只保留 v2 提示词模板
系统 MUST 只保留 v2 提示词模板作为唯一内置版本；MUST NOT 再提供 v1 模板或版本切换。
用户自定义 MUST 以「相对 v2 默认值的覆盖项」保存，未覆盖的条目 MUST 跟随内置默认值。

#### Scenario: 默认使用 v2
- **WHEN** 全新部署首次进入提示词编辑器
- **THEN** 展示 v2 模板内容且没有任何版本切换控件

#### Scenario: 只改一项不影响其它项
- **WHEN** 用户只修改「章节总结（非虚构）」并保存，之后内置 v2 的其它条目更新
- **THEN** 该项目保持用户内容，其余条目展示新的内置默认值

#### Scenario: 恢复默认
- **WHEN** 用户对某项点击「恢复默认」
- **THEN** 该覆盖项被删除，展示并发送内置 v2 默认内容

## MODIFIED Requirements

### Requirement: Prompt 模板占位符替换
前端与 CLI MUST 以同一语义渲染 prompt 模板：模板中的已知占位符全部替换，渲染结果不含字面 `{{...}}`，正文只出现一次。前端覆盖项与 CLI 配置中的自定义提示词 MUST 使用同一渲染语义。

#### Scenario: 章节总结模板
- **WHEN** 使用含 `{{title}}` 与 `{{content}}` 的模板生成章节总结
- **THEN** 发给模型的 prompt 中标题与正文各出现一次且不含 `{{`

#### Scenario: 旧版 v1 配置
- **WHEN** CLI 读取的配置声明 `currentPromptVersion: v1`
- **THEN** 输出告警并使用 v2 模板，不因缺少 v1 而失败

## REMOVED Requirements

### Requirement: 提示词版本切换
**Reason**: v1 模板已废弃，保留双版本使默认值和自定义覆盖难以维护。
**Migration**: 导入 1.0.0 配置时取 `promptVersionConfig.v2` 与内置 v2 的差集作为覆盖项，v1 内容丢弃；`currentPromptVersion` 字段被忽略。
