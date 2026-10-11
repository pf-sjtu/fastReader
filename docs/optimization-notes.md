# 优化说明（2026-08）

## 章节并行

- 配置项：`processingOptions.chapterConcurrency`（默认 **3**，范围 1–10）
- UI：配置对话框 →「章节并行数」
- 实现：`mapPoolOrdered`（`src/utils/async.ts`）
  - 任务可并行执行
  - **结果数组与 UI 提交严格按章节输入顺序**，完成先后不影响呈现顺序
- 单书：`useBookProcessing.processBook`
- 批量：文件级并行 + 单文件内章节并行，完成回调按队列/章节顺序触发

## 日志

- `src/lib/logger.ts`：生产默认不输出 debug/info；`import.meta.env.DEV` 或 `VITE_DEBUG=1` 开启

## WebDAV 代理

- `isValidUpstreamBase` 拒绝：非 https、内嵌凭据、localhost/私网/链路本地主机
- Cloudflare Function：Origin 优先于可伪造的 `X-Request-Origin`

## 首屏

- `ResultsSection` / `WebDAVFileBrowser` / `BatchQueuePanel` 使用 `React.lazy`

## 子项目边界

| 路径 | 角色 |
|------|------|
| `src/` SPA | **权威前端** |
| `src/cli/` Python | 批量 CLI；prompt/元数据需与前端约定对齐 |
| `md_reader/` | 历史/独立 Markdown 阅读器，**非主产品路径**；勿与 fastReader 业务耦合 |

## 包管理

- 统一使用 **pnpm**（`packageManager` 字段锁定版本），只提交 `pnpm-lock.yaml`；`package-lock.json` 已忽略
- `pnpm build` = `tsc -b`（真实类型检查）+ `vite build`；`pnpm typecheck` 单独跑类型检查
- vite 配置只保留根目录 `vite.config.ts` 一份

## 2026-10 全量整改（详见 openspec/changes/update-audit-remediation-2026-10、refactor-unified-book-pipeline）

### 首屏分包
- Rollup 的两个 CJS 虚拟模块 `\0commonjsHelpers.js` 与 `\0commonjs-dynamic-modules` 必须单独成 `cjs-helpers` 块：
  它们不含 `node_modules`，`manualChunks` 返回 undefined 时会被并入第一个依赖它们的手动块（曾先后把 cytoscape、epubjs 拖进首屏）
- 解析器（pdfjs / epubjs）一律按格式动态 import；首屏 JS 2.43MB → 1.19MB
- 排查方法：`dist/index.html` 的 modulepreload 列表；sourcemap 不含 `\0` 模块，需临时插件在 `generateBundle` 中打印 `chunk.modules`

### 取消与重试
- `AICallOptions.signal` 贯穿到 fetch 与重试等待；Gemini SDK 仅客户端放弃等待，服务端可能仍计费
- 只重试 408/429/5xx/网络错误，上下文超长优先判定；Retry-After 优先，否则指数退避 + 抖动；同一服务商 429 共享冷却

### 结果可信度
- 失败章节 `processed:false` + `utils/resultStatus.ts` 前缀；有失败即元数据 `isPartial`
- 云端存在性三态（exists / missing / unknown），unknown 时批量中止，避免网络抖动触发整库重跑覆盖

### 缓存
- IndexedDB，键见 `services/pipeline/cacheKeys.ts`；书级结果同样缓存，强制重跑需先清缓存
- 批量拿不到可靠修改时间，指纹的 lastModified 记 0（仅按大小 + 前 64KB 区分）
- 无 `crypto.subtle`（非安全上下文）或无 IndexedDB 时缓存静默停用

### 已知取舍
- CSP `connect-src` 只放行 https 与本机 http：局域网 http Ollama（如 `192.168.x.x:11434`）会被拦截，需改用 https 反代或本机地址
- AI 代理只接受 https 公网 base：公网 IP 上的 http 自建服务商会被拒
- 默认 prompt 版本为 v2（v2 结构更完整）：前端 `DEFAULT_PROMPT_VERSION` 与 CLI `DEFAULT_PROMPT_VERSION` 必须一致；已持久化为 v1 的用户保持 v1（无法区分「主动选择」与「沿用旧默认」，不擅自改动）
- 旧版导出配置（`tests/fixtures/config/legacy-export-2026-08.yaml`，由真实导出脱敏）前端 `importConfig` 与 CLI `ConfigLoader` 均可直接读取；导入时 `connectionStatus` 重置为 `disconnected`（运行时状态不随备份迁移），`customFields` 空值归一化为对象
- 真实 WebDAV 联调（`tests/tour/liveWebdav.test.ts`，设置 `E2E_CONFIG` 才运行，只写专用沙盒目录）发现两类 mock 测试永远发现不了的问题：（1）代理响应头白名单保留了 `content-length` 却丢了 `content-encoding`——上游 gzip 时 fetch 已解压，长度头是压缩后的，正文被截断；现在上游有内容编码时丢弃 `content-length`。（2）上传前只创建最后一级目录，`{书名}/mindmaps/` 这类两级新目录在标准 WebDAV 服务器（MKCOL 缺上级返回 409）上必然失败；现在自顶向下逐级创建，并缓存已确认存在的目录
- 输出语言 auto：前端跟随界面语言，CLI 跟随原书语言（CLI 无界面）
