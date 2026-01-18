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
