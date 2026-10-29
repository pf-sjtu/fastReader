# proxy-security Delta

## MODIFIED Requirements

### Requirement: 代理上游作用域约束
DAV 与 AI 代理 MUST 从服务端保存的配置中确定上游 base 与凭据，MUST NOT 接受客户端指定的任意上游 base；
最终上游 URL 仍 MUST 与 base 同源且路径位于 base 之下，base MUST 为 https 且不指向本机、私网、链路本地或其 IPv6 等价地址。

#### Scenario: path 为绝对 URL
- **WHEN** 请求的 path 为 `http://other.host/x` 或 `///other.host/x`
- **THEN** 代理返回 400，不发起上游请求

#### Scenario: 客户端指定未知服务商
- **WHEN** 请求头引用的服务商 id 在服务端配置中不存在
- **THEN** 代理返回 400 且不发起任何上游请求

#### Scenario: 跨源重定向
- **WHEN** 上游返回指向其他主机的重定向
- **THEN** 代理不携带 Authorization 跟随

## ADDED Requirements

### Requirement: 凭据由服务端注入
AI 与 DAV 代理 MUST 在转发时用服务端保存的凭据覆盖（而非追加）客户端的鉴权头，客户端 MUST NOT 能通过请求头覆盖服务端凭据。

#### Scenario: 客户端自带 Authorization
- **WHEN** 已登录用户请求 `/api/ai` 时自行设置 `Authorization: Bearer attacker-key`
- **THEN** 代理丢弃该头并改用服务端保存的 Key
