# Change: 修复静默失败与错误不可观测

## Why

审计发现处理链路里有几处失败会被当成成功、被吞掉、或触发无限递归，排障只能靠猜。完整优先级如下；**本轮只做 P0 + 可随手落地的小 P1**。

### 本轮实施（P0 / 小 P1）

- **P0** Gemini Node 代理在 `https-proxy-agent` 不可用时回退调用 `doGenerateContent`，会再次走进代理分支，**无限递归**（表现为 CLI 卡住/栈溢出）。`src/services/ai/geminiProvider.ts`
- **P0** 思维导图章节 AI 失败后仍 `processed: true` 且无占位内容，导航显示绿勾，结果区跳过空导图。用户以为成功。`src/hooks/useBookProcessing.ts`
- **P0** `ErrorBoundary` 只写「页面发生错误」，不展示 `error.message`，现场无法对照控制台。`src/components/ErrorBoundary.tsx`
- **P1** Gemini 代理响应 JSON 解析失败丢弃 body，只剩「响应解析失败」。`src/services/ai/geminiProvider.ts`
- **P1** 批处理下载文件、外层 item catch、配置导入 catch 不打日志，只返回字符串。`src/services/batchProcessingEngine.ts`、`src/stores/configStore.ts`

### 后续建议（刻意不做）

- **P1** `pdfProcessor.ts` 生产环境无条件 `console.log('[DEBUG]')`，大对象 dump 拖慢解析并淹没真错误。应改走 `logger.debug`。
- **P1** CLI `src/cli/webdav_client.py` 的 `file_exists` / `get_file_info` 吞掉所有异常当「不存在」，网络故障会重复处理整书。
- **P2** 死代码：`src/services/webdavProxyService.ts`（零引用，且 REST 路径与现有 `/api/dav` header 代理不兼容）；`src/services/aiService.ts` 的 `AiService` / `AIServiceCompat`；`src/lib/error.ts`（零引用）。
- **P2** `logger` 仅 2 个文件使用，其余直打 `console`；`mapPoolOrdered` 对 `undefined` 结果会死等；AI 请求 32-bit 哈希去重有碰撞窗口。

## What Changes

- Gemini：代理模块不可用时走 SDK 直连，**禁止**回退进 `doGenerateContent`；JSON 解析失败带上 body 摘要
- 思维导图：章节生成失败标记 `processed: false`，不显示成功勾
- ErrorBoundary：界面展示错误信息（message），控制台仍记录 stack
- 批处理下载 / 外层失败 / 配置导入：`logger.error` 留下异常对象

无 **BREAKING** 变更。

## Impact

- Affected specs: ADDED `error-observability`
- Affected code:
  - `src/services/ai/geminiProvider.ts`
  - `src/hooks/useBookProcessing.ts`
  - `src/components/ErrorBoundary.tsx`
  - `src/services/batchProcessingEngine.ts`
  - `src/stores/configStore.ts`
  - `tests/components/ErrorBoundary.test.tsx`
  - `tests/services/geminiProvider.test.ts`
