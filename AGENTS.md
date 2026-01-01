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

## Constraints
- Browser-only (no backend)
- AI APIs require online access
- Environment variables: `VITE_*` prefix
- Tests: `tests/` directory