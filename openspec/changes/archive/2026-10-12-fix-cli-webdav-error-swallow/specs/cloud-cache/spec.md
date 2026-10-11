## MODIFIED Requirements
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
