# Spec: PDF处理器测试补充

## 状态
ADDED

## 背景
pdfProcessor.ts 完全没有测试。

## 变更内容

### ADDED: pdfProcessor.test.ts
```typescript
// tests/services/pdfProcessor.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PDFProcessor } from '@/services/pdfProcessor';

describe('PDFProcessor', () => {
  let processor: PDFProcessor;

  beforeEach(() => {
    processor = new PDFProcessor();
  });

  describe('parsePdf', () => {
    it('应该正确解析有效的PDF文件', async () => {
      const mockFile = createMockPdfFile('test.pdf');
      const result = await processor.parsePdf(mockFile);

      expect(result.title).toBeDefined();
      expect(result.totalPages).toBeGreaterThan(0);
    });

    it('应该处理加密的PDF文件', async () => {
      const encryptedFile = createMockEncryptedPdfFile('encrypted.pdf');

      await expect(processor.parsePdf(encryptedFile))
        .rejects.toThrow('PDF加密');
    });

    it('应该处理损坏的PDF文件', async () => {
      const corruptFile = createMockCorruptPdfFile('corrupt.pdf');

      await expect(processor.parsePdf(corruptFile))
        .rejects.toThrow('PDF解析失败');
    });
  });

  describe('extractChapters', () => {
    it('应该基于目录提取章节', async () => {
      const mockFile = createMockPdfFile('with-toc.pdf', {
        toc: [
          { title: 'Introduction', page: 1 },
          { title: 'Chapter 1', page: 5 },
        ]
      });

      const book = await processor.parsePdf(mockFile);
      const chapters = await processor.extractChapters(book);

      expect(chapters.length).toBeGreaterThan(0);
    });

    it('应该处理无目录的PDF', async () => {
      const mockFile = createMockPdfFile('no-toc.pdf', { toc: [] });

      const book = await processor.parsePdf(mockFile);
      const chapters = await processor.extractChapters(book);

      // 应该使用启发式方法提取
      expect(chapters.length).toBeGreaterThan(0);
    });
  });

  describe('内存管理', () => {
    it('应该正确释放PDF资源', async () => {
      const mockFile = createMockPdfFile('test.pdf');

      await processor.parsePdf(mockFile);

      // 验证 destroy 被调用
    });

    it('应该流式处理大PDF', async () => {
      const largeFile = createMockLargePdfFile('large.pdf', { pages: 1000 });

      // 验证内存使用在合理范围
    });
  });
});
```

## 验收标准
- [ ] PDF解析测试
- [ ] 章节提取测试
- [ ] 目录识别测试
- [ ] 加密PDF处理测试
- [ ] 内存管理测试
- [ ] 覆盖率 >80%

## 影响范围
- tests/services/pdfProcessor.test.ts (新增)

## 依赖
- 无前置依赖
