# 第五轮修复：拆分 App.tsx 与完成剩余修复

## 变更概述

基于审计报告，完成剩余的高优先级任务：拆分庞大的 App.tsx 组件，迁移错误处理，提取剩余国际化。

## 剩余问题清单

### 🔴 高优先级

1. **App.tsx 过于庞大** - 1639 行，需要拆分为独立组件
2. **错误处理迁移** - 将服务层迁移到新的错误处理格式

### 🟡 中优先级

3. **更多 i18n 硬编码** - App.tsx 和其他组件还有未提取的中文

## 目标

1. 将 App.tsx 拆分为 3 个独立组件 + 自定义 hooks
2. 将关键服务迁移到新的错误处理格式
3. 提取所有剩余的硬编码中文

## App.tsx 拆分计划

```
src/
├── components/
│   └── sections/
│       ├── FileUploadSection.tsx      # 文件上传区域
│       ├── ChapterSelectSection.tsx   # 章节选择区域
│       └── ProcessingSection.tsx      # 处理结果区域
├── hooks/
│   └── useBookProcessing.ts           # 书籍处理逻辑
└── App.tsx                            # 主组件（精简至 600 行）
```

## 影响范围

| 文件 | 变更类型 | 影响 |
|------|----------|------|
| src/App.tsx | MODIFY | 大幅精简，使用新组件 |
| src/components/sections/ | ADD | 新增功能组件 |
| src/hooks/useBookProcessing.ts | ADD | 新增自定义 hook |
| src/services/ | MODIFY | 迁移错误处理 |
| src/i18n/locales/ | MODIFY | 补充翻译 |

## 验收标准

- [ ] App.tsx 行数减少到 600 以下
- [ ] 新增组件有完整的 TypeScript 类型
- [ ] 所有功能保持正常
- [ ] 服务层使用新的错误处理格式
- [ ] 所有用户可见文本可国际化
