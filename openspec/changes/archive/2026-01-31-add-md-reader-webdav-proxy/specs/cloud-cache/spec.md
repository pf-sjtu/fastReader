## MODIFIED Requirements
### Requirement: WebDAV 代理访问
系统 MUST 在 md_reader 中提供同源 WebDAV 代理能力，支持通过 `/api/dav` 访问用户配置的 WebDAV 服务，并在 Vercel 部署时兼容 `/api/webdav` 代理路径。

#### Scenario: Cloudflare 同源代理访问
- **WHEN** 用户在 md_reader 中配置 WebDAV 并启用
- **THEN** 客户端 MUST 通过 `/api/dav` 发起 WebDAV 请求

#### Scenario: Vercel 代理兼容
- **WHEN** 应用部署在 Vercel 且启用 WebDAV
- **THEN** 客户端 MUST 能通过 `/api/webdav` 完成 WebDAV 请求

## MODIFIED Requirements
### Requirement: Markdown Reader 构建稳定性
系统 MUST 保证 md_reader 子项目在 Vercel 构建时 JSX 语法正确并可成功编译。

#### Scenario: JSX 语法修复
- **WHEN** 构建 md_reader
- **THEN** TypeScript 编译与 Vite 构建均应通过
