# batch-ui Specification

## Purpose
TBD - created by archiving change add-batch-processing. Update Purpose after archive.
## Requirements
### Requirement: Batch Processing UI

系统 SHALL 在 WebDAV 按钮右侧添加"批量处理"按钮。

#### Scenario: 显示批量处理按钮
- **GIVEN** WebDAV 功能已启用
- **WHEN** 渲染文件上传与配置区域
- **THEN** 在 WebDAV 按钮右侧显示"批量处理"按钮
- **AND** 按钮图标为 ⚡（闪电）或批量处理相关图标

### Requirement: Batch Processing Dialog

系统 SHALL 提供批量处理配置对话框。

#### Scenario: 打开批量处理对话框
- **WHEN** 用户点击"批量处理"按钮
- **THEN** 显示批量处理配置对话框

#### Scenario: 选择文件夹
- **GIVEN** 批量处理对话框已打开
- **WHEN** 用户输入或浏览选择文件夹路径
- **THEN** 系统显示该路径下的 EPUB/PDF 文件数量

#### Scenario: 配置处理参数
- **GIVEN** 批量处理对话框已打开
- **WHEN** 用户配置以下参数：
  | 参数 | 选项 |
  |------|------|
  | 处理文件数量 | 全部 / 前 N 个 |
  | 处理范围 | 全部范围 / 仅未处理部分 |
  | 处理顺序 | 顺序处理 / 随机顺序
- **THEN** 系统验证参数有效性
- **AND** 系统显示待处理文件列表预览

#### Scenario: 确认开始处理
- **GIVEN** 用户已配置所有参数
- **WHEN** 点击"确认开始处理"按钮
- **THEN** 系统将选定文件加入处理队列
- **AND** 对话框关闭，显示批量队列面板

### Requirement: Batch Queue Panel

系统 SHALL 提供可展开的批量队列面板。

#### Scenario: 显示队列面板
- **GIVEN** 批量处理已开始
- **WHEN** 渲染主界面
- **THEN** 显示批量队列面板（可展开/收起）

#### Scenario: 折叠状态
- **GIVEN** 队列面板处于折叠状态
- **WHEN** 渲染面板
- **THEN** 显示：处理进度统计和当前处理状态
- **AND** 提供展开按钮

#### Scenario: 展开状态
- **GIVEN** 用户点击展开队列面板
- **WHEN** 渲染面板
- **THEN** 显示完整的队列列表
- **AND** 每项显示：文件名、处理状态（完成/进行中/待处理/跳过）
- **AND** 当前处理项高亮显示

#### Scenario: 跳过当前项
- **GIVEN** 队列正在处理某本书籍
- **WHEN** 用户点击"跳过当前"按钮
- **THEN** 系统停止处理当前书籍
- **AND** 系统标记当前书籍为"跳过"
- **AND** 系统继续处理队列中的下一本书籍

#### Scenario: 删除队列项
- **GIVEN** 队列面板处于展开状态
- **WHEN** 用户删除某个待处理的队列项
- **THEN** 系统从队列中移除该项
- **AND** 系统不处理被删除的书籍

### Requirement: Batch Progress Tracking

系统 SHALL 实时跟踪和显示批量处理进度。

#### Scenario: 显示处理进度
- **GIVEN** 批量处理进行中
- **WHEN** 更新进度显示
- **THEN** 显示：已处理数量/总数量、完成百分比

#### Scenario: 当前处理状态
- **GIVEN** 批量处理进行中
- **WHEN** 显示当前处理状态
- **THEN** 显示当前处理的书籍名称
- **AND** 显示当前书籍的处理进度（如章节 5/12）

#### Scenario: 处理完成
- **GIVEN** 所有队列项处理完成
- **WHEN** 渲染面板
- **THEN** 显示"批量处理完成"状态
- **AND** 显示成功/失败统计

### Requirement: Local Progress Storage

系统 SHALL 本地存储批量处理进度以支持断点续传。

#### Scenario: 记录处理进度
- **GIVEN** 批量处理进行中
- **WHEN** 一本书籍处理完成
- **THEN** 系统更新本地存储的进度记录
- **AND** 进度记录包含：batchId、已完成文件列表、失败文件列表

#### Scenario: 恢复未完成的批次
- **GIVEN** 用户之前启动了批量处理但未完成
- **WHEN** 用户重新打开批量处理对话框
- **THEN** 系统提示存在未完成的批次
- **AND** 用户可选择继续上次批次或开始新批次

