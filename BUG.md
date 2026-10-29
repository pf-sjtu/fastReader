# BUG 记录

> 格式：`- [状态] 位置 — 问题 → 修复`。状态：已修 / 待修 / 已知取舍。
> 本轮（共享状态重构）修复与登记的项如下；`docs/optimization-notes.md` 里有更详细的来龙去脉。

## 已修

### 共享状态 / 服务端

- [已修] `src/stores/*` — 配置全部存在各浏览器 localStorage，换设备/换人重配、API Key 明文可被 DevTools 读取
  → 迁到 Cloudflare KV，分节乐观锁；密钥只在服务端，代理注入
- [已修] `src/services/ai/geminiProvider.ts` — Gemini 走 `@google/generative-ai` SDK 浏览器直连，绕过同源代理
  → 改 REST 经 `/api/ai`，Key 由服务端注入，同时移除了 1 个依赖
- [已修] `functions/api/ai/[[path]].js` — 接受客户端任意 `X-AI-Base`，等于开放代理
  → 上游 base 与凭据只能来自共享状态；客户端伪造的 `Authorization` 被丢弃
- [已修] `functions/api/dav/[[path]].js` — 同上的 `X-WebDAV-Base` 任意上游问题
  → 服务端配置为准
- [已修] 登录 — 无访问控制，任何人打开页面即可读全员配置
  → 共享密码 + HttpOnly 签名 Cookie，改密码即全端失效，失败限速 10 次/10 分钟
- [已修] `functions/_middleware.js` — （新增）`/api/*` 统一会话校验
- [已修] 多人同时改配置 — 后写覆盖前写且无提示
  → `If-Match` 乐观锁 + 409 + 前端按字段三方合并；同字段双改时远端胜出并提示

### 配置与提示词

- [已修] `src/stores/ai-config/index.ts` — 一条配置 = 一个模型，同服务商 5 个模型要 5 条重复条目（真实用户导出即如此）
  → 服务商维度 + 多模型；导入旧配置按 `(协议, baseUrl, apiKey)` 自动折叠
- [已修] `src/services/metadataFormatter.ts` — 未登记价格的模型一律按 `gemini-1.5-pro` 估价，费用系统性失真
  → 优先用 models.dev 元数据；都没有时标 `pricingKnown:false` 并显示「未计价」
- [已修] `src/services/metadataFormatter.ts` — 浏览器分支读 `process.env.EXCHANGE_RATE_USD_TO_CNY`，在 SPA 里是死代码
  → 汇率并入共享处理配置，通过 provider 注入
- [已修] `src/stores/prompts/index.ts` — v1/v2 双版本 + 整份模板快照，内置模板升级无法触达老用户
  → 只留 v2，用户自定义存为「相对默认的覆盖项」
- [已修] `src/cli/prompts.py` — 仍支持 v1 模板；v1 文件删除后会直接抛 FileNotFoundError
  → 只支持 v2，读到 v1 声明时告警并回退

### UI / UX

- [已修] `src/components/PdfReader.tsx` — 翻页控件只在 `showHeader` 时渲染，而 `PreviewPanel` 恒传 `false`
  → PDF 预览永远停在第 1 页且无翻页入口
- [已修] `src/App.tsx` + `src/components/DownloadMindMapButton.tsx` — 导图导出时把 MindElixir **实例**当数据 `JSON.stringify`，
  `format` 参数被忽略，5 种格式永远写成 `.json`，toast 还误用 markdown 文案
  → `src/utils/mindmapExport.ts` 按格式真正导出 PNG/JPEG/WEBP/SVG/HTML/JSON/Markdown
- [已修] `src/components/UnifiedStatusBar.tsx` — 历史入口要求 `progress === 0`，处理完一次后 `progress=100`，历史再也打不开
  → 改为「当前没在跑」判定
- [已修] `src/components/UnifiedStatusBar.tsx` — 渲染期 `setState`；两段近乎相同的「重新处理」按钮 → 移到 effect，合并为一个按钮
- [已修] `src/hooks/useBookProcessing.ts` — 清 `selected_chapters` 时 `kind` 为 `null`，什么都没清却弹「已清除」
  → 该类型压根不是磁盘缓存，改为重置章节勾选
- [已修] i18n 缺键（zh/en 都缺，界面直接显示原始 key）：`batch.selectAll`、`batch.fileCount`、`batch.queueTitle`、
  `batch.chapterCount`、`batch.toast.startedDesc`、`batch.toast.itemPartialDesc`
- [已修] 原生 `confirm()`（`ConfigExportImport`、清空历史）→ 统一 `AlertDialog`
- [已修] `src/components/project/batch/BatchFileTab.tsx` — 文件行是 `<div onClick>`，键盘用户无法选择；内层 `Checkbox` 无 `onCheckedChange`
- [已修] `src/components/sections/PreviewPanel.tsx` — 关闭按钮是裸 `×`，无 `aria-label`
- [已修] 移动端溢出：`WebDAVFileBrowser` 工具条不换行、`min-w-[800px]`；`BatchFileTab` 的 `min-w-[600px]` 被裁切
- [已修] `src/components/PdfReader.tsx` — 用 `document.documentElement.classList` 判主题，切主题后画布样式不刷新
- [已修] `src/App.tsx` — 预览 `Sheet` 不判断 `isMobile`，转到桌面宽度后仍盖住右侧面板
- [已修] `src/App.tsx` — 懒加载 `Suspense fallback={null}`，加载期完全无反馈 → 骨架屏

### 性能 / 代码质量

- [已修] `src/App.tsx` — WebDAV 自动连接 effect 依赖 `[]`，之后在设置里开启 WebDAV 永不自动连接；固定 3s 延迟还会与首次选书竞争
  → 依赖配置变化
- [已修] `src/hooks/useProcessingRun.ts` — 每个章节都用 `findIndex` 定位序号 → 预建 `Map`
- [已修] 生产代码 20+ 处 `console.log`（autoSync/cloudCache/webdav/upload）→ `lib/logger`
- [已修] `vite.config.ts` — 两段几乎重复的开发代理、逐请求日志、把响应 `ACAO` 改成 `*`、硬编码坚果云 target
  → 删除；本地开发统一 `wrangler pages dev`
- [已修] `src/services/aiService.ts` — 与 `src/services/ai/index.ts` 导出同一批符号，两套 import 入口 → 删除兼容壳
- [已修] `src/services/cacheService.ts` — `set()` 先删索引再写，配额失败后索引与存储漂移
  → 写成功后才更新索引，失败回滚
- [已修] `src/services/cacheService.ts` — LRU 的 `lastAccessed` 靠 1s 防抖落盘，标签页关闭即丢，淘汰顺序失真
  → `pagehide` / `visibilitychange` 时立即落盘
- [已修] `src/components/EpubReader.tsx` — 无人监听的 `content-updated` 事件与重复的归零定时器 → 删除

## 代码审查发现并已修（2026-11 复审）

- [已修] `functions/api/providers/models.js` — 带 `providerId` 时会用**服务端保存的 Key** 去访问**客户端指定的 baseUrl**，
  等于任何登录用户都能把全体 API Key 外发到自己的域名 → 只有客户端自带 Key 时才允许用它的 baseUrl
- [已修] `functions/_lib/session.js` — 漏配 `APP_PASSWORD` 时悄悄回落 `123456a` → 公网部署等于无密码；现在非本机环境直接 503
- [已修] `functions/api/auth/[[action]].js` — 失败限速只写 KV，而 KV 最终一致（同 key 1 写/秒），并发爆破全读 0
  → 改「isolate 内内存计数 + KV 兜底」
- [已修] 清除密钥/密码不生效 — 服务端把「字段缺席」当「保留原值」，客户端删字段等于没清 → 改为显式提交 `null`
- [已修] `sharedState.ts` — 写入进行中又有新编辑时，base 回读成「含未发送新值」，重试被 `deepEqual` 短路 → 永久丢写
- [已修] `sharedState.ts` — `resync` 三方合并后没有写回，本地改动被标记为「已同步」→ 合并后强制写回
- [已修] `sharedState.ts` — 冲突状态刚设置就被循环末尾的 `idle` 覆盖，用户看不到 → 保留 conflict 状态并弹 toast
- [已修] 纯防抖在连续更新（进度条）下永不落盘 → 加 10s `maxWait` 兜底
- [已修] `batchQueueStore.ts` — 租约心跳只在「每本书开始」触发，单本书超过 2 分钟就会被别人接管（重复花 AI 费用）
  → 30s 独立心跳定时器
- [已修] `batchQueueStore.ts` — 只读观察者每次 resync 都把别人的 `processing` 降级成 `pending`，永远看不到真实进度
  → 有活跃 runner 时保留 processing
- [已修] `ConfigExportImport` — 「包含密钥」实际一个密钥都没导出（静默失败）→ 接上待提交密钥，并改文案说明服务端密钥不可导出
- [已修] `/api/ai` — 全量透传上游响应头（含 3xx 的 `location`）→ 加白名单，与 `/api/dav` 一致
- [已修] `/api/dav` — 50MB 请求体整体读进 128MB 的 Worker 内存 → 长度已知时流式转发

- [已修] 会话失效（改密码/过期）后前端仍可继续编辑，所有写入静默失败 → 401 广播事件，AuthGate 退回登录页
- [已修] 关页时 `flushSection` 发出的请求会被浏览器取消 → 卸载时用 `keepalive`（<60KB），且只写有挂起改动的分区
- [已修] 密码比较在长度不同时立即返回（泄漏长度）→ 先各自 SHA-256 成定长再常数时间比较
- [已修] 单测直接 import Functions，绕过打包器，`../../_lib/` 这类路径错误只有部署时才暴露
  → 新增 `scripts/check-functions-build.mjs`（esbuild 逐入口打包），接入 `build:pages` 与 CI；已验证能拦住该 bug

## 已知取舍（不修）

- [已知取舍] **KV 最终一致**：异地读最多滞后 60s，乐观锁在跨地域同秒并发时可能丢一次同字段改动。小团队场景可接受。
- [已知取舍] **KV 免费额度**：1000 写/天。写入已做防抖/批量合并，但极端情况下会写满 → 界面进入离线状态并保留本地改动。
- [已知取舍] **Ollama 不经代理**：本机 `http://localhost:11434` 服务端访问不到，保持浏览器直连（因此也不需要密钥）。
- [已知取舍] **章节缓存不共享**：仍在各浏览器 IndexedDB（体积大，KV 不适合）。A 处理过的书 B 仍会重跑。
- [已知取舍] CSP `connect-src` 只放行 https + 本机 http：局域网 Ollama（`192.168.x.x:11434`）会被拦，需 https 反代或本机地址。
