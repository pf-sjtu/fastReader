# Change: 引入 WebDAV CORS 同源代理能力

## Why
浏览器直连 WebDAV 时，PROPFIND 触发预检且上游未放行导致 CORS 阻断，需要通过同源代理解决跨域限制，并保留用户自配置 WebDAV 信息的灵活性。

## What Changes
- 新增基于 Cloudflare Pages Functions 的同源代理 `/api/dav`，透传 WebDAV 方法与响应
- 前端 WebDAV 请求改为同源代理地址，保持现有认证与请求结构
- 在设置页延续用户配置 WebDAV base/账号/密码/目录，并提供代理模式说明
- 文档补充代理部署、用户配置与安全注意事项

## Impact
- Affected specs: cloud-cache, batch-ui
- Affected code: functions/api/dav/[[path]].js, src/services/webdavService.ts, src/components/project/WebDAVConfig.tsx, docs/*, README.md, CLAUDE.md
