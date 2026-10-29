# ai-provider-config Delta

## ADDED Requirements

### Requirement: 服务商维度的模型配置
AI 配置 MUST 以「服务商」为单位组织：一个服务商包含 baseUrl、凭据与多个模型；用户 MUST 能在同一服务商下
启用多个模型并选择当前使用的模型，而不是为每个模型重复填写一遍服务商信息。

#### Scenario: 一个服务商多个模型
- **WHEN** 用户添加一个 OpenAI 兼容服务商并勾选 5 个模型
- **THEN** 配置中只存在 1 个服务商条目与 5 个模型，当前模型指向其中之一

#### Scenario: 切换当前模型
- **WHEN** 用户把当前模型从模型 A 切到同一服务商的模型 B
- **THEN** 后续 AI 调用使用模型 B，无需重新输入 baseUrl 或 Key

### Requirement: 自动获取模型列表
用户 MUST 能通过一个动作从服务商拉取可用模型列表（OpenAI 兼容 `/models`、Gemini `models`、Ollama `/api/tags`），
失败时 MUST 给出可读错误并保留手动添加能力。

#### Scenario: 拉取成功
- **WHEN** 用户填入有效 baseUrl 与 Key 并点击「获取模型」
- **THEN** 返回该服务商的模型 id 列表，用户可勾选启用并保存

#### Scenario: 拉取失败
- **WHEN** Key 无效或服务商不可达
- **THEN** 显示错误原因，且仍可通过「手动添加模型」输入模型 id 完成配置

### Requirement: models.dev 元数据自动补全
系统 MUST 使用 models.dev 目录为模型自动补全上下文长度、输出上限、价格与能力标记（推理、温度支持），
并在补全不到时显示为未知而不是套用其他模型的估价。

#### Scenario: 自动补全价格
- **WHEN** 用户启用的模型在 models.dev 中存在
- **THEN** 配置与元数据展示该模型的输入/输出价格与上下文长度，费用统计使用该价格

#### Scenario: 未知模型不套用他模型价格
- **WHEN** 模型在 models.dev 与内置价格表中都不存在
- **THEN** 费用统计显示「未知/未计价」，不得按其他模型（如 gemini-1.5-pro）的价格估算

### Requirement: 目录数据经服务端缓存下发
models.dev 目录 MUST 由服务端拉取并精简后下发，并缓存以避免每次访问都拉取 5.9MB 原始文件；
上游失败时 MUST 回退到上次成功缓存。

#### Scenario: 目录缓存命中
- **WHEN** 客户端在一次缓存有效期（24h）内再次请求目录
- **THEN** 响应来自缓存，不重新请求上游

#### Scenario: 上游不可用
- **WHEN** models.dev 请求失败且存在上次成功缓存
- **THEN** 返回上次缓存并标记为降级；无缓存时返回错误，前端提示只能手动填写模型

### Requirement: 1.0.0 旧配置折叠
导入 1.0.0 配置时，MUST 按 `(protocol, 规范化 baseUrl, apiKey)` 把同一服务商的多条模型条目折叠为一个服务商，
并保留每个模型的温度等差异，把 `currentModelId` 映射为当前模型。

#### Scenario: 真实用户导出配置
- **WHEN** 导入含 5 条同 baseUrl 同 Key、仅模型不同的 1.0.0 配置
- **THEN** 得到 1 个服务商与 5 个模型，当前模型为原 `currentModelId` 指向的模型
