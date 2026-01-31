# EPUB 封面-内容分离结构检测

## 问题描述

《金融的本质：伯南克四讲美联储.epub》等部分 EPUB 图书采用**封面-内容分离**的特殊结构：

- TOC 目录指向 `chapter01.xhtml` → 只有章节封面图（~573 字节，无实际文本）
- 实际章节内容在 `chapter01_0001.xhtml` → 18,701 字节，15,885 字符

这导致以目录模式读取章节时，所有章节内容为空。

## 根因分析

通过调试发现该 EPUB 的 spine 结构如下：

| Spine 索引 | 文件 | 大小 | 内容 |
|-----------|------|------|------|
| 4 | chapter01.xhtml | 573 字节 | ❌ 只有封面图 |
| 5 | chapter01_0001.xhtml | 18,701 字节 | ✅ 实际内容 |
| 6 | chapter02.xhtml | 573 字节 | ❌ 只有封面图 |
| 7 | chapter02_0001.xhtml | 21,697 字节 | ✅ 实际内容 |

**模式特征**：`_0001.xhtml` 文件紧跟在封面文件后，包含实际内容。

## 解决方案

在 `getSingleChapterContent` 方法中添加**智能内容检测**：

1. 提取章节内容后，如果文本长度 < 100 字符
2. 检查 spine 中下一项的文件名是否匹配 `*_\d+.xhtml` 模式
3. 如果是，自动渲染该文件并提取内容
4. 返回内容更丰富的那个

### 代码修改

```typescript
// 在 getSingleChapterContent 中添加
if (textContent.length < 100 && spineIndex >= 0 && spineIndex < spineItems.length - 1) {
  const nextSpineItem = spineItems[spineIndex + 1]
  const nextHref = nextSpineItem.href
  
  if (nextHref.match(/_\d+\.xhtml$/)) {
    const nextSection = book.spine.get(spineIndex + 1)
    if (nextSection) {
      const nextHTML = await nextSection.render(book.load.bind(book))
      const nextText = this.extractTextFromXHTML(nextHTML, anchor)
      if (nextText.length > textContent.length) {
        textContent = nextText
      }
      nextSection.unload()
    }
  }
}
```

## 验证计划

1. 重新构建项目
2. 在浏览器中测试《金融的本质》EPUB
3. 检查所有 11 个章节都能正确提取内容
4. 确保其他 EPUB 不受影响

## 影响范围

- **修复文件**: `src/services/epubProcessor.ts`
- **修复位置**: `getSingleChapterContent` 方法
- **向后兼容**: ✅ 不影响正常结构的 EPUB
