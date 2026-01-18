# WebDAV 同源代理（Cloudflare Pages Functions）

## 目的

浏览器直接访问 WebDAV（例如 PROPFIND）会触发 CORS 预检，部分 WebDAV 服务未允许 PROPFIND，导致请求被拦截。本方案通过同源代理绕过浏览器跨域限制。

## 总体架构

- 浏览器仅请求同源 `/api/dav`
- Pages Functions 代理转发到用户配置的 WebDAV base
- 代理透传请求方法、主要 headers 与 body，并返回上游响应
- WebDAV URL/用户名/密码/文件夹均由浏览器端用户配置

## 与需求的对应关系

- 用户配置 WebDAV URL / 用户名 / 密码 / 文件夹：已由设置页配置与 `webdavService` 统一读取
- 代理泛化：代理端不硬编码任何 WebDAV 信息，仅转发并校验
- 流程清晰：本手册包含代码路径、配置步骤、部署与本地开发说明

## 当前实现说明（与建议方案的差异）

当前实现支持两种传参方式：

1) **Header 方式（默认）**
- 前端通过 `X-WebDAV-Base` 传上游 base
- 通过 `X-WebDAV-Path` 传目标路径（包含 folder + path）
- 优点：避免 `webdav` 客户端对 query/path 拼接的限制

2) **Query 方式（兼容）**
- 代理也支持 `?base=...&path=...`
- 当 header 未提供时使用 query 参数

如果你希望严格保持 `/api/dav/<path>?base=...` 形式，请明确告知，可另做改造。

## 代码位置（必读）

- 代理函数：`functions/api/dav/[[path]].js`
- 前端服务层：`src/services/webdavService.ts`
- 代理工具：`src/services/webdavProxyUtils.ts`
- WebDAV UI：`src/components/project/WebDAVConfig.tsx`
- 文档：`docs/webdav-proxy.md`

## 代理实现要点

### 1) 允许的请求方法
代理允许以下方法（可按需删减）：

- `OPTIONS, PROPFIND, GET, PUT, POST, DELETE, MKCOL, MOVE, COPY, HEAD`

### 2) Origin 白名单
仅允许指定来源调用代理。默认白名单：

- `https://fast-read.pages.dev`
- `http://localhost:3000`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

修改位置：`functions/api/dav/[[path]].js` → `ALLOWED_ORIGINS`

### 3) base URL 校验（防 SSRF）

- 必须为 `https://`
- 禁止 URL 内含用户名/密码

对应函数：`isValidUpstreamBase`

### 4) 预检处理（OPTIONS）

代理对 `OPTIONS` 返回 204，并带完整 CORS headers：

- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Methods`
- `Access-Control-Allow-Headers`
- `Access-Control-Max-Age`

### 5) 透传 headers 与 body

- 透传 Authorization / Depth / If-* / Range 等
- 移除 `Origin / Referer / Host / X-WebDAV-*`

## 前端改造说明

### 用户配置（设置页）

- Server URL：`https://example.com/dav/`
- Username / Password
- Folder（同步路径）：默认 `/fastReader`

### 关键请求逻辑

- 前端统一访问 `/api/dav`
- 通过 headers 发送：
  - `Authorization: Basic <base64(user:pass)>`
  - `X-WebDAV-Base: https://example.com/dav/`
  - `X-WebDAV-Path: /Books/My File.txt`

内部工具：`buildWebdavPath` 与 `buildWebdavProxyUrl`

## Cloudflare Pages 配置手册（详尽版）

### 1) 准备代码

确认仓库已包含文件：

- `functions/api/dav/[[path]].js`

Cloudflare Pages 会自动识别该目录并部署 Functions。

### 2) 绑定 Pages 项目（从 0 开始）

1. 登录 Cloudflare Dashboard
2. 左侧菜单进入 Pages → Create a project
3. 选择 Git 仓库并授权
4. 构建设置：
   - Build command：按你的项目设置（如 `npm run build`）
   - Build output directory：`dist`
   - Framework preset：选择你项目实际框架（Vite 通常可自动识别）
5. 点击 Save and Deploy
6. 部署完成后打开项目详情页，记录生产域名（如 `https://<name>.pages.dev`）

### 3) 启用 Functions（无需额外开关）

Pages 会自动识别 `functions/` 目录并启用 Functions。
确认方式：

- 在部署日志中看到 Functions 构建步骤
- 访问 `https://<your-pages-domain>/api/dav` 返回 405（Method not allowed）而不是 404

### 4) 配置 CORS 白名单（关键步骤）

CORS 不在 Cloudflare 控制台里配置，**只能在函数代码中配置**。

1. 打开 `functions/api/dav/[[path]].js`
2. 更新 `ALLOWED_ORIGINS`：
   - 生产域名（Pages 默认域名 + 你绑定的自定义域名）
   - 本地开发域名（如 `http://localhost:5173`）
3. 保存后重新部署（推送代码即可触发）

建议白名单示例：

- `https://<your-pages-domain>`
- `https://<your-custom-domain>`
- `http://localhost:5173`

### 5) 配置自定义域名（可选但推荐）

1. Pages → Custom domains
2. Add custom domain
3. 按提示完成 DNS 解析
4. 将新域名加入 `ALLOWED_ORIGINS`

### 6) 代理开关与调试

不需要任何环境变量或 Secrets。

常见错误定位：

- 403：Origin 不在白名单
- 400：Server URL 非 https 或含凭证
- 405：方法未在白名单

### 7) 部署后验证

1. 打开站点
2. Settings → WebDAV
3. 填写 Server URL / Username / Password / Folder
4. 点击 Test Connection
5. 期待结果：207 Multi-Status 或目录列表

## 本地开发（推荐流程）

### 方案 A：使用 Pages 本地开发（推荐）

```bash
npx wrangler pages dev ./dist
```

- 默认端口：`http://localhost:8788`
- 可加 HTTPS：

```bash
npx wrangler pages dev --local-protocol=https ./dist
```

### 方案 B：前端开发服务器 + 远端 Pages

- 直接请求 `https://<your-pages-domain>/api/dav`
- 需要确保 `Origin` 在白名单

## 常见错误排查

- `403 Origin not allowed`
  - Origin 不在白名单
- `400 Invalid upstream base URL`
  - Server URL 非 https 或含凭证
- `405 Method not allowed`
  - 请求方法不在白名单
- `401/403 Unauthorized`
  - WebDAV 凭证错误或权限不足

## 安全提醒

- 凭证在浏览器端保存与发送（同源 HTTPS）
- 代理不应记录敏感 headers
- 如果需要进一步限制，可新增 host 白名单校验

## 参考链接

- Cloudflare Pages Functions CORS 示例：https://developers.cloudflare.com/pages/functions/examples/cors-headers/
- Pages 本地开发：https://developers.cloudflare.com/pages/functions/local-development/
- Wrangler 配置：https://developers.cloudflare.com/pages/functions/wrangler-configuration/
