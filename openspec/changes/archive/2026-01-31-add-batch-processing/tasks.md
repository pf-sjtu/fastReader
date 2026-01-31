# Tasks: 批量处理与缓存读取功能

## 测试规范
- 在 `tests/tour/` 文件夹内编写可持久化存在的测试文件
- 对项目的功能覆盖度达到 80%+
- 包含生产环境单独环节的非 mock 测试
- 在 git 提交后必须运行一次测试
- 测试运行过程中需要设置 timeout，防止程序假死
- 测试结果中如果出错必须解决
- 如果覆盖率低必须解决
- 对于警告除非给出修改困难性和安全性解释否则也必须解决

## 1. 基础设施准备

### 1.1 创建项目结构
- [x] 1.1.1 创建 `src/services/cloudCacheService.ts`
- [x] 1.1.2 创建 `src/services/metadataFormatter.ts`
- [x] 1.1.3 创建 `src/stores/batchQueueStore.ts`
- [x] 1.1.4 创建 `src/cli/` 目录及初始化文件
- [ ] 1.1.5 创建示例配置文件 `config.example.yaml`

### 1.2 定义类型定义
- [x] 1.2.1 定义 `CloudCacheFile` 接口 (cloudCacheService.ts)
- [x] 1.2.2 定义 `ProcessingMetadata` 接口 (cloudCacheService.ts)
- [x] 1.2.3 定义 `BatchQueueItem` 接口 (batchQueueStore.ts)
- [x] 1.2.4 定义 `BatchProgress` 接口 (batchQueueStore.ts)
- [x] 1.2.5 定义 CLI 配置的 Python 数据模型 (models.py)

## 2. 缓存读取功能 (Cloud Cache Reading)

### 2.1 云端缓存服务实现
- [x] 2.1.1 实现 `checkCacheExists(fileName)` 方法
- [x] 2.1.2 实现 `readCache(fileName)` 方法
- [x] 2.1.3 实现 `downloadCache(fileName)` 方法 (复用 webdavService)
- [x] 2.1.4 实现 `sanitizeFileName(fileName)` 工具方法

### 2.2 集成到主应用
- [x] 2.2.1 在 `App.tsx` 的文件选择流程中添加缓存检查
- [x] 2.2.2 添加"从云端加载"按钮组件 (集成在UI中)
- [ ] 2.2.3 实现缓存加载到结果页面的渲染逻辑 (简化版)

## 3. 处理信息备注功能 (Processing Metadata)

### 3.1 元信息格式化器
- [x] 3.1.1 实现 `generateMetadata(processResult)` 方法
- [x] 3.1.2 实现 `parseMetadata(fileContent)` 方法
- [x] 3.1.3 实现 `formatAsHTMLComment(metadata)` 方法
- [x] 3.1.4 实现费用计算逻辑（各模型定价）
- [x] 3.1.5 实现汇率配置读取

### 3.2 集成到文件保存
- [x] 3.2.1 修改 `UploadToWebDAVButton.tsx` 添加处理备注
- [x] 3.2.2 修改 `autoSyncService.ts` 添加处理备注
- [ ] 3.2.3 确保 AI API 返回的 token 使用情况被捕获 (待完善)

## 4. WebDAV 批量处理 UI

### 4.1 批量队列状态管理
- [x] 4.1.1 创建 `batchQueueStore.ts` Zustand store
- [x] 4.1.2 实现队列添加/删除/跳过方法
- [x] 4.1.3 实现进度跟踪方法
- [x] 4.1.4 实现本地持久化（断点续传）

### 4.2 批量处理对话框
- [ ] 4.2.1 创建 `BatchProcessingDialog.tsx` 组件
- [ ] 4.2.2 实现文件夹选择器
- [ ] 4.2.3 实现处理参数配置表单
- [ ] 4.2.4 实现文件列表预览

### 4.3 批量队列面板
- [ ] 4.3.1 创建 `BatchQueuePanel.tsx` 组件
- [ ] 4.3.2 实现可展开/收起 UI
- [ ] 4.3.3 实现队列列表渲染
- [ ] 4.3.4 实现跳过/删除操作按钮
- [ ] 4.3.5 实现进度条显示

### 4.4 批量处理引擎
- [ ] 4.4.1 实现顺序处理逻辑
- [ ] 4.4.2 实现暂停/继续功能
- [ ] 4.4.3 实现错误处理和跳过
- [ ] 4.4.4 实现与现有处理流程的集成

## 5. CLI 批量处理工具

### 5.1 CLI 入口和配置
- [x] 5.1.1 创建 `main.py` CLI 入口
- [x] 5.1.2 实现 `--config/-c` 参数解析
- [x] 5.1.3 实现 YAML 配置文件加载器
- [x] 5.1.4 实现环境变量替换

### 5.2 WebDAV 客户端
- [x] 5.2.1 创建 `webdav_client.py`
- [x] 5.2.2 实现连接和文件操作
- [x] 5.2.3 实现文件夹扫描

### 5.3 AI 客户端
- [x] 5.3.1 创建 `ai_client.py`
- [x] 5.3.2 实现 Gemini API 调用
- [x] 5.3.3 实现 token 使用情况捕获

### 5.4 批量处理核心
- [x] 5.4.1 创建 `batch_processor.py`
- [x] 5.4.2 实现文件发现和过滤
- [x] 5.4.3 实现顺序处理循环
- [x] 5.4.4 实现指数退避重试

### 5.5 结果输出
- [x] 5.5.1 创建 `formatter.py`
- [x] 5.5.2 实现 Markdown 文件生成
- [x] 5.5.3 实现处理备注添加
- [x] 5.5.4 创建 `logger.py` 实现日志功能

### 5.6 测试 CLI 工具
- [ ] 5.6.1 编写配置加载测试
- [ ] 5.6.2 编写批量处理测试
- [ ] 5.6.3 编写错误处理测试

## 6. 集成测试

### 6.1 功能测试
- [ ] 6.1.1 测试缓存读取功能
- [ ] 6.1.2 测试处理备注生成和解析
- [ ] 6.1.3 测试批量处理 UI
- [ ] 6.1.4 测试 CLI 批量处理

### 6.2 端到端测试
- [ ] 6.2.1 测试完整批量处理流程
- [ ] 6.2.2 测试断点续传功能
- [ ] 6.2.3 测试错误恢复

## 7. 文档更新

### 7.1 用户文档
- [ ] 7.1.1 更新 README.md（添加 CLI 使用说明）
- [ ] 7.1.2 创建批量处理功能使用文档
- [ ] 7.1.3 创建 CLI 配置示例文档

### 7.2 开发文档
- [x] 7.2.1 更新 CLAUDE.md（添加 CLI 架构说明）
- [ ] 7.2.2 注释关键代码逻辑

## 8. 测试编写 (tests/tour/)

### 8.1 前端测试
- [ ] 8.1.1 创建 `tests/tour/cloud-cache.test.ts` - 缓存读取测试
- [ ] 8.1.2 创建 `tests/tour/metadata-formatter.test.ts` - 元数据格式化测试
- [ ] 8.1.3 创建 `tests/tour/batch-queue-store.test.ts` - 队列状态管理测试
- [ ] 8.1.4 创建 `tests/tour/batch-ui.test.ts` - 批量处理 UI 测试

### 8.2 CLI 测试
- [ ] 8.2.1 创建 `tests/tour/cli-config.test.py` - CLI 配置加载测试
- [ ] 8.2.2 创建 `tests/tour/cli-batch.test.py` - CLI 批量处理测试
- [ ] 8.2.3 创建 `tests/tour/cli-webdav.test.py` - CLI WebDAV 测试
- [ ] 8.2.4 创建 `tests/tour/cli-ai.test.py` - CLI AI 客户端测试

### 8.3 集成测试
- [ ] 8.3.1 创建 `tests/tour/e2e-cache-read.test.ts` - 端到端缓存读取测试
- [ ] 8.3.2 创建 `tests/tour/e2e-metadata.test.ts` - 端到端元数据测试
- [ ] 8.3.3 创建 `tests/tour/e2e-cli-full.test.py` - CLI 完整流程测试

### 8.4 测试运行配置
- [ ] 8.4.1 配置 Jest/Vitest timeout (30000ms)
- [ ] 8.4.2 配置 Pytest timeout
- [ ] 8.4.3 设置 CI/CD 测试钩子
- [ ] 8.4.4 生成覆盖率报告
