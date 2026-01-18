# WebDAV 同源代理（Cloudflare Pages Functions）

## 目的

浏览器直接访问 WebDAV（例如 PROPFIND）会触发 CORS 预检，部分 WebDAV 服务未允许 PROPFIND，导致请求被拦截。此方案通过同源代理绕过浏览器跨域限制。

## 工作原理

- 浏览器仅请求同源 `/api/dav`
- Pages Functions 代理转发到用户配置的 WebDAV base
- 代理透传请求方法、主要 headers 与 body，并返回上游响应

## 安全约束

- 仅允许白名单 Origin
- base URL 必须为 `https://` 且不包含内嵌用户名密码
- 禁止日志打印敏感 headers（如 Authorization）

## 配置说明

### 应用内配置（Settings → WebDAV）

- Server URL：以 `https://` 开头，并以 `/` 结尾
- Username / Password：WebDAV 账号或应用密码
- Folder（同步路径）：默认 `/fastReader`

点击“测试连接”会通过 `/api/dav` 发起 PROPFIND 以验证连接。

### 代理部署（Cloudflare Pages）

仓库内已包含：

- `functions/api/dav/[[path]].js`

部署后 `/api/dav` 与前端同源，即可工作。

### 本地开发建议

建议使用 Pages Functions 本地模式或直接使用开发站点同源代理。

## 故障排查

- 403/Origin not allowed：检查本地端口是否在白名单
- 400/Invalid upstream base URL：检查 Server URL 是否为 https 且不含凭证
- 405：请求方法未在代理白名单中
