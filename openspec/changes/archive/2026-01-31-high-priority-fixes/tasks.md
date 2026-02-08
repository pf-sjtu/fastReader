# 第四轮修复任务清单（高优先级）

## 高优先级任务

### Task 1: 统一 AI 配置系统
- [ ] 分析 configStore.ts 中两套配置接口
- [ ] 废弃旧的 AIConfig 接口
- [ ] 统一使用 AIProviderConfig 和 AIConfigManager
- [ ] 更新所有使用旧接口的组件
- [ ] 添加迁移逻辑（向后兼容）

### Task 2: 为 EpubProcessor 添加单元测试
- [ ] 创建 tests/services/epubProcessor.test.ts
- [ ] 测试 parseEpub 方法
- [ ] 测试 extractChapters 方法
- [ ] 测试错误处理
- [ ] 确保覆盖率>80%

### Task 3: 为 CacheService 添加单元测试
- [ ] 创建 tests/services/cacheService.test.ts
- [ ] 测试 get/set/delete 方法
- [ ] 测试过期清理
- [ ] 测试 localStorage 持久化
- [ ] 确保覆盖率>80%

### Task 4: 拆分 App.tsx
- [ ] 创建 src/components/sections/FileUploadSection.tsx
- [ ] 创建 src/components/sections/ProcessingSection.tsx
- [ ] 提取相关 hooks
- [ ] 更新 App.tsx 使用新组件
- [ ] 确保功能完整

## 中优先级任务

### Task 5: 提取剩余 i18n 硬编码中文
- [ ] 扫描所有组件文件
- [ ] 添加缺失的翻译键
- [ ] 更新中英文翻译文件

## Git 提交计划

1. `refactor(config): 统一 AI 配置系统，废弃旧接口`
2. `test(epub): 为 EpubProcessor 添加单元测试`
3. `test(cache): 为 CacheService 添加单元测试`
4. `refactor(app): 拆分 App.tsx 为独立组件`
5. `feat(i18n): 提取剩余硬编码中文`
