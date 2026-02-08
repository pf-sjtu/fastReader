# Tasks: 代码库架构重构与优化

## Change ID
`refactor-codebase-architecture`

## 阶段1: 内存安全与BUG修复 (可立即开始)

### 1.1 修复PDF重复读取问题 [P0]
- [ ] 分析 `pdfProcessor.ts` 中的重复读取
- [ ] 重构 `parsePdf` 和 `extractChapters` 方法
- [ ] 复用 ArrayBuffer 避免重复读取
- [ ] 编写单元测试验证修复
- **依赖**: 无
- **并行**: 可与1.2、1.3并行

### 1.2 修复AI Service非空断言问题 [P0]
- [ ] 检查 `batchProcessingEngine.ts` 中的 `aiService!` 使用
- [ ] 添加 null 检查和安全处理
- [ ] 编写防御性代码
- **依赖**: 无
- **并行**: 可与1.1、1.3并行

### 1.3 修复EPUB null引用风险 [P0]
- [ ] 检查 `epubProcessor.ts:35-36` 的 null 引用
- [ ] 使用可选链和空值合并运算符
- [ ] 添加边界测试
- **依赖**: 无
- **并行**: 可与1.1、1.2并行

### 1.4 添加PDF资源释放 [P0]
- [ ] 在 `pdfProcessor.ts` 中添加 `pdf?.destroy()` 调用
- [ ] 使用 try-finally 确保资源释放
- [ ] 测试内存使用情况
- **依赖**: 1.1完成
- **并行**: 否

### 1.5 优化localStorage写入性能 [P1]
- [ ] 分析 `cacheService.ts` 同步写入问题
- [ ] 实现防抖延迟写入
- [ ] 添加 requestIdleCallback 支持
- **依赖**: 无
- **并行**: 是

---

## 阶段2: 架构重构 (需阶段1完成)

### 2.1 拆分App.tsx [P0] - **已完成**
**团队**: Team A (组件重构团队)
- [x] 创建组件拆分结构
- [x] 提取 `useBookProcessing` Hook (800+行)
- [x] 创建 `FileUploadCard` 组件
- [x] 创建 `ChapterSelectionSection` 组件
- [x] 创建 `PreviewPanel` 组件
- [x] 创建 `ResultsSection` 组件
- [x] App.tsx 从 1669行 缩减至 453行
- **完成日期**: 2026-02-08
- [ ] 提取 `useFileProcessing` Hook
- [ ] 创建 `FileUploadContainer` 组件
- [ ] 创建 `ProcessingContainer` 组件
- [ ] 创建 `ResultsContainer` 组件
- [ ] 迁移状态管理
- [ ] 编写组件测试
- **依赖**: 阶段1完成
- **并行**: 可与2.2、2.3并行

### 2.2 重构AI Service为策略模式 [P0]
**团队**: Team B (服务层重构团队)
- [ ] 创建 `services/ai/` 目录结构
- [ ] 定义 `AIProvider` 接口
- [ ] 实现 `GeminiProvider`
- [ ] 实现 `OpenAIProvider`
- [ ] 实现 `OllamaProvider`
- [ ] 实现 `Provider302`
- [ ] 创建 `AIProviderFactory`
- [ ] 合并重复的 `generateContent` 方法
- [ ] 编写服务测试
- **依赖**: 阶段1完成
- **并行**: 可与2.1、2.3并行

### 2.3 拆分configStore [P0] - **已完成**
**团队**: Team C (状态管理重构团队)
- [x] 创建 `stores/ai-config/` 目录
- [x] 创建 `useAIConfigStore`
- [x] 创建 `useProcessingStore`
- [x] 创建 `useWebDAVStore`
- [x] 创建 `usePromptStore`
- [x] 创建 `useCoreStore`
- [x] 更新 configStore.ts 为兼容壳
- [x] 所有引用点保持兼容
- [x] 新增 Store 测试
- **完成日期**: 2026-02-08
- [ ] 创建 `useAIConfigStore`
- [ ] 创建 `useProcessingOptionsStore`
- [ ] 创建 `useWebDAVConfigStore`
- [ ] 创建 `usePromptConfigStore`
- [ ] 更新所有引用点
- [ ] 编写Store测试
- **依赖**: 阶段1完成
- **并行**: 可与2.1、2.2并行

### 2.4 提取公共工具函数 [P1]
**团队**: Team D (工具函数团队)
- [ ] 创建 `utils/async.ts` (sleep, retry)
- [ ] 创建 `utils/file.ts` (getMimeType, convertToArrayBuffer)
- [ ] 创建 `utils/url.ts` (buildProxyUrl)
- [ ] 替换所有重复定义
- [ ] 编写工具函数测试
- **依赖**: 无
- **并行**: 可与2.1、2.2、2.3并行

### 2.5 统一类型定义 [P1]
- [ ] 创建 `types/chapter.ts`
- [ ] 创建 `types/metadata.ts`
- [ ] 创建 `types/ai.ts`
- [ ] 更新所有文件中的类型引用
- **依赖**: 2.1、2.2、2.3开始后可并行
- **并行**: 是

---

## 阶段3: 性能优化 (可部分与阶段2并行)

### 3.1 PDF章节并行提取 [P1]
- [ ] 实现 `ConcurrencyLimiter` 类
- [ ] 修改 `pdfProcessor.ts` 使用并行提取
- [ ] 控制并发数为3
- [ ] 性能基准测试
- **依赖**: 1.1完成
- **并行**: 可与2.x部分并行

### 3.2 EPUB章节并行提取 [P1]
- [ ] 修改 `epubProcessor.ts` 使用并行提取
- [ ] 确保 Section 正确卸载
- [ ] 内存使用测试
- **依赖**: 1.3完成
- **并行**: 可与3.1并行

### 3.3 批量处理并发控制 [P1]
- [ ] 修改 `batchProcessingEngine.ts`
- [ ] 实现文件级并发控制
- [ ] 添加自适应限流
- [ ] 性能测试
- **依赖**: 2.2完成
- **并行**: 否

### 3.4 实现请求去重机制 [P2]
- [ ] 在 `aiService.ts` 中添加飞行中请求缓存
- [ ] 使用 Map 存储进行中的请求
- [ ] 测试并发请求场景
- **依赖**: 2.2完成
- **并行**: 可与3.3并行

### 3.5 缓存策略优化 [P2]
- [ ] 实现 LRU 缓存策略
- [ ] 添加章节内容指纹缓存
- [ ] 考虑缓存压缩 (lz-string)
- **依赖**: 1.5完成
- **并行**: 可与3.3、3.4并行

---

## 阶段4: 测试补充 (需阶段2、3完成)

### 4.1 EPUB处理器测试 [P0]
- [ ] 编写 `epubProcessor.test.ts`
- [ ] 正常EPUB解析测试
- [ ] 损坏文件处理测试
- [ ] 章节提取边界测试
- **依赖**: 阶段2完成
- **并行**: 可与4.2、4.3并行

### 4.2 PDF处理器测试 [P0]
- [ ] 编写 `pdfProcessor.test.ts`
- [ ] PDF解析测试
- [ ] 页面文本提取测试
- [ ] 目录识别测试
- **依赖**: 阶段2完成
- **并行**: 可与4.1、4.3并行

### 4.3 批量处理引擎测试 [P0]
- [ ] 编写集成测试
- [ ] 模拟 WebDAV 服务
- [ ] 模拟 AI 服务
- [ ] 测试暂停/继续功能
- [ ] 测试错误恢复
- **依赖**: 阶段2、3完成
- **并行**: 可与4.1、4.2并行

### 4.4 React组件测试 [P1]
- [ ] 配置组件测试环境
- [ ] 编写 `FileUploadContainer` 测试
- [ ] 编写 `ProcessingContainer` 测试
- [ ] 编写 `ResultsContainer` 测试
- **依赖**: 2.1完成
- **并行**: 可与4.1、4.2、4.3并行

### 4.5 覆盖率提升 [P1]
- [ ] 运行覆盖率报告
- [ ] 识别未覆盖代码
- [ ] 补充缺失测试
- [ ] 确保覆盖率 >80%
- **依赖**: 4.1、4.2、4.3、4.4完成
- **并行**: 否

---

## 依赖关系图

```
阶段1: 内存安全与BUG修复
├── 1.1 修复PDF重复读取 ──┬── 1.4 添加PDF资源释放
├── 1.2 修复AI非空断言   │
├── 1.3 修复EPUB null    ├── 阶段2.2 AI Service重构
└── 1.5 优化localStorage ─── 阶段3.5 缓存优化

阶段2: 架构重构
├── 2.1 拆分App.tsx ─── 阶段4.4 组件测试
├── 2.2 AI Service重构 ─┬── 阶段3.3 批量处理优化
│                     └── 阶段3.4 请求去重
├── 2.3 拆分configStore
├── 2.4 提取工具函数
└── 2.5 统一类型定义

阶段3: 性能优化
├── 3.1 PDF并行提取
├── 3.2 EPUB并行提取
├── 3.3 批量处理并发
├── 3.4 请求去重
└── 3.5 缓存优化

阶段4: 测试补充
├── 4.1 EPUB测试
├── 4.2 PDF测试
├── 4.3 批量处理测试
├── 4.4 组件测试
└── 4.5 覆盖率提升
```

---

## 团队分配

| 团队 | 职责 | 任务 |
|-----|------|------|
| Team A | 组件重构 | 2.1, 4.4 |
| Team B | 服务层重构 | 2.2, 2.4, 3.4 |
| Team C | 状态管理 | 2.3, 2.5 |
| Team D | 性能优化 | 3.1, 3.2, 3.3, 3.5 |
| Team E | 测试 | 4.1, 4.2, 4.3, 4.5 |

---

*Created: 2026-02-08*
*Last Updated: 2026-02-08*
