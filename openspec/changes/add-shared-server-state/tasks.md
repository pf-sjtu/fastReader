# Tasks

## 1. 规格
- [x] 1.1 `openspec validate add-shared-server-state --strict` 通过

## 2. 夹具与迁移契约
- [x] 2.1 脱敏真实用户导出 → `tests/fixtures/config/export-2026-08-03.yaml`
- [x] 2.2 新增 2.0.0 样例 `tests/fixtures/config/export-v2.sample.yaml`
- [x] 2.3 失败测试：1.0.0 折叠为 1 服务商 5 模型 / active=glm-5.2 / 提示词覆盖仅 nonFiction

## 3. 服务端基础
- [x] 3.1 `functions/_lib/{kv,session,secrets,origin}.js`
- [x] 3.2 `functions/_middleware.js`：会话校验 + 安全头
- [x] 3.3 `/api/auth/{login,logout,me}`
- [x] 3.4 `/api/state`（GET 全量脱敏、PUT If-Match、append）
- [x] 3.5 单测（内存 KV）：登录/过期/伪造/改密失效/限速；state rev/409/脱敏/保留秘密/append 合并

## 4. 服务端代理
- [x] 4.1 `/api/ai` 改为按 `X-Provider-Id` 注入 base + key，拒绝任意 base
- [x] 4.2 `/api/dav` 改为按配置注入 Basic Auth
- [x] 4.3 `/api/catalog`（models.dev 精简 + Cache API 24h + 回退）
- [x] 4.4 `/api/providers/models`（OpenAI 兼容 / Gemini / Ollama）
- [x] 4.5 安全单测：未登录 401、伪造 Cookie、改密失效、不能指定任意 base、路径逃逸

## 5. 前端共享层
- [x] 5.1 `src/services/shared/api.ts`
- [x] 5.2 `src/services/shared/sharedState.ts`（hydrate / 防抖 PUT / 409 三方合并 / 聚焦刷新 + 60s 轮询 / 同步状态机）
- [x] 5.3 各子 store 去 persist，改 hydrate + bindSection
- [x] 5.4 单测：合并规则、写入节流、离线降级

## 6. 登录与初始化
- [x] 6.1 `AuthGate` + `LoginPage`
- [x] 6.2 `InitWizard`（导入配置 / 迁移本机旧配置 / 空白）
- [x] 6.3 顶栏登出 + 同步状态指示

## 7. 服务商化模型（数据层）
- [x] 7.1 `types.ts` 新模型 + `computeAIConfig` 运行时视图
- [x] 7.2 `src/stores/aiMigration.ts`（1.0.0 折叠）
- [x] 7.3 `src/services/ai/catalog.ts` 元数据匹配
- [x] 7.4 Gemini 改 REST 经代理；Ollama 保留直连；删除 `@google/generative-ai`
- [x] 7.5 价格改用模型 meta，未知模型显示未知

## 8. 服务商化模型（UI）
- [x] 8.1 `ProviderWizard`（预设选择 → Key → 获取模型 → 勾选）
- [x] 8.2 服务商卡片：模型列表、刷新、手动添加、温度、测试连接
- [x] 8.3 `ActiveModelSelect`（设置页 + 处理页快捷切换）

## 9. 提示词只留 v2
- [x] 9.1 删 `v1-prompts.yaml` 与 v1 类型/状态/UI
- [x] 9.2 overrides 存储 + 编辑器「已自定义 / 恢复默认」
- [x] 9.3 CLI `prompts.py` 同步；v1 告警

## 10. 导入导出 2.0.0
- [x] 10.1 导出 2.0.0（默认脱敏占位符，可选含密钥）
- [x] 10.2 导入预览 + 1.0.0/2.0.0 兼容
- [x] 10.3 CLI `config.py` 支持 2.0.0
- [x] 10.4 前端 + CLI 共读夹具测试

## 11. 批量队列租约 + 追加数据
- [x] 11.1 租约 + 心跳 + 接管
- [x] 11.2 历史 / 用量走 append 接口

## 12. 优化清单
- [x] 12.1 PDF 预览翻页
- [x] 12.2 思维导图按格式导出
- [x] 12.3 处理完成后历史入口仍可用
- [x] 12.4 补 6 个缺失 i18n key + key 覆盖测试
- [x] 12.5 清 `selected_chapters` 缓存提示与实际不符
- [x] 12.6 预览 Sheet 跟随 isMobile
- [x] 12.7 WebDAV 自动连接 effect 依赖修正
- [x] 12.8 cacheService LRU 索引漂移 + pagehide flush
- [x] 12.9 原生 confirm → AlertDialog（含清空历史确认）
- [x] 12.10 批量文件行键盘可选；预览关闭按钮 aria-label
- [x] 12.11 移动端溢出修复
- [x] 12.12 PdfReader 主题改用 useIsDarkMode
- [x] 12.13 懒加载 fallback 骨架屏
- [x] 12.14 ResultsSection Tab 受控
- [x] 12.15 useProcessingRun 章节索引 Map
- [x] 12.16 生产 console.log → logger
- [x] 12.17 删除 vite 重复开发代理与 ACAO `*`
- [x] 12.18 删除 `src/services/aiService.ts` 重复入口
- [x] 12.19 UnifiedStatusBar 重复按钮合并；EpubReader 死代码
- [x] 12.20 metadataFormatter 死代码与汇率并入配置
- [x] 12.21 BUG.md 登记

## 13. 文档
- [x] 13.1 `README.md`、`AGENTS.md`
- [x] 13.2 `docs/deploy.md`（KV 绑定、环境变量、wrangler 本地开发）
- [x] 13.3 `.env.example`、`docs/webdav-proxy.md`、`docs/optimization-notes.md`
- [x] 13.4 `config.example.yaml`

## 14. 验证
- [x] 14.1 `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build:pages`
- [x] 14.2 `uv run pytest -q`
- [x] 14.3 reviewer 子代理独立审查并修复
- [x] 14.4 commit + push
