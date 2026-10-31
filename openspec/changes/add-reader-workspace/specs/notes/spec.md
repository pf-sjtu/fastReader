# notes Delta

## ADDED Requirements

### Requirement: 划线与批注
用户选中正文后 MUST 可划线（4 色）、添加批注；笔记锚点 MUST 由章节 id、文本片段与前后文组成，内容变化后 MUST 做模糊重定位，重定位失败时 MUST 保留笔记并标注"已失去定位"。

#### Scenario: 总结重新生成后
- **WHEN** 章节总结被重新生成，原片段仍存在于新文本
- **THEN** 笔记重定位到新位置

#### Scenario: 原片段消失
- **WHEN** 原片段在新文本中找不到
- **THEN** 笔记保留并显示"已失去定位"，不被删除

### Requirement: 笔记存储与同步
笔记 MUST 先写 IndexedDB，再以 3 秒防抖同步到 `{name}-笔记.json`；删除书或清缓存时 MUST 询问是否一并删除笔记。

#### Scenario: 离线编辑
- **WHEN** WebDAV 不可用时用户添加笔记
- **THEN** 笔记保存在本地并在恢复后同步

### Requirement: 导出
系统 MUST 支持导出笔记为 Markdown，以及导出离线可读的单文件学习包 HTML（含总结、彩色图谱/时间线图片、人物志、笔记、自测题）。

#### Scenario: 导出学习包
- **WHEN** 用户导出学习包
- **THEN** 得到一个不依赖网络即可打开的 HTML 文件，其中实体颜色与应用内一致
