# cloud-cache Specification

## Purpose
TBD - created by archiving change add-batch-processing. Update Purpose after archive.
## Requirements
### Requirement: Cloud Cache Reading

系统 SHALL 支持从 WebDAV 读取已处理的文件缓存，避免重复处理。

#### Scenario: 打开已处理的文件
- **WHEN** 用户选择打开一个 EPUB/PDF 文件
- **THEN** 系统检查 WebDAV 上是否存在 `{syncPath}/{sanitizedName}-完整摘要.md`
- **AND** 如果文件存在，系统下载并读取该文件内容
- **AND** 系统渲染内容到结果页面
- **AND** 系统提示用户"发现云端缓存，可直接查看或重新处理"

#### Scenario: 打开未处理的文件
- **WHEN** 用户选择打开一个 EPUB/PDF 文件
- **THEN** 系统检查 WebDAV 上是否存在 `{syncPath}/{sanitizedName}-完整摘要.md`
- **AND** 如果文件不存在，系统继续常规处理流程

#### Scenario: 缓存文件损坏
- **WHEN** 系统下载缓存文件后解析失败
- **THEN** 系统记录错误日志
- **AND** 系统提示用户"缓存文件损坏，将重新处理"
- **AND** 系统继续常规处理流程

### Requirement: Cache Key Generation

系统 SHALL 根据文件名生成标准化的缓存键。

#### Scenario: 生成缓存键
- **GIVEN** 文件名为 `我的书籍.epub`
- **WHEN** 生成缓存键
- **THEN** 结果为 `我的书籍-完整摘要.md`

#### Scenario: 生成缓存键（包含特殊字符）
- **GIVEN** 文件名为 `Test <Book> Name:Part1.pdf`
- **WHEN** 生成缓存键
- **THEN** 结果为 `Test Book NamePart1-完整摘要.md`

### Requirement: Cloud Cache Service

系统 SHALL 提供 `cloudCacheService.ts` 服务处理云端缓存操作。

#### Scenario: 检查缓存是否存在
- **WHEN** 调用 `cloudCacheService.checkCacheExists(fileName)`
- **THEN** 返回 Promise<boolean> 表示缓存是否存在

#### Scenario: 读取缓存内容
- **WHEN** 调用 `cloudCacheService.readCache(fileName)`
- **THEN** 返回 Promise<string> 表示文件内容
- **AND** 如果读取失败，抛出异常或返回 null

