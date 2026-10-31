# 任务清单

## 0. 提案
- [x] 0.1 本提案经 `openspec validate add-reader-workspace --strict` 通过

## 1. 实体配色与索引（纯函数）
- [x] 1.1 `index.css` 新增 `--entity-1..10`（light/dark，oklch）（对比度校验见阶段 8 走查）
- [x] 1.2 `charts/linking/entityColors.ts`：合并节点与时间线实体、分配颜色与形状
- [x] 1.3 `charts/linking/entityIndex.ts`：名称变体、首字符分桶扫描、entityToChapters/chapterToEntities、matchChapterHint
- [x] 1.4 `charts/linking/remarkEntityMark.ts`
- [x] 1.5 `charts/theme.ts` palette 改读 token
- [x] 1.6 单测（含 300 章 × 50 实体性能用例）

## 2. 滚动 ref 化与图谱修复
- [x] 2.1 `useChapterScrollSpy` 增加 container 参数；`utils/scrollTo.ts`
- [x] 2.2 `stores/readingFocus.ts`
- [x] 2.3 `ChartPluginProps` 扩展（可选字段，向后兼容）
- [x] 2.4 图谱 0→有尺寸时 fit；"适应画布"按钮；布局后按每节点面积等比压紧（防重叠下限）并放宽 minZoom

## 3. 阅读工作台
- [x] 3.1 `ResizeHandle`（指针拖拽 + 键盘 + 双击复位，不另设 hook）
- [x] 3.2 `ReaderWorkspace` + `CompanionDock`（移动端抽屉内置于工作台）
- [x] 3.3 `ResultsSection variant="body"`；`PreviewPanel variant="dock"`；章节卡「清除缓存」收进更多菜单；正文限宽居中（衬线正文切换留到阶段 8）
- [x] 3.4 专注模式
- [x] 3.5 阅读进度栏：可折叠为 14px 竖向圆点进度条（每章一点，已读点亮、当前放大，超 40 章只画线）、可拖拽/键盘调宽（160–360px）、状态记忆

## 4. 联动与标注
- [x] 4.1 图谱高亮/淡化/居中、渐进模式、图例与类型过滤
- [x] 4.2 时间线本章高亮、点事件跳章
- [x] 4.3 `EntityDetailPane`、人物志、本章出场条
- [x] 4.4 正文标注 + `EntityHoverCard`（悬停 300ms 延迟）
- [ ] 4.5 `entityIndex` 记录每次出现的位置与摘录；`LinkCard`（实体/事件/章节三种卡）（实体卡、事件卡已完成；章节卡推迟）
- [x] 4.6 统一 `navigateTo`：自动展开/切页签 → 精确定位 → 到达高亮 → 历史栈与"返回上一位置"
- [x] 4.7 防误触：单击仅选中、拖动不触发、触屏无悬停、双击快捷；Esc/点空白关闭并还焦点
- [x] 4.8 图谱「与正文同色」开关 + 图例 + 类型过滤（偏好记忆）
- [x] 4.9 信息项章节归属：节点/边/事件可选 `chapterHint`（schema + prompt，旧缓存兼容）+ 客户端推导（边=两端共现章节）
- [x] 4.10 `buildEntityCardModel` 纯函数：剧透折叠（e<c 可见；折叠区只给条数，内容不进 DOM）+ 关系概括 + 重要事件
- [x] 4.11 悬停实体卡片（可移入、300ms 延迟、200ms 关闭延迟）+ 折叠区展开；正文悬停取标注所在章为"本章"
- [x] 4.12 图谱渐进模式口径（e≤c）与界面说明

## 5. 顶栏与书库
- [x] 5.1 `App.tsx` 拆分（695→369 行）：`components/app/{AppHeader,ConfigStep,ClassicResults,MobileSheets}`、`hooks/{useAppExports,useAppShell}`，行为不变，由 `tests/appShell.test.tsx` 冒烟锁定；顶栏单行化（`AppTopBar` 分段导航）仍未做
- [x] 5.2 `services/library/`（index/scanner/gc）与 IndexedDB 镜像（索引 gzip 单文件一次加载；真实封面（EPUB 内嵌 / PDF 首页）缩成 webp，懒加载、并发 2；补全元数据由用户触发、并发 2、可取消；孤儿封面随 GC 清理。未做：空闲自动补全）
- [x] 5.3 `LibraryView`、继续阅读、封面墙、`QuickStartSheet`（智能勾选 + 费用预估）（QuickStartSheet 以「选章页的用量预估 + 既有智能不勾选/字数筛选」落地，未新增独立抽屉）
- [x] 5.4 设置：重建/清空书库索引
- [x] 5.5 书架组织：分类（状态/格式/作者/目录）、排序（+作者/进度/大小/更新时间）、带种子的加权随机推荐（可换一批、避开上一批、与「继续阅读」去重）、书卡信息布局（书名/作者/章数在封面内部底部阴影层，EPUB 与体积不占位）、元数据补全（用户触发，并发 2）、真实封面懒加载（队列并发 2）

## 6. AI 学习功能
- [x] 6.1 学习包（studyKit）生成、本地持久化、三档阅读深度（对照栏「速读」页签 + 正文顶部深度切换；`{name}-学习包.json` 云同步**未做**）
- [x] 6.2 自测（选择/简答、出处跳转、错题筛选、重做）。闪卡**未做**
- [x] 6.3 问书（检索 + 引用跳转 + 取消 + 内存对话）。**非流式**；「选区提问」未做

## 7. 笔记与导出
- [ ] 7.1 划线/批注、锚点重定位、`{name}-笔记.json` 同步
- [ ] 7.2 笔记页签与 Markdown 导出；离线学习包 HTML
- [ ] 7.3 命令面板、快捷键、断点续读

## 8. 打磨与验收
- [x] 8.1 排查并修复"暂无内容可上传"（无本地源文件时不渲染上传按钮）
- [x] 8.2 同步更新受影响测试：`uiRender`、`uiComponents`、`fixUiE2e`、`w2pipeHook`
- [ ] 8.3 i18n zh/en 补齐；明暗主题与 375/768/1440 走查
- [ ] 8.4 `pnpm test`、`pnpm build`、`pnpm check:functions` 通过
- [ ] 8.5 独立 Reviewer（devils_advocate）审查并处理结论
- [ ] 8.6 更新 README 与项目 CLAUDE.md

## 9. 生产环境走查修订（2026-10-31，read-app.navira.blog）
- [x] 9.1 书库竞态：WebDAV 自动连接完成前进入首页，书库永远不出现（`webdavService.onInitialized`）
- [x] 9.2 目录深度列表 403 → 逐层遍历降级；超上限抛错；扫描失败显示原因与重试，不再谎称「没有书」
- [x] 9.3 书在浏览根（`browsePath`）而非同步目录：书目录与摘要目录分离；`normalizeDavPath` 先解析 `..` 再剥前缀（生产实测 `/../../dav/EBook/x`）
- [x] 9.4 处理产物（`_chapter_N_summary.md`）不进书库，旧条目立即清除；文件名「书名 - 作者」直接解析；补全只针对 epub/pdf
- [x] 9.5 镜像先行（连接中先显示上次书架）；书架分页（24 + 显示更多）；去掉自动连接 toast；书名最多三行
- [x] 9.6 状态栏：无外框、去掉占位文字、「最近处理」改为入口 + 纵向列表
- [x] 9.7 工作台：窄窗口紧凑布局 + 三栏宽度夹紧；进入即展开第一章可读章节；`ReaderWorkspace` 首次有挂载测试
- [x] 9.8 章节卡重设计（折叠只留序号+标题+箭头，操作进展开后的工具栏）
- [x] 9.9 目录头：折叠钮并入进度行；抽屉关闭钮不压计数
- [x] 9.10 图表页签工具栏分层（视图选项 + 一个图表操作菜单 + 画布工具）
- [ ] 9.11 字体：品牌衬线与正文全靠系统字体，Windows 上观感不可控；需自托管只含 woff2 的 Noto Serif SC 两个字重（`@fontsource` 自带 woff+woff2 全字重约 82MB，不可直接引入），并给正文设衬线/无衬线切换
- [ ] 9.12 「补全书籍信息」按钮应提示将下载的总量（646 本约数 GB）
- [ ] 9.13 WebDAV 连接首屏要 20 秒以上（先登录、加载共享状态、再 testConnection 列根目录）：量化各段耗时并削减
- [ ] 9.14 推荐行与全量网格的书重复且相邻（同一屏出现两次），考虑网格排除已推荐/继续阅读或给推荐行独立容器
- [ ] 9.15 书架 646 本无虚拟滚动/按需渲染的更多测量；封面懒加载在真实 WebDAV 上的并发与流量未测
