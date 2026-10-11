# Change: 统一单书/批量处理管线、版本化章节缓存与 prompt 模板修复（第 2 波）

## Why

第 1 波修复后仍存在结构性问题：

- 单书 hook（约 1700 行）与批量引擎各自实现章节提取、并行、后处理、落盘四个环节，行为持续漂移（批量 mindmap 模式只能临时拒绝）
- 本地章节缓存只写不读，键不含模型/prompt 版本/内容指纹，整份存在单个 localStorage 键；「重新处理」只能整本重跑
- 批量 skipProcessed 只看文件名，`isPartial` 结果仍被跳过
- **prompt 模板占位符（`{{title}}`、`{{content}}` 等）从未替换**：字面占位符与追加正文同时发给模型（前端与 CLI 都受影响）
- 跳过词子串匹配误杀 about/author 等正常章节；ConfigDialog 1000+ 行、约 314 行硬编码文案、三处重复的 WebDAV 初始化
- webdavService 1038 行、stores 下遗留死代码；代理自身错误与上游错误无法区分

## What Changes

- 新增 `services/pipeline/bookPipeline.ts`：单书与批量共用，支持全部处理模式；hook 拆为 useBookFile / useProcessingRun / useKeyCharts / useReaderPanel，返回值兼容
- 章节缓存迁到 IndexedDB，键含文件指纹、内容哈希、模型、prompt 版本、实际输出语言、处理类型；命中即跳过 AI 调用，按字节 LRU 淘汰
- 批量 skipProcessed 读取云端元数据，`isPartial` 不跳过；恢复批量 mindmap / combined-mindmap
- `renderPrompt` 统一模板语义，前端与 CLI 共享测试用例；跳过词改为前缀 + 整词匹配并共享用例
- ConfigDialog 拆分、重复逻辑合并、文案全部 i18n、清零 exhaustive-deps 警告
- webdavService 按职责拆分；删除 stores 死代码；DAV 代理自身错误加 `X-Proxy-Error` 头

**BREAKING**：旧版 localStorage 章节缓存不迁移（不含版本信息，迁移会命中错误结果），升级后首次处理会重新调用 AI。

## Impact

- Affected specs: cloud-cache, batch-ui；新增 prompt-templates
- Affected code: src/hooks/**、src/services/pipeline/**、batchProcessingEngine、cacheService、prompts/**、constants、src/cli/**、src/components/**、webdavService、stores、functions/api/dav
