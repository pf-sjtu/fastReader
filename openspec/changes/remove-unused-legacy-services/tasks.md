## 1. 审计与验证
- [x] 1.1 Grep 证实 `webdavProxyService.ts` 零 import 引用
- [x] 1.2 Grep 证实 `AiService` / `AIServiceCompat` 零外部引用
- [x] 1.3 Grep 证实 `src/lib/error.ts` 零 import 引用

## 2. 删除死代码
- [x] 2.1 删除 `src/services/webdavProxyService.ts`
- [x] 2.2 从 `src/services/aiService.ts` 移除 `AiService` 与 `AIServiceCompat`
- [x] 2.3 删除 `src/lib/error.ts`

## 3. 验证
- [x] 3.1 `openspec validate remove-unused-legacy-services --strict` 通过
- [x] 3.2 `pnpm test` 或构建通过
