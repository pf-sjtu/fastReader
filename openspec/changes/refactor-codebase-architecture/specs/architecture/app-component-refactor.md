# Spec: App组件拆分重构

## 状态
ADDED

## 背景
App.tsx 当前 1669 行，承担过多职责：文件上传、章节提取、AI处理、状态管理、UI渲染等。需要拆分为多个专注的组件和自定义Hooks。

## 变更内容

### ADDED: features/ 目录结构
```
src/features/
├── file-upload/
│   ├── FileUploadContainer.tsx
│   ├── FileUploadSection.tsx
│   ├── hooks/
│   │   └── useFileProcessing.ts
│   └── types.ts
├── chapter-processing/
│   ├── ChapterSelection.tsx
│   ├── ChapterList.tsx
│   └── hooks/
│       └── useChapterExtraction.ts
├── ai-processing/
│   ├── ProcessingContainer.tsx
│   ├── ProcessingProgress.tsx
│   └── hooks/
│       └── useAIProcessing.ts
├── results/
│   ├── SummaryResults.tsx
│   └── MindMapResults.tsx
└── preview/
    └── PreviewPanel.tsx
```

### ADDED: useFileProcessing Hook
```typescript
// hooks/useFileProcessing.ts
export function useFileProcessing() {
  const [file, setFile] = useState<File | null>(null);
  const [chapters, setChapters] = useState<ChapterData[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);

  const extractChapters = useCallback(async () => {
    // 实现
  }, [file]);

  return { file, setFile, chapters, extractChapters, isExtracting };
}
```

### ADDED: useAIProcessing Hook
```typescript
// hooks/useAIProcessing.ts
export function useAIProcessing() {
  const [processingState, setProcessingState] = useState({
    isProcessing: false,
    progress: 0,
    currentStep: ''
  });

  const processBook = useCallback(async (chapters: ChapterData[]) => {
    // 实现
  }, []);

  return { processingState, processBook };
}
```

### MODIFIED: App.tsx
- 从 1669 行缩减到 <100 行
- 仅作为容器组件，组合各功能模块

## 验收标准
- [ ] App.tsx 行数 < 100 行
- [ ] 所有功能正常工作
- [ ] 新组件有单元测试
- [ ] 无功能回归

## 影响范围
- src/App.tsx (大幅修改)
- 新增 src/features/ 目录

## 依赖
- 无前置依赖
