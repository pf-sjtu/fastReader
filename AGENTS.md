<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->
# 操作守则
- 使用中文回复和撰写文档，特别是openspec文档
- 有实质代码/配置改动时，**必须**按下方「修改 → 测试 → 提交 → 推送」流程收尾，不得只改代码不验证、不落地版本库

## 修改 → 测试 → 提交 → 推送（强制流程）

完成可交付改动后，按顺序执行；任一步失败则先修复再继续，不得跳过。

### 1. 修改（Modify）
- 先读相关实现与本文件约束，沿用现有模式，只改必要范围
- 不碰无关文件；工作树已有他人/用户改动不擅自回滚
- 禁止直接编辑 `.env`；密钥不入库

### 2. 测试（Test）
改动涉及前端/逻辑时，至少跑通与改动相关的检查（按改动面取子集，**有测试体系时优先真实测试**）：

| 改动类型 | 最低要求 |
|---------|----------|
| 业务逻辑 / store / services | `pnpm test`（或针对相关文件的 vitest） |
| UI / 样式 / 布局 | `pnpm build` 或等价 Vite 构建通过；能本地 dev 时说明关键路径已自测 |
| 类型 / 接口变更 | 构建含类型检查通过（`pnpm build` 内含 `tsc`） |
| 仅文档 / AGENTS 文案 | 可跳过自动化测试，仍须 commit |

- 测试失败必须先修再提交；无法跑通时在回复中标明 **未验证项与风险**
- 长期/关键链路测试放 `tests/`（含 `tests/circuit/` 若有）

### 3. 提交（Commit）
测试通过后：

```bash
git status
git diff
git log -5 --oneline   # 对齐既有 message 风格
git add <相关文件>     # 不 stage 无关改动、密钥、大体积产物
git commit -m "..."    # 中文或项目既有风格；写清动机与主要改动
```

- **构建号**：`src/buildInfo.ts` 的 `BUILD_VERSION`（`YYYYMMDD.bN`）由 `pre-commit` hook 自动 bump；首次 clone 后执行 `pnpm hooks:install`（或 `pnpm install` 触发 `prepare`）。若 hook 未生效，提交前手动 `node scripts/bump-build.mjs` 并 `git add src/buildInfo.ts`
- 提交信息聚焦「为什么」与关键改动，避免空泛 `update` / `fix`
- 不使用 `git commit --amend` 改写已推送历史，除非用户明确要求

### 4. 推送（Push）
提交成功后推送到远程跟踪分支：

```bash
git push -u origin HEAD
```

- **默认执行 push**（本项目约定：改动闭环含远程同步）
- 禁止 force-push 到 `master` / `main` 等共享分支
- push 失败（冲突/权限）须报告并协助解决，不得假装已推送
- 若用户当轮明确说「先不要 push」，可停在 commit，并在回复中注明

### 5. 收尾汇报
回复中简要写明：改了什么、跑了哪些测试、commit hash、是否已 push。


# Project Context (Architecture)

## Overview
**咀华 Juhua**（原名 fastReader）- AI 电子书精读工具，EPUB/PDF 转章节总结、思维导图与全书综述。
品牌：朱砂印章 logo（`public/logo.svg`，小尺寸用 `favicon.svg`）、宣纸/松烟墨/朱砂配色（`src/index.css` 的 token）、
标题衬线 `.font-brand`。仓库名、Pages 项目 `fast-read`、存储键与 `FASTREADER_*` 环境变量为兼容保留原名，不要改。
样式一律用语义 token（`bg-muted`/`text-muted-foreground`…），不要写 `gray-*`/`slate-*` 这类冷灰硬编码。

## Architecture
- **SPA**: React 19 + TypeScript + Vite
- **Server**: Cloudflare Pages Functions（`functions/`）+ Workers KV（绑定名 `FASTREADER_KV`）
- **State**: Zustand，数据来自服务端共享状态；本地只留 UI 偏好与 IndexedDB 章节缓存
- **Auth**: 共享密码登录（`APP_PASSWORD`，缺省 `123456a`），HttpOnly 签名 Cookie
- **UI**: shadcn/ui + Tailwind CSS
- **Files**: epubjs (EPUB) + pdfjs-dist (PDF)
- **AI**: 服务商化配置（OpenAI 兼容 / Gemini REST / Ollama 直连）+ models.dev 元数据
- **Cloud**: WebDAV (nutz, Nextcloud, ownCloud)
- **MindMap**: mind-elixir

## Key Patterns
- Service layer (`services/`) handles business logic；单书与批量共用 `services/pipeline/bookPipeline.ts`
- `useBookProcessing` 只做组合，逻辑在 `useBookFile` / `useProcessingRun` / `useKeyCharts` / `useReaderPanel`
- **共享状态**：每类数据对应一个分区（`ai|processing|webdav|prompts|history|batch|usage`），子 store 用 `registerSection()` 绑定；
  写入经 `markDirty()` 防抖、`POST /api/state/:section/append` 处理追加型数据（历史/用量）。子 store **不再使用** zustand `persist`。
- **秘密字段**（`apiKey`/`password`）只存在于服务端：客户端状态是 `{ hasSecret: true }`，新输入经 `setProviderSecret` /
  `setWebDAVPassword` 暂存于内存 pending，随写回提交后被清掉。服务端 `functions/_lib/secrets.js` 负责脱敏与合并。
- **AI 请求**一律走 `/api/ai`（`services/ai/utils.ts#proxyFetch`）：客户端只传 `X-Provider-Id` 与相对 baseUrl 的端点路径，
  base 与凭据由服务端注入。Ollama 例外（本机地址，浏览器直连）。
- Prompts 只有 v2（`services/prompts/config/v2-prompts.yaml`）；用户自定义以「相对默认的覆盖项」存于 `prompts` 分区，
  前端 `renderPrompt` 与 CLI `render_prompt` 同语义（见该目录 README）
- 章节缓存：IndexedDB，键含文件指纹/内容/模型/prompt/语言（`services/pipeline/cacheKeys.ts`）
- 模型参数全部由目录元数据（models.dev / OpenRouter / 网关，`meta.*`）自动驱动，规则在 `services/ai/outputBudget.ts` ↔ CLI `src/cli/model_budget.py`，契约 `tests/fixtures/model-budget-cases.json`：
  输出上限 = `meta.output`（不超窗口，超限按报错重发）；输入超预算的章节按段落分段总结再合并；后处理压缩阈值按窗口计算；
  `meta.temperature/reasoning === false` 时不发对应参数，未知照常发、被拒降级重试。不要再写死 token / 字数上限
- 结果状态统一用 `utils/resultStatus.ts`（失败/跳过前缀），书籍 HTML 入 DOM 前必经 `utils/sanitizeHtml.ts`
- 价格：`services/ai/catalog.ts` 用 models.dev 元数据匹配，`services/metadataFormatter.ts` 通过 `setPricingProvider` /
  `setExchangeRateProvider` 注入（`services/pricingBridge.ts` 在启动时接好）；查不到价格时标 `pricingKnown:false`，不估价
- 前端与 CLI 的共享契约以 `tests/fixtures/` 下的样例为准（两端测试都读）。1.0.0 与 2.0.0 配置都能读：
  `tests/fixtures/config/legacy-export-2026-08.yaml`（1.0.0）与 `export-v2.sample.yaml`（2.0.0）

## Cloud Cache Reading
- 检查 WebDAV 上 `{syncPath}/{sanitizedName}-完整摘要.md` 是否存在
- 发现缓存后提示用户可直接查看或重新处理
- 缓存元数据以 HTML 注释格式存储在文件头部

## Deployment
- `wrangler.toml` 声明 `pages_build_output_dir = "dist"` 与 KV 绑定 `FASTREADER_KV`
- 环境变量：`APP_PASSWORD`（缺省 `123456a`）、`SESSION_SECRET`（可选，缺省由密码派生）、`ALLOWED_ORIGINS`（可选）
- 本地开发只能用 `wrangler pages dev`（见 `docs/deploy.md`）；`vite.config.ts` 不再有 dev proxy
- 改密码会让所有已签发的会话立即失效（Cookie 签名里带密码指纹）
- 改 `functions/` 后跑 `pnpm check:functions`：单测不经过打包器，相对 import 写错只有它能提前发现

## Processing Metadata
- 保存处理结果时在文件头部添加 HTML 注释格式的元数据
- 包含：来源、文件名、处理时间、模型、章节信息、Token 使用情况、费用等
- 汇率来自共享处理配置（`exchangeRateUsdToCny`，默认 7.0），不再读 `process.env`

## CLI Tool (src/cli/)
- 命令：`uv run python -m src.cli.main batch -c config.yaml`（依赖见 `pyproject.toml`，测试 `uv run pytest -q`）
- 配置：YAML 格式，支持环境变量替换 `${VAR_NAME}`
- 输出：`output/` 目录生成处理结果
- 日志：`log/` 目录记录处理过程和错误
- 错误处理：仅 408/429/5xx/网络错误按配置重试并遵循 Retry-After；仅支持 summary 模式

## Constraints
- Browser-only (no backend)
- AI APIs require online access
- Environment variables: `VITE_*` prefix (browser), `*` prefix (CLI)
- Tests: `tests/` directory

## WebDAV CORS 代理
- 前端 WebDAV 请求走同源 `/api/dav`，只传路径（`X-WebDAV-Path`）
- **上游 base（serverUrl）与凭据从共享状态 `state:webdav` 取**，客户端自带的 `Authorization` / `X-WebDAV-Base` 一律丢弃
- 代理必须校验 Origin 白名单与 https base URL，最终上游 URL 必须与 base 同源且在其路径下；代理自身错误带 `X-Proxy-Error: 1`
- 客户端侧 `webdavService` 因此不再拼 Basic Auth，也不再需要明文密码
- CSP 在 `public/_headers`；connect-src 不收窄到具体主机（用户自定义 AI 服务商）
