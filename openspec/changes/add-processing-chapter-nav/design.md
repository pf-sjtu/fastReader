## Context

工作台左侧目录由 `ChapterSummaryNavigation` 渲染，它的输入 `chapters` 来自 `bookSummary.chapters`。处理流程（`useProcessingRun`）为了让正文逐章出现，先 `setBookSummary({ …, chapters: [] })`，之后每 `onChapter` 才追加一条。目录因此是「结果列表」而非「书目录」，处理中会缺失未完成章节，甚至在首章完成前整体不渲染。

折叠态由 `NavRail` 承担，它只接收「当前阅读章序号」，处理中仍是阅读语义。

## Goals / Non-Goals

**Goals**

- 处理中目录始终可见且是完整章节清单（含未开始、处理中、已完成三种状态）。
- 处理中章节有明确的「正在生成」视觉：更淡的文字 + 旋转节点 + 呼吸条。
- 收起态能看出处理进度，处理部分与已完成部分颜色不同。

**Non-Goals**

- 不改处理管线的并发、顺序或状态存储。
- 不改正文区的处理进度条（`UnifiedStatusBar`）。
- 不引入新的动画库或依赖。

## Decisions

1. **目录的数据源按阶段切换**：处理中优先用 `extractedChapters`（书目录）并按 id 合并结果里的 `processed`；处理结束后回到 `bookSummary.chapters`（章节命名模式可能重排/重命名标题，最终结果才是权威）。
   - 备选：让 `useProcessingRun` 一开始就写入完整章节骨架。否决——`processed` 语义属于结果，骨架写进结果会让「处理失败/跳过」和「还没跑」混淆，缓存与导出也会看到假章节。
   - 备选：在 App 层拼一份 nav 章节传入。否决——目录列宽/折叠逻辑都在 `ReaderWorkspace` 内，拼接放在同一处更容易保持 id 一致。

2. **语义配色**：阅读/已完成用主色（`bg-primary`），处理中用 `bg-info`。两者在浅色深色主题下都有对应 token（`--info` / `--info-muted` / `--info-border`），不写死色值。

3. **处理中的章节文字比未处理更淡**：未处理 `text-muted-foreground/35` → 处理中 `text-muted-foreground/25`，保持中性而不是主色，避免被误读成「当前阅读」；活动感交给节点动画与呼吸条。

4. **动画纯 CSS**：在 `index.css` 加 `@keyframes chapter-processing-sweep`（细条在行内左右扫过），并遵守 `prefers-reduced-motion`（系统要求减少动效时只保留静态淡色条）。不加依赖，也不用 JS 计时器（处理中每秒重渲染会浪费）。

5. **收起态的填充分两段**：已完成段高度 = `processedCount / total`，处理段高度 = `1 / total`，起始位置接在已完成段之后；处理段用 `bg-info` 并带脉冲，完成后整条恢复阅读进度与主色。`MAX_RAIL_DOTS` 的点状模式保留，处理中的点用 info 色 + 脉冲。

## Risks / Trade-offs

- 目录在首章完成前就要出现，意味着「未处理章节点不可点」会被更早看到：现有实现已经禁用未处理项，只是此前看不到而已。
- 处理中章节标题过淡可能难辨认：用呼吸条与旋转节点补足位置感；真机验收会看 390 / 1280 两档。
- `extractedChapters` 与结果 id 理论上一致（同一批对象经管线），若未来改名策略改变 id，合并会退化为「未处理」——用 id 合并失败时回退到结果列表。
