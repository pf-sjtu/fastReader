# Spec: AI Service 策略模式重构

## 状态
MODIFIED

## 背景
当前 aiService.ts 1305 行，混合了 Gemini、OpenAI、Ollama、302.ai 的实现，使用 if/else 判断 provider 类型，违反开闭原则。generateContent 和 generateContentWithStatusCheck 有约 150 行重复代码。

## 变更内容

### ADDED: AI Provider 接口
```typescript
// services/ai/aiProvider.interface.ts
export interface AIProvider {
  readonly name: string;
  generateContent(prompt: string, options?: GenerateOptions): Promise<string>;
  generateStructured<T>(prompt: string, schema: Schema<T>): Promise<T>;
  testConnection(): Promise<boolean>;
}
```

### ADDED: Provider 实现
```typescript
// services/ai/providers/geminiProvider.ts
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  constructor(private config: GeminiConfig) {}
  // 实现接口方法
}

// services/ai/providers/openaiProvider.ts
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  constructor(private config: OpenAIConfig) {}
  // 实现接口方法
}

// services/ai/providers/ollamaProvider.ts
export class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  constructor(private config: OllamaConfig) {}
  // 实现接口方法
}

// services/ai/providers/provider302.ts
export class Provider302 implements AIProvider {
  readonly name = '302.ai';
  constructor(private config: Provider302Config) {}
  // 实现接口方法
}
```

### ADDED: Provider Factory
```typescript
// services/ai/aiProviderFactory.ts
export class AIProviderFactory {
  static create(config: AIProviderConfig): AIProvider {
    switch (config.provider) {
      case 'gemini': return new GeminiProvider(config);
      case 'openai': return new OpenAIProvider(config);
      case 'ollama': return new OllamaProvider(config);
      case '302.ai': return new Provider302(config);
      default: throw new Error(`Unknown provider: ${config.provider}`);
    }
  }
}
```

### MODIFIED: AIService
```typescript
// services/ai/aiService.ts
export class AIService {
  private provider: AIProvider;

  constructor(config: AIProviderConfig) {
    this.provider = AIProviderFactory.create(config);
  }

  // 统一的生成方法，移除重复代码
  async generateContent(prompt: string, options?: GenerateOptions): Promise<string> {
    return this.provider.generateContent(prompt, options);
  }
}
```

## 目录结构
```
src/services/ai/
├── aiProvider.interface.ts
├── aiProviderFactory.ts
├── aiService.ts
└── providers/
    ├── geminiProvider.ts
    ├── openaiProvider.ts
    ├── ollamaProvider.ts
    └── provider302.ts
```

## 验收标准
- [ ] aiService.ts 行数 < 300 行
- [ ] 消除 150 行重复代码
- [ ] 新增 Provider 无需修改现有代码 (开闭原则)
- [ ] 所有 AI 提供商正常工作
- [ ] 有完整的单元测试

## 影响范围
- src/services/aiService.ts (删除，改为入口文件)
- 新增 src/services/ai/ 目录

## 依赖
- 无前置依赖
