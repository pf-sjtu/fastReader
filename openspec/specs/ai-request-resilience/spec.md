# ai-request-resilience Specification

## Purpose
约束前端 AI 请求的取消与重试行为：用户取消、换书或重启时在途请求必须中止且旧结果不得写入新任务；仅对可恢复错误按 Retry-After / 指数退避重试，并在同一服务商内共享限流冷却。

## Requirements

### Requirement: AI 请求可取消
用户取消、换书或重新处理时，进行中的 AI 请求与重试等待 MUST 被中止，旧任务结果 MUST NOT 写入新任务状态或 token 统计。

#### Scenario: 处理中换书
- **WHEN** 第一本书处理中用户选择第二本书
- **THEN** 第一本书的在途请求被中止
- **AND** 第二本书的结果中不出现第一本书的章节

### Requirement: AI 请求分类重试
系统 MUST 只对 408、429、5xx 与网络错误重试，优先遵循 Retry-After，否则指数退避加抖动；同一服务商收到 429 后并发请求 MUST 共享冷却期。

#### Scenario: 上下文超长
- **WHEN** 服务商返回上下文超长错误
- **THEN** 不重试，立即失败并提示
