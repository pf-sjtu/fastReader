## ADDED Requirements

### Requirement: Uncaught UI errors surface a readable message
系统 SHALL 在 React 错误边界捕获未处理渲染错误时，向用户展示错误消息文本，并在控制台记录完整错误对象。

#### Scenario: 渲染抛错时可见 message
- **WHEN** 子组件在渲染期间抛出 `Error`
- **THEN** 错误边界页面包含该 Error 的 `message`
- **AND** 页面仍提供刷新入口

#### Scenario: 控制台保留诊断信息
- **WHEN** 错误边界捕获到未处理错误
- **THEN** 系统在控制台输出错误对象与组件栈

### Requirement: Failed mindmap chapters are not marked processed
系统 SHALL 在章节思维导图生成失败时，不将该章节标记为已成功处理。

#### Scenario: 单章导图生成失败
- **WHEN** 某章节 `generateChapterMindMap` 抛错且当前处理未被中止
- **THEN** 该章节 `processed` 为 `false`
- **AND** 该章节不带可用 `mindMap`
- **AND** 系统记录错误日志

### Requirement: Gemini Node proxy fallback must not recurse
系统 SHALL 在 Node 环境启用 HTTP 代理但代理模块不可用时，回退到 Gemini SDK 直连，且 MUST NOT 再次进入代理生成路径。

#### Scenario: 代理模块缺失时直连
- **GIVEN** `proxyEnabled` 为 true 且配置了 `proxyUrl`，运行环境为 Node
- **WHEN** `https-proxy-agent` 无法加载
- **THEN** 系统使用 SDK 直连生成内容
- **AND** 系统不递归调用带代理的生成入口

#### Scenario: 代理响应无法解析
- **WHEN** Gemini 代理 HTTP 200 但响应体不是合法 JSON
- **THEN** 失败错误信息包含解析原因
- **AND** 失败错误信息包含响应体摘要

### Requirement: Service-layer unexpected failures are logged
系统 SHALL 在批处理下载、批处理条目未预期失败、以及配置导入抛错时记录错误日志（含异常对象），不得只返回字符串而不留痕。

#### Scenario: 批处理下载抛错
- **WHEN** 从 WebDAV 下载待处理文件时抛出异常
- **THEN** 系统记录 error 级日志
- **AND** 向调用方返回失败结果（含错误消息）

#### Scenario: 配置导入抛错
- **WHEN** 解析或应用导入配置时抛出异常
- **THEN** 系统记录 error 级日志
- **AND** 向调用方返回 `success: false` 与错误消息
