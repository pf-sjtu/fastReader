# access-control Delta

## ADDED Requirements

### Requirement: 共享密码登录
系统 MUST 提供单一共享密码登录；密码从部署环境变量 `APP_PASSWORD` 读取，未配置时缺省为 `123456a`。
登录成功后 MUST 下发 `HttpOnly; Secure; SameSite=Strict` 的签名会话 Cookie，浏览器刷新后保持登录。

#### Scenario: 正确密码登录
- **WHEN** 用户输入与 `APP_PASSWORD` 相同的密码
- **THEN** 返回 200 并下发会话 Cookie，前端进入主界面；刷新页面后仍处于登录状态

#### Scenario: 错误密码
- **WHEN** 用户输入错误密码
- **THEN** 返回 401，不设置会话 Cookie，界面提示密码错误且不泄露任何配置信息

### Requirement: 受保护的路由
除 `/api/auth/*` 与静态资源外，所有 `/api/*` 请求 MUST 校验会话 Cookie；无效或过期时返回 401。

#### Scenario: 未登录直接调用接口
- **WHEN** 未携带会话 Cookie 请求 `GET /api/state`
- **THEN** 返回 401，响应体不含任何配置数据

#### Scenario: 伪造会话
- **WHEN** 请求携带自造的 `fr_session`（签名不匹配）
- **THEN** 返回 401

### Requirement: 改密码使全部会话失效
会话签名 MUST 绑定当前密码的指纹；`APP_PASSWORD` 变更后，此前签发的所有会话 MUST 失效。

#### Scenario: 改密后旧会话被拒
- **WHEN** 运维修改 `APP_PASSWORD` 后，用户用旧 Cookie 请求 `GET /api/state`
- **THEN** 返回 401，前端回到登录页

### Requirement: 登录失败限速
系统 MUST 对登录失败按来源 IP 计数，超过阈值时返回 429，且限速状态只在失败时写入存储。

#### Scenario: 连续错误密码
- **WHEN** 同一 IP 在短时间内连续多次登录失败超过阈值
- **THEN** 后续登录请求返回 429 并提示稍后再试

### Requirement: 登出
系统 MUST 提供登出接口，清除会话 Cookie。

#### Scenario: 登出后再访问
- **WHEN** 用户点击登出后再次请求 `GET /api/state`
- **THEN** 返回 401
