## 1. Implementation

- [x] 1.1 为 `mapPoolOrdered` 增加完成标记，不再用 `!== undefined` 判断槽位是否完成
- [x] 1.2 补充 mapper 返回 `undefined` 的回归测试
- [x] 1.3 运行 `openspec validate fix-map-pool-undefined-hang --strict` 与相关 vitest
