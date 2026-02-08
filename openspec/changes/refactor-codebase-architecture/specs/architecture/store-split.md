# Spec: Store 拆分重构

## 状态
MODIFIED

## 背景
configStore.ts 912 行，管理 AI 配置、处理选项、WebDAV、提示词等多种状态，职责不单一。

## 变更内容

### ADDED: AI Config Store
```typescript
// stores/ai-config/aiConfigStore.ts
interface AIConfigState {
  providers: AIProviderConfig[];
  currentProviderId: string;
  setCurrentProvider: (id: string) => void;
  updateProvider: (id: string, config: Partial<AIProviderConfig>) => void;
}

export const useAIConfigStore = create<AIConfigState>()(
  persist(...)
);
```

### ADDED: Processing Options Store
```typescript
// stores/processing/processingOptionsStore.ts
interface ProcessingOptionsState {
  mode: 'summary' | 'mindmap' | 'combined-mindmap';
  outputLanguage: SupportedLanguage;
  useCache: boolean;
  setMode: (mode: ProcessingMode) => void;
  // ...
}

export const useProcessingOptionsStore = create<ProcessingOptionsState>()(
  persist(...)
);
```

### ADDED: WebDAV Config Store
```typescript
// stores/webdav/webdavConfigStore.ts
interface WebDAVConfigState {
  config: WebDAVConfig | null;
  isConnected: boolean;
  setConfig: (config: WebDAVConfig) => void;
  testConnection: () => Promise<boolean>;
}

export const useWebDAVConfigStore = create<WebDAVConfigState>()(
  persist(...)
);
```

### ADDED: Prompt Config Store
```typescript
// stores/prompts/promptConfigStore.ts
interface PromptConfigState {
  version: 'v1' | 'v2';
  customPrompts: Record<string, string>;
  setVersion: (version: PromptVersion) => void;
  updateCustomPrompt: (key: string, prompt: string) => void;
}

export const usePromptConfigStore = create<PromptConfigState>()(
  persist(...)
);
```

### MODIFIED: 统一导出
```typescript
// stores/index.ts
export { useAIConfigStore } from './ai-config/aiConfigStore';
export { useProcessingOptionsStore } from './processing/processingOptionsStore';
export { useWebDAVConfigStore } from './webdav/webdavConfigStore';
export { usePromptConfigStore } from './prompts/promptConfigStore';
```

## 目录结构
```
src/stores/
├── index.ts                    # 统一导出
├── ai-config/
│   ├── aiConfigStore.ts
│   └── aiConfigSelectors.ts
├── processing/
│   └── processingOptionsStore.ts
├── webdav/
│   └── webdavConfigStore.ts
├── prompts/
│   └── promptConfigStore.ts
└── batch/
    └── batchQueueStore.ts
```

## 数据迁移
- 保持 localStorage key 不变
- 自动迁移旧配置到新结构

## 验收标准
- [ ] configStore.ts 拆分完成
- [ ] 每个 store 职责单一
- [ ] 数据持久化正常工作
- [ ] 自动迁移旧配置
- [ ] 有完整的单元测试

## 影响范围
- src/stores/configStore.ts (删除)
- 新增 src/stores/*/ 目录
- 更新所有使用 configStore 的组件

## 依赖
- 无前置依赖
