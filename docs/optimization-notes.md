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

- 仓库同时可能存在 `package-lock.json` 与 `pnpm-lock.yaml`；推荐团队统一一种（Agents 偏好 **pnpm**），避免交叉 `install`。
