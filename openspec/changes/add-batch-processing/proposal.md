# Change: 批量处理与缓存读取功能

## Why

当前 fastReader 仅支持单本书的逐个处理，用户需要处理大量电子书时效率低下。本变更旨在：

1. **缓存复用**：支持从 WebDAV 读取已处理缓存，避免重复处理相同书籍
2. **信息追踪**：添加处理信息备注，便于调试、统计和成本核算
3. **批量处理**：实现 WebDAV 批量处理 UI，支持选择文件夹批量处理
4. **命令行工具**：提供 CLI 批量处理工具，支持无人值守的批量处理

## Background

### 现有处理流程
```
文件选择 → 章节提取 → AI处理 → 结果保存 → WebDAV同步
```

### 现有保存路径（单文件方式）
- 路径格式：`{syncPath}/{sanitizedName}-完整摘要.md`
- 默认 syncPath：`/fastReader`
- 示例：`/fastReader/我的书籍-完整摘要.md`

### 现有文件格式
```markdown
# 书名

**作者**: 作者名

---

## 第1章 章节标题

章节总结内容...

## 第2章 章节标题

章节总结内容...
```

## What Changes

### 1. 缓存读取功能 (Cloud Cache Reading)

#### 1.1 功能描述
每次打开 PDF 或 EPUB 文件时，以文件名匹配尝试读取 WebDAV 中的处理结果。如果存在则直接读取并渲染，提示用户可跳过处理。

#### 1.2 缓存判断标准
- **缓存存在判断**：检查 WebDAV 上是否存在 `{syncPath}/{sanitizedName}-完整摘要.md`
- **sanitizedName 生成规则**：
  1. 移除文件扩展名（如 `.epub`、`.pdf`）
  2. 移除特殊字符（`<>:"/\|?*`）
  3. 合并多个空格为单个空格
  4. 保留中文、日文、韩文等多语言字符

#### 1.3 缓存读取流程
```
用户选择文件
    ↓
生成 sanitizedName
    ↓
检查 WebDAV 缓存是否存在
    ↓
┌────────────────────────────────────────────┐
│  存在                                      │  不存在
│    ↓                                      │    ↓
│  从 WebDAV 下载文件内容                     │  继续常规处理流程
│    ↓                                      │
│  解析 HTML 备注（可选）                     │
│    ↓                                      │
│  渲染内容到结果页面                         │
│    ↓                                      │
│  提示用户："发现云端缓存，可直接查看或重新处理" │
└────────────────────────────────────────────┘
```

#### 1.4 新增文件
- `src/services/cloudCacheService.ts`：云端缓存服务

### 2. 处理信息备注 (Processing Metadata Annotation)

#### 2.1 功能描述
在保存处理结果到 WebDAV 时，在文件头部以 HTML 注释格式添加处理元信息。

#### 2.2 备注格式
```html
<!--
source: WebDAV
fileName: 我的书籍.epub
processedAt: 2026-01-02T10:00:00Z
model: gemini-1.5-pro
chapterDetectionMode: normal
selectedChapters: 1,3,5,7,9,11
chapterCount: 12
originalCharCount: 52340
processedCharCount: 8560
inputTokens: 125000
outputTokens: 3200
costUSD: 0.01525
costRMB: 0.10675 (USD/CNY: 7.0)
-->
```

#### 2.3 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| source | string | 来源：`WebDAV` 或 `local` |
| fileName | string | 原始文件名（含扩展名） |
| processedAt | string | 处理完成时间（ISO 8601 格式） |
| model | string | 使用的 AI 模型 ID |
| chapterDetectionMode | string | 章节检测模式：`normal` / `smart` / `epub-toc` |
| selectedChapters | string | 勾选的章节编号列表，逗号分隔 |
| chapterCount | number | 总章节数量 |
| originalCharCount | number | 处理前原始内容字符数（不含空格） |
| processedCharCount | number | 处理后内容字符数（不含空格） |
| inputTokens | number | 输入 Token 数（从 API 响应获取） |
| outputTokens | number | 输出 Token 数（从 API 响应获取） |
| costUSD | number | 处理费用（美元，保留 5 位小数） |
| costRMB | number | 处理费用（人民币，保留 5 位小数） |

#### 2.4 费用计算规则
- 汇率来源：从环境变量 `EXCHANGE_RATE_USD_TO_CNY` 读取
- 默认汇率：`7.0`（即 1 美元 = 7 人民币）
- 计算公式：`costRMB = costUSD * exchangeRate`

#### 2.5 修改文件
- `src/services/metadataFormatter.ts`（新增）
- `src/components/UploadToWebDAVButton.tsx`（修改）
- `src/services/autoSyncService.ts`（修改）

### 3. WebDAV 批量处理 UI

#### 3.1 功能描述
在"文件上传与配置"区域，WebDAV 按钮右侧添加"批量处理"按钮，点击后可以选择 WebDAV 文件夹进行批量处理。

#### 3.2 UI 布局
```
┌─────────────────────────────────────────────────────────────────┐
│  [📤 上传] [📂 WebDAV] [⚡ 批量处理] [⚙️ 配置]                   │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.3 批量处理对话框内容

**步骤 1：选择文件夹**
- 文件夹路径输入框（可浏览选择）
- 显示选定路径下的 EPUB/PDF 文件数量

**步骤 2：配置处理参数**
- **处理文件数量**：
  - [ ] 处理全部文件
  - [ ] 处理前 N 个文件（输入数字）
- **处理范围**：
  - [x] 全部范围（处理所有匹配文件）
  - [ ] 仅未处理部分（跳过已有缓存的文件）
- **处理顺序**：
  - [x] 顺序处理（按文件名排序）
  - [ ] 随机顺序（断点续传友好）

**步骤 3：确认并开始**
- 显示待处理文件列表预览（前 10 个）
- 显示预计处理时间（基于历史数据估算）
- [取消] [确认开始处理]

#### 3.4 批量队列面板（可展开）

**折叠状态**：
```
┌────────────────────────────────────────┐
│ ⚡ 批量处理: 5/12 完成 | 正在处理: 第3本... │ [▼]
└────────────────────────────────────────┘
```

**展开状态**：
```
┌────────────────────────────────────────┐
│ ⚡ 批量处理: 5/12 完成 | 正在处理: 第3本... │ [▲]
├────────────────────────────────────────┤
│ ✅ 书名1.epub           - 完成          │
│ ✅ 书名2.epub           - 完成          │
│ 🔄 书名3.epub           - 处理中 45%    │
│ ⏸️ 书名4.epub           - 待处理        │
│ ⏸️ 书名5.epub           - 待处理        │
│ ...                                    │
├────────────────────────────────────────┤
│ [⏸️ 全部暂停] [⏭️ 跳过当前] [🗑️ 删除项]  │
└────────────────────────────────────────┘
```

#### 3.5 功能特性

- **实时预览**：展开面板可查看队列内容
- **跳过/删除**：处理中可随时跳过或删除个别书籍
- **进度追踪**：显示当前进度和总体进度
- **断点续传**：本地记录已完成的书籍列表
- **尊重配置**：使用现有配置（AI 模型、处理选项等）

#### 3.6 新增文件
- `src/components/project/BatchProcessingDialog.tsx`
- `src/components/project/BatchQueuePanel.tsx`
- `src/stores/batchQueueStore.ts`

### 4. CLI 批量处理工具

#### 4.1 命令行接口
```bash
# 基本用法
python -m src.cli.main batch --config config.yaml

# 短格式
python -m src.cli.main batch -c config.yaml

# 显示帮助
python -m src.cli.main batch --help
```

#### 4.2 配置文件格式（YAML）
```yaml
# ebook-to-mindmap-config-v2.yaml

# WebDAV 配置
webdav:
  serverUrl: "https://dav.jianguoyun.com/dav/"
  username: "your-email@example.com"
  password: "your-app-password"
  syncPath: "/fastReader"

# AI 配置
ai:
  provider: "gemini"  # gemini, openai, ollama, 302.ai, custom
  apiKey: "${GEMINI_API_KEY}"  # 支持环境变量引用
  model: "gemini-1.5-pro"
  apiUrl: ""  # 仅 custom/openai/302.ai 需要
  temperature: 0.7

# 处理选项
processing:
  mode: "summary"  # summary, mindmap, combined-mindmap
  bookType: "non-fiction"  # fiction, non-fiction
  chapterDetectionMode: "normal"  # normal, smart, epub-toc
  outputLanguage: "zh"  # auto, en, zh, ja, fr, de, es, ru

# 批量处理配置
batch:
  # WebDAV 源文件夹路径（相对于 syncPath）
  sourcePath: "/books"
  # 处理文件数量，0 表示处理全部
  maxFiles: 0
  # 是否仅处理未处理的文件
  skipProcessed: true
  # 处理顺序：sequential, random
  order: "sequential"
  # 每次处理的最大并发数（当前仅支持顺序处理）
  concurrency: 1
  # 重试次数
  maxRetries: 3
  # 重试间隔（秒）：[1, 2, 4, 8, ...]
  retryDelays: [60, 120, 240, 480]

# 输出配置
output:
  # 本地输出目录
  localDir: "output/"
  # 日志目录
  logDir: "log/"
  # 是否同步到 WebDAV
  syncToWebDAV: true

# 高级配置
advanced:
  # 汇率配置（USD -> CNY）
  exchangeRate: 7.0
  # DEBUG 模式
  debug: false
  # 队列预取数量
  queuePrefetchCount: 10
```

#### 4.3 交互输出示例
```
$ python -m src.cli.main batch -c config.yaml

🚀 fastReader CLI - 批量处理工具 v1.0.0
================================================

📂 连接到 WebDAV...
✅ WebDAV 连接成功

📋 扫描文件夹: /books
📚 找到 25 个待处理文件

⚙️  配置摘要:
   - 模式: 文字总结
   - 模型: gemini-1.5-pro
   - 语言: 中文
   - 跳过已处理: 是
   - 处理顺序: 顺序

⏳ 开始处理队列 (25/25)...

[01/25] 📖 开始处理: 书籍名称.epub
   📊 章节: 15 | 字符数: 52,340
   🔄 正在提取章节...
   ✅ 章节提取完成

   🔄 正在处理章节 1/15...
   ✅ 章节 1 处理完成 (input: 3,450 tokens, output: 820 tokens)
   ...
   ✅ 所有章节处理完成

   💰 费用统计:
      - 输入 Token: 125,000 | 输出 Token: 3,200
      - 费用: $0.01525 | ¥0.10675

   📤 正在保存到 WebDAV...
   ✅ 已保存: /fastReader/书籍名称-完整摘要.md

[02/25] 📖 开始处理: 另一本书.epub
   ...

================================================
✅ 处理完成: 25/25 成功, 0/25 失败
📁 输出目录: output/
📋 日志目录: log/
```

#### 4.4 错误处理策略

**WebDAV 连接失败**
- 重试 3 次，每次间隔 60s
- 3 次都失败后记录错误日志，跳过当前文件，继续处理下一本

**AI API 调用失败**
- 使用指数退避重试：`retryDelays` 配置间隔
- 例如：`[60, 120, 240, 480]` 表示第 1 次重试等待 60s，第 2 次 120s，以此类推
- 超过最大重试次数后记录错误日志，跳过当前文件

**文件处理异常**
- 记录详细错误堆栈到日志文件
- 标记该文件为"失败"，不影响其他文件处理
- 实时增量记录到 `log/batch_progress_YYYYMMDD.log`

**处理报告生成**
- 处理完成后生成 `log/batch_report_YYYYMMDD.md` 格式报告
- 报告包含：处理统计、成功/失败列表、费用汇总

#### 4.5 目录结构
```
src/cli/
├── __init__.py
├── main.py              # CLI 入口
├── config.py            # 配置加载器
├── batch_processor.py   # 批量处理核心逻辑
├── webdav_client.py     # WebDAV 客户端封装
├── ai_client.py         # AI API 客户端
├── formatter.py         # 结果格式化器
├── logger.py            # 日志工具
└── models.py            # 数据模型定义
```

#### 4.6 断点续传机制

**本地标记存储**
- 存储位置：`localStorage` 键 `fastReader-batch-progress`
- 存储格式：
  ```json
  {
    "batchId": "20260102-143022",
    "sourcePath": "/books",
    "completedFiles": ["书名1.epub", "书名2.epub"],
    "failedFiles": ["书名3.epub"],
    "lastUpdated": "2026-01-02T14:35:00Z"
  }
  ```

**恢复处理**
- 启动时检查是否存在未完成的批次
- 提示用户选择：继续上次的批次 / 开始新批次

#### 4.7 环境变量支持

```bash
# 支持的环境变量
export GEMINI_API_KEY="your-gemini-api-key"
export OPENAI_API_KEY="your-openai-api-key"
export EXCHANGE_RATE_USD_TO_CNY="7.0"
export FASTREADER_DEBUG="true"
```

配置文件中可引用：
```yaml
ai:
  apiKey: "${GEMINI_API_KEY}"
```

#### 4.8 新增文件
- `src/cli/main.py`
- `src/cli/config.py`
- `src/cli/batch_processor.py`
- `src/cli/webdav_client.py`
- `src/cli/ai_client.py`
- `src/cli/formatter.py`
- `src/cli/logger.py`
- `src/cli/models.py`

## Impact

### Affected Specs
- `cloud-cache`：云端缓存读取功能
- `processing-metadata`：处理信息备注功能
- `batch-ui`：批量处理 UI
- `batch-cli`：CLI 批量处理工具

### Affected Code Files

**新增文件**
- `src/services/cloudCacheService.ts`
- `src/services/metadataFormatter.ts`
- `src/stores/batchQueueStore.ts`
- `src/components/project/BatchProcessingDialog.tsx`
- `src/components/project/BatchQueuePanel.tsx`
- `src/cli/main.py`
- `src/cli/config.py`
- `src/cli/batch_processor.py`
- `src/cli/webdav_client.py`
- `src/cli/ai_client.py`
- `src/cli/formatter.py`
- `src/cli/logger.py`
- `src/cli/models.py`

**修改文件**
- `src/App.tsx`：添加缓存读取逻辑
- `src/components/UploadToWebDAVButton.tsx`：添加处理备注
- `src/services/autoSyncService.ts`：添加处理备注

### Dependencies
- 无新增外部依赖
- 重用现有 `webdav` 库
- Python 标准库：`argparse`, `yaml`, `logging`, `pathlib`, `json`, `datetime`

## Risks and Mitigation

| 风险 | 缓解措施 |
|------|----------|
| WebDAV 大文件下载超时 | 添加超时配置，分块下载 |
| AI API 限流 | 实现指数退避重试，控制并发 |
| 内存占用过高 | 流式处理，及时释放资源 |
| CLI 与网页版行为不一致 | 复用相同的服务层代码 |

## Open Questions

1. ~~缓存判断标准~~：已确认使用单文件方式检查 `{sanitizedName}-完整摘要.md`
2. ~~处理备注格式~~：已确认为 HTML 注释格式在文件头部
3. ~~批量处理并发~~：已确认为顺序处理
4. ~~断点续传存储~~：已确认为本地标记
5. CLI 是否需要生成 HTML 格式的处理报告？**（待确认）**
