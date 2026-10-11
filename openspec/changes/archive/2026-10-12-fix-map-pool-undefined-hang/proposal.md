# Change: 修复 mapPoolOrdered 对 undefined 结果的有序提交停滞

## Why

`mapPoolOrdered` 用 `slots[i] !== undefined` 判断某索引是否已完成。未完成的槽与 mapper 返回的 `undefined` 无法区分，导致 `commitReady` / `onOrderedResult` 在首个 `undefined` 结果处永久停滞。主 Promise 虽能 resolve，但依赖有序回调的进度与 UI 更新会卡住。

## What Changes

- 用独立的完成标记数组区分「未完成」与「结果为 undefined」
- 允许 mapper 返回 `undefined` / `null` 作为合法结果
- 补充回归测试：mapper 返回 `undefined` 时函数能结束且 `onOrderedResult` 按序触发

无 **BREAKING** 变更。

## Impact

- Affected specs: `async-utils`（新增）
- Affected code: `src/utils/async.ts`、`tests/mapPoolOrdered.test.ts`
