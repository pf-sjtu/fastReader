# Tasks

## 1. 管线统一与缓存（w2pipe）
- [x] 1.1 bookPipeline 覆盖 summary / mindmap / combined-mindmap，单书与批量共用
- [x] 1.2 hook 拆分，返回值兼容；合并云端/历史加载重复逻辑
- [x] 1.3 版本化章节缓存（IndexedDB、文件指纹、LRU、命中跳过 AI）
- [x] 1.4 批量 skipProcessed 读元数据；isPartial 统计含失败章节；恢复批量导图模式
- [x] 1.5 跨端契约样例前端测试

## 2. Prompt 与解析（w2prompt）
- [x] 2.1 renderPrompt 统一占位符替换，前端/CLI 共享用例
- [x] 2.2 跳过词前缀 + 整词匹配，前端/CLI 共享用例
- [x] 2.3 CLI batch_processor 拆分至 ≤400 行

## 3. UI（w2ui）
- [x] 3.1 ConfigDialog 拆分
- [x] 3.2 AI 连接测试与 WebDAV 初始化去重
- [x] 3.3 结构化状态替代中文字符串匹配
- [x] 3.4 硬编码文案 i18n 化
- [x] 3.5 清零 exhaustive-deps 警告；拆分后组件覆盖率 ≥80%

## 4. 存储（w2store）
- [x] 4.1 删除 stores 死代码
- [x] 4.2 webdavService 按职责拆分
- [x] 4.3 代理自身错误标识与客户端区分

## 5. 收尾（leader）
- [x] 5.1 补齐 i18n key、全量门禁、README / CLAUDE.md / docs 同步
- [x] 5.2 归档已完成的 openspec 变更
