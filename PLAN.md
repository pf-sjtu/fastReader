# fastReader：共享服务端状态 + 密码登录 + 服务商化模型配置 + 全面优化

## Context

现状：纯浏览器 SPA（Cloudflare Pages + Pages Functions，`fast-read.pages.dev` / `read-app.navira.blog`）。所有配置/状态由 zustand persist 写各自浏览器的 localStorage（`ebook-ai-config` / `ebook-processing-config` / `ebook-webdav-config` / `ebook-prompt-config` / `ebook-core-config` / `ebook-processing-history` / `fastReader-batch-queue`），API Key、WebDAV 密码散落在每个浏览器里，换设备/换人就得重配。

目标：
1. 所有用户共用一份服务端状态：AI 服务商、处理选项、WebDAV、提示词、处理历史、批量队列、Token 用量/费用。
2. 共享密码登录，浏览器记住登录态；密码取环境变量 `APP_PASSWORD`，缺省 `123456a`。
3. 模型配置改成「服务商」维度：填 baseURL + Key → 自动拉 `/models` → 用 models.dev 元数据自动补全（上下文、价格、能力）；保留手动添加模型。
4. 提示词废弃 v1，只保留 v2（仍可自定义覆盖）。
5. 兼容 `ebook-to-mindmap-config-2026-08-03T09-39-34.yaml`（及所有 1.0.0 导出）。
6. 全面修 bug、性能、UI/UX。

已确认的决策：存储用 **Cloudflare KV**；**API Key / WebDAV 密码只存服务端**，由代理注入，浏览器永远拿不到明文；共享范围 = 配置 + 处理历史 + 批量队列 + 用量统计；并发写入用 **乐观锁 + 冲突提示**。

## 探索所得（关键事实）

- AI 请求全部走 `/api/ai`（`src/services/ai/utils.ts#proxyFetch`），但 **Gemini 走 `@google/generative-ai` SDK 浏览器直连**（`geminiProvider.ts`），绕过代理——Key 只在服务端后必须改为经代理的 REST。
- WebDAV：`webdavService.ts:94/172` 在浏览器拼 Basic Auth，经 `/api/dav`（`X-WebDAV-Base`/`X-WebDAV-Path`）。
- 运行时消费 `aiConfig`（扁平 `AIProviderConfig`）的地方：`useProcessingRun.ts`、`useKeyCharts.ts`、`useBookProcessing.ts:194`、`batchProcessingEngine.ts:71/267`、`batchQueueRunner.ts`。保留一个扁平的运行时视图可把改动面压到最小。
- 用户 YAML：`version 1.0.0`；5 个 `openai` 条目同一 `apiUrl`(navira.blog/v1)+同一 Key，仅 model 不同；`currentModelId: 5`(glm-5.2)；`currentPromptVersion: v2`。与内置默认对比：仅 **v2 `chapterSummary.nonFiction` 有用户定制**（引用规则、→/✓/✗ 符号的小改），v1 `mindmap.arrow` 只有空白差异，其余与默认一致。含明文 Key 与 WebDAV 密码，测试夹具必须脱敏。
- models.dev `api.json`：5.9MB，233 家 / 8917 模型，允许 CORS；精简到 `{name, api, models:{id:{n,c,o,i,x,r,t}}}` 后 ~960KB、gzip ~138KB。用户 5 个模型在 models.dev 都能按「去前缀/后缀后的 id」命中（`grok-4.5:online` 需剥 `:online`）。
- KV 限额（官方文档 2026-10）：免费版 读 10 万/天、**写（不同 key）1000/天**、同 key 1 次/秒、单值 25MiB；**最终一致**，异地读可能滞后 ≤60s。→ 写入必须节流（用量、队列不能每次 AI 调用都写）。
- 价格：`metadataFormatter.ts#MODEL_PRICING` 精确匹配，未知模型按 gemini-1.5-pro 估价（费用失真），`registerModelPricing` 无人调用。
- CLI（`src/cli/config.py`）读同一 YAML：`_parse_ai` 只认扁平 providers 列表；`prompts.py` 仍支持 v1。
- 前后端共享契约在 `tests/fixtures/`（`config/legacy-export-2026-08.yaml` 已有）。Functions 已有单测（`tests/securityAiProxy.test.ts` 直接 import `onRequest`）。

## Approach

### A. 服务端：Pages Functions + KV（`functions/`）

绑定：KV `FASTREADER_KV`；环境变量 `APP_PASSWORD`（缺省 `123456a`）、`SESSION_SECRET`（缺省由密码派生）、既有 `ALLOWED_ORIGINS`。新增 `wrangler.toml`（`pages_build_output_dir = "dist"` + kv_namespaces）。

共享工具 `functions/_lib/`：`kv.js`（带 rev 的读写）、`session.js`（HMAC 签名 Cookie）、`secrets.js`（脱敏/合并）、`origin.js`（把 ai/dav 两份重复的 Origin 白名单逻辑合并）。

| 路由 | 作用 |
|---|---|
| `functions/_middleware.js` | 除 `/api/auth/*` 外的 `/api/*` 校验会话 Cookie，否则 401；统一安全头 |
| `POST /api/auth/login` | 常数时间比对密码 → `Set-Cookie: fr_session=…; HttpOnly; Secure; SameSite=Strict; Max-Age=30d`；签名里带密码指纹，**改密码即全员失效**；失败按 IP 限速（只在失败时写 KV） |
| `POST /api/auth/logout`、`GET /api/auth/me` | 登出 / 探活 |
| `GET /api/state` | 一次返回所有分区 `{section: {rev, updatedAt, data}}`，秘密字段替换为 `{hasSecret:true}` |
| `PUT /api/state/:section` | `If-Match: rev`；不一致 409 + 最新值；secret 字段「空=不改，新值=覆盖，null=清除」 |
| `POST /api/state/:section/append` | 历史、用量这类累加数据走追加（服务端合并，避免冲突） |
| `GET /api/catalog` | 拉 models.dev → 精简 → Cache API 缓存 24h（不占 KV 写额度）；失败回退上次缓存 |
| `POST /api/providers/models` | 用服务端存的 Key（或表单里新填的 Key）调上游 `/models`（OpenAI 兼容 / Gemini `models` / Ollama `/api/tags`），返回 id 列表 |
| `/api/ai`（改） | 改为按 `X-Provider-Id` 从 KV 取 baseURL + Key 注入；**不再接受客户端传任意 base**，顺带关掉开放代理面 |
| `/api/dav`（改） | 从 KV 取 WebDAV serverUrl + 凭据注入 Basic Auth |

KV 布局：`state:ai` / `state:processing` / `state:webdav` / `state:prompts` / `state:history` / `state:batch` / `state:usage`，每个值 `{rev, updatedAt, data}`。KV 不是强一致，乐观锁在同秒并发下仍有窗口——小团队场景可接受，文档写明。

### B. 前端共享状态层

- 新增 `src/services/shared/`：`api.ts`（fetch 封装，401 → 登录页）、`sharedState.ts`（启动拉全量、分区订阅、防抖 PUT、409 三方合并：以「上次同步值」为 base，本地改过的顶层字段覆盖到远端最新值后重试；同字段双改则远端胜出并 toast 提示）。
- 各子 store 去掉 localStorage persist，改为 `bindSharedSection(store, 'ai')`；本地只留 UI 偏好（主题、字号、语言）与 IndexedDB 章节缓存（未选择共享）。
- 写入节流：配置改动 800ms 防抖；用量在每本书结束/每 30s 合并追加；批量队列只在状态迁移时写 + 15s 防抖；历史在完成时追加，上限提到 200 条。
- 拉新：窗口重新聚焦 + 每 60s 轮询 `GET /api/state`（只读，便宜）。
- 批量队列共享：加执行租约 `runner {clientId, heartbeatAt}`，同时只有一个浏览器执行，其他人只读查看进度；心跳超时 2 分钟可接管。
- App 启动：`AuthGate` → 未登录显示 `LoginPage`（单个密码框 + 记住登录说明）；已登录但服务端为空 → 首次初始化向导：「导入配置文件」/「迁移本浏览器旧配置」（复用 `legacyMigration.ts` 读 localStorage）/「从空白开始」。
- 顶栏加「登出」，并显示同步状态（已同步 / 同步中 / 冲突 / 离线）。

### C. 服务商化模型配置

新数据模型（`src/stores/types.ts`）：
```ts
interface ProviderEntry {
  id: string                    // uuid
  name: string                  // 显示名，默认取 models.dev 名称或 hostname
  type: 'openai' | 'gemini' | 'ollama'  // 协议
  baseUrl: string
  apiKey?: { hasSecret: boolean } // 客户端只看到是否已设置
  catalogId?: string            // 对应 models.dev provider id
  models: ProviderModel[]
  modelsFetchedAt?: string
}
interface ProviderModel {
  id: string; label?: string; enabled: boolean; source: 'auto' | 'manual'
  temperature?: number          // 不填用全局默认 0.7
  meta?: { context?: number; output?: number; inputCost?: number; outputCost?: number; reasoning?: boolean; temperature?: boolean }
}
interface AIState { providers: ProviderEntry[]; active: { providerId: string; modelId: string }; defaultTemperature: number }
```
- 运行时仍由 `computeAIConfig` 派生扁平 `{provider, providerId, apiUrl, model, temperature}`（无 apiKey），下游 hooks/引擎基本不动。
- UI（`AIProviderConfig.tsx` 重写，`AIProviderDialog.tsx` 拆为两步）：
  1. 选预设（models.dev 中带 `api` 的 OpenAI 兼容服务商 + OpenAI/Gemini/Ollama/自定义，可搜索）→ 自动填 baseURL、名称；
  2. 填 Key → 「获取模型」→ 列表（带上下文/价格/推理标签，可搜索、全选、勾选启用）→ 保存；
  3. 服务商卡片下展开模型，可「刷新模型」「手动添加模型」「设温度」「测试连接」；顶部全局「当前模型」下拉（按服务商分组），处理页也放一个快捷切换。
- 元数据匹配 `src/services/ai/catalog.ts`：先按 catalogId 精确，再按 baseURL 主机匹配 models.dev provider，最后全局按归一化 id（小写、去 `vendor/` 前缀、去 `:online`/`:free` 等后缀）匹配，优先官方 provider 的价格。
- 价格：`metadataFormatter` 先用模型 `meta` 价格，再查 `MODEL_PRICING`，都没有就显示「未知」而不是按 gemini-1.5-pro 估。
- Gemini：删掉 `@google/generative-ai`，改用 REST `models/{m}:generateContent` 经 `/api/ai`（Key 由代理以 `x-goog-api-key` 注入）——同时减小首屏包。
- Ollama：本机地址（localhost）服务端访问不到，保留「浏览器直连」模式（无 Key），其余一律走代理。
- 旧格式迁移 `src/stores/aiMigration.ts`：1.0.0 的扁平 providers 按 `(provider, normalizedApiUrl, apiKey)` 分组折叠为服务商，模型带各自 temperature；`currentModelId` → `active`。用户文件 → 1 个服务商「navira.blog」+ 5 个模型，当前 glm-5.2。

### D. 提示词只保留 v2

- 删 `v1-prompts.yaml`、`DEFAULT_PROMPT_CONFIG`(v1)、版本切换 UI、`promptVersionConfig/currentPromptVersion` 状态。
- store 只存**相对默认值的覆盖项**（`overrides: Partial<PromptConfig>`），内置 v2 升级后未改动的项自动跟随；编辑器显示「已自定义 / 恢复默认」。
- 导入 1.0.0：取 `promptVersionConfig.v2` 与默认 diff 存为覆盖（用户文件 → 仅 `chapterSummary.nonFiction` 一项），v1 忽略并在导入报告里说明。
- CLI：`prompts.py` 去掉 v1，`SUPPORTED_PROMPT_VERSIONS=("v2",)`；读到 v1 配置时告警并用 v2。

### E. 配置导入导出

- 导出 `version: 2.0.0`：`{ai, processingOptions, webdav, prompts.overrides, ...}`，**默认不含秘密**（Key/密码写成 `${FASTREADER_PROVIDER_<NAME>_KEY}` 占位，CLI 可直接用环境变量替换）；勾选「包含密钥」才导出明文。
- 导入接受 1.0.0 / 2.0.0，先展示预览（将新增 N 个服务商 / M 个模型、提示词覆盖项、WebDAV），确认后写服务端；导入里的明文 Key 直接存入服务端。
- CLI `config.py#_parse_ai` 同时支持 2.0.0 结构（`ai.providers[].models[]` + `active`），继续支持 1.0.0。

### F. 全面优化（已核实的项）

Bug：
1. `PdfReader.tsx:110` 翻页控件只在 `showHeader` 时渲染，而 `PreviewPanel.tsx:132/142` 恒传 `false` → PDF 预览永远停在第 1 页。加紧凑分页条。
2. `App.tsx:201` `downloadMindMap` 收到的是 MindElixir 实例（`DownloadMindMapButton.tsx:44` 传 `instance, title, format`），却当数据 `JSON.stringify`，format 被忽略、toast 文案错 → 按 format 分支导出（JSON 用 `getData()`，PNG/SVG/HTML/Markdown 用 mind-elixir 导出 API）。
3. `UnifiedStatusBar.tsx:140-145` 历史入口要求 `progress===0`，处理完一次后再也打不开 → 改用独立条件。
4. i18n 缺键（zh/en 都缺，已脚本核对）：`batch.selectAll`、`batch.fileCount`、`batch.queueTitle`、`batch.chapterCount`、`batch.toast.startedDesc`、`batch.toast.itemPartialDesc`。加键 + 加一个「代码里用到的 key 必须在 locale 中存在」的测试。
5. `useBookProcessing.ts:290` 清 `selected_chapters` 时 `kind=null` 什么都没清却提示成功。
6. `App.tsx` 预览 Sheet 不看 `isMobile`，转到桌面宽度仍覆盖。
7. `App.tsx:139-160` WebDAV 自动连接 effect 依赖 `[]`，之后开启 WebDAV 不会连接；固定 3s 延迟与首次选书竞争 → 改为订阅配置变化。
8. `cacheService.ts:137-152` LRU 写入前先删索引，配额失败后索引与存储漂移；LRU 更新防抖落盘在关页时丢失（`pagehide` 时 flush）。

UX / 可访问性：
9. 原生 `confirm()`（`ConfigExportImport.tsx:117`、`AIProviderConfig.tsx:124`）及清空历史无确认 → 统一 `AlertDialog`。
10. `BatchFileTab.tsx:99-104` 行是 div+onClick，键盘不可选；`PreviewPanel.tsx:114` 关闭按钮无 aria-label。
11. 移动端溢出：`WebDAVFileBrowser.tsx:195` 工具条无 `flex-wrap`、`:304` `min-w-[800px]`；`BatchFileTab.tsx:85` `min-w-[600px]` 被裁切。
12. `PdfReader.tsx:78` 用 classList 判主题，切主题不刷新 → 复用 `useIsDarkMode`。
13. `App.tsx:436-448` 懒加载 fallback 为 `null` → 骨架屏。
14. `ResultsSection.tsx:191` mindmap 分支 Tab 非受控 → 统一受控。

性能 / 代码质量：
15. `useProcessingRun.ts:180` 每章 `findIndex` → 预建 Map。
16. 生产代码 24 处 `console.log`（autoSync/cloudCache/webdav/Upload/PromptEditor）→ `lib/logger`。
17. `vite.config.ts:73-118` 两段重复的开发代理、ACAO `*`、逐请求日志 → 删除，开发改用 `wrangler pages dev`（需要 Functions + KV）。
18. 删兼容壳重复入口 `src/services/aiService.ts`；`configStore` 兼容壳里与 v1 / 旧 AI setter 相关的方法一并删减。
19. `UnifiedStatusBar.tsx:232-249` 重复按钮合并；`EpubReader.tsx:392-415` 无人监听的 `content-updated` 事件与重复的归零逻辑删除。
20. `metadataFormatter.ts:64-72` 浏览器分支读 `process.env` 的死代码 → 汇率并入共享处理选项。
21. `BUG.md` 为空：把上面已修/未修项登记进去。

## Files to modify

- 新增：`wrangler.toml`、`functions/_middleware.js`、`functions/_lib/{kv,session,secrets,origin}.js`、`functions/api/auth/{login,logout,me}.js`、`functions/api/state/[[section]].js`、`functions/api/catalog.js`、`functions/api/providers/models.js`
- 修改：`functions/api/ai/[[path]].js`、`functions/api/dav/[[path]].js`
- 新增前端：`src/services/shared/{api,sharedState}.ts`、`src/services/ai/catalog.ts`、`src/stores/aiMigration.ts`、`src/components/auth/{AuthGate,LoginPage}.tsx`、`src/components/onboarding/InitWizard.tsx`、`src/components/project/config/{ProviderWizard,ProviderModelList,ActiveModelSelect}.tsx`
- 重构：`src/stores/{types.ts,ai-config,prompts,webdav,processing,core,processingHistory,batchQueueStore.ts,configStore.ts,legacyMigration.ts}`、`src/services/ai/{geminiProvider,openaiProvider,ollamaProvider,utils,factory}.ts`、`src/services/webdavService.ts`、`src/services/configExportService.ts`、`src/services/metadataFormatter.ts`、`src/services/prompts/{templates/index.ts,config/promptLoader.ts}`、`src/components/project/{AIProviderConfig,PromptEditor}.tsx`、`src/components/ConfigExportImport.tsx`、`src/App.tsx`
- 删除：`src/services/prompts/config/v1-prompts.yaml`、`src/services/aiService.ts`、依赖 `@google/generative-ai`
- 优化项涉及：`PdfReader.tsx`、`PreviewPanel.tsx`、`DownloadMindMapButton.tsx`、`UnifiedStatusBar.tsx`、`useBookProcessing.ts`、`useProcessingRun.ts`、`cacheService.ts`、`EpubReader.tsx`、`WebDAVFileBrowser.tsx`、`batch/*`、`ResultsSection.tsx`、`vite.config.ts`、`i18n/locales/{zh,en}.json`
- CLI：`src/cli/config.py`、`src/cli/prompts.py`、`config.example.yaml`
- 夹具：`tests/fixtures/config/export-2026-08-03.yaml`（由用户文件脱敏：Key/密码/用户名替换）、`tests/fixtures/config/export-v2.sample.yaml`
- 文档：`openspec/changes/add-shared-server-state/*`、`README.md`、`AGENTS.md`、`docs/deploy.md`（新：KV 绑定、环境变量、本地开发）、`docs/webdav-proxy.md`、`.env.example`、`BUG.md`

## Reuse

- `src/services/webdavProxyUtils.ts#isValidUpstreamBase / resolveScopedUpstreamUrl`：新代理与 `/api/providers/models` 继续用作上游校验。
- `src/stores/ai-config#mergeAIConfigManager`、`src/stores/legacyMigration.ts#migrateLegacyConfig`：作为 1.0.0 → 2.0.0 迁移的输入适配层。
- `src/services/configExportService.ts` 的校验/文件名逻辑沿用，版本分支扩展。
- `src/services/ai/retry.ts`、`baseProvider.ts`（重试、429 冷却、取消）不动，Gemini REST 化后直接复用。
- `src/utils/async.ts#mapPoolOrdered`、`useConfigStore` 兼容壳的 selector 模式，保持下游调用方不变。
- 现有 Functions 单测写法（直接 import `onRequest` + 构造 `Request`）用于新路由；KV 用内存 Map 实现的 mock。
- UI：现有 shadcn `AlertDialog`/`Dialog`/`Select`/`Badge`/`ScrollArea`。

## Steps

- [x] 1. 写 openspec 变更 `add-shared-server-state`（proposal / tasks / spec delta：auth、shared-state、provider-config、prompts-v2-only），`openspec validate --strict`
- [x] 2. 夹具与契约：脱敏用户 YAML 入 `tests/fixtures/config/`，写 2.0.0 样例；先写失败测试（1.0.0 折叠为 1 服务商 5 模型、active=glm-5.2、提示词覆盖只剩 nonFiction）
- [x] 3. 服务端：`_lib` + 登录/会话中间件 + `/api/state`（rev/409/秘密脱敏/append）+ 单测（内存 KV）
- [x] 4. 服务端：`/api/ai`、`/api/dav` 改为按 id 注入秘密；`/api/catalog`、`/api/providers/models`；安全单测（未登录 401、伪造 Cookie、改密码失效、不能指定任意 base、路径逃逸）
- [x] 5. 前端共享层：`shared/api`、`sharedState`（防抖、409 合并、轮询、离线状态），各子 store 换绑；单测覆盖合并规则与写入节流
- [x] 6. 登录与初始化：`AuthGate`、`LoginPage`、`InitWizard`（导入文件 / 迁移本机旧配置 / 空白）、登出与同步状态指示
- [x] 7. 服务商模型：新类型 + `aiMigration` + `catalog` 匹配 + `computeAIConfig` 运行时视图；Gemini 改 REST、Ollama 直连分支；价格改用 meta
- [x] 8. 服务商 UI：预设选择、获取模型、模型勾选/手动添加/温度、当前模型切换（设置页 + 处理页快捷）
- [x] 9. 提示词只留 v2：删除 v1、覆盖项存储、编辑器「已自定义/恢复默认」；CLI 同步
- [x] 10. 导入导出 2.0.0（预览、默认不含密钥）+ CLI `config.py` 支持 2.0.0；前端/CLI 共读夹具测试
- [x] 11. 批量队列执行租约 + 历史/用量追加接口接入
- [x] 12. 优化清单 F1–F21（每个 bug 先补回归测试）
- [x] 13. 文档：README、AGENTS.md、`docs/deploy.md`、`.env.example`、BUG.md、optimization-notes
- [x] 14. 全量验证（见下）+ reviewer 子代理独立审查 → 修复 → commit / push

执行分工：步骤 3–4 交 `coder`，6、8、12 的 UI 部分交 `frontend`，5/7/9/10 主线程做并桥接（共享 `types.ts` 先由主线程定稿，避免并发改同一文件）。

## Verification

- `pnpm typecheck`、`pnpm lint`、`pnpm test`（含新 Functions 单测、迁移/夹具契约测试、i18n key 覆盖测试）、`pnpm build:pages`（含 chunk 循环检查，并确认移除 Gemini SDK 后首屏体积下降）
- `uv run pytest -q`（CLI 读 1.0.0 用户夹具与 2.0.0 样例；v1 告警）
- 本地端到端：`wrangler pages dev`（本地 KV）+ 浏览器：
  - 未登录访问 → 登录页；错误密码提示与限速；`123456a` 登录后刷新仍保持；登出后失效；改 `APP_PASSWORD` 后旧 Cookie 失效
  - 初始化向导导入用户 YAML → 1 个服务商 5 个模型、当前 glm-5.2、提示词仅 nonFiction 为自定义；DevTools 里看不到 Key / WebDAV 密码
  - 新增服务商 → 获取模型 → models.dev 元数据显示；手动加模型；切换模型后跑一章摘要成功（真实 AI 用 `E2E_CONFIG` 现有联调测试）
  - 两个浏览器（不同 profile）同时改同一分区 → 冲突提示且不丢字段；A 处理完一本书 → B 看到历史与用量
  - 批量队列：A 执行时 B 只读看进度
  - F 清单逐项手测（PDF 翻页、导图各格式导出、历史入口、375px 布局、键盘选择批量文件）
- 风险/未验证项会在完成汇报中列出：KV 最终一致导致的乐观锁窗口、免费额度 1000 写/天、`wrangler` 在 Windows ARM64 上走 x64 仿真。
