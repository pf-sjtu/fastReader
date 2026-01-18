## ADDED Requirements
### Requirement: AI 同源代理
系统 MUST 提供 `/api/ai` 同源代理用于转发 AI API 请求。

#### Scenario: 多 API Base 支持
- **WHEN** 前端请求携带 apiUrl（如 `https://api.xiaomimimo.com/v1` 或 `http://35.208.227.162:8317/v1beta`）
- **THEN** 代理 MUST 使用该 apiUrl 作为上游 base 并转发请求

#### Scenario: CORS/Mixed Content 规避
- **WHEN** 前端通过 `/api/ai/*` 发起请求
- **THEN** 浏览器不应直接访问上游 API，避免 CORS 与 Mixed Content 阻断
