# Change: 删除未引用的遗留服务与兼容层

## Why
代码审计发现三处遗留模块在全仓库零引用：`webdavProxyService.ts`（REST 路径与现有 `/api/dav` header 代理不兼容）、`aiService.ts` 中的 `AiService` / `AIServiceCompat` 弃用别名、以及 `src/lib/error.ts` 工具模块。保留它们增加维护成本与误用风险。

## What Changes
- 删除 `src/services/webdavProxyService.ts`（整文件）
- 从 `src/services/aiService.ts` 移除 `AiService` 类与 `AIServiceCompat` 对象（保留 facade 重导出）
- 删除 `src/lib/error.ts`（整文件）

## Impact
- Affected specs: `lint-quality-gates`
- Affected code: 上述三个文件；无运行时行为变更（零引用已证实）
