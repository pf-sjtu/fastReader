## ADDED Requirements
### Requirement: 真实类型检查与 CI 门禁
`pnpm build` 与 `pnpm typecheck` MUST 使用 `tsc -b` 实际检查 `src/` 全部文件；CI MUST 在每次推送执行 typecheck、lint、test、build。

#### Scenario: 引入类型错误
- **WHEN** 提交引入类型错误
- **THEN** `pnpm typecheck` 失败且 CI 标红
