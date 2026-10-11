## 1. Gemini 代理失败可诊断

- [x] 1.1 代理模块不可用时走 SDK 直连，禁止 `generateWithProxy` 回调 `doGenerateContent`
- [x] 1.2 JSON 解析失败错误信息包含 parse reason 与 body 摘要
- [x] 1.3 补充 `geminiProvider` 单测覆盖直连回退契约与解析错误文案

## 2. 处理结果不再伪装成功

- [x] 2.1 思维导图章节失败时 `processed: false`，不写入空成功导图

## 3. UI / 服务层错误可观测

- [x] 3.1 ErrorBoundary 展示 `error.message`，并补组件测试
- [x] 3.2 批处理下载与外层 item catch 调用 `logger.error`
- [x] 3.3 配置导入 catch 调用 `logger.error`

## 4. 验证

- [x] 4.1 `pnpm test`
- [x] 4.2 `pnpm build`
