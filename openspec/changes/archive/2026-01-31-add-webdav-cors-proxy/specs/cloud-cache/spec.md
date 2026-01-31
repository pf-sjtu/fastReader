## ADDED Requirements
### Requirement: WebDAV CORS 同源代理
系统 MUST 提供 `/api/dav` 同源代理以转发 WebDAV 请求，支持 PROPFIND 等 WebDAV 方法，并且不要求在服务端预置 WebDAV 配置。

#### Scenario: 代理请求转发成功
- **WHEN** 用户在浏览器发起 `/api/dav/<path>?base=<https-url>` 请求
- **THEN** 代理 MUST 将方法、headers 与 body 透传至上游 WebDAV 并返回响应体与状态码

#### Scenario: 非允许方法被拒绝
- **WHEN** 浏览器发起非白名单方法
- **THEN** 代理 MUST 返回 405

#### Scenario: 非法 base URL 被拒绝
- **WHEN** base URL 不是 https 或包含内嵌凭证
- **THEN** 代理 MUST 返回 400

### Requirement: 代理安全约束
系统 MUST 对代理请求进行 Origin 白名单校验，并在响应中返回相应 CORS headers。

#### Scenario: 允许的 Origin
- **WHEN** Origin 属于允许列表
- **THEN** 响应 MUST 返回对应的 Access-Control-Allow-Origin

#### Scenario: 不允许的 Origin
- **WHEN** Origin 不在允许列表
- **THEN** 响应 MUST 返回 Access-Control-Allow-Origin 为 null
