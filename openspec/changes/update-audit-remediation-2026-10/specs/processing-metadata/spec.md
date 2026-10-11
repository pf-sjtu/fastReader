## ADDED Requirements
### Requirement: 元数据注释块解析与转义
系统 MUST 只解析文件开头的 HTML 注释元数据块，写入元数据值时 MUST 转义 `-->`；前端只保留一份解析实现。

#### Scenario: 正文中出现 HTML 注释
- **WHEN** 摘要正文中包含 `<!-- ... -->`
- **THEN** 元数据解析结果只来自文件开头的注释块

#### Scenario: 元数据值包含注释结束符
- **WHEN** 书名或提示词中包含 `-->`
- **THEN** 写出的文件元数据块仍可被完整解析
