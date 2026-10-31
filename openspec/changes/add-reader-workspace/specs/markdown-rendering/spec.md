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
章节卡的标题是最重要的信息，MUST NOT 被操作按钮挤占：折叠态 MUST 只有「序号 + 衬线标题 + 箭头」，整行为一个带 `aria-expanded` 的点击区（读屏名称含标题），标题完整显示不截断；操作（复制 + 阅读原文 + 更多菜单）MUST 只在展开后作为内容上方的轻量工具栏出现，且带文字标签；「查看内容」「清除缓存」等次要操作 MUST 收进更多菜单。卡片 MUST 无阴影，折叠态悬停才有底色。单张卡（全书关联、全书总结）MUST 不显示序号。

#### Scenario: 折叠态
- **WHEN** 章节卡折叠
- **THEN** 整张卡只有一个按钮，没有任何操作图标，标题带序号完整显示

#### Scenario: 展开后的工具栏
- **WHEN** 章节卡展开
- **THEN** 内容上方出现「复制」「阅读原文」「更多操作」三项，更多菜单里有「原文内容」（打开完整原文弹窗）与「清除缓存」
