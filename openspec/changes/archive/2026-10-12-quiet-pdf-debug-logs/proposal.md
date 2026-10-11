# Change: 关闭生产环境 PDF DEBUG 刷屏

## Why

`src/services/pdfProcessor.ts` 在生产路径无条件 `console.log('[DEBUG]')`，并 dump 目录、元数据、章节信息等大对象。解析被拖慢，真错误被淹没。`fix-silent-failures` 已将其列为后续建议，本轮单独落地。

## What Changes

- 将无条件 `console.log('[DEBUG]'...)` 及大对象 dump 改为 `logger.debug`（由现有 logger 在非 DEV / 未设 `VITE_DEBUG` 时关闭）
- 资源释放失败、跳页、提取失败等仍走 `logger.warn` / `logger.error`，生产默认可见
- 不改 PDF 解析算法、目录与文本提取逻辑
- 不改 logger 实现

无 **BREAKING** 变更。

## Impact

- Affected specs: ADDED `pdf-debug-logging`
- Affected code:
  - `src/services/pdfProcessor.ts`
  - `tests/services/pdfProcessor.test.ts`
