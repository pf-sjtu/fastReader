## MODIFIED Requirements
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
