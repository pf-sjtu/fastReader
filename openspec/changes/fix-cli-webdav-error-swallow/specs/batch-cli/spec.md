## MODIFIED Requirements
### Requirement: Batch File Discovery
系统 SHALL 在单次批量处理内缓存云端文件列表，用于过滤已处理文件，避免循环内重复调用 WebDAV。
系统 MUST 区分「缓存列表为空（确实没有已处理文件）」与「缓存列表探测失败」；后者不得当作无缓存而把全部书籍加入处理队列。

#### Scenario: 单次批处理内缓存列表
- **GIVEN** 配置 skipProcessed = true
- **WHEN** 系统开始一次批量处理
- **THEN** 系统只进行一次 WebDAV 目录/缓存列表查询
- **AND** 后续过滤逻辑使用本地缓存列表进行对比

#### Scenario: 缓存探测失败时中止批处理
- **GIVEN** 配置 skipProcessed = true
- **AND** 云端缓存列表查询因网络错误、超时、5xx 或鉴权失败而无法完成
- **WHEN** 系统开始一次批量处理
- **THEN** 系统 MUST NOT 将探测失败当作「没有已处理缓存」
- **AND** 系统中止批处理并记录错误，而不是对全部书籍重新处理
