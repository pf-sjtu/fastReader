## Why

处理进行中时，左侧目录是「结果」的镜像而不是「书本」的目录：`useProcessingRun` 一开始把 `bookSummary.chapters` 置空，之后每完成一章才追加一条，于是

- 第一章还没跑完时 `ChapterSummaryNavigation` 因为 `chapters.length === 0` 直接返回 `null`，左边整块目录消失；
- 之后只显示已完成的章节，未开始的章节不在名单里，用户看不到「还有多少章」；
- 目录收起成竖向细条（`NavRail`）时只认阅读进度，处理中仍按「当前阅读章」画填充，看不出生成进度。

## What Changes

- 处理进行中时，目录用**提取出的完整章节清单**（`extractedChapters`）渲染，`processed` 由当前结果映射得到，不再等结果逐章追加。
- 正在处理的章节标题用比未处理章节更淡的中性灰（低调、不抢眼），节点保留旋转图标，并加一条呼吸式的处理条作为「正在生成」的视觉表现。
- 目录收起时，竖向进度条在处理中显示**处理进度**：已完成部分用主色填充，正在处理的那一章高度用独立的 info 色并带脉冲，处理结束后恢复阅读进度与主色。
- 顺手删除 `ReaderWorkspace` 里重复渲染的 `{commandLayer.overlay}`（同一节点画了两次）。

## Impact

- Affected specs: `chapter-navigation`（新增）
- Affected code:
  - `src/App.tsx`（把 `extractedChapters` 传给工作台）
  - `src/components/workspace/ReaderWorkspace.tsx`（目录章节合并、NavRail 传参）
  - `src/components/ChapterSummaryNavigation.tsx`（处理中章节视觉）
  - `src/components/workspace/NavRail.tsx`（处理进度段与配色）
  - `src/index.css`（处理条动画 keyframes）
  - `tests/`（新增目录与收起进度条的处理中守卫）
