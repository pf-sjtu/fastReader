## ADDED Requirements
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
