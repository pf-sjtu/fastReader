# batch-cli Specification

## Purpose
TBD - created by archiving change add-batch-processing. Update Purpose after archive.
## Requirements
### Requirement: CLI Entry Point

系统 SHALL 提供 `fastreader batch` 命令行工具。

#### Scenario: 显示帮助信息
- **WHEN** 运行 `python -m src.cli.main batch --help`
- **THEN** 显示命令帮助信息，包括所有可用选项

#### Scenario: 指定配置文件
- **WHEN** 运行 `python -m src.cli.main batch -c config.yaml`
- **THEN** 系统使用指定的 YAML 配置文件
- **AND** 支持 `--config` 和 `-c` 两种参数格式

### Requirement: Configuration Loading

系统 SHALL 支持从 YAML 文件加载配置。

#### Scenario: 加载 WebDAV 配置
- **GIVEN** 配置文件包含 `webdav` 节
- **WHEN** 加载配置
- **THEN** 系统读取 serverUrl、username、password、syncPath

#### Scenario: 加载 AI 配置
- **GIVEN** 配置文件包含 `ai` 节
- **WHEN** 加载配置
- **THEN** 系统读取 provider、apiKey、model、temperature

#### Scenario: 环境变量替换
- **GIVEN** 配置文件中某值为 `"${GEMINI_API_KEY}"`
- **WHEN** 加载配置
- **THEN** 系统替换为环境变量 `GEMINI_API_KEY` 的值
- **AND** 如果环境变量不存在，抛出错误

### Requirement: Batch File Discovery
系统 SHALL 在单次批量处理内缓存云端文件列表，用于过滤已处理文件，避免循环内重复调用 WebDAV。

#### Scenario: 单次批处理内缓存列表
- **GIVEN** 配置 skipProcessed = true
- **WHEN** 系统开始一次批量处理
- **THEN** 系统只进行一次 WebDAV 目录/缓存列表查询
- **AND** 后续过滤逻辑使用本地缓存列表进行对比

### Requirement: Sequential Processing
系统 SHALL 在处理队列内使用缓存的“已处理文件”集合进行跳过判断，避免逐文件远程存在性检查。

#### Scenario: 处理循环内使用本地缓存
- **GIVEN** 批量处理队列包含多本书籍
- **AND** 已生成本次批处理的缓存列表
- **WHEN** 处理每本书籍
- **THEN** 使用本地缓存判断是否跳过

### Requirement: Error Handling with Retry

系统 SHALL 实现指数退避重试机制处理错误。

#### Scenario: WebDAV 连接失败
- **GIVEN** WebDAV 连接超时或失败
- **WHEN** 系统尝试重试
- **THEN** 按配置的 `retryDelays` 间隔等待后重试
- **AND** 最多重试 `maxRetries` 次
- **AND** 超过最大重试次数后记录错误并跳过该文件

#### Scenario: AI API 调用失败
- **GIVEN** AI API 返回错误或超时
- **WHEN** 系统尝试重试
- **THEN** 使用指数退避策略等待
- **AND** 例如配置 [60, 120, 240] 表示第 1 次等 60s，第 2 次等 120s，第 3 次等 240s

#### Scenario: 记录错误
- **GIVEN** 某个文件处理失败
- **WHEN** 记录错误信息
- **THEN** 实时写入日志文件 `log/batch_progress_YYYYMMDD.log`
- **AND** 错误包含：文件名、错误时间、错误详情

#### Scenario: 生成处理报告
- **GIVEN** 批量处理完成（或中断）
- **WHEN** 生成处理报告
- **THEN** 创建 `log/batch_report_YYYYMMDD.md` 文件
- **AND** 报告包含：处理统计、成功列表、失败列表、费用汇总

### Requirement: Result Output

系统 SHALL 输出处理结果到本地和 WebDAV。

#### Scenario: 保存到本地
- **GIVEN** 配置 localDir = "output/"
- **WHEN** 一本书处理完成
- **THEN** 在 output/ 目录下创建 `{sanitizedName}-完整摘要.md`
- **AND** 同时保存处理元信息 JSON 文件 `{sanitizedName}.meta.json`

#### Scenario: 同步到 WebDAV
- **GIVEN** 配置 syncToWebDAV = true
- **AND** WebDAV 功能已配置
- **WHEN** 一本书处理完成
- **THEN** 上传处理结果到 WebDAV 的 `{syncPath}/{sanitizedName}-完整摘要.md`
- **AND** 同时上传处理元信息（HTML 注释）

### Requirement: Progress Reporting

系统 SHALL 实时报告处理进度。

#### Scenario: 处理开始
- **WHEN** 开始处理一本书
- **THEN** 输出：`[01/25] 📖 开始处理: 书名.epub`

#### Scenario: 章节处理
- **WHEN** 一个章节处理完成
- **THEN** 输出：`✅ 章节 5/15 处理完成 (input: 3,450 tokens, output: 820 tokens)`

#### Scenario: 书籍完成
- **WHEN** 一本书处理完成
- **THEN** 输出费用统计和处理状态

#### Scenario: 批处理完成
- **WHEN** 所有队列处理完成
- **THEN** 输出：`✅ 处理完成: 25/25 成功, 0/25 失败`

### Requirement: DEBUG Mode

系统 SHALL 支持 DEBUG 模式输出详细信息。

#### Scenario: DEBUG 模式开启
- **GIVEN** 环境变量 FASTREADER_DEBUG = "true"
- **OR** 配置中 debug = true
- **WHEN** 处理过程中
- **THEN** 输出详细的调试信息
- **AND** 包括：API 请求详情、Token 计算过程、费用明细

#### Scenario: DEBUG 模式关闭
- **GIVEN** DEBUG 模式未开启
- **WHEN** 处理过程中
- **THEN** 只输出关键进度和结果信息

