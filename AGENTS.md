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
**fastReader** - AI驱动的电子书解析工具，支持EPUB/PDF转思维导图和总结。

## Architecture
- **SPA**: React 19 + TypeScript + Vite
- **State**: Zustand with persistence
- **UI**: shadcn/ui + Tailwind CSS
- **Files**: epubjs (EPUB) + pdfjs-dist (PDF)
- **AI**: Gemini/OpenAI/Ollama/302.ai via config-driven service layer
- **Cloud**: WebDAV (nutz, Nextcloud, ownCloud)
- **MindMap**: mind-elixir

## Key Patterns
- Service layer (`services/`) handles business logic
- Centralized store (`stores/configStore.ts`) manages state
- Prompts versioned (v1/v2) in `services/prompts/`
- Chapter-level caching to avoid re-computation

## Cloud Cache Reading
- 检查 WebDAV 上 `{syncPath}/{sanitizedName}-完整摘要.md` 是否存在
- 发现缓存后提示用户可直接查看或重新处理
- 缓存元数据以 HTML 注释格式存储在文件头部

## Processing Metadata
- 保存处理结果时在文件头部添加 HTML 注释格式的元数据
- 包含：来源、文件名、处理时间、模型、章节信息、Token 使用情况、费用等
- 支持汇率配置（USD -> CNY，默认 7.0）

## CLI Tool (src/cli/)
- 命令：`python -m src.cli.main batch -c config.yaml`
- 配置：YAML 格式，支持环境变量替换 `${VAR_NAME}`
- 输出：`output/` 目录生成处理结果
- 日志：`log/` 目录记录处理过程和错误
- 错误处理：指数退避重试机制

## Constraints
- Browser-only (no backend)
- AI APIs require online access
- Environment variables: `VITE_*` prefix (browser), `*` prefix (CLI)
- Tests: `tests/` directory

## WebDAV CORS 代理
- 前端 WebDAV 请求走同源 `/api/dav`
- Cloudflare Pages Functions 代理读取 `X-WebDAV-Base` 与 `X-WebDAV-Path`
- 代理必须校验 Origin 白名单与 https base URL
