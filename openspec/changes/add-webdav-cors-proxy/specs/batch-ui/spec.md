## MODIFIED Requirements
### Requirement: WebDAV 批处理配置
批处理界面 MUST 允许用户在设置页配置 WebDAV 连接信息，并在启用 WebDAV 时通过同源代理执行连接测试与后续请求。

#### Scenario: 通过代理进行连接测试
- **WHEN** 用户在设置页点击连接测试
- **THEN** 系统 MUST 通过 `/api/dav` 发起 PROPFIND 并显示结果
