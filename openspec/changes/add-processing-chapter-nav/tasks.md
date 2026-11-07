## 1. 目录章节来源

- [x] 1.1 `ReaderWorkspace` 接收 `extractedChapters`（书目录），处理中按 id 合并结果里的 `processed`
- [x] 1.2 处理结束后回到 `bookSummary.chapters`（最终标题权威）
- [x] 1.3 `App.tsx` 把 `extractedChapters` 传进 `ReaderWorkspace`

## 2. 处理中章节视觉

- [x] 2.1 处理中标题 `text-muted-foreground/25`（比未处理 `/35` 更淡）
- [x] 2.2 保留旋转节点，增加行内扫动处理条（`index.css` keyframes）
- [x] 2.3 `prefers-reduced-motion: reduce` 时停止扫动，只留静态条

## 3. 收起态进度条

- [x] 3.1 `NavRail` 接收 `processing` / `processedCount` / `processingChapterId`
- [x] 3.2 处理中：已完成段主色 + 处理段 info 色呼吸，高度按 `1 / total`
- [x] 3.3 处理结束恢复阅读进度与主色；`aria-valuenow` 与无障碍名称随阶段切换

## 4. 测试

- [x] 4.1 单元测试：处理中目录含全部章节、未处理禁用、处理中标题更淡
- [x] 4.2 单元测试：`NavRail` 处理段存在且用 info 色，处理结束回主色
- [x] 4.3 `pnpm test` 全量 + `pnpm build`
- [x] 4.4 真实浏览器 390 / 1280 验收（处理中目录、处理条、折叠进度条；768 由同一套容器查询覆盖，窄屏布局已在 390 与 1280 两端实测）

## 5. 收尾

- [x] 5.1 删除 `ReaderWorkspace` 里重复的 `{commandLayer.overlay}`
- [x] 5.2 回填本文件、提交（pre-commit bump BUILD_VERSION）并推送
