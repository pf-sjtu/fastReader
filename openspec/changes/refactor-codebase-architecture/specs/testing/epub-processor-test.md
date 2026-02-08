# Spec: EPUB处理器测试补充

## 状态
ADDED

## 背景
epubProcessor.ts 核心处理逻辑缺乏自动化测试，只有类型测试。

## 变更内容

### ADDED: epubProcessor.test.ts
```typescript
// tests/services/epubProcessor.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EPUBProcessor } from '@/services/epubProcessor';

describe('EPUBProcessor', () => {
  let processor: EPUBProcessor;

  beforeEach(() => {
    processor = new EPUBProcessor();
  });

  describe('parseEpub', () => {
    it('应该正确解析有效的EPUB文件', async () => {
      // 使用 mock EPUB 文件
      const mockFile = createMockEpubFile('test.epub');
      const result = await processor.parseEpub(mockFile);

      expect(result.title).toBeDefined();
      expect(result.author).toBeDefined();
      expect(result.chapters).toBeInstanceOf(Array);
    });

    it('应该处理损坏的EPUB文件', async () => {
      const corruptFile = createMockCorruptEpubFile('corrupt.epub');

      await expect(processor.parseEpub(corruptFile))
        .rejects.toThrow('EPUB解析失败');
    });

    it('应该处理空EPUB文件', async () => {
      const emptyFile = createMockEmptyEpubFile('empty.epub');

      await expect(processor.parseEpub(emptyFile))
        .rejects.toThrow('EPUB文件为空');
    });
  });

  describe('extractChapters', () => {
    it('应该提取所有章节', async () => {
      const mockFile = createMockEpubFile('test.epub', {
        chapters: [
          { title: 'Chapter 1', content: 'Content 1' },
          { title: 'Chapter 2', content: 'Content 2' },
        ]
      });

      const book = await processor.parseEpub(mockFile);
      const chapters = await processor.extractChapters(book);

      expect(chapters).toHaveLength(2);
      expect(chapters[0].title).toBe('Chapter 1');
      expect(chapters[1].title).toBe('Chapter 2');
    });

    it('应该处理嵌套章节结构', async () => {
      const mockFile = createMockEpubFile('nested.epub', {
        chapters: [
          {
            title: 'Part 1',
            subitems: [
              { title: 'Chapter 1.1', content: 'Content 1.1' },
              { title: 'Chapter 1.2', content: 'Content 1.2' },
            ]
          }
        ]
      });

      const book = await processor.parseEpub(mockFile);
      const chapters = await processor.extractChapters(book);

      expect(chapters.length).toBeGreaterThan(0);
    });

    it('应该处理特殊字符', async () => {
      const mockFile = createMockEpubFile('special.epub', {
        chapters: [
          { title: 'Chapter «特殊»', content: 'Content with émojis 🎉' }
        ]
      });

      const book = await processor.parseEpub(mockFile);
      const chapters = await processor.extractChapters(book);

      expect(chapters[0].title).toBe('Chapter «特殊»');
    });
  });

  describe('错误处理', () => {
    it('应该处理网络错误', async () => {
      // 模拟网络错误
    });

    it('应该处理内存不足', async () => {
      // 模拟大文件处理
    });
  });
});
```

### ADDED: Mock 工具
```typescript
// tests/__mocks__/epubFileMock.ts
export function createMockEpubFile(
  name: string,
  options: MockEpubOptions = {}
): File {
  // 创建模拟EPUB文件
}

export function createMockCorruptEpubFile(name: string): File {
  // 创建损坏的EPUB文件
}

export function createMockEmptyEpubFile(name: string): File {
  // 创建空EPUB文件
}
```

## 验收标准
- [ ] 正常EPUB解析测试
- [ ] 损坏文件处理测试
- [ ] 章节提取测试
- [ ] 嵌套章节测试
- [ ] 特殊字符处理测试
- [ ] 错误处理测试
- [ ] 覆盖率 >80%

## 影响范围
- tests/services/epubProcessor.test.ts (新增)
- tests/__mocks__/epubFileMock.ts (新增)

## 依赖
- 无前置依赖
