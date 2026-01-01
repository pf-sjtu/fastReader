# Project Context

## Purpose
**fastReader** 是一个基于 AI 技术的智能电子书解析工具，支持将 EPUB 和 PDF 格式的电子书转换为结构化的思维导图和文字总结。

核心功能：
- 📖 EPUB/PDF 文件解析与章节提取
- 🤖 AI 驱动的内容总结与思维导图生成
- ☁️ WebDAV 云同步
- 🧠 多种 AI 服务商支持（Gemini、OpenAI、Ollama、302.ai）

## Tech Stack
- **前端框架**: React 19.1.0 + TypeScript 5.8.3 + Vite 7.0.4
- **UI 组件**: Tailwind CSS 4.1.11 + shadcn/ui + Radix UI + Lucide React
- **状态管理**: Zustand 5.0.6 (持久化存储)
- **文件处理**: epubjs 0.3.93 + pdfjs-dist 5.3.93 + JSZip 3.10.1
- **AI 集成**: Google Gemini + OpenAI 兼容 + Ollama + 302.ai
- **云存储**: webdav 5.8.0 (WebDAV)
- **思维导图**: mind-elixir 5.0.4
- **国际化**: i18next 25.3.6 + react-i18next 15.6.1

## Project Conventions

### Code Style
- TypeScript 严格模式
- 组件采用 functional component + hooks 模式
- 样式使用 Tailwind CSS 原子化类
- 组件文件结构: `components/` (ui 基础组件) + `project/` (业务组件)

### Architecture Patterns
- **单页应用 (SPA)**: React + Vite
- **服务层分离**: `services/` 包含业务逻辑，`stores/` 集中状态管理
- **配置驱动**: AI 服务、提示词等通过 YAML/配置管理
- **缓存策略**: 章节级别缓存避免重复计算

### Testing Strategy
- 测试文件置于 `tests/` 目录
- 使用 JSdom 进行 DOM 测试
- 构建前运行 lint 检查

### Git Workflow
- 主分支: master
- 提交信息使用中文描述变更内容

## Domain Context

### 核心技术领域
- **电子书格式解析**: EPUB (ZIP + XML), PDF (二进制结构)
- **AI Prompt Engineering**: 提示词版本管理 (v1/v2)
- **WebDAV 协议**: 云存储同步
- **思维导图渲染**: 节点式数据结构可视化

### 项目结构
```
src/
├── components/
│   ├── ui/          # shadcn/ui 基础组件
│   └── project/     # 业务组件
├── services/        # 业务逻辑服务层
├── stores/          # Zustand 状态管理
├── prompts/         # AI 提示词配置
├── i18n/            # 国际化
└── lib/             # 工具函数
```

## Important Constraints
- 浏览器端运行 (无后端服务)
- AI API 调用依赖在线服务
- WebDAV 代理通过 Vite 开发服务器配置
- 环境变量以 `VITE_` 前缀注入

## External Dependencies
- **AI 服务商 APIs**: Google Gemini, OpenAI, Ollama (本地), 302.ai
- **云存储**: WebDAV (坚果云、Nextcloud、ownCloud 等)
- **浏览器 API**: File System Access API, Notification API
