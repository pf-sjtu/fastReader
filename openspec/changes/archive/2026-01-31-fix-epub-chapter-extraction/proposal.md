# 修复 EPUB 章节提取问题

## 问题描述

EPUB 章节提取的"第三种方式"（`epub-toc` 模式）在个别图书上失效，特别是《金融的本质：伯南克四讲美联储.epub》。

## 问题分析

根据代码审查，当前章节提取逻辑存在以下潜在问题：

### 1. TOC 与 Spine 不匹配

某些 EPUB 文件的目录结构（`navigation.toc`）中的 `href` 与书脊（`spine`）中的文件路径可能不完全匹配：
- 目录使用相对路径，而 spine 使用绝对路径
- 目录包含锚点（如 `chapter1.xhtml#section1`），但 spine 只包含文件名
- 文件扩展名不一致（.xhtml vs .html）

### 2. 章节内容匹配失败

[`getSingleChapterContent`](src/services/epubProcessor.ts:273) 方法的匹配逻辑：
```typescript
if (spineItem.href === href || spineItem.href.endsWith(href))
```

这个匹配可能失败的情况：
- `spineItem.href` = "OEBPS/chapter1.xhtml"
- `href` = "chapter1.xhtml" （从 TOC 提取的）
- `endsWith` 可以匹配，但如果顺序反过来则失败

### 3. 锚点定位问题

某些 EPUB 使用锚点（#id）来区分同一文件内的多个章节，但当前逻辑可能无法正确提取锚点范围内的内容。

## 预期行为

对于《金融的本质》这类 EPUB 文件：
1. 应该能够正确识别所有章节
2. 章节顺序应该与目录一致
3. 每个章节的内容应该完整提取

## 影响范围

- **主要影响**: `src/services/epubProcessor.ts` 中的章节提取逻辑
- **次要影响**: 可能需要更新 `EpubReader.tsx` 组件的章节显示逻辑

## 修复策略

1. **增强 href 匹配逻辑**：使用更灵活的路径匹配算法
2. **改进锚点处理**：正确提取锚点范围内的内容
3. **添加调试日志**：便于后续排查类似问题
4. **编写测试用例**：确保修复不会破坏现有功能

## 验证方法

使用《金融的本质：伯南克四讲美联储.epub》作为测试文件，验证：
1. 能够正确提取所有章节
2. 章节标题与目录一致
3. 章节内容不为空
