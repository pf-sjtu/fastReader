# shared-state Delta

## ADDED Requirements

### Requirement: 服务端共享状态存储
系统 MUST 把 AI 服务商、处理选项、WebDAV、提示词、处理历史、批量队列、Token 用量等状态保存在服务端
（Cloudflare KV），所有登录用户看到同一份数据；浏览器本地 MUST NOT 再作为这些数据的权威存储。

#### Scenario: 换浏览器后配置仍在
- **WHEN** 用户在浏览器 A 修改「处理选项 → 章节并行数」并等待同步完成，随后在浏览器 B 登录
- **THEN** 浏览器 B 展示修改后的章节并行数值，且 A、B 的本地 localStorage 中不存在该配置的权威副本

#### Scenario: 服务端不可用时只读降级
- **WHEN** 拉取 `GET /api/state` 失败（网络错误或 5xx）
- **THEN** 界面进入离线状态、保留上次成功拉取的数据视图、禁止写入并提示「离线，暂不可修改」

### Requirement: 分节乐观锁与冲突处理
系统 MUST 按节（section）独立版本号；写入 MUST 携带 `If-Match`，版本不匹配时返回 409 与最新值，
前端 MUST 以三方合并后重试而不是覆盖。

#### Scenario: 并发修改不同字段
- **WHEN** A 修改「处理模式」、B 同时修改「输出语言」，两者基于同一 rev 提交
- **THEN** 后提交者收到 409，合并后重试成功，最终服务端同时保留两项改动

#### Scenario: 并发修改同一字段
- **WHEN** A 与 B 基于同一 rev 修改同一个字段为不同值
- **THEN** 合并结果采用服务端最新值，并向本地用户提示该字段已被他人修改

### Requirement: 秘密字段不离开服务端
API Key、WebDAV 密码等秘密字段 MUST 只保存在服务端；`GET /api/state` MUST 脱敏为 `{hasSecret: true}`；
写入时字段缺席或为 `{hasSecret: true}` 视为保留原值，`null` 视为清除。

#### Scenario: 读取不到明文密钥
- **WHEN** 已登录用户请求 `GET /api/state`
- **THEN** 响应中任何 `apiKey` / `password` 字段都不是明文字符串，而是 `{hasSecret: boolean}`

#### Scenario: 更新其它字段不会清掉密钥
- **WHEN** 客户端只修改服务商名称并提交（apiKey 字段仍是 `{hasSecret: true}`）
- **THEN** 服务端保留原 API Key，代理请求仍可正常鉴权

### Requirement: 追加型数据无冲突合并
处理历史与 Token 用量等累加数据 MUST 通过追加接口写入，由服务端合并，不得因并发而丢失记录。

#### Scenario: 两台浏览器各完成一本书
- **WHEN** A 完成后写入历史记录 R1，B 同时写入 R2
- **THEN** 最终历史列表同时包含 R1 与 R2，用量为两者之和

### Requirement: 批量队列单执行者
共享批量队列 MUST 同一时刻只允许一个客户端执行；非持有者只读并看到当前进度。

#### Scenario: 他人正在执行
- **WHEN** A 已持有执行租约，B 打开批量面板并点击开始
- **THEN** B 的开始操作被拒绝并提示「正在由其他客户端执行」，B 仍能看到 A 的进度
