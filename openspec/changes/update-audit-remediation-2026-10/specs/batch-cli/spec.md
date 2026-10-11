## ADDED Requirements
### Requirement: CLI 与前端产物契约一致
CLI 输出的文件名、Markdown 结构与元数据字段 MUST 与前端 `formatUnifiedMarkdown` 一致，并有跨端样例测试保障。

#### Scenario: 大写扩展名文件
- **WHEN** 处理 `Book.EPUB`
- **THEN** CLI 与前端生成相同的缓存文件名 `Book-完整摘要.md`

#### Scenario: 章节失败
- **WHEN** 部分章节处理失败
- **THEN** 失败章节使用 `【处理失败】` 前缀，元数据 `isPartial: true`
- **AND** 失败比例超过阈值时整本判失败且不上传

### Requirement: CLI 分类重试与超时
CLI MUST 只对 408、429、5xx 与网络错误按配置的 maxRetries/retryDelays 重试并遵循 Retry-After；其余 4xx 立即失败；AI 请求 MUST 设置超时。

#### Scenario: 鉴权失败
- **WHEN** AI 服务返回 401
- **THEN** 不重试，立即记录失败
