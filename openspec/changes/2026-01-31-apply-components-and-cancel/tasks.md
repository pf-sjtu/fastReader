# 第三轮修复任务清单

## 应用组件

### Task 1: 在 WebDAV 文件浏览器中应用 EmptyState
- [ ] 导入 EmptyState 组件
- [ ] 在 WebDAV 未配置时显示
- [ ] 在文件列表为空时显示
- [ ] 添加对应的 i18n 翻译

### Task 2: 优化 MindMapCard 响应式
- [ ] 移除固定 max-w-[500px]
- [ ] 使用响应式类名
- [ ] 测试移动端显示

## 添加取消功能

### Task 3: 为 AI 处理添加取消功能
- [ ] 在 App.tsx 中添加取消状态
- [ ] 修改 processBook 函数支持取消
- [ ] 添加取消按钮 UI
- [ ] 添加取消后的清理逻辑

## 国际化

### Task 4: 提取剩余硬编码中文
- [ ] 扫描 App.tsx 剩余硬编码
- [ ] 扫描其他组件
- [ ] 添加翻译键
- [ ] 更新中英文翻译文件

## Git 提交计划

1. `feat(ui): 在 WebDAV 文件浏览器中应用 EmptyState 组件`
2. `feat(processing): 为 AI 处理添加取消功能`
3. `style(mindmap): 优化 MindMapCard 响应式布局`
4. `feat(i18n): 提取剩余硬编码中文`
