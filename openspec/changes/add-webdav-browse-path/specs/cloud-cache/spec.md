## MODIFIED Requirements
### Requirement: WebDAV 目录配置
系统 MUST 区分 WebDAV 浏览目录与输出目录，并允许用户分别配置。

#### Scenario: 默认浏览根目录
- **WHEN** 用户启用 WebDAV 且未配置 browsePath
- **THEN** 系统 MUST 默认浏览 `/`

#### Scenario: 输出目录保持 fastReader
- **WHEN** 用户未修改 syncPath
- **THEN** 系统 MUST 默认输出到 `/fastReader`
