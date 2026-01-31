## ADDED Requirements

### Requirement: Processing Metadata Annotation

系统 SHALL 在保存处理结果时，在文件头部添加 HTML 注释格式的处理元信息。

#### Scenario: 保存摘要文件时添加备注
- **WHEN** 系统完成书籍处理并准备保存到 WebDAV
- **THEN** 系统在文件内容头部插入 HTML 注释格式的处理元信息
- **AND** 注释包含：source, fileName, processedAt, model, chapterDetectionMode, selectedChapters, chapterCount, originalCharCount, processedCharCount, inputTokens, outputTokens, costUSD, costRMB

#### Scenario: 解析已存在的备注
- **WHEN** 系统读取已存在的处理结果文件
- **THEN** 系统可以解析文件头部的 HTML 注释
- **AND** 系统可以提取备注中的处理信息用于显示

### Requirement: Metadata Fields

系统 SHALL 记录以下处理元信息字段。

#### Scenario: 记录基础信息
- **GIVEN** 处理一本书籍
- **WHEN** 生成处理备注
- **THEN** 包含以下基础字段：
  | 字段 | 值来源 |
  |------|--------|
  | source | 固定值 "WebDAV" |
  | fileName | 原始文件名（含扩展名） |
  | processedAt | 当前 UTC 时间（ISO 8601 格式） |
  | model | 使用的 AI 模型 ID |
  | chapterDetectionMode | 配置的章节检测模式 |

#### Scenario: 记录章节信息
- **GIVEN** 处理一本书籍有 12 个章节
- **WHEN** 生成处理备注
- **THEN** 包含以下章节字段：
  | 字段 | 值来源 |
  |------|--------|
  | selectedChapters | 用户勾选的章节编号列表（逗号分隔） |
  | chapterCount | 总章节数量 |
  | originalCharCount | 原始内容字符数（不含空格） |
  | processedCharCount | 处理后内容字符数（不含空格） |

#### Scenario: 记录 AI 使用情况
- **GIVEN** AI API 返回了使用统计
- **WHEN** 生成处理备注
- **THEN** 包含以下 AI 使用字段：
  | 字段 | 值来源 |
  |------|--------|
  | inputTokens | API 响应的 usage.prompt_tokens |
  | outputTokens | API 响应的 usage.completion_tokens |
  | costUSD | 根据模型定价计算的美元费用 |
  | costRMB | 根据汇率换算的人民币费用 |

### Requirement: Cost Calculation

系统 SHALL 根据 AI API 响应计算处理费用。

#### Scenario: 计算 Gemini 费用
- **GIVEN** 使用 gemini-1.5-pro 模型处理
- **AND** inputTokens = 125000, outputTokens = 3200
- **WHEN** 计算费用
- **THEN** costUSD = (125000 * 0.00000125) + (3200 * 0.00001875) = 0.01525
- **AND** costRMB = costUSD * 7.0 = 0.10675

#### Scenario: 配置自定义汇率
- **GIVEN** 环境变量 EXCHANGE_RATE_USD_TO_CNY = 7.5
- **AND** costUSD = 0.01525
- **WHEN** 计算人民币费用
- **THEN** costRMB = 0.01525 * 7.5 = 0.114375

### Requirement: Metadata Formatter

系统 SHALL 提供 `metadataFormatter.ts` 工具生成和解析处理备注。

#### Scenario: 生成 HTML 备注
- **WHEN** 调用 `metadataFormatter.generateMetadata(processResult)`
- **THEN** 返回格式化的 HTML 注释字符串

#### Scenario: 解析 HTML 备注
- **WHEN** 调用 `metadataFormatter.parseMetadata(fileContent)`
- **THEN** 返回包含所有字段的 Metadata 对象
- **AND** 如果文件没有备注，返回 null
