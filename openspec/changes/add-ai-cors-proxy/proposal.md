# Change: 新增 AI 同源代理以支持多 API Base

## Why
浏览器直接请求第三方 AI API 会触发 CORS 或 Mixed Content 阻断，需要同源代理，同时需支持用户自定义 apiUrl（含 http/https、多版本路径）。

## What Changes
- 新增 `/api/ai` 同源代理（Cloudflare Pages Functions）
- 前端请求改为走 `/api/ai/*`，并通过 header 传递上游 apiUrl
- 保持现有 AI 配置结构（apiUrl 由用户配置）

## Impact
- Affected specs: cloud-cache
- Affected code: functions/api/ai/[[path]].js, src/services/aiService.ts, docs/*
