## ADDED Requirements
### Requirement: 云端存在性三态
前端云端缓存探测 MUST 区分「存在」「不存在」「未知」三种结果；鉴权失败、网络错误、重试后仍为 5xx 的结果为「未知」，不得当作不存在。

#### Scenario: 批量处理遇到未知状态
- **WHEN** 批量处理开始前查询云端已处理列表，结果为未知
- **THEN** 系统中止本次批量并提示无法确认云端状态
- **AND** 不得以覆盖模式重新处理并上传

#### Scenario: 单书遇到未知状态
- **WHEN** 选书后云端缓存探测结果为未知
- **THEN** 界面提示无法确认云端缓存状态，而不是表现为没有缓存

### Requirement: 部分失败结果不作为完整缓存
含失败章节的处理结果 MUST 在元数据中标记 `isPartial: true`；读取到 `isPartial` 或失败占位的云端结果时 MUST NOT 视为完整缓存。

#### Scenario: 读取部分失败的云端结果
- **WHEN** 云端摘要元数据 `isPartial` 为 true
- **THEN** 系统提示存在失败章节并允许重新处理
- **AND** 批量 skipProcessed 不跳过该书
