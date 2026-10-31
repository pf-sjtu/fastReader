# markdown-rendering Delta

## ADDED Requirements

### Requirement: 可注入的正文实体标注
章节正文渲染 MUST 支持通过稳定引用的 remark 插件注入实体标注；标注 MUST 不改变 Markdown 语义，且 MUST 跳过 code、inlineCode 与链接节点。

#### Scenario: 代码块内不标注
- **WHEN** 总结文本的代码块中含有实体名
- **THEN** 代码块内容保持原样

#### Scenario: 插件引用稳定
- **WHEN** 其他章节流式更新
- **THEN** 已渲染章节的 remark 插件数组引用不变，不触发重新处理

### Requirement: 章节卡精简操作
章节卡 MUST 将操作收敛为「复制 + 原文 + 更多菜单 + 折叠」，折叠按钮 MUST 保留 `aria-expanded`。

#### Scenario: 更多菜单
- **WHEN** 用户打开"更多"菜单
- **THEN** 可见"查看内容""清除缓存"等次要操作
