# 电子书转思维导图

[English](README.en.md) | 中文

一个基于 AI 技术的智能电子书解析工具，支持将 EPUB 和 PDF 格式的电子书转换为结构化的思维导图和文字总结。

## ✨ 功能特性

### 📚 多格式支持

- **EPUB 文件**：完整支持 EPUB 格式电子书的解析和处理
- **PDF 文件**：智能解析 PDF 文档，支持基于目录和智能检测的章节提取

### 🔐 共享配置与登录

- **一份配置全员共用**：AI 服务商、处理选项、WebDAV、提示词、处理历史、批量队列、Token 用量都存在服务端（Cloudflare KV），换设备不用重配
- **密码登录**：输入共享密码即可使用，浏览器记住登录状态 30 天
- **密钥不进浏览器**：API Key 与 WebDAV 密码只保存在服务端，由同源代理注入；前端只看到「已配置」
- **乐观锁 + 冲突合并**：多人同时改配置不会互相覆盖；顶栏实时显示同步状态

### 🤖 AI 驱动的内容处理

- **服务商化模型配置**：一条配置 = 一个服务商（地址 + 密钥）+ 多个模型；填好地址和密钥后一键拉取模型列表，并用 [models.dev](https://models.dev) 元数据自动补全上下文长度与价格
- **多种 AI 协议**：OpenAI 兼容、Google Gemini、本地 Ollama（浏览器直连）
- **三种处理模式**：
  - 📝 **文字总结模式**：生成章节总结、分析章节关联、输出全书总结
  - 🧠 **章节思维导图模式**：为每个章节生成独立的思维导图
  - 🌐 **整书思维导图模式**：将整本书内容整合为一个完整的思维导图

### 🎯 智能章节处理

- **智能章节检测**：自动识别和提取书籍章节结构
- **章节筛选**：支持跳过前言、目录、致谢等非核心内容
- **灵活选择**：用户可自由选择需要处理的章节
- **子章节支持**：可配置子章节提取深度

### 💾 高效缓存机制

- **章节级缓存**：结果存于 IndexedDB，键包含文件指纹、章节内容、模型、prompt 版本与输出语言，换模型或改 prompt 不会命中旧结果
- **只重跑失败章节**：重新处理时命中缓存的章节不再调用 AI；可清除单章或整书缓存强制重跑
- **离线查看**：已处理的内容可离线查看

### 🎨 现代化界面

- **响应式设计**：适配各种屏幕尺寸
- **实时进度**：处理过程可视化，实时显示当前步骤
- **交互式思维导图**：支持缩放、拖拽、节点展开/折叠
- **内容预览**：支持查看原始章节内容
- **阅读控制**：字体大小调节和全屏模式，提供更好的阅读体验
- **主题支持**：完整的深色/浅色主题支持，自动跟随系统主题

### 🌐 增强阅读体验

- **字体控制**：EPUB 内容预览支持字体大小调节（12px-24px）
- **全屏模式**：沉浸式阅读体验，支持全屏切换
- **自适应布局**：全屏模式下内容区域自动调整到屏幕高度
- **主题一致性**：预览内容跟随选择的主题（浅色/深色/系统）

### ☁️ 云端同步与存储

- **WebDAV 支持**：上传和同步思维导图到 WebDAV 云存储
- **多云支持**：支持坚果云、Nextcloud、ownCloud 等 WebDAV 服务
- **覆盖保护**：智能文件存在性检查，支持覆盖确认
- **自动同步**：处理完成后自动同步到云端存储
- **同源代理**：AI 请求与 WebDAV 请求都走 Pages Functions 代理，凭据在服务端注入（见 `docs/webdav-proxy.md`、`docs/deploy.md`）


## 🚀 快速开始

### 环境要求

- Node.js 20.19+（Vite 7 要求）
- pnpm（版本由 `package.json` 的 `packageManager` 锁定，仓库只维护 `pnpm-lock.yaml`）

### 安装依赖

```bash
# 克隆项目
git clone https://github.com/SSShooter/ebook-to-mindmap
cd ebook-to-mindmap

# 安装依赖
pnpm install
```

### 部署 / 本地开发

配置与状态已迁到 Cloudflare KV，`/api/*` 由 Pages Functions 提供，**只跑 `pnpm dev` 不再可用**：

```bash
# 本地开发（本地 KV，不需要真账号）
pnpm build:pages
pnpm dlx wrangler pages dev dist --kv FASTREADER_KV --binding APP_PASSWORD=123456a
```

首次部署需要创建 KV namespace 并配置 `APP_PASSWORD` 等环境变量，详见 **[docs/deploy.md](docs/deploy.md)**。

默认密码 `123456a`，正式环境务必在 Cloudflare Dashboard 修改；改密码会让所有已登录浏览器立即失效。

### 开发检查

```bash
pnpm typecheck   # tsc -b，真实类型检查
pnpm lint
pnpm test        # vitest
uv run pytest -q # CLI 测试
pnpm build       # typecheck + vite build
```

CI（`.github/workflows/ci.yml`）在每次推送执行以上全部检查。

### 💻 命令行工具（CLI）

项目提供了命令行工具，支持批量处理电子书。

**快速开始：**

```bash
# 安装 Python 依赖（uv，依赖见 pyproject.toml）
uv sync

# 查看帮助
uv run python -m src.cli.main --help

# 运行批量处理（需要配置文件，示例见 config.example.yaml）
uv run python -m src.cli.main batch -c config.yaml
```

**配置文件示例：**

```yaml
webdav:
  serverUrl: "https://dav.jianguoyun.com/dav/"
  username: "your-email@example.com"
  password: "${JIANGUOYUN_PASSWORD}"  # 支持环境变量
  syncPath: "/fastReader"

ai:
  provider: "gemini"  # 或 openai, 302.ai
  apiKey: "${GEMINI_API_KEY}"
  model: "gemini-1.5-pro"

processing:
  mode: "summary"        # CLI 仅支持 summary；导图模式请用 Web 端批量处理
  bookType: "non-fiction"  # fiction, non-fiction
  outputLanguage: "zh"

batch:
  sourcePath: "/books"
  skipProcessed: true
  maxFiles: 0  # 0 表示处理全部

output:
  localDir: "output/"
  syncToWebDAV: true
```

**使用真实场景配置：**

可以直接使用 Web UI 导出的配置文件：

```bash
uv run python -m src.cli.main batch -c ebook-to-mindmap-config-v2.yaml --dry-run
```

CLI 会自动：
- 解析嵌套的配置结构
- 支持多 AI 提供商配置
- 从配置获取 Prompt 模板（v2）
- 同时读取 1.0.0（`aiConfigManager.providers[]`，一模型一条）与 2.0.0（`ai.providers[].models[]`，服务商化）两种结构

## 📁 项目结构

```
ebook-to-mindmap/
├── 📄 package.json              # 项目依赖和脚本
├── 📄 index.html                 # 入口 HTML 文件
├── 📄 .env                       # 环境变量配置
├── 📄 .gitignore                 # Git 忽略规则
├── 📄 config.example.yaml        # CLI 配置文件示例
├── 📁 src/                       # 源代码目录
│   ├── 📁 components/            # React 组件
│   │   ├── 📁 ui/               # 基础 UI 组件
│   │   ├── 📁 project/          # 项目相关组件
│   │   └── 📄 *.tsx              # 其他功能组件
│   ├── 📁 services/             # 服务层
│   │   ├── 📄 ai/               # AI provider 实现与共享任务编排
│   │   ├── 📄 pdfProcessor.ts   # PDF 处理
│   │   └── 📄 *.ts              # 其他服务
│   ├── 📁 stores/               # 状态管理
│   ├── 📁 hooks/                # 自定义 Hooks
│   ├── 📁 i18n/                 # 国际化配置
│   ├── 📁 lib/                  # 工具库
│   └── 📄 *.tsx                 # 页面组件
├── 📁 src/cli/                   # CLI 源代码（Python）
│   ├── 📄 main.py               # CLI 入口
│   ├── 📄 batch_processor.py    # 批量处理核心逻辑
│   ├── 📄 chapter_extractor.py  # EPUB/PDF 章节提取
│   ├── 📄 ai_client.py          # AI 客户端（多提供商支持）
│   ├── 📄 config.py             # 配置解析
│   ├── 📄 webdav_client.py      # WebDAV 客户端
│   ├── 📄 formatter.py          # 结果格式化
│   └── 📄 *.py                  # 其他工具模块
├── 📁 config/                    # 配置文件目录
│   ├── 📄 vite.config.ts        # Vite 构建配置
│   ├── 📄 tailwind.config.js    # Tailwind CSS 配置
│   ├── 📄 eslint.config.js      # ESLint 代码检查配置
│   ├── 📄 tsconfig*.json        # TypeScript 配置
│   └── 📄 components.json       # shadcn/ui 组件配置
├── 📁 docs/                      # 文档目录
│   ├── 📄 README.md              # 项目说明文档
│   ├── 📄 README.en.md           # 英文说明文档
│   ├── 📄 TODO.md                # 待办事项
│   ├── 📄 LICENSE                # 许可证
│   ├── 📄 CLAUDE.md              # Claude AI 使用说明
│   ├── 📄 EPUB结构说明.md        # EPUB 格式说明
│   ├── 📄 PDF处理流程文档.md     # PDF 处理说明
│   └── 📄 webdav-proxy.md         # WebDAV 同源代理指南

├── 📁 test/                      # 测试文件目录
├── 📁 node_modules/              # 依赖包
└── 📁 dist/                      # 构建输出目录
```

### 配置文件说明

- **config/**: 所有配置文件统一管理，提高项目可维护性
- **docs/**: 项目文档集中存放，包括说明文档和技术文档（含 WebDAV 同源代理）

- **src/**: 源代码按功能模块组织，遵循最佳实践

## 📖 使用指南

### 1. 配置 AI 服务商

首次部署后进入初始化向导，可导入配置文件、导入本浏览器旧配置或从空白开始。之后在「配置 → AI 服务商」里维护：

1. 点「添加服务商」，从 models.dev 预设里选一个（自动填好地址），或选「OpenAI 兼容 / Gemini / Ollama」
2. 填入 API Key
3. 点「获取模型」自动拉取该服务商的模型列表，勾选要用的模型
4. 在顶部「当前模型」里选一个作为默认模型；每个模型可单独设温度

模型的价格与上下文长度会自动从 models.dev 补全；查不到的模型价格显示为「未计价」，不会拿别的模型估价。

#### 获取 API Key

**Google Gemini API Key**：

1. 访问 [Google AI Studio](https://aistudio.google.com/)
2. 登录 Google 账号
3. 创建新的 API Key
4. 复制 API Key 到配置中

**OpenAI API Key**：

1. 访问 [OpenAI Platform](https://platform.openai.com/)
2. 登录并进入 API Keys 页面
3. 创建新的 API Key
4. 复制 API Key 到配置中

这里还有一些[免费方案](https://github.com/SSShooter/Video-Summary/blob/master/guide/index.md)可供参考。

### 2. 上传电子书文件

1. 点击「选择 EPUB 或 PDF 文件」按钮
2. 选择要处理的电子书文件
3. 支持的格式：`.epub`、`.pdf`

### 3. 配置处理选项

在配置对话框中设置处理参数：

#### 处理模式

- **文字总结模式**：适合需要文字总结的场景
- **章节思维导图模式**：为每个章节生成独立思维导图
- **整书思维导图模式**：生成整本书的统一思维导图

#### 书籍类型

- **小说类**：适用于小说、故事类书籍
- **非小说类**：适用于教材、工具书、技术书籍等

#### 高级选项

- **智能章节检测**：启用后会使用 AI 智能识别章节边界
- **跳过无关章节**：自动跳过前言、目录、致谢等内容
- **子章节深度**：设置提取子章节的层级深度（0-3）

### 4. 提取章节

1. 点击「提取章节」按钮
2. 系统会自动解析文件并提取章节结构
3. 提取完成后会显示章节列表
4. 可以选择需要处理的章节（默认全选）

### 5. 开始处理

1. 确认选择的章节
2. 点击「开始处理」按钮
3. 系统会显示处理进度和当前步骤
4. 处理完成后会显示结果

### 6. 查看结果

根据选择的处理模式，可以查看不同类型的结果：

#### 文字总结模式

- **章节总结**：每个章节的详细总结
- **章节关联**：分析章节之间的逻辑关系
- **全书总结**：整本书的核心内容总结

#### 思维导图模式

- **交互式思维导图**：可缩放、拖拽的思维导图
- **节点详情**：点击节点查看详细内容
- **导出功能**：支持导出为图片或其他格式

## 🛠️ 技术架构

### 核心技术栈

- **前端框架**：React 19 + TypeScript
- **构建工具**：Vite
- **样式方案**：Tailwind CSS + shadcn/ui
- **状态管理**：Zustand（数据来自服务端共享状态，本地只留 UI 偏好）
- **服务端**：Cloudflare Pages Functions + Workers KV
- **文件解析**：
  - EPUB：@ssshooter/epubjs
  - PDF：pdfjs-dist
- **思维导图**：mind-elixir
- **AI 服务**：OpenAI 兼容 / Gemini REST / Ollama（均经服务端代理注入凭据）

## 🔧 高级功能

### 缓存管理

章节与书级结果（关联、全书总结、图表、整书导图）缓存在浏览器 IndexedDB：

- **版本化键**：文件指纹（大小 + 修改时间 + 前 64KB 哈希）+ 章节内容哈希 + 模型 + prompt 模板 + 输出语言 + 处理类型，任一变化即视为新结果
- **命中跳过**：重新处理只对失败或未缓存的章节调用 AI；需要强制重跑时先清除对应章节或整书缓存
- **容量**：约 50MB，按字节近似 LRU 淘汰；旧版 localStorage 缓存升级后自动清除（不含版本信息，不迁移）
- **云端**：处理结果可同步到 WebDAV；含失败章节的结果标记 `isPartial`，不会被当作完整缓存或在批量中被跳过

### 批量处理

- **章节选择**：支持批量选择/取消选择章节
- **并发处理**：章节并行数可配置（默认 3），结果按章节顺序呈现；遇 429 时同一服务商共享冷却期
- **断点续传**：处理中断后可从上次位置继续

### 导出功能

- **思维导图导出**：支持导出为 PNG、SVG 等格式
- **文字总结导出**：支持导出为 Markdown、TXT 格式
- **数据备份**：支持导出处理结果数据

## 🔧 CLI 高级配置

### 命令行选项

```bash
# 查看完整帮助
python -m src.cli.main --help

# 查看 batch 子命令帮助
python -m src.cli.main batch --help

# 试运行模式（预览处理队列，不实际执行）
python -m src.cli.main batch -c config.yaml --dry-run
```

### 多 AI 提供商配置

CLI 支持多提供商配置，与 Web UI 完全兼容：

```yaml
ai:
  providers:
    - provider: gemini
      apiKey: "${GEMINI_API_KEY}"
      model: gemini-1.5-pro
      temperature: 0.7
    - provider: openai
      apiKey: "${OPENAI_API_KEY}"
      model: gpt-4o
      apiUrl: "https://api.openai.com/v1"
    - provider: 302.ai
      apiKey: "${302_API_KEY}"
      model: glm-4
      apiUrl: "http://35.208.227.162:8317/v1"
  currentModelId: 2  # 1-based 索引，对应第二个提供商
```

### Prompt 模板配置

CLI 支持从配置文件加载自定义 Prompt 模板：

```yaml
promptVersionConfig:
  v2:
    chapterSummary:
      nonFiction: |
        # 角色
        你是...
    connectionAnalysis: |
      任务：分析...
    overallSummary: |
      任务：生成全书总结...
currentPromptVersion: v2
```

如未配置 Prompt，CLI 会使用内置的默认模板（只保留 v2；读到旧配置声明的 `v1` 会告警并回退 v2）。

### 环境变量支持

配置文件中支持环境变量引用：

```yaml
webdav:
  password: "${JIANGUOYUN_PASSWORD}"  # 自动替换为环境变量值

ai:
  apiKey: "${GEMINI_API_KEY}"
```

### 处理模式

| 模式 | 说明 |
|------|------|
| `summary` | 文字总结模式：章节总结 + 章节关联 + 全书总结 |
| `mindmap` | 章节思维导图模式：为每个章节生成思维导图 |
| `combined-mindmap` | 综合思维导图模式：整书整合为一个思维导图 |

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

感谢以下开源项目：

- [React](https://reactjs.org/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [mind-elixir](https://github.com/ssshooter/mind-elixir-core)
- [PDF.js](https://mozilla.github.io/pdf.js/)
- [epub.js](https://github.com/futurepress/epub.js/)

---

如有问题或建议，欢迎提交 Issue 或联系开发者。
