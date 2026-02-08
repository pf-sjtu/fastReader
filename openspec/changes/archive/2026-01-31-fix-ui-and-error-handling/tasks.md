# 第二轮修复任务清单

## UI 修复

### Task 1: 响应式布局重构
- [ ] 分析 App.tsx 当前布局结构
- [ ] 将固定宽度改为 Grid 布局
- [ ] 添加移动端断点支持
- [ ] 测试不同屏幕尺寸

### Task 2: 修复深色模式硬编码颜色
- [ ] 修改 src/index.css 滚动条样式
- [ ] 使用 CSS 变量替代 oklch 硬编码值
- [ ] 验证深色模式切换正常

### Task 3: 统一组件样式
- [ ] 统一 MarkdownCard 和 MindMapCard 的 gap
- [ ] 统一按钮变体使用

### Task 4: 添加空状态组件
- [ ] 创建 EmptyState 组件
- [ ] 在 WebDAV 未配置时使用
- [ ] 在章节列表为空时使用

## 错误处理修复

### Task 5: 统一错误处理机制
- [ ] 创建错误处理工具函数
- [ ] 统一服务层错误返回格式
- [ ] 修改 AI 服务错误处理
- [ ] 修改 WebDAV 服务错误处理

### Task 6: 优化加载状态
- [ ] 添加取消处理功能
- [ ] 改进进度显示

## Git 提交计划

1. `style(layout): 重构响应式布局，使用 Grid 系统`
2. `fix(theme): 修复深色模式滚动条硬编码颜色`
3. `style(components): 统一组件样式 gap 和按钮变体`
4. `feat(ui): 添加 EmptyState 和 ErrorState 组件`
5. `refactor(error): 统一错误处理机制`
6. `feat(processing): 添加处理取消功能`
