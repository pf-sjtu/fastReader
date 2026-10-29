# Design

## 1. 服务端存储：KV 分节 + 乐观锁

KV 键 `state:<section>`，section ∈ `ai | processing | webdav | prompts | history | batch | usage`。
每个值 = `{ rev: number, updatedAt: string, data: object }`。

- `GET /api/state` 一次返回全部节（小体积，单次往返）。
- `PUT /api/state/:section` 要求 `If-Match: <rev>`；不匹配返回 `409` + 最新值，前端合并后重试。
- 追加型数据（处理历史、Token 用量）走 `POST /api/state/:section/append`，服务端合并，天然无冲突。

**为什么不强一致**：KV 是最终一致的（异地读可能滞后 ≤60s，`cacheTtl` 最小 60s），乐观锁在跨地域
同秒并发下仍有窗口。工具型多人共享场景可接受；冲突时前端以「远端字段优先、本地未冲突字段保留」合并并提示。

**KV 额度**：免费版 1000 写/天、10 万读/天、同 key 1 写/秒。因此：
- 配置写入 800ms 防抖，且只在数据实际变化时写。
- 用量按「每本书结束或每 30s」合并追加，不随每次 AI 调用写。
- models.dev 目录用 Cache API（不占 KV），24h 过期。

## 2. 秘密只存服务端

- KV 里 `providers[].apiKey`、`webdav.password` 为明文（仅服务端可读）。
- `GET /api/state` 遍历脱敏：命中秘密字段名 → 替换为 `{ hasSecret: true }`。
- `PUT` 时：字段缺席或 `{ hasSecret: true }` → 保留原值；字符串 → 覆盖；`null` → 删除。
- `/api/ai` 用 `X-Provider-Id` 取服务商的 baseUrl + key 注入 `Authorization`，**不再接受客户端传 base**（关闭开放代理面）。
- `/api/dav` 取 `webdav.serverUrl` + 凭据注入 `Basic`，客户端只传路径。

## 3. 会话

`fr_session = base64url(payload) + "." + base64url(HMAC-SHA256(payload, key))`，
`payload = {v:1, fp: sha256(APP_PASSWORD).slice(0,16), iat, exp}`。

- `key = SESSION_SECRET || sha256("fastreader:" + APP_PASSWORD)`，未配 `SESSION_SECRET` 也能工作。
- `fp` 绑定当前密码：改 `APP_PASSWORD` → 所有旧 Cookie 立即失效，无需额外版本号。
- Cookie 属性：`HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`。
- 密码比较用定长哈希 + 常数时间比较，避免时序泄漏与长度泄漏。
- 登录失败限速：KV 键 `auth:fail:<ip>` 计数（只在失败时写，命中上限返回 429）。

## 4. 前端共享状态层

- `src/services/shared/api.ts`：`fetch` 封装，401 抛 `UnauthorizedError` → 上层切登录页。
- `src/services/shared/sharedState.ts`：
  - `loadAll()` 启动拉全量 → 各 store 用 `hydrate()` 写入。
  - `bindSection(section, getData)`：订阅 store，800ms 防抖后 `PUT`。
  - 409 → 三方合并：base=上次同步成功的远端值，local=当前，remote=冲突响应；对每个顶层键：
    仅 local 改 → 用 local；仅 remote 改 → 用 remote；双方都改且不等 → remote 胜出 + toast 提示。
  - `resync()`：聚焦窗口 + 60s 轮询（只 GET，不写）。
  - 同步状态机：`idle | syncing | conflict | offline`，供顶栏展示。
- 各子 store 去掉 `persist`，改为 `hydrate()` + `bindSection()`；本地只保留 UI 偏好（主题/字号/语言）与 IndexedDB 章节缓存。

## 5. 服务商化模型配置

```ts
interface ProviderEntry {
  id: string
  name: string
  type: 'openai' | 'gemini' | 'ollama'
  baseUrl: string
  apiKey?: { hasSecret: boolean }   // 客户端只看到是否已配置
  catalogId?: string                // models.dev provider id
  models: ProviderModel[]
  modelsFetchedAt?: string
}
interface ProviderModel {
  id: string
  label?: string
  enabled: boolean
  source: 'auto' | 'manual'
  temperature?: number              // 未设置用全局默认
  meta?: { context?: number; output?: number; inputCost?: number; outputCost?: number; reasoning?: boolean; temperature?: boolean }
}
interface AIState { providers: ProviderEntry[]; active: { providerId: string; modelId: string }; defaultTemperature: number }
```

- 运行时视图 `computeAIConfig(state)` 派生扁平 `{ provider, providerId, apiUrl, model, temperature }`（无 apiKey），
  保持 `useProcessingRun` / `useKeyCharts` / `batchProcessingEngine` 等下游调用方不变。
- 元数据匹配（`src/services/ai/catalog.ts`）：catalogId 精确 → baseUrl 主机匹配 models.dev provider →
  归一化 model id（小写、去 `vendor/` 前缀、去 `:online`/`:free` 等后缀）全局匹配，官方 provider 优先。
- 目录接口 `GET /api/catalog`：服务端拉 models.dev `api.json`（5.9MB）→ 精简为
  `{providerId: {name, api, models: {id: {n,c,o,i,x,r,t}}}}`（~960KB / gzip ~138KB）→ Cache API 24h；
  上游失败时回退上一次缓存副本（KV `catalog:fallback`），仍失败则前端降级为「手动填模型」。
- 1.0.0 迁移：按 `(provider, 规范化 baseUrl, apiKey)` 分组为服务商，每组模型列表保留各自 temperature；
  `currentModelId`(1-based) → `active`。

## 6. 提示词只留 v2

- 删除 `v1-prompts.yaml`、`DEFAULT_PROMPT_CONFIG`(v1)、`promptVersionConfig` / `currentPromptVersion`。
- store 保存 `overrides: Partial<PromptConfig>`，读取时 `merge(默认v2, overrides)`；「恢复默认」= 删对应键。
- 导入 1.0.0 时 `diff(导出v2, 内置v2)` → overrides；v1 丢弃并在导入报告里说明。
- CLI `SUPPORTED_PROMPT_VERSIONS = ("v2",)`，读到 `currentPromptVersion: v1` 时告警并回退 v2。

## 7. 配置导入导出 2.0.0

```yaml
version: 2.0.0
exportTime: ...
config:
  ai:
    providers: [{ id, name, type, baseUrl, apiKey: ${FASTREADER_PROVIDER_NAVIRA_KEY} | 明文, catalogId, models: [...] }]
    active: { providerId, modelId }
    defaultTemperature: 0.7
  processingOptions: {...}
  webdav: { serverUrl, username, password: ${FASTREADER_WEBDAV_PASSWORD} | 明文 }
  prompts: { overrides: {...} }
```
- 默认导出脱敏（占位符 `\${FASTREADER_PROVIDER_<SLUG>_KEY}` / `\${FASTREADER_WEBDAV_PASSWORD}`，CLI 已支持 `${VAR}` 替换）；
  勾选「包含密钥」才导出明文。
- 导入接受 1.0.0 / 2.0.0，先解析并展示预览（新增 N 服务商 / M 模型、提示词覆盖项、WebDAV），确认后写服务端。

## 8. 批量队列执行租约

state_batch 增加 `runner: { clientId, startedAt, heartbeatAt }`。
- 开始执行 → 申请租约（无租约或心跳超 2 分钟）；每 20s 心跳。
- 非持有者只读展示进度，执行按钮禁用并提示「由他人执行中」。
- 页面卸载/取消 → 释放租约（尽力而为；超时兜底）。

## 9. 风险与取舍

- KV 最终一致 → 乐观锁有窗口；文档写明「跨地域同时编辑可能丢失同字段改动」。
- 免费额度 1000 写/天用尽后退化为只读（前端提示），需在文档说明。
- `wrangler` 在 Windows ARM64 走 x64 仿真；本地开发命令写入 `docs/deploy.md`。
- 本机 Ollama（`localhost:11434`）服务端访问不到 → 该服务商类型保留浏览器直连（无 Key，不需要注入）。
