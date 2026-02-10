## Why
当前仓库存在大量历史 ESLint 违规，导致 `npm run lint` 无法作为稳定质量门禁。与此同时，本轮审计缺口修复引入了新测试与服务改动，需要先建立“分批收敛 lint 债务”的可执行规范，避免一次性全量修复造成高风险改动。

## What Changes
- 新增 lint 债务收敛变更（`update-eslint-debt-remediation`），分阶段推进：
  1. 首批聚焦“本次改动相关文件”与“阻塞测试/覆盖率验证的文件”；
  2. 统一测试代码中 `any`、unused import 等高频违规模式；
  3. 建立 lint 分批验收规则（按文件清单验收，再逐步扩大范围）。
- 保持现有业务行为不变，不引入新框架，仅修复代码质量问题。

## Impact
- Affected specs:
  - ADDED: `lint-quality-gates`
- Affected files（首批）：
  - `tests/services/aiService.test.ts`
  - `tests/batchProcessingEngine.test.ts`
  - `tests/services/pdfProcessor.test.ts`
  - `tests/services/cacheService.test.ts`
  - 以及后续每批次纳入的清单文件
