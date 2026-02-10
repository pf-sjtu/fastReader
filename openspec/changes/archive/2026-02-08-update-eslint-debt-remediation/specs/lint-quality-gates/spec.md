## ADDED Requirements

### Requirement: Incremental lint debt remediation
系统 MUST 采用分批方式收敛 ESLint 历史债务，并为每一批次提供可验证的文件清单。

#### Scenario: 首批 lint 收敛范围
- **WHEN** 执行首批 lint 收敛
- **THEN** 至少包含本轮变更相关测试与服务文件
- **AND** 记录该批次文件级 lint 结果

### Requirement: File-level lint gates for changed scope
系统 MUST 对本次变更涉及文件执行文件级 lint 校验，确保新增改动不引入新的 lint 违规。

#### Scenario: 变更文件 lint 校验
- **WHEN** 执行文件级 lint 命令
- **THEN** 本批次目标文件不出现新的 lint 错误
- **AND** 对暂未纳入批次的历史文件保持现状，不阻塞本批次交付

### Requirement: Lint and test co-validation
系统 MUST 在 lint 收敛批次中同时执行相关测试，避免“仅过 lint 但行为回退”。

#### Scenario: 收敛批次回归验证
- **WHEN** 完成首批 lint 修复
- **THEN** 运行对应测试套件并通过
- **AND** 记录失败项与后续批次计划
