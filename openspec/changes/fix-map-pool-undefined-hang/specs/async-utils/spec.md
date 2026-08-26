## ADDED Requirements

### Requirement: mapPoolOrdered treats undefined as a valid result
系统 SHALL 在 `mapPoolOrdered` 中允许 mapper 返回 `undefined` 或 `null`，且 MUST 正常 resolve 并继续按输入索引顺序触发 `onOrderedResult`。

#### Scenario: Mapper returns undefined
- **WHEN** 某索引的 mapper 解析为 `undefined`
- **THEN** `mapPoolOrdered` 在全部任务 settle 后 resolve
- **AND** 返回数组在该索引位置为 `undefined`
- **AND** `onOrderedResult` 仍按 0..n-1 顺序触发，不在该索引处停滞

#### Scenario: Mapper returns null
- **WHEN** 某索引的 mapper 解析为 `null`
- **THEN** `mapPoolOrdered` 正常 resolve
- **AND** 返回数组在该索引位置为 `null`
- **AND** `onOrderedResult` 按序触发
