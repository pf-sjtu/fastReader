# lint-quality-gates Specification

## Purpose
约束代码质量门禁：真实类型检查、ESLint、测试与构建在本地与 CI 上的执行要求，以及历史债务的分批收敛方式。

## Requirements

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

### Requirement: 不得保留零引用的遗留模块
代码库 MUST NOT 保留经全仓库检索确认零 import 引用的遗留服务文件、兼容层别名或未使用的工具模块。

#### Scenario: 删除已证实零引用的遗留 WebDAV 代理服务
- **WHEN** `src/services/webdavProxyService.ts` 在全仓库无 import 引用
- **AND** 现有 WebDAV 流量经 `/api/dav` header 代理处理
- **THEN** 该文件 SHALL 从代码库移除

#### Scenario: 删除已证实零引用的 AI 兼容别名
- **WHEN** `AiService` 类与 `AIServiceCompat` 对象在全仓库无 import 引用
- **AND** `AIService` facade 重导出仍被业务代码使用
- **THEN** 仅移除弃用别名，保留活跃 facade 导出

#### Scenario: 删除已证实零引用的错误工具模块
- **WHEN** `src/lib/error.ts` 在全仓库无 import 引用
- **THEN** 该文件 SHALL 从代码库移除

### Requirement: 真实类型检查与 CI 门禁
`pnpm build` 与 `pnpm typecheck` MUST 使用 `tsc -b` 实际检查 `src/` 全部文件；CI MUST 在每次推送执行 typecheck、lint、test、build。

#### Scenario: 引入类型错误
- **WHEN** 提交引入类型错误
- **THEN** `pnpm typecheck` 失败且 CI 标红
