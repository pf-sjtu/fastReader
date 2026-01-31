## MODIFIED Requirements
### Requirement: Cloud Cache Service
系统 SHALL 支持获取云端缓存文件列表，并可在单次批处理内复用该列表进行本地对比。

#### Scenario: 读取缓存文件列表
- **WHEN** 系统请求云端缓存文件列表
- **THEN** 返回 `syncPath` 下所有 `*-完整摘要.md` 的文件名集合
- **AND** 支持在一次批量处理中复用该列表进行存在性判断
