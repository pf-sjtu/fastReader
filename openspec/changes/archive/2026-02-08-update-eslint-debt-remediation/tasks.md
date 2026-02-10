# Tasks

## 1. Spec Proposal 构建（顺序）
- [x] 1.1 创建 `proposal.md` 并明确分批收敛策略
- [x] 1.2 创建 lint capability delta（requirements/scenarios）
- [x] 1.3 运行 `openspec validate update-eslint-debt-remediation --strict`

## 2. 首批 lint 收敛（顺序）
- [x] 2.1 修复 `tests/services/aiService.test.ts`（兼容 facade 后的失效测试 + lint）
- [x] 2.2 修复 `tests/batchProcessingEngine.test.ts` 的 `any` 违规
- [x] 2.3 修复 `tests/services/pdfProcessor.test.ts` 的 `any` 违规
- [x] 2.4 修复 `tests/services/cacheService.test.ts` 的 unused import

## 3. 验证与扩展（顺序）
- [x] 3.1 运行首批文件级 lint 校验
- [x] 3.2 运行相关测试（aiService/batch/pdf/cache）
- [x] 3.3 评估下一批 lint 清单并更新 tasks（下一批建议：`tests/services/epubProcessor.test.ts`、`tests/batchQueueStore.test.ts`、`tests/services/aiService.test.ts` 进一步补强）

## 4. 第二批 lint 收敛（顺序）
- [x] 4.1 修复 `tests/services/epubProcessor.test.ts` 的 lint（any/no-empty 等）
- [x] 4.2 修复 `tests/batchQueueStore.test.ts` 的 unused import
- [x] 4.3 修复 `config/vite.config.ts` 与 `vite.config.ts` 的 unused 参数问题
- [x] 4.4 运行第二批文件级 lint 与测试验证

## 5. 第三批 lint 收敛（顺序）
- [x] 5.1 修复 `tests/__mocks__/@ssshooter/epubjs.ts` lint（Function/unused/any）
- [x] 5.2 修复 `src/stores/ai-config/store.ts`、`src/stores/prompts/store.ts`、`src/types/batch.ts`、`src/types/chapter.ts`、`src/utils/async.ts`、`src/utils/uiHelpers.ts` lint
- [x] 5.3 修复 `src/services/webdavProxyService.ts`、`src/services/webdavService.ts` 目标 lint 项
- [x] 5.4 运行第三批文件级 lint 与相关测试验证

## 6. 第四批 lint 收敛（顺序）
- [x] 6.1 修复 `src/services/pdfProcessor.ts` 的 any/unused lint（保持行为不变）
- [x] 6.2 修复 `src/services/cacheService.ts` 的 any lint（保持缓存行为不变）
- [x] 6.3 运行第四批文件级 lint 与相关测试验证

## 7. 第五批 lint 收敛（顺序）
- [x] 7.1 修复 `md_reader/src/components/markdown-reader-enhanced.tsx` 中 `no-explicit-any` 与 `no-unused-vars` 错误
- [x] 7.2 运行该文件 lint 校验（保留 react-hooks 警告待后续专项处理）
- [x] 7.3 运行构建验证确保行为未回退

## 8. 第六批 lint 收敛（顺序）
- [x] 8.1 修复 `md_reader/src/components/markdown-reader-enhanced.tsx` 的 `react-hooks/exhaustive-deps` 警告
- [x] 8.2 运行该文件 lint 验证（warning 清零）
- [x] 8.3 运行构建验证确保行为未回退

## 9. 第七批 lint 收敛（顺序）
- [x] 9.1 修复 `src/services/aiService.ts` 与 AI Provider 相关文件的 lint 违规（any/no-namespace/no-require-imports）
- [x] 9.2 修复 `src/services/autoSyncService.ts`、`src/services/configExportService.ts` 的 any lint
- [x] 9.3 修复 `src/services/epubProcessor.ts`、`src/services/epub/anchorExtractor.ts`、`src/services/epub/textExtractor.ts` 的 lint（prefer-const/no-unused-vars/no-useless-escape）
- [x] 9.4 运行第七批文件级 lint 与相关测试验证

## 10. Git + 测试 + Spec 归档确认（最后）
- [x] 10.1 记录验证结果并更新任务状态
- [x] 10.2 提交代码并添加 git notes
- [ ] 10.3 上线后执行 archive 流程
