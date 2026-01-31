## 1. OpenSpec
- [ ] 1.1 编写 AI 代理 spec delta
- [ ] 1.2 运行 openspec validate add-ai-cors-proxy --strict

## 2. 代理实现
- [ ] 2.1 新增 Cloudflare Functions `/api/ai/[[path]]`
- [ ] 2.2 代理支持自定义 apiUrl（允许 http/https）
- [ ] 2.3 安全策略：Origin 白名单、允许方法、去除敏感回显

## 3. 前端改造
- [ ] 3.1 AI 请求改走同源代理，传递 apiUrl
- [ ] 3.2 兼容 openai-compatible / gemini 等 provider

## 4. 文档
- [ ] 4.1 docs 增加 AI 代理使用说明
