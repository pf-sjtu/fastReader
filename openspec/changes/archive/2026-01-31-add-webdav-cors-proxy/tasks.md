## 1. OpenSpec
- [ ] 1.1 确认涉及的现有 spec 并编写 delta
- [ ] 1.2 运行 openspec validate add-webdav-cors-proxy --strict

## 2. Functions 代理
- [ ] 2.1 新增 Cloudflare Pages Functions 代理入口 `/api/dav/[[path]]`
- [ ] 2.2 代理实现：方法白名单、Origin 白名单、https base 校验、headers 透传

## 3. 前端改造
- [ ] 3.1 WebDAV 设置页补充代理模式说明（保留用户配置方式）
- [ ] 3.2 WebDAV 服务层改造为同源代理 URL（保留认证与请求结构）
- [ ] 3.3 连接测试走代理链路

## 4. 文档
- [ ] 4.1 docs/ 增加代理部署与用户配置说明
- [ ] 4.2 README.md 补充 WebDAV 代理模式
- [ ] 4.3 CLAUDE.md 补充代理架构约束

## 5. 测试
- [ ] 5.1 手动验证：本地 dev + pages.dev 连接测试看到 207
- [ ] 5.2 必要时补充前端单测（如存在相关测试基架）
