## ADDED Requirements

### Requirement: PDF debug logs are gated
系统 SHALL 将 PDF 解析过程中的诊断日志（含 `[DEBUG]` 标记与目录/元数据/章节信息等大对象 dump）通过可开关的 debug 通道输出。生产默认路径 MUST NOT 无条件调用 `console.log` 打印这些诊断信息。

#### Scenario: 生产默认不刷 DEBUG
- **WHEN** 运行环境非开发模式且未开启 debug 开关
- **THEN** PDF 解析与章节提取不向 `console.log` 输出带 `[DEBUG]` 的诊断日志
- **AND** 不向 `console.log` dump 目录、元数据、章节信息等大对象

#### Scenario: debug 开启时可观测
- **WHEN** 开发模式或 debug 开关开启
- **THEN** 上述诊断信息可通过 logger debug 通道输出

### Requirement: PDF operational failures remain visible
系统 SHALL 继续以 warn/error 级别记录 PDF 资源释放失败、页面跳过、章节提取失败等真实问题，不得因关闭 debug 而吞掉这些日志。

#### Scenario: 提取失败仍有 error 日志
- **WHEN** 章节提取抛出异常
- **THEN** 系统记录 error 级日志
- **AND** 向调用方抛出包装后的错误
