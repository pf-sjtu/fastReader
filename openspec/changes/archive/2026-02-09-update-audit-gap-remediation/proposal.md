# Change: 审计缺口收敛与警告清理

## Why
`tmp/audit-reports/` 中多项问题与 warning 尚未完成，但 `refactor-codebase-architecture` 已标记为 COMPLETED，当前状态与代码事实不一致。需要单独创建 follow-up change 收敛剩余问题，并给出可验证验收标准。

## What Changes
- 修复 PDF 处理链路中的重复读取、资源释放与文本项安全访问问题
- 修复批处理引擎中的非空断言与固定 sleep 节流问题
- 优化本地缓存写入策略（防抖/idle）与缓存淘汰策略
- 清理 WebDAV 服务中的重复 header 设置与重复转换逻辑
- 补齐 UI 健壮性与可访问性基线（ErrorBoundary、文件上传触发）
- 补齐关键测试并以覆盖率门槛作为验收条件

## Impact
- Affected specs:
  - MODIFIED: `batch-ui`
  - MODIFIED: `cloud-cache`
  - ADDED: `pdf-processing-safety`
  - ADDED: `batch-processing-resilience`
  - ADDED: `test-coverage-gates`
- Affected code:
  - `src/services/pdfProcessor.ts`
  - `src/services/batchProcessingEngine.ts`
  - `src/services/cacheService.ts`
  - `src/services/webdavService.ts`
  - `src/components/sections/FileUploadSection.tsx`
  - `src/main.tsx`
  - `tests/services/pdfProcessor.test.ts`
  - `tests/batchProcessingEngine.test.ts`
