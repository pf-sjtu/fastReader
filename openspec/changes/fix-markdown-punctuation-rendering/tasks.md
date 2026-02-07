## Implementation Tasks

### 1. 修改主应用 markdown.ts
- [ ] 1.1 修改 `normalizeMarkdownTypography` 函数，将 `ZERO_WIDTH_SPACE` 替换为普通空格 `' '`
- [ ] 1.2 更新函数注释，说明使用普通空格解决渲染问题
- [ ] 1.3 验证正则表达式逻辑保持正确

### 2. 修改 md_reader 子程序的 markdown.ts
- [ ] 2.1 同步修改 `md_reader/src/lib/markdown.ts` 中的相同实现
- [ ] 2.2 确保两处实现保持一致

### 3. 测试验证
- [ ] 3.1 编写测试用例验证中文标点附近 Markdown 渲染正确
- [ ] 3.2 验证测试用例：`"**测试文本。**"` 正确渲染为加粗
- [ ] 3.3 验证测试用例：`"**"引用"文本**"` 正确渲染

### 4. Git 提交
- [ ] 4.1 提交修改：`git add .` 和 `git commit`
- [ ] 4.2 添加 git notes 说明改动详情

### 5. OpenSpec 归档
- [ ] 5.1 验证 proposal：`openspec validate fix-markdown-punctuation-rendering --strict`
- [ ] 5.2 归档 change：`openspec archive fix-markdown-punctuation-rendering --yes`
