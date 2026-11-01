## ADDED Requirements

### Requirement: v3 提示词与向后兼容
系统 SHALL 提供 v3 提示词集（`services/prompts/config/v3-prompts.yaml`），新处理默认使用 v3；缓存键 SHALL 含提示词版本，v2 已有缓存继续可读且不被 v3 覆盖。用户自定义覆盖项 SHALL 记录其基于的版本；基于 v2 的覆盖在 v3 下 SHALL 提示「基于旧版本，可选择迁移或保留」，不得静默失效或静默套用。CLI `render_prompt` 与前端 `renderPrompt` SHALL 对 v3 保持同语义。

#### Scenario: 旧缓存
- **WHEN** 用户打开用 v2 处理过的书
- **THEN** 原总结照常显示，不触发重新处理；「用 v3 重新生成」为显式操作

#### Scenario: 旧自定义覆盖
- **WHEN** 用户有基于 v2 的自定义章节提示词
- **THEN** 设置页提示其基于 v2，并提供「查看差异 / 迁移 / 保持 v2」三个选项

### Requirement: 命令行与网页处理镜像等效
网页处理与 CLI 批量处理 SHALL 由同一份提示词与后处理契约驱动：提示词文案、输出语言指令、质量闸判定与定向重写、富内容块剔除与坏块修复、格式化请求的结构化输出声明与降级顺序，两端 SHALL 同语义。提示词与 schema SHALL 只存一份于 `services/prompts/config/`，任一端 SHALL NOT 再内联一份同类文案；共享文件的唯一性 SHALL 由两端的守卫测试锁定。

#### Scenario: 提示词只存一份
- **WHEN** 修改速读包 / 自测 / 问书 / 关键图表 / 坏块修复的提示词文案
- **THEN** 只改 `services/prompts/config/` 下的共享文件，网页与 CLI 同时生效，无需改两处代码

#### Scenario: 质量闸与定向重写
- **WHEN** 一章按 v3 给了旁路但正文过短
- **THEN** 网页与 CLI 都追加同一句「上一次输出存在的问题」并只重写一次，采用条件相同（阻塞问题不增多且长度不低于首轮的 80%），且两次调用都计入费用

#### Scenario: 结构化输出降级
- **WHEN** 上游网关不认 `json_schema`
- **THEN** 两端都按 schema → json → 不带 逐档降级，且只把降级后成功的档位写入共享档案，CLI 与浏览器互认

#### Scenario: 坏块修复
- **WHEN** 章节输出里的 mermaid / genui / html 块无法通过校验
- **THEN** 两端都只把坏块（含 80 字上下文）发给模型修复；疑似修好的块复检通过才写回，仍坏则删除，正文逐字不变

### Requirement: 章节调用一次产出「正文 + 结构化旁路」
v3 章节提示词 SHALL 要求模型先输出章节总结 Markdown，再输出一个以固定分隔符（如 `<!--juhua:meta-->`）开头的 JSON 旁路，至少包含：`oneLine`（≤40 字）、`takeaways`（3 条）、`entities`（规范名、类型、别名、本章角色）、`terms`（关键术语）、`skip`（是否无实质内容）。解析失败 SHALL 退化为仅正文，不得使该章失败。

#### Scenario: 旁路解析
- **WHEN** 模型返回正文 + 旁路 JSON
- **THEN** 章节 `summary` 只含正文，旁路存入章节的 `meta` 字段并随缓存保存

#### Scenario: 旁路损坏
- **WHEN** 旁路 JSON 无法解析
- **THEN** 章节仍标为已处理，`meta` 为空，并记录一次可诊断的 warning

### Requirement: 规范实体名贯穿全流程
书级步骤（关联分析、全书总结、关键图表、速读包）SHALL 以各章旁路的 `entities` 合并成的「实体表」为输入（规范名 + 别名），并要求模型沿用规范名；正文实体标注 SHALL 同时匹配规范名与别名。

#### Scenario: 缩写与全称
- **WHEN** 第 3 章写「KKR」，第 9 章写「Kohlberg Kravis Roberts」
- **THEN** 二者归并为同一实体，图谱只有一个节点，正文两种写法均被标注

### Requirement: 去掉无效与有风险的提示词成分
v3 提示词 SHALL 删除：「内心工作/不输出的推理」类要求（无法被验证且浪费输出 token）、「请方向处理/不涉及敏感信息」类安抚话术、与输出格式无关的角色吹捧；规则 SHALL 改为可被程序校验的约束（字数范围、禁用标题、加粗上限），并由后处理做轻量校验与自动修复。

#### Scenario: 违规输出
- **WHEN** 输出包含 Markdown 一级标题或问候语
- **THEN** 后处理剥离之，且不触发整章重试

### Requirement: 强调系统收敛
章节正文 SHALL 只保留一种「主旨句」强调（加粗），每个逻辑区块至多 1 处、全章至多 6 处；斜体用于数字/案例/原文短语；「加粗斜体」与「专有名词反引号」SHALL 取消（实体由实体标注系统负责）。后处理 SHALL 对超限的加粗降级为普通文本。

#### Scenario: 加粗超限
- **WHEN** 一章输出 11 处加粗
- **THEN** 后处理保留前 6 处最短的主旨句，其余去掉加粗

### Requirement: 虚构类提示词达到非虚构同等质量
fiction 提示词 SHALL 补齐：人物与关系更新、情节推进与伏笔、叙事视角与时间线、可剧透等级标记（`spoiler: low|high` 旁路字段，供「截至本章」渐进模式使用），并保持与 nonFiction 相同的旁路结构。

#### Scenario: 小说章节
- **WHEN** 处理小说章节
- **THEN** 旁路含 `entities`（角色）与 `events`（本章关键事件，含 spoiler 等级）
