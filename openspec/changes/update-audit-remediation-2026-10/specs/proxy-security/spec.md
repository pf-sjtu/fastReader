## ADDED Requirements
### Requirement: 代理上游作用域约束
DAV 与 AI 代理 MUST 校验最终上游 URL 与声明的 base 同源且路径位于 base 之下；base MUST 为 https 且不指向本机、私网、链路本地或其 IPv6 等价地址。

#### Scenario: path 为绝对 URL
- **WHEN** 请求的 path 为 `http://other.host/x` 或 `///other.host/x`
- **THEN** 代理返回 400，不发起上游请求

#### Scenario: 跨源重定向
- **WHEN** 上游返回指向其他主机的重定向
- **THEN** 代理不携带 Authorization 跟随

### Requirement: 书籍 HTML 净化与 CSP
所有书籍或外部来源 HTML 写入 DOM 前 MUST 经过净化；站点 MUST 下发禁止内联脚本的 CSP。

#### Scenario: EPUB 含事件属性
- **WHEN** EPUB 章节包含 `<img onerror=...>`
- **THEN** 渲染结果不含该事件属性，脚本不执行
