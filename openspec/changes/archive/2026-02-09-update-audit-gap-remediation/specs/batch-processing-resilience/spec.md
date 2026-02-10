## ADDED Requirements

### Requirement: AI service availability guard
系统 MUST 在批处理执行前校验 AI 服务可用性，并在不可用时返回可诊断错误。

#### Scenario: AI 服务未初始化
- **GIVEN** 批处理任务进入关联分析或总结阶段
- **AND** AI 服务实例不可用
- **WHEN** 系统尝试调用 AI 能力
- **THEN** 系统返回明确错误状态
- **AND** 不因非空断言导致运行时崩溃

### Requirement: Adaptive pacing for chapter processing
系统 MUST 使用可配置节流策略而非固定休眠值，控制章节处理节奏。

#### Scenario: 配置节流策略后处理章节
- **GIVEN** 批处理配置启用节流控制
- **WHEN** 系统连续处理章节
- **THEN** 系统按照配置策略节流
- **AND** 不依赖固定 `sleep(100)` 常量

### Requirement: Stable batch control behavior
系统 MUST 在并发场景下保持暂停、继续、跳过和停止行为一致。

#### Scenario: 处理中触发暂停与继续
- **GIVEN** 队列存在多个待处理项
- **WHEN** 用户先暂停再继续
- **THEN** 系统从暂停点恢复
- **AND** 队列状态与进度统计保持一致
