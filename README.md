# 电子书转思维导图

[English](README.en.md) | 中文

一个基于 AI 技术的智能电子书解析工具，支持将 EPUB 和 PDF 格式的电子书转换为结构化的思维导图和文字总结。

## ✨ 功能特性

### 📚 多格式支持

- **EPUB 文件**：完整支持 EPUB 格式电子书的解析和处理
- **PDF 文件**：智能解析 PDF 文档，支持基于目录和智能检测的章节提取

### 🤖 AI 驱动的内容处理

- **多种 AI 服务**：支持 Google Gemini 和 OpenAI GPT 模型
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

- **智能缓存**：自动缓存 AI 处理结果，避免重复计算
- **缓存管理**：支持按模式清除缓存，节省存储空间
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
- **同源代理**：通过 Cloudflare Pages Functions 代理解决浏览器 CORS（见 `docs/webdav-proxy.md`）


## 🚀 快速开始

### 环境要求

- Node.js 18+
- pnpm（推荐）或 npm

### 安装依赖

```bash
# 克隆项目
git clone https://github.com/SSShooter/ebook-to-mindmap
cd ebook-to-mindmap

# 安装依赖
pnpm install
# 或
npm install
```

### 启动开发服务器

```bash
pnpm dev
# 或
npm run dev
```

访问 `http://localhost:5173` 开始使用。

### 💻 命令行工具（CLI）

项目提供了命令行工具，支持批量处理电子书。

**快速开始：**

```bash
# 安装 Python 依赖
pip install -r requirements-cli.txt

# 查看帮助
python -m src.cli.main --help

# 运行批量处理（需要配置文件）
python -m src.cli.main batch -c config.yaml
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
  mode: "summary"        # summary, mindmap, combined-mindmap
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
python -m src.cli.main batch -c ebook-to-mindmap-config-v2.yaml --dry-run
```

CLI 会自动：
- 解析嵌套的配置结构
- 支持多 AI 提供商配置
- 从配置获取 Prompt 模板（支持 v1/v2）
- 正确转换 currentModelId 索引（1-based → 0-based）

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
│   │   ├── 📄 aiService.ts      # AI 服务
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

### 1. 配置 AI 服务

首次使用需要配置 AI 服务：

1. 点击「配置」按钮
2. 选择 AI 服务提供商：
   - **Google Gemini**（推荐）：需要 Gemini API Key
   - **OpenAI GPT**：需要 OpenAI API Key 和 API 地址
3. 输入相应的 API Key
4. 选择模型（可选，使用默认模型即可）

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
- **状态管理**：Zustand
- **文件解析**：
  - EPUB：@smoores/epub + epubjs
  - PDF：pdfjs-dist
- **思维导图**：mind-elixir
- **AI 服务**：
  - Google Gemini：@google/generative-ai
  - OpenAI：自定义实现

## 🔧 高级功能

### 缓存管理

系统会自动缓存 AI 处理结果，提高效率：

- **自动缓存**：处理结果会自动保存到本地
- **智能复用**：相同内容不会重复处理
- **缓存清理**：可按模式清除特定类型的缓存
- **存储优化**：缓存数据经过压缩，节省存储空间

### 批量处理

- **章节选择**：支持批量选择/取消选择章节
- **并发处理**：多个章节可并行处理（受 API 限制）
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

如未配置 Prompt，CLI 会使用内置的默认模板（v1/v2）。

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
