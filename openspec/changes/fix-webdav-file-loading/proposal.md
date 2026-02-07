# 修复 WebDAV 文件加载时章节选择显示旧数据的问题

## 问题描述

从 WebDAV 读取不同的书目时，日志显示读取了正确的文件，但**章节选择界面总是显示之前打开的书的信息**。

例如：
- 日志显示读取了 "美国优先和美国梦：1900-2017.epub" 和 "货币幻觉.epub"
- 但章节选择界面显示的是 "可能性的艺术：比较政治学30讲"

## 问题根因

在 `handleWebDAVFileSelect` 和 `handleFileChange` 函数中，**没有完整清理所有相关状态**，特别是 `fullBookData` 状态未被清理。

`fullBookData` 存储完整的书籍数据（EpubBookData/PdfBookData），如果未清理，阅读器组件和内部逻辑会继续使用旧的书籍数据。

## 影响范围

- 用户无法正确查看新加载书籍的章节列表
- 用户体验严重受损
- 可能导致数据处理错误（基于错误的章节信息）

## 解决方案

在 `handleWebDAVFileSelect` 和 `handleFileChange` 函数中添加缺失的状态清理：

### 需要清理的状态

| 状态变量 | 用途 |
|---------|------|
| `fullBookData` | 完整书籍数据（EpubBookData/PdfBookData） |
| `currentReadingChapter` | 当前阅读的章节 |
| `currentProcessingChapter` | 当前处理的章节 |
| `currentViewingChapter` | 当前查看的章节 |
| `currentViewingChapterSummary` | 当前查看的章节总结 |
| `expandedChapters` | 展开的章节集合 |
| `cloudCacheMetadata` | 云端缓存元数据 |
| `cloudCacheContent` | 云端缓存内容 |
| `customPrompt` | 自定义提示词 |

## 验收标准

- [ ] 从 WebDAV 选择新文件后，章节选择界面显示正确的书籍标题和章节列表
- [ ] 本地文件上传后，章节选择界面显示正确的书籍信息
- [ ] 快速切换文件时不会出现旧数据闪烁
- [ ] 所有现有测试通过

## 相关文件

- `src/App.tsx` - 主组件，包含状态管理和文件处理逻辑
