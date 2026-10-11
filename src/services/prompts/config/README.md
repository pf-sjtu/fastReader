# Prompt配置说明

本目录包含了从代码中分离出来的系统默认prompt配置，使用YAML格式存储，方便修改和维护。

## 文件结构

- `v1-prompts.yaml` - V1版本的prompt配置
- `v2-prompts.yaml` - V2版本的prompt配置（优化版）
- `promptLoader.ts` - Prompt配置加载器
- `README.md` - 本说明文件

## 配置格式

每个YAML文件包含以下类型的prompt：

### 章节总结提示词 (chapterSummary)
- `fiction` - 小说类章节总结
- `nonFiction` - 社科类章节总结

### 思维导图提示词 (mindmap)
- `chapter` - 章节思维导图
- `arrow` - 思维导图箭头连接
- `combined` - 整书思维导图

### 其他提示词
- `connectionAnalysis` - 章节关联分析
- `overallSummary` - 全书总结
- `system.testConnection` - 系统测试连接

## 使用方法

### 1. 修改Prompt配置

直接编辑对应的YAML文件即可修改prompt内容。修改后需要重新构建应用：

```bash
npm run build
```

### 2. 添加新版本

要添加新的prompt版本：

1. 复制现有的YAML文件（如`v2-prompts.yaml`）
2. 重命名为新版本（如`v3-prompts.yaml`）
3. 修改内容
4. 更新`promptLoader.ts`中的导入语句
5. 更新类型定义和加载逻辑

### 3. 在代码中使用

```typescript
import { 
  getChapterSummaryPrompt,
  getMindmapPrompt,
  getConnectionAnalysisPrompt,
  getOverallSummaryPrompt,
  getSystemPrompt
} from '../config/promptLoader'

// 获取V1版本的小说类章节总结prompt
const fictionPrompt = getChapterSummaryPrompt('v1', 'fiction')

// 获取V2版本的思维导图prompt
const mindmapPrompt = getMindmapPrompt('v2', 'chapter')

// 获取系统测试连接prompt
const testPrompt = getSystemPrompt('testConnection')
```

## 注意事项

1. **YAML语法**：确保YAML文件语法正确，注意缩进和特殊字符的转义
2. **变量占位符**：保持现有的变量占位符格式，如`{{title}}`、`{{content}}`等
3. **版本兼容**：修改prompt时注意保持向后兼容性
4. **测试验证**：修改后建议运行测试确保功能正常

## 模板渲染语义（唯一规范）

前端 `src/services/prompts/render.ts` 的 `renderPrompt(template, vars)` 与 CLI `src/cli/prompts.py` 的 `render_prompt(template, variables)` 实现同一语义，跨端用例见 `tests/fixtures/prompts/render-cases.json`（两端测试读取同一份输入/期望）。

1. **占位符语法**：`{{name}}`，花括号内允许两侧空白；`name` 以字母或下划线开头。单花括号（如 `{nodeData:null}`）不是占位符。
2. **已知占位符全部替换**：一次性替换，变量值里出现的 `{{…}}` 不会被二次替换。
3. **未知占位符保留原样**，并 `logger.warn` / `logging.warning` 一次（列出名字）。
4. **回退追加**：模板未引用的变量，按变量顺序以 `标签: 值`（inline 变量同行，否则换行）追加到模板末尾，段间空一行。由此保证：
   - 每个变量**恰好发送一次**——不会既留字面占位符又追加正文，也不会重复发送正文；
   - 模板完全不含占位符（思维导图、关键图表、多数用户自定义 prompt）时，行为与旧版「模板 + 追加内容」逐字一致。
5. 后处理的章节列表统一为紧凑 JSON（等价 `JSON.stringify`，CLI 用 `separators=(",", ":")`、`ensure_ascii=False`）。

## 各类型变量表

| prompt 类型 | 变量名（顺序即回退追加顺序） | 回退标签 | v1/v2 YAML 实际引用 |
|---|---|---|---|
| chapterSummary.fiction / nonFiction | `title`（inline）、`content` | 章节标题 / 章节内容 | `title`、`content` |
| connectionAnalysis | `chapterSummaries` | 已处理的章节列表 | `chapterSummaries` |
| overallSummary | `bookTitle`（inline）、`chapterInfo`、`connections` | 书名 / 已处理的章节列表 / 章节关联分析 | 三者全部 |
| mindmap.chapter（仅前端） | `title`（inline）、`content` | 章节标题 / 章节内容 | 无（回退追加） |
| mindmap.arrow（仅前端） | `chapterSummaries` | 章节列表 | 无 |
| mindmap.combined（仅前端） | `bookTitle`（inline）、`chapterSummaries` | 书名 / 章节列表 | 无 |
| keyCharts（TS 内置，仅前端） | `bookTitle`（inline）、`chapterSummaries`、`connections`、`overallSummary` | 书名 / 章节摘要 / 章节关联分析 / 全书总结 | 无 |

`overallSummary` 的章节列表沿用既有名 `chapterInfo`（不改名，避免已持久化的用户自定义 prompt 失效）。测试 `tests/w2prompt.yamlPrompts.test.ts`、`tests/python/test_cli_render_prompt.py` 会校验 YAML 实际引用的占位符集合与上表一致。
