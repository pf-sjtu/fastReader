# Change: 共享服务端状态 + 密码登录 + 服务商化模型配置

## Why

当前 fastReader 是纯浏览器 SPA，所有配置与状态由 zustand persist 写在各自浏览器的 localStorage
（`ebook-ai-config` / `ebook-processing-config` / `ebook-webdav-config` / `ebook-prompt-config` /
`ebook-core-config` / `ebook-processing-history` / `fastReader-batch-queue`）。带来三个问题：

- **配置不共享**：换设备、换浏览器、多人协作都要重配一遍；服务商 Key 与 WebDAV 密码散落在每个浏览器。
- **凭据暴露在浏览器**：API Key 明文存在 localStorage 并随请求发到同源代理，任何能打开 DevTools 的人都能读走。
- **模型配置维度错误**：一条配置 = 「一个模型」，同一服务商的 5 个模型要塞 5 条重复条目（真实用户导出配置即如此）。

同时存在一批已核实的缺陷与体验问题：PDF 预览无法翻页、思维导图导出忽略格式、处理完一次后历史入口消失、
6 个 i18n key 缺失、原生 `confirm()`、移动端溢出等。

## What Changes

- **共享状态（新增能力 shared-state）**：状态迁到 Cloudflare KV，前端启动拉全量、分节乐观锁写回、冲突三方合并；
  共享范围 = AI 服务商 / 处理选项 / WebDAV / 提示词 / 处理历史 / 批量队列 / Token 用量。
  秘密字段（API Key、WebDAV 密码）只在服务端保存，读取时脱敏，由代理注入。
- **访问控制（新增能力 access-control）**：共享密码登录，密码取环境变量 `APP_PASSWORD`（缺省 `123456a`），
  会话用 HttpOnly 签名 Cookie 记住 30 天；改密码即全员失效；`/api/*`（除 auth）一律要求会话。
- **服务商化模型配置（新增能力 ai-provider-config）**：一条配置 = 一个服务商（baseURL + Key）+ 多个模型；
  用 `GET /models` 自动拉取模型列表，用 models.dev 元数据自动补全上下文/价格/能力；保留手动添加；
  兼容 1.0.0 导出（按 `(provider, baseUrl, apiKey)` 折叠为服务商）。
- **提示词只保留 v2（修改能力 prompt-templates）**：删除 v1 模板与版本切换，store 只存相对 v2 默认值的覆盖项；
  CLI 同步；读到 v1 配置时告警并使用 v2。
- **配置导入导出 2.0.0**：默认不含密钥（占位符 + 环境变量引用），导入前展示预览；继续接受 1.0.0。
- **批量队列执行租约**：共享队列同一时刻只允许一个浏览器执行，其余只读。
- **缺陷与体验修复**：见 tasks.md 第 12 节。

**BREAKING**：
- 不再支持纯浏览器（无 Functions）部署：所有状态与 AI/WebDAV 请求都依赖 Pages Functions + KV。
- Gemini 不再使用 `@google/generative-ai` 浏览器直连 SDK，改为经同源代理的 REST。
- 提示词 v1 被移除，`currentPromptVersion` / `promptVersionConfig` 字段废弃（导入时自动转换）。
- 配置文件格式升级为 2.0.0；1.0.0 仍可导入但不原样导出。

## Impact

- Affected specs: 新增 `shared-state`、`access-control`、`ai-provider-config`；修改 `prompt-templates`、`proxy-security`
- Affected code: `functions/**`、`src/services/shared/**`、`src/services/ai/**`、`src/stores/**`、
  `src/components/auth/**`、`src/components/onboarding/**`、`src/components/project/**`、`src/App.tsx`、
  `src/services/{configExportService,metadataFormatter,webdavService}.ts`、`src/cli/{config,prompts}.py`
- 部署：新增 `wrangler.toml`、KV 绑定 `FASTREADER_KV`、环境变量 `APP_PASSWORD` / `SESSION_SECRET`
