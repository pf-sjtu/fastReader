# 设计：阅读工作台

## 关键决策

### 1. 分栏自写，不引入 react-resizable-panels
只有一个分隔条，且侧栏要按 px 记忆宽度；该库以百分比建模，窗口缩放时侧栏宽度会漂移。
自写 ≈120 行：`setPointerCapture`、宽度限制 280–760px、`role="separator"` + 方向键/Home/End、localStorage 记忆。

### 2. 当前章只有一个来源
继续以 `currentViewingChapterSummary`（scroll spy）为唯一来源，通过 props 向下传，不进入 `readingFocus` store，避免双写。
store 只存 UI 偏好与聚焦实体：`focusedEntityId / companionTab / companionOpen / companionWidth / annotateEntities / focusMode`。

### 3. 滚动容器 ref 化
结果步根容器改为 `h-dvh flex flex-col overflow-hidden`，目录/正文/对照栏各自滚动。
`useChapterScrollSpy` 增加 `container` 参数（选择器作兜底）；`scrollToChapterSummary` 抽为 `utils/scrollTo.ts(container,id,offset)`。
不新增 `useBookProcessing` 返回键（`w2pipeHook.test.tsx` 断言了精确键集）。

### 4. 实体配色与匹配
- 图谱节点与时间线实体同属一个 id 命名空间，合并后按 importance + 出场章数排序，前 10 个分配独立 `--entity-N`，其余按类型用低饱和中性色；类型用形状区分（人物=圆，组织=圆角方，概念/事件=菱形）。
- 匹配只针对图表里已有的实体；CJK 名至少 2 字；名称变体取括号内名与按 `·`/`/` 拆分；单一正则按长度降序拼接，避免短名吃掉长名。
- `chapterHint` 匹配：全角转半角 → 序号（"第十二章"/"Chapter 3"）→ 包含 → 二元组 Dice ≥ 0.5；失败返回 null（UI 置灰而不是猜）。
- 按「章节 id + 内容」缓存逐章结果；处理中不计算。不新增 AI 调用。

### 5. 正文实体标注
remark 插件（手写递归遍历，不新增 `unist-util-visit` 依赖）把 text 节点按实体名切开，输出 `span.entity-mark[data-entity-id]`，跳过 code/inlineCode/link。
悬停与点击用容器级事件委托，不覆写 `components`；插件数组 `useMemo` 保持稳定。

### 6. 书库索引的生命周期
`{syncPath}/.juhua/library.json`（schemaVersion 1）+ `.juhua/covers/<sha1(path)>.webp`（≈200px，≤30KB）。
- 失效：PROPFIND 的 size/mtime/etag 变化 → 条目标 stale。
- 懒补全：`requestIdleCallback`，同时最多 2 本，只解析元数据与封面。
- 状态同步：处理完成/清缓存/删摘要在同一服务调用里更新 status。
- GC：源文件连续 2 次扫描缺失才删条目与封面；孤儿封面每次全量扫描后清；索引 >2MB 淘汰最久未打开。
- 并发：按条目 `updatedAt` 合并，写前重读（WebDAV 无 CAS，接受偶发覆盖，最多丢一次阅读进度）。
- 版本：schemaVersion 不匹配就地迁移，无法迁移则重建；设置里提供「重建/清空」。
- 本地：IndexedDB 镜像，stale-while-revalidate。

### 7. AI 功能
新 prompt 与 keyCharts 同模式放 `services/prompts/*.ts`；复用 `proxyFetch` 流式、`outputBudget`、quirks 退避；输出 zod 校验；失败可重试；查不到价格不显示费用。
问书上下文 = 全书综述 + 按问题打分检索的相关章节总结（entityIndex + 关键词，不引入向量库）。CLI 不改。

## 风险与缓解
- 实体误报（常见词/同名）：2 字下限、只匹配图表实体、可关闭标注。
- cytoscape 在可拖宽容器：ResizeObserver 用 rAF 节流；从 0 尺寸变有尺寸及 layoutstop 时 fit 一次；用户缩放/平移后不再自动 fit。
- 性能：单一正则 ≈ O(总文本长度)；折叠的章节不渲染正文因此不跑插件；300 章 × 50 实体 <50ms 用例。
- i18n：zh/en 同步补；不用动态键（`i18nCoverage.test.ts` 扫不到）。
- 费用：学习包/自测/问书默认手动触发，预估费用先提示。
