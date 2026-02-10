# Spec: 并发处理优化

## 状态
ADDED

## 背景
当前PDF/EPUB章节提取、批量处理都是串行执行，无法利用并发，处理大文件时效率低下。

## 变更内容

### ADDED: ConcurrencyLimiter 类
```typescript
// src/utils/concurrency.ts
export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
```

### ADDED: AdaptiveRateLimiter 类
```typescript
// src/utils/rateLimit.ts
export class AdaptiveRateLimiter {
  private minDelay = 100;
  private maxDelay = 5000;
  private currentDelay = 500;
  private consecutiveErrors = 0;

  async acquire(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.currentDelay));
  }

  recordSuccess(): void {
    this.consecutiveErrors = 0;
    this.currentDelay = Math.max(this.minDelay, this.currentDelay * 0.9);
  }

  recordError(retryAfter?: number): void {
    this.consecutiveErrors++;
    if (retryAfter) {
      this.currentDelay = retryAfter * 1000;
    } else {
      this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 2);
    }
  }
}
```

### MODIFIED: PDF章节并行提取
```typescript
// src/services/pdfProcessor.ts
async extractChaptersParallel(
  pdf: PDFDocumentProxy,
  chapterInfos: ChapterInfo[],
  concurrencyLimit = 3
): Promise<ChapterData[]> {
  const limiter = new ConcurrencyLimiter(concurrencyLimit);

  const extractChapter = async (info: ChapterInfo, index: number): Promise<ChapterData> => {
    return limiter.run(async () => {
      const content = await this.extractTextFromPages(pdf, info.startPage, info.endPage);
      return {
        id: `chapter-${index}`,
        title: info.title,
        content,
      };
    });
  };

  // 分批并行处理
  const chapters: ChapterData[] = [];
  for (let i = 0; i < chapterInfos.length; i += concurrencyLimit) {
    const batch = chapterInfos.slice(i, i + concurrencyLimit);
    const batchResults = await Promise.all(
      batch.map((info, idx) => extractChapter(info, i + idx))
    );
    chapters.push(...batchResults);
  }

  return chapters;
}
```

### MODIFIED: 批量处理引擎并发控制
```typescript
// src/services/batchProcessingEngine.ts
async startProcessing(
  queueItems: BatchQueueItem[],
  config: BatchProcessingConfig
): Promise<BatchProcessingSummary> {
  const CONCURRENT_FILES = config.maxConcurrentFiles || 2;
  const limiter = new ConcurrencyLimiter(CONCURRENT_FILES);
  const rateLimiter = new AdaptiveRateLimiter();

  const promises = queueItems.map(item =>
    limiter.run(() => this.processItemWithRateLimit(item, config, rateLimiter))
  );

  const results = await Promise.allSettled(promises);
  // 处理结果...
}
```

### ADDED: 请求去重机制
```typescript
// src/services/ai/aiService.ts
private inFlightRequests = new Map<string, Promise<any>>();

async summarizeChapter(
  title: string,
  content: string,
  bookType: string
): Promise<string> {
  const cacheKey = this.generateChapterCacheKey(title, content, bookType);

  // 检查是否有正在进行的相同请求
  if (this.inFlightRequests.has(cacheKey)) {
    return this.inFlightRequests.get(cacheKey)!;
  }

  const promise = this.doSummarizeChapter(title, content, bookType);
  this.inFlightRequests.set(cacheKey, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    this.inFlightRequests.delete(cacheKey);
  }
}
```

## 验收标准
- [ ] ConcurrencyLimiter 类实现
- [ ] AdaptiveRateLimiter 类实现
- [ ] PDF章节并行提取
- [ ] EPUB章节并行提取
- [ ] 批量处理并发控制
- [ ] 请求去重机制
- [ ] 大文件处理时间减少30%+
- [ ] 无API限流问题

## 性能指标
- 多章节处理加速: 30%+
- 批量处理加速: 50%+

## 影响范围
- src/utils/concurrency.ts (新增)
- src/services/pdfProcessor.ts
- src/services/epubProcessor.ts
- src/services/batchProcessingEngine.ts
- src/services/ai/aiService.ts

## 依赖
- AI Service重构完成 (请求去重)
