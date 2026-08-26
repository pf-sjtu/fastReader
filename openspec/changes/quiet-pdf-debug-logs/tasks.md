## 1. OpenSpec

- [x] 1.1 撰写 proposal、tasks 与 spec delta
- [x] 1.2 `openspec validate quiet-pdf-debug-logs --strict` 通过

## 2. 实现

- [x] 2.1 `pdfProcessor` 引入现有 `logger`，将 `console.log('[DEBUG]'...)` 与大对象 dump 改为 `logger.debug`
- [x] 2.2 资源释放失败、跳页、提取失败等真实问题走 `logger.warn` / `logger.error`，生产默认仍可见
- [x] 2.3 新增测试：非 debug 路径不向 `console.log` 刷 `[DEBUG]` / 大对象 dump

## 3. 验证

- [x] 3.1 跑 `tests/services/pdfProcessor.test.ts`（或等价 vitest）
- [x] 3.2 `pnpm build` 通过
