# Spec: PDF内存优化

## 状态
MODIFIED

## 背景
PDF处理存在以下内存问题：
1. 文件被重复读取两次（parsePdf 和 extractChapters）
2. 所有页面文本同时驻留内存
3. PDF文档未调用 destroy() 释放资源

## 变更内容

### MODIFIED: PDFProcessor.parsePdf
```typescript
async parsePdf(file: File): Promise<BookData & { pdfDocument: PDFDocumentProxy }> {
  let pdf: PDFDocumentProxy | null = null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // 提取元数据...

    return {
      title: /* ... */,
      author: /* ... */,
      totalPages: pdf.numPages,
      pdfDocument: pdf, // 返回 pdf 实例供复用
    };
  } catch (error) {
    pdf?.destroy();
    throw error;
  }
}
```

### MODIFIED: PDFProcessor.extractChapters
```typescript
// 修改为接收已解析的PDF实例
async extractChapters(
  pdf: PDFDocumentProxy,
  chapterInfos: ChapterInfo[]
): Promise<ChapterData[]> {
  const chapters: ChapterData[] = [];

  for (let i = 0; i < chapterInfos.length; i++) {
    const chapterInfo = chapterInfos[i];
    const chapterContent = await this.extractTextFromPages(pdf, startPage, endPage);
    chapters.push({
      id: `chapter-${i}`,
      title: chapterInfo.title,
      content: chapterContent,
    });
  }

  return chapters;
}
```

### MODIFIED: 页面文本流式处理
```typescript
// 使用生成器模式流式处理页面
private async* iteratePageTexts(
  pdf: PDFDocumentProxy
): AsyncGenerator<{ pageNum: number; text: string }> {
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    try {
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item: any) => item?.str ?? '')
        .join(' ');
      yield { pageNum, text };
    } finally {
      page.cleanup?.();
    }
  }
}
```

### ADDED: 资源管理
```typescript
// 确保PDF文档最终被释放
async extractBookData(file: File): Promise<BookData & { chapters: ChapterData[] }> {
  let pdf: PDFDocumentProxy | null = null;

  try {
    const bookData = await this.parsePdf(file);
    pdf = bookData.pdfDocument;

    const chapters = await this.extractChapters(pdf, bookData.chapterInfos);

    return { ...bookData, chapters };
  } finally {
    pdf?.destroy();
  }
}
```

## 验收标准
- [ ] PDF文件只读取一次
- [ ] 页面文本流式处理，不全部驻留内存
- [ ] PDF文档正确释放
- [ ] 大PDF文件处理内存占用降低50%+
- [ ] 功能正常工作，无回归
- [ ] 有性能基准测试

## 性能指标
- 内存峰值降低: 50%+
- 处理时间变化: ±10% 内可接受

## 影响范围
- src/services/pdfProcessor.ts

## 依赖
- 无前置依赖
