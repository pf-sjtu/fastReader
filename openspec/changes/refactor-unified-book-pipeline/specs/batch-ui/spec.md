## ADDED Requirements
### Requirement: 批量跳过以元数据完整性为准
批量 skipProcessed MUST 读取云端摘要元数据；`isPartial` 为 true 的书 MUST NOT 被跳过。

#### Scenario: 云端结果不完整
- **WHEN** 批量处理开启 skipProcessed，云端存在同名摘要但 `isPartial: true`
- **THEN** 该书重新进入处理

### Requirement: 批量支持全部处理模式
批量处理 MUST 与单书使用同一处理管线，支持 summary、mindmap、combined-mindmap 模式。

#### Scenario: 批量导图模式
- **WHEN** 以 mindmap 模式批量处理
- **THEN** 每本书产出非空的章节导图结果
