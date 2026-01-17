## 1. 提案与校验
- [ ] 完成 proposal.md 与 delta specs 草稿
- [ ] 运行 `openspec validate refactor-webdav-batch-cache --strict` 并修复问题

## 2. 前端：批量处理缓存优化
- [ ] 在批量处理启动前预取云端缓存列表（单次批处理内）
- [ ] 批量处理循环内改为本地 Map 对比，避免逐文件 WebDAV 检查
- [ ] 批量对话框内缓存检查改为单次目录缓存列表对比

## 3. CLI：批量处理缓存优化
- [ ] 发现书籍后预取缓存列表并复用
- [ ] 移除 `_process_single_book` 内的重复缓存检查
- [ ] 评估 `list_books` 期间的多次 info 请求并替换为一次性列表

## 4. 测试与验证
- [ ] 增加/更新批量处理相关测试（覆盖率 >= 80%）
- [ ] 运行测试并记录结果

## 5. Git 与归档
- [ ] 按规范提交并添加 git notes
- [ ] 完成验证后提示 `/openspec:achieve`
