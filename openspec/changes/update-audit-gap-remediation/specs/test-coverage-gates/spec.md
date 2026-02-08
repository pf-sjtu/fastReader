## ADDED Requirements

### Requirement: PDF processor behavior tests
系统 MUST 为 PDF 处理器提供行为级测试，覆盖解析、章节提取与异常路径。

#### Scenario: 运行 PDF 处理器测试
- **WHEN** 执行测试命令
- **THEN** `pdfProcessor` 相关行为测试可运行并通过
- **AND** 覆盖正常与异常场景

### Requirement: Batch engine integration behavior tests
系统 MUST 为批处理引擎提供行为级集成测试，覆盖关键控制流。

#### Scenario: 覆盖暂停恢复与错误恢复
- **GIVEN** 批处理队列包含多个文件
- **WHEN** 执行测试套件
- **THEN** 测试覆盖暂停、继续、跳过、错误恢复路径
- **AND** 验证状态迁移与回调行为

### Requirement: Coverage threshold gate
系统 MUST 将覆盖率阈值作为验收门禁，未达阈值不得视为完成。

#### Scenario: 覆盖率检查
- **WHEN** 运行覆盖率命令
- **THEN** 总体覆盖率达到并保持在 80% 及以上
- **AND** 若低于阈值则流程失败并要求补测
