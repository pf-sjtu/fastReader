# Spec: WebDAV 文件加载状态清理修复

## 概述

修复从 WebDAV 加载新文件时，章节选择界面显示旧书籍数据的问题。

## 变更内容

### 1. 修改 `src/App.tsx` - `handleWebDAVFileSelect` 函数

**位置**: 第 332-344 行

**当前代码**:
```typescript
const handleWebDAVFileSelect = useCallback(async (file: File) => {
  // 直接使用已经下载的File对象
  setFile(file)
  setExtractedChapters(null)
  setBookData(null)
  setSelectedChapters(new Set())
  setBookSummary(null)
  setBookMindMap(null)
  setCurrentStepIndex(1)
  setRightPanelContent(null)

  toast.success(`已选择文件: ${file.name}`)
}, [])
```

**修改为**:
```typescript
const handleWebDAVFileSelect = useCallback(async (file: File) => {
  // 直接使用已经下载的File对象
  setFile(file)
  setExtractedChapters(null)
  setBookData(null)
  setSelectedChapters(new Set())
  setBookSummary(null)
  setBookMindMap(null)
  setCurrentStepIndex(1)
  setRightPanelContent(null)

  // 清理完整书籍数据和相关状态
  setFullBookData(null)
  setCurrentReadingChapter(null)
  setCurrentProcessingChapter('')
  setCurrentViewingChapter('')
  setCurrentViewingChapterSummary('')
  setExpandedChapters(new Set())
  setCloudCacheMetadata(null)
  setCloudCacheContent(null)
  setCustomPrompt('')

  toast.success(`已选择文件: ${file.name}`)
}, [])
```

### 2. 修改 `src/App.tsx` - `handleFileChange` 函数

**位置**: 第 317-329 行

**当前代码**:
```typescript
const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
  const uploadedFile = event.target.files?.[0]
  if (!uploadedFile) return

  setFile(uploadedFile)
  setExtractedChapters(null)
  setBookData(null)
  setSelectedChapters(new Set())
  setBookSummary(null)
  setBookMindMap(null)
  setCurrentStepIndex(1)
  setRightPanelContent(null)
}, [])
```

**修改为**:
```typescript
const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
  const uploadedFile = event.target.files?.[0]
  if (!uploadedFile) return

  setFile(uploadedFile)
  setExtractedChapters(null)
  setBookData(null)
  setSelectedChapters(new Set())
  setBookSummary(null)
  setBookMindMap(null)
  setCurrentStepIndex(1)
  setRightPanelContent(null)

  // 清理完整书籍数据和相关状态
  setFullBookData(null)
  setCurrentReadingChapter(null)
  setCurrentProcessingChapter('')
  setCurrentViewingChapter('')
  setCurrentViewingChapterSummary('')
  setExpandedChapters(new Set())
  setCloudCacheMetadata(null)
  setCloudCacheContent(null)
  setCustomPrompt('')
}, [])
```

## 验证步骤

1. 启动开发服务器: `npm run dev`
2. 打开 WebDAV 文件浏览器
3. 选择第一本书，等待章节提取完成
4. 关闭文件或刷新页面
5. 再次打开 WebDAV 文件浏览器
6. 选择第二本不同的书
7. **验证**: 章节选择界面应显示第二本书的正确标题和章节列表，而不是第一本书的信息

## 测试

- 运行现有测试: `npm test`
- 所有测试应通过

## 风险

- 低风险：仅添加状态清理，不影响现有功能
- 可能影响：用户切换文件后需要重新提取章节（这是预期行为）
