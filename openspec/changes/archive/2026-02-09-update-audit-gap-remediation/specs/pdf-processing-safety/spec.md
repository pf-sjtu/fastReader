## ADDED Requirements

### Requirement: Single-read PDF parsing
系统 MUST 在同一次 PDF 处理链路中复用读取结果，避免对同一文件进行重复二进制读取。

#### Scenario: 单次处理中仅一次二进制读取
- **GIVEN** 用户上传单个 PDF 并触发章节提取
- **WHEN** 系统执行解析与提取流程
- **THEN** 系统在该流程中只读取一次文件二进制内容
- **AND** 后续步骤复用同一解析上下文

### Requirement: Deterministic PDF resource cleanup
系统 MUST 在成功或失败路径上都执行 PDF 资源清理，避免资源泄露。

#### Scenario: 提取失败时也释放资源
- **GIVEN** 章节提取过程中发生异常
- **WHEN** 流程退出
- **THEN** 系统执行统一的资源释放逻辑
- **AND** 不因异常跳过清理步骤

### Requirement: Safe text item extraction
系统 MUST 安全处理 PDF 文本项中非字符串或缺失字段，避免运行时错误。

#### Scenario: 文本项包含非标准对象
- **GIVEN** `textContent.items` 中存在无 `str` 字段的项
- **WHEN** 系统拼接页面文本
- **THEN** 系统跳过或安全转换该项
- **AND** 不抛出未捕获异常
