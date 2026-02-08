# 高优先级修复：AI配置系统、测试覆盖、组件拆分

## 变更概述

基于最初审计报告，修复剩余的高优先级问题，包括 AI 配置系统混乱、缺少测试覆盖、App.tsx 过于庞大等。

## 剩余问题清单（按迫切程度排序）

### 🔴 高优先级

1. **AI 配置系统混乱** 
   - 两套并行配置接口：`AIConfig` vs `AIProviderConfig`
   - 方法命名冲突：`addAIProvider` vs `addProvider`
   - 状态同步复杂，类型不安全

2. **缺少测试覆盖**
   - `EpubProcessor` - 核心文件解析逻辑无测试
   - `CacheService` - 缓存管理无测试
   - `aiService` - AI 调用逻辑无测试

3. **App.tsx 过于庞大**
   - 1638 行，30+ 个 state
   - 需要拆分为独立组件

### 🟡 中优先级

4. **错误处理迁移** - 将服务层迁移到新的错误处理格式
5. **更多 i18n 硬编码** - App.tsx 和其他组件还有硬编码中文

## 目标

1. 统一 AI 配置系统为单一接口
2. 为核心服务添加单元测试（覆盖率>80%）
3. 拆分 App.tsx 为独立功能组件

## 影响范围

| 文件 | 变更类型 | 影响 |
|------|----------|------|
| src/stores/configStore.ts | MODIFY | 统一 AI 配置接口 |
| src/services/epubProcessor.ts | ADD TEST | 添加单元测试 |
| src/services/cacheService.ts | ADD TEST | 添加单元测试 |
| src/services/aiService.ts | ADD TEST | 添加单元测试 |
| src/App.tsx | MODIFY | 拆分组件 |
| src/components/ | ADD | 新增功能组件 |

## 验收标准

- [ ] AI 配置系统只有一套接口
- [ ] EpubProcessor 测试覆盖率>80%
- [ ] CacheService 测试覆盖率>80%
- [ ] App.tsx 行数减少到 800 以下
- [ ] 所有测试通过
