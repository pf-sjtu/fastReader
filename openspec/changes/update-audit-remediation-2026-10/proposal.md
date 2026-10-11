# Change: 2026-10 全量审计整改（第 0/1 波：工具链、安全、可靠性、性能）

## Why

2026-10-11 五维度只读审计（工具链 / 处理链路 / 存储与安全 / UI / CLI）发现：

- **门禁失效**：`tsc -p` 对 solution 配置不检查任何文件，121 个类型错误长期未被发现；覆盖率因 vitest 版本错配无法运行；无 CI
- **安全**：DAV/AI 代理 path 可为绝对 URL、重定向复用 Authorization，可被当开放中继；EPUB HTML 未净化直接注入，XSS 可读出 localStorage 全部凭据；无 CSP
- **正确性**：换书/取消不作废进行中任务（旧书章节串入新书、取消后继续计费）；失败章节标记为已处理并同步云端，被永久当作完整缓存；云缓存探测失败当作「不存在」导致整库重跑
- **性能**：cytoscape（568KB）因 CJS helper 分块错误被拖进首屏；pdfjs/epubjs 静态 import；整 store 订阅使每次 AI 调用都全树重渲染
- **CLI 契约漂移**：文件名 sanitize、Markdown 结构、prompt、isPartial 与前端不一致；PDF 切章不拼正文；配置的重试参数从未生效

## What Changes

- 工具链：统一 pnpm；`tsc -b` 真实类型检查并清零错误；vitest 系列锁定同版本；最小 CI（typecheck/lint/test/build）
- 安全：代理同源断言、重定向复检、响应头白名单、请求体上限、AI 代理与 DAV 同级校验、IPv6 字面量拦截；`sanitizeBookHtml` 净化所有书籍 HTML；`public/_headers` 下发 CSP；删除遗留 Vercel 代理
- 可靠性：AbortSignal 贯穿 AI 调用与重试 sleep；并发池首错停止出队；换书递增代际；失败章节 `processed:false` + 统一占位前缀，后处理与同步过滤；云端存在性三态（exists/missing/unknown）；按 HTTP status 分类重试并读取 Retry-After、provider 级冷却
- 性能：修复分包；解析器按格式动态加载；store selector 订阅；mind-elixir 销毁与懒挂载；配置对话框仅打开时预览章节
- 状态：persist 单一来源 + version/migrate；批量队列 rehydrate 修复；tokenUsage 不持久化
- CLI：对齐前端文件名/Markdown/元数据契约；共享前端 prompt YAML；修 PDF 切章；分类重试、超时、配置边界；pyproject 声明依赖
- 决策：输出语言 auto 前端跟随界面语言、CLI 跟随原书语言；配置主表单保持即时保存；凭据存储方式不变（仅去重）

**BREAKING**：批量模式暂不支持 mindmap / combined-mindmap（此前产出空结果并被永久跳过），第 2 波统一 pipeline 后恢复。

## Impact

- Affected specs: cloud-cache, processing-metadata, batch-cli, batch-ui, lint-quality-gates；新增 proxy-security、ai-request-resilience
- Affected code: functions/**、src/services/**、src/hooks/useBookProcessing.ts、src/stores/**、src/components/**、src/cli/**、构建配置
