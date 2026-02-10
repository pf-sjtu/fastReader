# Tasks: 审计缺口收敛与警告清理

## 1. Spec Proposal 构建（顺序）
- [x] 1.1 完成 `proposal.md`，明确承接 `refactor-codebase-architecture` 的未完成项
- [x] 1.2 完成 `specs/` 下 5 个 delta 文件（2 MODIFIED + 3 ADDED）
- [x] 1.3 运行 `openspec validate update-audit-gap-remediation --strict`

## 2. P0 运行时安全修复（可并行）
- [x] 2.1 重构 `src/services/pdfProcessor.ts`：单次读取并复用 ArrayBuffer/PDFDocument
- [x] 2.2 重构 `src/services/pdfProcessor.ts`：在异常路径中确保资源释放（try/finally）
- [x] 2.3 重构 `src/services/pdfProcessor.ts`：`textContent.items` 安全提取文本
- [x] 2.4 重构 `src/services/batchProcessingEngine.ts`：移除 `aiService!` 非空断言，改守卫逻辑

## 3. P1 性能与复用收敛（可并行）
- [x] 3.1 重构 `src/services/cacheService.ts`：防抖+idle 持久化写入（含 fallback）
- [x] 3.2 重构 `src/services/cacheService.ts`：缓存淘汰策略升级为 LRU
- [x] 3.3 重构 `src/services/batchProcessingEngine.ts`：用可配置节流策略替代固定 sleep
- [x] 3.4 重构 `src/services/webdavService.ts`：统一 header 设置与 MIME/ArrayBuffer 逻辑

## 4. P1 UI/UX 警告收敛（可并行）
- [x] 4.1 新增并接入 ErrorBoundary（入口层）
- [x] 4.2 修复 `src/components/sections/FileUploadSection.tsx` 文件上传触发可访问性
- [x] 4.3 为高频展示组件补充 memo，降低无效重渲染

## 5. 测试与覆盖率门禁（顺序）
- [x] 5.1 新增 `tests/services/pdfProcessor.test.ts` 行为级测试
- [x] 5.2 扩展 `tests/batchProcessingEngine.test.ts` 到行为级集成场景
- [x] 5.3 运行覆盖率并补测，确保关键链路覆盖（cacheService 35.88% → 65.55%）

## 6. Git + 测试 + Spec 归档确认（最后）
- [x] 6.1 运行 lint/test/coverage 并记录结果（说明：项目当前存在大量历史 lint 错误，非本次变更引入）
  - 测试结果：134 passed (11 test files)
  - 覆盖率：32.68%（总体），cacheService 65.55%
  - Lint：历史错误存在于 md_reader/ 目录，非本 change 范围
- [x] 6.2 提交代码并添加 git notes 记录任务与验证
- [x] 6.3 执行 archive 流程并再次 validate
