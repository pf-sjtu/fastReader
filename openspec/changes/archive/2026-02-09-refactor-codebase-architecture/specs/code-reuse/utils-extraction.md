# Spec: 公共工具函数提取

## 状态
ADDED

## 背景
代码中存在多处重复的工具函数定义：sleep、retry、getMimeType、convertToArrayBuffer 等。

## 变更内容

### ADDED: async.ts
```typescript
// src/utils/async.ts

/**
 * 延迟指定毫秒
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * 带重试的异步操作
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delay: number,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxRetries) break;

      onRetry?.(attempt, lastError);
      await sleep(delay * attempt); // 指数退避
    }
  }

  throw lastError!;
}

/**
 * 带超时的Promise
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = '操作超时'
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms)
  );
  return Promise.race([promise, timeout]);
}
```

### ADDED: file.ts
```typescript
// src/utils/file.ts

/**
 * 根据文件名获取MIME类型
 */
export function getMimeType(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop();
  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'epub':
      return 'application/epub+zip';
    case 'txt':
      return 'text/plain';
    case 'md':
      return 'text/markdown';
    default:
      return 'application/octet-stream';
  }
}

/**
 * 转换数据为 ArrayBuffer
 */
export function convertToArrayBuffer(data: ArrayBuffer | Uint8Array | string): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  // 字符串转 ArrayBuffer
  const encoder = new TextEncoder();
  return encoder.encode(data).buffer;
}

/**
 * Base64 转 ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
```

### ADDED: url.ts
```typescript
// src/utils/url.ts

/**
 * 构建代理URL
 */
export function buildProxyUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const normalizedPath = path.replace(/^\//, '');
  return `${normalizedBase}/${normalizedPath}`;
}

/**
 * 安全地拼接URL
 */
export function joinUrl(...parts: string[]): string {
  return parts
    .map(part => part.replace(/^\/|\/$/g, ''))
    .filter(Boolean)
    .join('/');
}
```

### MODIFIED: 替换重复定义
- `aiService.ts:320` 移除 `sleep` 方法
- `batchProcessingEngine.ts:690` 移除 `sleep` 方法
- `webdavService.ts:767` 移除 `getMimeType` 方法
- `App.tsx:362` 移除 `getMimeType` 方法

## 验收标准
- [ ] 创建 utils/async.ts
- [ ] 创建 utils/file.ts
- [ ] 创建 utils/url.ts
- [ ] 替换所有重复定义
- [ ] 所有测试通过
- [ ] 新工具函数有单元测试

## 影响范围
- src/utils/ 新增文件
- src/services/aiService.ts (移除 sleep)
- src/services/batchProcessingEngine.ts (移除 sleep)
- src/services/webdavService.ts (移除 getMimeType)
- src/App.tsx (移除 getMimeType)

## 依赖
- 无前置依赖
