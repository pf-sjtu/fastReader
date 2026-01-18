## 1. OpenSpec
- [ ] 1.1 编写 md_reader WebDAV 代理与构建修复的 spec delta
- [ ] 1.2 运行 openspec validate add-md-reader-webdav-proxy --strict

## 2. md_reader 构建修复
- [ ] 2.1 修复 markdown-reader-enhanced.tsx JSX 结构错误
- [ ] 2.2 本地运行 md_reader build 验证

## 3. md_reader WebDAV 同源代理
- [ ] 3.1 新增 md_reader 代理工具（与主项目一致的 /api/dav 方案）
- [ ] 3.2 更新 md_reader WebDAV service 使用同源代理
- [ ] 3.3 更新 md_reader WebDAV 配置 UI 提示与默认行为
- [ ] 3.4 兼容 Vercel 路径（/api/webdav）

## 4. 文档
- [ ] 4.1 更新 md_reader README 或文档说明代理差异

## 5. 测试
- [ ] 5.1 本地 build 通过（md_reader + 主项目）
