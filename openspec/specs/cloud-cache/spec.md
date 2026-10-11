# cloud-cache Specification

## Purpose
约束 WebDAV 云端缓存的命名、读取与存在性判定，以及本地章节缓存的版本化键，保证不把失败、未知或过期结果当作有效缓存。

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
系统 SHALL 支持获取云端缓存文件列表，并可在单次批处理内复用该列表进行本地对比。
CLI WebDAV 存在性探测（单文件 `exists`/`info` 与缓存目录列举）MUST 区分「资源不存在」与「探测失败」；网络错误、超时、5xx、鉴权失败及未连接不得当作不存在。

#### Scenario: 读取缓存文件列表
- **WHEN** 系统请求云端缓存文件列表
- **THEN** 返回 `syncPath` 下所有 `*-完整摘要.md` 的文件名集合
- **AND** 支持在一次批量处理中复用该列表进行存在性判断

#### Scenario: CLI 单文件探测到资源不存在
- **WHEN** CLI 对某路径做存在性或文件信息探测，且服务端表示资源不存在（如 404）
- **THEN** `file_exists` 为 False
- **AND** `get_file_info` 表示不存在（空信息）

#### Scenario: CLI 单文件探测失败
- **WHEN** CLI 对某路径做存在性或文件信息探测，且发生网络错误、超时、5xx 或鉴权失败
- **THEN** 系统 MUST NOT 将该失败当作文件不存在
- **AND** 系统向上抛出可区分的探测失败

#### Scenario: CLI 缓存列表探测失败
- **WHEN** CLI 列举云端缓存文件列表因网络错误、超时、5xx 或鉴权失败而无法完成
- **THEN** 系统 MUST NOT 返回空集合当作「没有任何缓存文件」
- **AND** 系统向上抛出可区分的探测失败

### Requirement: AI 同源代理
系统 MUST 提供 `/api/ai` 同源代理用于转发 AI API 请求。

#### Scenario: 多 API Base 支持
- **WHEN** 前端请求携带 apiUrl（如 `https://api.xiaomimimo.com/v1` 或 `http://35.208.227.162:8317/v1beta`）
- **THEN** 代理 MUST 使用该 apiUrl 作为上游 base 并转发请求

#### Scenario: CORS/Mixed Content 规避
- **WHEN** 前端通过 `/api/ai/*` 发起请求
- **THEN** 浏览器不应直接访问上游 API，避免 CORS 与 Mixed Content 阻断

### Requirement: 云端存在性三态
前端云端缓存探测 MUST 区分「存在」「不存在」「未知」三种结果；鉴权失败、网络错误、重试后仍为 5xx 的结果为「未知」，不得当作不存在。

#### Scenario: 批量处理遇到未知状态
- **WHEN** 批量处理开始前查询云端已处理列表，结果为未知
- **THEN** 系统中止本次批量并提示无法确认云端状态
- **AND** 不得以覆盖模式重新处理并上传

#### Scenario: 单书遇到未知状态
- **WHEN** 选书后云端缓存探测结果为未知
- **THEN** 界面提示无法确认云端缓存状态，而不是表现为没有缓存

### Requirement: 部分失败结果不作为完整缓存
含失败章节的处理结果 MUST 在元数据中标记 `isPartial: true`；读取到 `isPartial` 或失败占位的云端结果时 MUST NOT 视为完整缓存。

#### Scenario: 读取部分失败的云端结果
- **WHEN** 云端摘要元数据 `isPartial` 为 true
- **THEN** 系统提示存在失败章节并允许重新处理
- **AND** 批量 skipProcessed 不跳过该书

### Requirement: 版本化章节缓存
章节级缓存键 MUST 包含文件指纹、章节内容哈希、模型、prompt 版本（含自定义 prompt 哈希）、实际输出语言与处理类型；任一变化 MUST NOT 命中旧结果。

#### Scenario: 换模型重新处理
- **WHEN** 用户更换模型后重新处理同一本书
- **THEN** 所有章节重新调用 AI，不返回旧模型的缓存结果

#### Scenario: 重新处理部分失败的书
- **WHEN** 同一配置下重新处理一本有失败章节的书
- **THEN** 只有失败或未缓存的章节调用 AI
