# book-upload Specification

## Purpose
TBD - created by archiving change fix-settings-overflow-and-extract-action. Update Purpose after archive.

## Requirements

### Requirement: 「获取章节」以已选文件作为输入

「获取章节」SHALL 以当前已选文件作为提取输入；DOM 点击事件对象 SHALL NOT 被当作文件参数。

#### Scenario: 选择文件后点击获取章节

- **WHEN** 用户选择一个 EPUB 文件并点击「获取章节」
- **THEN** 提取过程以 hook 中当前文件作为输入
- **AND** 处理函数不收到任何实参（第一个实参不是 SyntheticEvent）
- **AND** 不出现「不支持的文件格式，请选择 EPUB、PDF、TXT 或 MD」
- **AND** 章节列表按该文件解析出来

#### Scenario: 无文件或提取中

- **WHEN** 还没有选择文件，或正在提取章节 / 正在处理
- **THEN** 「获取章节」按钮为禁用状态，点击不触发提取

#### Scenario: 调用方接线错误可被测试捕获

- **WHEN** 组件测试渲染 `FileUploadCard` 并点击「获取章节」
- **THEN** 断言传入的 `onExtractChapters` spy 收到的实参个数为 0
- **AND** 若把处理函数直接挂在 `onClick` 上，该断言失败（回归守卫）
