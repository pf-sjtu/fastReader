# 修复任务清单

## 高优先级修复

### Task 1: 修复 package.json name
- [ ] 修改 package.json 中的 name 字段
- [ ] 验证 npm 脚本正常运行

### Task 2: 修复缓存过期时间
- [ ] 修改 cacheService.ts 中的 CACHE_EXPIRY
- [ ] 添加缓存统计和清理功能

### Task 3: 提取 i18n 硬编码中文
- [ ] 扫描所有组件文件，提取硬编码中文
- [ ] 更新 zh.json 添加新键
- [ ] 更新 en.json 添加英文翻译
- [ ] 替换组件中的硬编码文本

## 中优先级修复

### Task 4: 优化 App.tsx
- [ ] 提取可复用的 hooks
- [ ] 简化 state 管理
- [ ] 添加代码注释

### Task 5: 响应式布局调整
- [ ] 分析当前布局问题
- [ ] 调整 Grid 布局
- [ ] 测试不同屏幕尺寸

### Task 6: 统一错误处理
- [ ] 创建错误处理工具函数
- [ ] 统一服务层错误返回格式

## Git 提交计划

1. `chore(config): 修正 package.json 项目名称为 fastreader`
2. `fix(cache): 将缓存过期时间从999天调整为7天`
3. `feat(i18n): 完善国际化，提取所有硬编码中文`
4. `refactor(app): 优化 App.tsx 代码结构`
5. `style(layout): 改进响应式布局`
6. `refactor(error): 统一错误处理机制`
