# Change: 修复 md_reader 构建错误并加入 WebDAV 同源代理

## Why
Vercel 构建因 JSX 未闭合导致失败，同时 md_reader 子项目在浏览器端仍会被 WebDAV CORS 阻断，需要统一代理方案以兼容 Cloudflare 与 Vercel 部署。

## What Changes
- 修复 `md_reader` 中 `markdown-reader-enhanced.tsx` 的 JSX 结构错误
- 引入 md_reader 同源 WebDAV 代理（Cloudflare Pages Functions 为主，Vercel 兼容）
- 更新 md_reader WebDAV 服务层与配置 UI，沿用现有配置入口
- 补充 md_reader 代理使用说明与部署差异说明

## Impact
- Affected specs: cloud-cache, batch-ui
- Affected code: md_reader/src/components/markdown-reader-enhanced.tsx, md_reader/src/services/webdavService.ts, md_reader/api/webdav.js (or functions api), md_reader/src/components/webdav-config.tsx
