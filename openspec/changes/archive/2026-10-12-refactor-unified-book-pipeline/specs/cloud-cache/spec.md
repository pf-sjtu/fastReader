## ADDED Requirements
### Requirement: 版本化章节缓存
章节级缓存键 MUST 包含文件指纹、章节内容哈希、模型、prompt 版本（含自定义 prompt 哈希）、实际输出语言与处理类型；任一变化 MUST NOT 命中旧结果。

#### Scenario: 换模型重新处理
- **WHEN** 用户更换模型后重新处理同一本书
- **THEN** 所有章节重新调用 AI，不返回旧模型的缓存结果

#### Scenario: 重新处理部分失败的书
- **WHEN** 同一配置下重新处理一本有失败章节的书
- **THEN** 只有失败或未缓存的章节调用 AI
