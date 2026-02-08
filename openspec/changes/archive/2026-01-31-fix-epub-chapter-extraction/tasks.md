# 修复 EPUB 章节提取问题 - 任务清单

## 分析阶段

- [x] 复现问题：分析《金融的本质》EPUB 的目录结构
- [x] 诊断根本原因：确定 TOC 与 Spine 的匹配正常，问题在锚点内容提取
- [x] 识别边界情况：锚点元素只提取标题文本，未包含后续内容

## 修复阶段

- [x] 修复策略2：修改 `extractContentByAnchorImproved` 方法
  - 原逻辑：只提取锚点元素内部的文本
  - 新逻辑：提取锚点元素及其后续内容直到下一个同级/更高级标题
- [x] 重构代码结构：将大文件拆分为模块
  - `src/services/epub/types.ts` - 类型定义
  - `src/services/epub/utils.ts` - 工具函数
  - `src/services/epub/anchorExtractor.ts` - 锚点提取逻辑
  - `src/services/epub/textExtractor.ts` - 文本提取逻辑
  - `src/services/epub/index.ts` - 模块导出
  - `src/services/epubProcessor.ts` - 重构后的主文件（从899行简化为约350行）

## 验证阶段

- [x] TypeScript 编译通过
- [ ] 实际 EPUB 文件测试（需浏览器环境）

## 文档阶段

- [x] 更新代码注释：解释修复逻辑
- [x] 创建 Spec 文档

## 提交记录

```
fix(epub): 修复章节提取时锚点内容不完整的问题

问题：
- extractContentByAnchorImproved 的策略2只提取锚点元素内部的文本
- 对于 preface.xhtml#sigil_toc_id_1 这样的锚点，只返回标题文本
- 忽略了锚点之后的段落内容

修复：
- 提取锚点元素本身（如 <h2 id="...">标题</h2>）
- 继续提取锚点之后的所有内容，直到遇到同级或更高级的标题
- 确保章节内容包含标题和后续段落

重构：
- 将 899 行的 epubProcessor.ts 拆分为 6 个文件
- 提高代码可维护性和可测试性
```
