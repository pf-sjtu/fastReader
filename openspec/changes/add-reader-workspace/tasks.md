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
- [x] 7.1 划线/批注（选中正文 → 划线 / 批注，按书存本机 IndexedDB，锚点记章节序号+标题+原文片段+前后文，重新加载后按标题 / 序号找回章节，找不到的归入「游离笔记」不丢。**已完成**：`{name}-笔记.json` 云同步（见 10.13 与 `docs/artifact-store.md`）、正文里把划线渲染成高亮（`src/notes/remarkNoteMark.ts`：把整章各块拼起来**一次**定位，每条笔记只画一处、只画起点所在的块级单元——跨列表项不再画出多个同 id 的 mark；同段内跨行内格式仍逐段切开；引文确实覆盖行内代码时整段包住 `<code>`；围栏代码块整块跳过）、原文片段的模糊重定位（`src/notes/anchor.ts`：exact → tolerant → fuzzy 三级，bigram 位置索引 + 候选窗口 + 上限预筛，笔记页签与正文高亮共用 `createNoteResolver` 的整章折叠结果，两处口径一致）；重定位失败时笔记页签在条目顶部标「已失去定位」并保留笔记。**独立审查（`review-notes-pack`）后的四处行为修复**：短引文不再被别处的 fuzzy 误命中、跨段落/跨行内代码的引文正文也标得上、一条笔记最多一处语义区间（跨块取起点所在块，跨字段/跨行内格式逐段切开，重叠笔记仍然是嵌套 mark 且 `.note-mark` 不带水平内边距）、长章整章定位从 306ms/条降到毫秒级）
- [x] 7.2 笔记页签与 Markdown 导出（笔记页签、复制 / 下载 Markdown；**已完成**离线学习包 HTML：结果页标题栏「HTML」按钮 → 单文件、断网可读、可打印的 `.html`，含目录 / 章节总结 / 章节关联 / 全书综述 / 人物志 / 图谱与时间线（自绘 SVG）/ 笔记（4 色左边条）/ 自测题与作答标记；实现见 `src/study/pack/**`（纯渲染）、`src/study/exportPack.ts`（接线）、`src/study/exportFigures.ts`（图谱与时间线），说明见 `docs/study-pack.md`）
- [x] 7.3 命令面板、快捷键、断点续读（Ctrl/⌘+K 命令面板：跳章节 / 找实体 / 切页签 / 操作；`j` `k` 切章、`[` `]` 切对照栏页签、`?` 帮助，输入框与对话框里不触发；续读按书名+作者存 localStorage，重新打开时跳回上次章节，每本书只恢复一次。阅读进度同步到书库索引（停留 5 秒才写、进度没变不写，封面上的进度条随阅读更新）。**未做**：跨设备同步续读点（续读点只在本机）、续读到章内滚动位置）

## 8. 打磨与验收
- [x] 8.1 排查并修复"暂无内容可上传"（无本地源文件时不渲染上传按钮）
- [x] 8.2 同步更新受影响测试：`uiRender`、`uiComponents`、`fixUiE2e`、`w2pipeHook`
- [ ] 8.3 i18n zh/en 补齐；明暗主题与 375/768/1440 走查（**部分完成**：i18n 键一致性自查通过——代码静态键 983 个、zh/en 各 1315 条词条、四个方向 0 缺失，动态键 16 处已由 `study.pack.*` 那条守卫覆盖；**未做**：真实浏览器下的明暗主题与三尺寸目视）
- [x] 8.4 `pnpm test`、`pnpm build`、`pnpm check:functions` 通过（2026-11-01 复验：vitest 1871 通过 / 23 跳过、`pnpm build` 通过、8 个 Functions 入口打包通过；本轮后续改动仍需再跑）
- [x] 8.5 独立 Reviewer（devils_advocate）审查并处理结论（`review-notes-pack` 审 `d4ba264` / `5598b7f` / `ffb3b2c`（+ `340bd83`）：**工程面干净**（2815 行新增无 `any`/`console.log`/调色板硬编码、守卫与三条新提交的自述基本属实），3 条必修已全部修完并配回归测试——① 页签与正文的「可定位块集合」仍不等价（缩进代码块与围栏外 HTML/注释：页签说已定位、正文 0 高亮）→ 抽出 `src/notes/noteText.ts` 的共享判定 `NOTE_SKIP_TYPES` + `noteSearchText()`（用与正文渲染**同一条 unified 链**解析），`tests/notes/noteTextParity.test.ts` 14 种 markdown 形态双边对拍；② 编码回退会把合法 UTF-8 整篇解成乱码（U+FFFD 占位符触发 GB18030 回退）且两端阈值/空白集/书名语义不一致 → 两端改**严格解码**（UTF-8 → GB18030 → UTF-8 替换），空白集显式写死成同一字符类，新增共享夹具 `plain-decode-cases.json` / `plain-title-cases.json`（两端读同一份字节）；③ `.markdown` 声称支持却点不到也扫不到 → 文件选择器、`browse.ts`、`libraryService`、`WebDAVFileBrowser`、`webdav_client.py` 五处列表补齐。建议项处理：`raw-color` 守卫扩到 `#fff` 与任意值颜色函数（另加 `raw-color-fn` 规则）、深色 `--destructive-foreground` 改墨色（实测由 ~3:1 升到 ~5:1）、`README.md:9` 文案补 TXT/Markdown；余下未做：深色实心底目视、`ListRow` 嵌套 button 的守卫化）
- [x] 8.6 更新 README 与项目 CLAUDE.md（`AGENTS.md` 已补 Overview 的多格式说明、`## 笔记划线高亮（阅读工作台）`、窄口径 `noteSearchText` 约定；`README.md` 补 TXT/Markdown 支持、笔记导出与离线学习包、学习数据同步）

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
- [x] 9.11 字体：放弃自托管（体积/加载代价过大），改为「系统字体栈 + 回退」：字体栈集中在 `index.css` 的 `--font-sans/--font-serif/--font-mono`，设置新增「字体」页签展示优先级与是否已安装，并提供正文衬线/无衬线切换；全站基础字号 15px、正文行高 1.8
- [x] 9.12 「补全书籍信息」按钮应提示将下载的总量（646 本约数 GB）（按钮提示写明本数与总量；≥200MB 先确认；手机上按钮缩成图标+数字）
- [x] 9.13 WebDAV 连接首屏 20 秒+：量化（生产 b5：18 次 PROPFIND 严格串行、约 16s，每次 0.4–2s）。**根因**是 `webdavService.runExclusive` 把所有 DAV 操作串行（共享 client 的可变头 `X-WebDAV-Path`），所以第一版「listTree 6 路并行」在生产里毫无效果（单测用假 list 发现不了）。已修：`getDirectoryContents` 改用「每次请求自带 headers」、不再加锁（真实 webdav 库 + 本地 HTTP 服务测试 `tests/webdav/davConcurrentList.test.ts`，旧实现会失败）；两个根目录并行；目录扫描与读远端索引并行。待部署后复测耗时
- [x] 9.14 推荐行与全量网格的书重复且相邻（同一屏出现两次），考虑网格排除已推荐/继续阅读或给推荐行独立容器（网格排除「继续阅读/推荐」已展示的书；标题改「其余书籍」；全被展示时不报「没有符合条件」；分组/排序视图不排除）
- [x] 9.15 书架 646 本无虚拟滚动/按需渲染的更多测量；封面懒加载在真实 WebDAV 上的并发与流量未测（按设计核算：封面 IntersectionObserver 懒加载 + 全局队列 + IndexedDB 缓存，单张 ≤30KB，首屏 24 本≈≤1MB；**封面流量改为不再逐本下载**：封面与元数据预处理后放进 Cloudflare KV（`docs/covers-kv.md`），书库只读一份索引 + 可见封面；646 本本地预处理实测 643 本有封面、平均 2.3KB。**已做**：2026-11-01 经 Cloudflare REST API 直写线上 KV（脚本 `--upload`，不需要项目 `.env` 变量），回读核对 646 条索引 / 643 张封面。**未做**：登录线上站后实际看到云端封面的联调（需要登录密码，由你确认）与线上首屏流量实测）
- [x] 9.15b 书架以云端 metadata 为主、WebDAV 按需访问（`docs/covers-kv.md`）：书架 = WebDAV 索引 ∪ 云端目录（仅内存叠加，云端有而 WebDAV 暂无的是虚拟条目）；进入书库不再扫描 WebDAV；用上分类（`dc:subject` 18 类词表，643/646 本）/ 简介 / 出版社 / 年份：分类条、多字段搜索、按分类·年份·出版社分组、同类推荐、悬浮卡、详情对话框（手机长按）；缺失处理（连接正常且扫描成功却无此书 → 询问是否删云端资料；连不上 / 扫描失败 / 扫到 0 本 → 绝不提示删除；整批孤儿提示）；元数据生命周期（点开时按完整度 / size 补传或 `?replace=1` 覆盖，索引 `rev` + ETag/304，`DELETE`）；并发放宽（云端封面 6→16、WebDAV 封面 2→4、扫描 6→10、补全 2→4），且云端封面在 WebDAV 未连上时也能取。真实目录数据（646 本）在浏览器里验证了桌面 / 手机 / 深色，并据此修了手机上 ⓘ 盖书名、推荐胶囊换行、工具栏占满首屏。**未做**：线上 Pages 联调（需登录密码）；索引 650KB（简介占大头），书再多可按需拆分简介
- [x] 9.16 正文里两套高亮互相抢眼：AI 加粗句被渲染成橙色荧光笔底，叠加实体的彩色下划线；每段都有大片橙底，实体标注反而不突出。应降低加粗句的底色（或仅保留字重），让实体标注成为唯一的强调系统（加粗句底色降为淡色，实体标注为主要强调）

## 10. 二次走查与 v3（2026-10-31，生产 b29；规格见 specs/ux-audit、prompts-v3、processing-v3）
- [x] 10.1 字号层级收敛：行高 !important 压过 prose-sm（实测 27px=15×1.8）；≤11px 清零（**例外**：`src/charts` 里 5 处 `text-[10|11px]` 仍在，守卫跳过该目录）；字号角色见 10.12
- [x] 10.2 目录条目：折行或悬停全称，点击区 ≥ 32px，副标题弱化（现 17px 高、「01 镜像世界——…」被无提示截断）（line-clamp-2 + title 全称 + min-h-8；副标题弱化）
- [x] 10.3 打开已精读书不再自动调用 AI（去掉 pendingAuto；生产实测 `/api/ai` 请求数为 0）；图表页签显示「生成关键图表」+ 固定的费用说明文案。**未做**：预估金额、生成中的「取消」按钮
- [x] 10.4 工作台单层页头（现品牌行 / 工具行 / 书名行叠放）（工作台：品牌 + 状态栏 + 工具合成一行；窄屏状态栏另起一行）
- [x] 10.5 书库头部密度：搜索+刷新+补全同行；手机首屏第一排书 ≤ 300px（现 472px，刷新钮独占一行）；模型芯片不再截成「GPT-6…」（标题行：标题 + 补全 + 刷新；搜索手机上独占下一行；排序/分类标签手机上仅读屏可见）
- [x] 10.6 对照栏 10 个页签在 452px 宽被挤压：常驻 4 项 + 「更多」（常驻 图谱/时间线/人物志/问书 + 「更多」菜单；当前激活的非常驻页签顶替显示）
- [x] 10.7 主题切换无混合帧：卡片去掉 transition-colors，且切换那一帧给 `<html>` 加 `data-theme-switching`（CSS 里全部 `transition: none !important`，两帧后移除），覆盖 ui 层 Button 等的 transition-all；有测试
- [x] 10.8 已精读书点击后不再经过「文件上传与配置」卡（现先弹 toast、再显示配置卡「正在检查云端缓存」，约 8s 才进工作台）；改骨架屏直达（`autoOpening` → 骨架屏「正在打开《…》」，不再闪「文件上传与配置」卡；缓存没读到则回到正常配置流程）
- [x] 10.9 提示词 v3（已落地：`v3-prompts.yaml`；`chapterMeta.ts`/CLI `chapter_meta.py` 拆分+清理，共用 `meta-cases.json`；默认 v3，v2 仍可选；旧导出配置按 v2 基线求覆盖项，CLI 回落 v2 条目时「等于 v2 默认全文」的条目跟随 v3）。独立审查后修正：取最后一个标记、旁路在前/末尾代码块、围栏代码块不清理、标题不吞空行、开头客套话本地剥掉。**未做 / 已知缺口**：① 规范实体名：**已接入正文实体标注与出场章节索引**（`entityAliases.ts` 把各章旁路的别名并入图表实体，`buildEntityMatcher` 别名优先级低于所有主名；有测试）；****图谱重复节点已合并**（`entityMerge.ts`：旁路别名同时命中两个节点全名即并，边/事件引用同步改写，类型冲突不并）；**旁路已写入云端**（同名 `{书名}-完整摘要.meta.json`，`metaSidecar.ts`：同步 / 手动上传 / 批量三处写入，加载时按序号还原，章节数不符则要求标题兼容才挂，缺失或损坏静默忽略；只覆盖 v3 之后处理的书，旧书无此文件）；② 切回 v2：设置→提示词→「改用 v2 提示词」一键套用 v2 覆盖项（会覆盖已有自定义，「恢复默认」回到 v3；仍无独立的版本字段）；③ 覆盖项「基于版本 / 迁移」界面；④ fiction 的 spoiler 事件未接入渐进模式；⑤ **升级成本**：默认模板变了，缓存键含提示词哈希，v2 时期的章节缓存不会被 v3 命中，处理到一半的书会重新付费
- [ ] 10.10 处理机制 v3（**部分完成**：实体表归并后传给关联/全书总结/图表；质量闸只在「按 v3 格式给了旁路却正文极短」时做一次定向重写（先过限速、失败不连累首轮结果、取消照常抛出），自定义提示词不清理不重写；开头客套话本地剥掉。**已做**：关联分析 / 全书总结超预算时 map-reduce（分组各做一次再合并，不再把每章砍短；`groupChaptersByChars`）；关联 / 全书总结缺失或失败时有「重试这一步」（`useBookSteps`，只重跑该步并回写云端 MD；成功结果不写本地章节缓存）；`quality: warn` 与 token 账单已有界面提示。**未做**：章节调用的书级上下文快照与提示词缓存友好排序、map-reduce 对真实长书的效果评测、图表 / 综述之外其它步骤的单步重试）
- [ ] 10.11 v2/v3 评测（**部分完成**：前后端共用契约样例与一致性测试；**已做**：真实模型评测 `tests/tour/eval_prompts.py`（glm-5.3-flash 生成、glm-5.3 评判，5 本 × 14 章 + 5 本书级；两种顺序各评一次），报告见 `docs/eval-prompts-v2-v3.md`。结果：格式违规 v2 0.93 → v3 0.07，旁路 14/14 可解析，书级关联分析 v3 3 胜 0 负 2 平；章节质量无可靠差异（评判者位置偏向严重，一致率 54%）。规格的回退条件「v3 格式违规率高于 v2」**未触发**；但小样本、单一模型家族、同族评判，不宣称 v3 质量更好。**未做**：换家族评判、小说 / PDF / 英文书、控制长度的对比）
- [ ] 10.12 设计系统收敛（规格 design-system）——**部分完成**。已做：index.css 的 `.t-*` 文字角色（含本轮新增 `.t-body`）+ `--success/--warning/--info` token；`CardTitle/DialogTitle/SheetTitle` 默认 `t-title`；调色板色/裸圆角/≤11px/12px 图标批量迁移；`tests/designSystem.test.ts` 守卫。**本轮补齐**：①状态色 token 家族——`--danger`（= `--destructive` 别名，规格口径与 shadcn 口径始终同值）、`--success/--warning/--info/--destructive` 各配 `-foreground`（深色下状态色已提亮，实心底改墨色文字）与 `-muted`（`color-mix(… 14%/18%, var(--card))`），`@theme inline` 全部映射；②共享组件 `ui/section-heading.tsx`（`SectionHeading` + `PanelHeader`，含 `id` 透传以便 `aria-labelledby`）、`ui/list-row.tsx`（`ListRow`，含 `disabled`）、`ui/skeleton.tsx`（`Skeleton`/`SkeletonText`/`SkeletonList`），`EmptyState` 复用；③骨架屏迁移 3 处（`App.tsx`、`config/ConfigStep.tsx`、`markdown/RichBlock.tsx`）；④分部标题迁移 13 个文件（library 3 / notes 1 / project 4 / workspace 2 / 其余），业务代码里已无自拼 `t-section`/`t-label` 标题（余下两处属正当：登录页品牌标题、GenUi 生成块内标题）；⑤`EmptyState` 由 1 处扩到 5 处（服务商空列表、批处理文件/队列空态、历史空态）、`ListRow` 落地 2 处（处理历史行、批处理队列行）；⑥守卫扩面：同时扫 `.ts`（类名常写在常量表 / `cn()` 拼接里），新增 `skeleton`、`empty-state`、`raw-color` 三条规则与 `except` 例外机制，豁免登记 11 条（品牌 logo 固定色、SVG/canvas/iframe 内文档等）。**独立审查后加固**：`raw-color` 正则扩到 `#rgb`/`#rrggbbaa`（并排除 HTML 实体 `&#160;`），另加 `raw-color-fn` 规则拦 `text-[rgb(...)]` / `bg-[#fff]` 这类任意值颜色函数（阴影/渐变里的 `rgb(...)` 不算）；深色主题 `--destructive-foreground` 改墨色（近白前景在提亮后的深色 destructive 上只有 ~3:1）；README 补「TXT / Markdown」。**未做**：按钮高度 h-7/8/9/10 混用（**已逐处甄别**：`<Button>` 的 className 里只剩 4 处刻意抬高的 `min-h-9`/`min-h-10`——`App.tsx` 与 `ReaderWorkspace.tsx` 的移动端整宽切换按钮，为 44px 级点按区域而设，不上档位；`ModelSwitcher` 的冗余 `h-8` 已删（`size="sm"` 本身就是 h-8）；其余命中都是 `svg`/`input`/`select`/非 Button 的筛选 chip，属正当用法）；列表行在书库 / 批量文件 / 笔记等剩余面板的落地（**甄别结论**：书库是封面网格（`BookCard`）不是行；`BatchFileTab` 的行带 `role="checkbox"` + `aria-checked` + 整行键盘交互，<code>ListRow</code> 目前只支持 button/div 语义，硬套会丢可访问性——留给 <code>ListRow</code> 支持 selected 语义后再迁；笔记项是带引文与操作的多行卡片，不是列表行）；守卫不覆盖**运行期算出**的类名（静态扫描已覆盖 `cn()` 里的字面量与模板字面量本身，本轮新增 `dynamic-palette` 规则拦 <code>text-${tone}-500</code> 这类模板插值拼色，剩下的运行时拼接无法静态判断）；真实浏览器下的明暗主题与三尺寸目视走查（本机装不出 workerd，`pnpm dlx wrangler pages dev` 不可用）
- [x] 10.13 产物持久化与清理（**已完成**，设计见 `docs/artifact-store.md`：逐类判断；WebDAV 过时产物清理（旧版格式 / 悬空附件 / 书已不在三级，强制重扫 + 新鲜完整扫描闸 + 二次确认）；速读 / 自测在章节总结稳定后自动生成（可关）；章节链接统一悬浮速读卡。**本轮补齐**：统一信封 `{syncPath}/.juhua/books/<bookFolder>/<kind>.json.gz`（`src/services/artifacts/`，`schema: 2`，`bookKey = 书名|作者` 稳定身份 + `inputsFp` 上游指纹）；速读 / 自测 / 答题同一 `study.json.gz`，本机 IndexedDB 先写、云端 2 秒防抖异步写、读时按 `updatedAt` 合并、失败只 warn，换设备打开同一本书直接从云端恢复；笔记 `notes.json.gz` 条目级合并（同 id 取新、相等保留本机）+ 墓碑（`deleted: true` 保留 30 天）+ `{名}-笔记.json` 人可读副本（只含可见笔记），防抖 3 秒；`schema` 更高只读不写；界面提示「按旧总结生成 / 云端版本更高 / 云端不可用」（`SyncNote`）。**清理扩面**：新增「已过时」（信封 `inputsFp` ≠ 索引里该书当前指纹，指纹在打开书时由 `touchStudyFp` 回写 `LibraryEntry.studyFp`）与「整包」（`.juhua/books/<bookFolder>` 的书已不在）两类，信封类一律默认不勾选（含答题记录 / 笔记等不可恢复数据），含笔记的包额外警示；四条安全闸一条未松（强制重扫、0 本或扫描失败拒绝给清单、「书还在」= WebDAV 真书 ∪ 云端书目、只删严格命名产物且 `.juhua` 下只认能解析且版本认识的信封，目录删除另经 `isArtifactPackageDir` 校验）。测试：`tests/artifacts.test.ts` 19、`tests/study/studySync.test.ts` 19、`tests/notesSync.test.ts` 29、`tests/library/artifactCleanup*.test.ts{,x}` 41，14 个既有测试文件跟进；`openspec/changes/add-reader-workspace/specs/artifact-store/spec.md` 记契约。**独立审查后加固（两份审查 + 修复）**：修掉 4 条「测试全绿但行为错」——①读到更高 `schema` 的信封后仍可能被本机覆盖（`remoteKnown` 对所有状态都记住 + `holdWrite` 三态：newer 只读 / bad·error 当云端不可用 / missing 才允许写）；②只重生成速读会把自测「洗白」成已跟上当前总结（`kitFp` / `quizFp` 分开记，`autoGenerate` 先快照两份的需求，界面按面板提示）；③重新出题后旧答案按题号贴到新题上（只在两边题目完全相同时才并集答案）；④笔记读失败被当成「云端没有存档」→ 本机旧副本盖掉云端（读不到一律不写，含人可读副本；写失败留在待写队列下次补推）。另删死代码 `newerEnvelope`、目录名清洗加 `%`、删除前对文件项与整包目录同时校验「在当前同步目录内 + 目录解码后仍安全」、整包「书已不在」按书名匹配且「已过时」只认精确 `bookKey`。**仍待真实 WebDAV 端到端手验**（包目录创建与 gunzip 读取真链路只经假 IO 覆盖））
- [x] 10.14 书籍下载进度（用户要求：处理前的下载要有进度环/条、速度、预计完成时间，让用户知道没卡死）：流式读取响应体，`Content-Length` 缺失时回退书库索引里的 `size`；平滑速度 + ETA；久无数据显示「连接较慢，仍在等待」；可取消；书卡进度环 + 全局 toast；阶段标签（连接 → 下载 → 解析）。**已完成（57d744c）**
- [x] 10.15 总结支持富内容块（**代码与单测落地 0574f3e + 9c5d0af，与 CLI 镜像；真实环境验收发现的缺陷见 10.22，spec：`specs/rich-blocks/spec.md`**）：模型可选输出 ```mermaid / ```genui（JSON 规格，原生组件渲染）/ ```html（沙箱 iframe）；仅在帮助理解复杂 / 抽象内容时用；**不计入字数**（质量闸、压缩阈值、加粗上限、下游 prompt 输入一律剔除，`richBlocks.ts` ↔ `rich_blocks.py`，共享夹具 `tests/fixtures/rich-blocks/cases.json`）；容错渲染（解析 / 渲染 / 超长 / 脚本出错都回退为源码并提示，`RichBlock.tsx` + `richBlockUi.test.tsx`）；坏块生成后统一修复（只发坏块 + 80 字前文，修好复检通过才写回、仍坏则删，`richRepair.ts` ↔ `rich_repair.py`，共用 `rich-repair.schema.json`）
- [x] 10.16 章末提问样式（**已落地 9c5d0af**）：颜色变浅、字体与字号区别于正文，前置浅色虚线分隔；兼容「有换行」和「无换行（挤在一段里）」两种输出，渲染与落盘都统一成每问一行（`tailQuestions.ts` ↔ `chapter_meta.py` 的 `_normalize_tail_questions`，`tailQuestions.test.tsx` 覆盖）
- [ ] 10.17 本轮已完成并推送、待独立审查（8.5 同款）：自动生成速读 / 自测（可关）、`ChapterPeek` 章节悬浮速读卡、对照栏页签「图标 + 文字」逐级退让（`planDockLayout`）、WebDAV 过时产物清理、书卡右上角主分类、超宽屏断点修复（px→rem 层叠顺序）、`useFillHeight`、问书 Markdown 渲染与引用标签、两本期权书分类修正（本地 RR / WebDAV / KV 已核实）
- [ ] 10.18 备忘（延后）：服务端索引并发写根治（Durable Object / D1）与 M5 索引解析开销实测；`cleanMeta` 两端契约样例（L1）；换家族评判 / 小说·PDF·英文书评测；章节调用的书级上下文快照与提示词缓存友好排序；跨设备续读；设计系统 10.12 余项；测试里 `act(...)` 警告清零（L6「`PUT` 校验 webp 魔数」已于本轮完成：`functions/_lib/covers.js` 的 `isWebpBase64` 要求 `RIFF`/`WEBP` 魔数，非真 webp 一律 `bad_image`）
- [ ] 10.19 待用户：登录线上实测（云端书架 / ETag / 补全 / 打开虚拟条目 / 新页签 / 清理产物）；两本期权书改分类后的 Readest 同步（退出 Readest 后执行 `sync_rr_to_readest` / `refresh_readest_groups_from_opf`）；`.env` 里 `FASTREADER_MAX_FILES` / `FASTREADER_SOURCE_PATH` 取舍

## 10.22 富内容块的真实环境审计与补齐（用户反馈：html / genui / mermaid 及修补「似乎没接入或没看到可用」）
审计方法：`tmp/rich-demo`（真实 react-markdown + 项目插件 + 全部块样例）+ `serve.mjs` 套用 `public/_headers` 的**生产 CSP**，在真实浏览器里浅色 / 深色各看一遍。结论：渲染入口与 mermaid / genui / 回退 / 章末提问在线上 CSP 下**可用**；但有下列缺陷（10.15 当时只经 jsdom 验证，mermaid 还被 mock，未能发现）。
- [x] 10.22.1 审计：线上 CSP 下 mermaid 懒加载渲染 OK、genui 组件 OK、坏块回退 OK、章末提问区隔 OK
- [x] 10.22.2 **缺陷 A（高）**：html 块 `srcdoc` iframe 继承父页 CSP，内联脚本被拦。已修：独立沙箱页 `public/rich-sandbox/`（内联脚本——opaque origin 下 CSP `'self'` 匹配不到外链脚本，真实浏览器验证过）+ `_headers` 用 `!` 摘除全站 CSP 换专属 CSP（`default-src 'none'`、无网络、`frame-ancestors 'self'`）+ `postMessage` 握手（READY → DOC → HEIGHT，按 `e.source` 校验，5s 超时回退源码）；守卫 `tests/richSandbox.test.ts`，握手 / 超时 / 高度 `tests/richBlockUi.test.tsx`；Playwright Chromium + 生产 CSP 复验：高度 217px 自适应、点击计数生效、外链脚本 / 网络 / Cookie / 嵌套页面探针全被拦
- [x] 10.22.3 **缺陷 B（中）**：深色主题下 genui / 回退块文字发灰。已修：根节点与回退块显式 `text-foreground`；深色截图复验。另修一并发现的 **mermaid 失败后把「Syntax error」炸弹图残留在 `<body>`**（先 `mermaid.parse` 再 `render` + `finally` 清理 `#d<id>` / `#<id>`），Playwright 复验 `document.body` 无残留
- [x] 10.22.4 渲染入口盘点：`MarkdownCard`（结果页 / 阅读工作台 / 联动）与 `ViewContentDialog` 的 markdown 分支都接了 `richMarkdownComponents`；问书回答（`AskAnswer`）登记为例外；守卫 `tests/richEntries.test.ts`。另：章节悬浮预览（`ChapterPeek`）与实体联动（`useEntityLinking`）取文字前先 `stripRichBlocks`
- [x] 10.22.5 离线学习包：genui 渲染成静态 HTML（七种组件，测验直接给答案与解析，所有文本经 `escapeHtml`）；mermaid 在正文里只留一行指路、图本身在「图谱与时间线」区（既有 `captureDiagramImages`）；html 与读不懂的 genui 换「仅在线版可用」说明；未闭合尾块丢弃（`src/study/pack/richStatic.ts`，标签走 i18n `study.pack.interactiveOnline|diagramBelow`，测试 `tests/study/packRichStatic.test.ts`）
- [x] 10.22.6a **富内容块能力说明 = 独立的提示词 / 上下文工程**：共享 `config/rich-blocks-guide.md`（能力介绍 / 何时用何时不用 / 硬规则 / 精确语法与常见错误 / 4 个 few-shot 正例 + 1 个反例）；章节总结 v3 提示词（小说与社科）里的两份内联小节改为 `{{richBlocksGuide}}`，由 `richGuide.ts#expandRichGuide`（CLI：`PromptTemplates.expand_rich_guide`）**预展开**——不用 renderPrompt 变量，因为用户自定义的旧提示词没有占位符时，变量会被追加到末尾；提示词预览同样展开。**与最初设想的差异**：只用一份说明（不分 fiction 版，场景清单已中性化）；全书综述 / 关联分析不要求产块（下游只读正文、块被剔除），所以不注入。守卫 `tests/richGuide.test.ts` + `test_cli_shared_prompts.py`（few-shot 必须被我们自己的解析器认可）
- [x] 10.22.6 真实模型实测（MiniMax-M3，`tests/tour/eval_rich_guide.py`，每组 6 次）：同一批章节「有说明 vs 去掉说明」——结构性章节出块率 **83% vs 0%**，线性叙述章节误画率 **17% vs 0%**，正文均字数 1133 vs 1066（无缩水）；有说明组 5 个块里 1 个未过 CLI 结构检查（交给坏块修复步骤处理）。**独立审查指出首版评测章节与 few-shot 示例同题（量的是抄示例），已换成与示例无关的主题重测，数字基本不变**；n=6 仍是小样本，且只过了结构启发式而非真 mermaid 解析器。迭代记录：初版「宁缺毋滥」措辞过保守（结构性章节仅 25%）→ 加「≥3 环节的流程 / ≥2 方对比应当配块」→ 线性章节被误画 50% → 加「叙述 / 抒情内容哪怕能排成时间线也不画」→ 现数。**结构化输出真实网关探测**（`tests/tour/probe_structured.py`，MiniMax-M3）：`json_schema(strict)` 被接受且返回符合 schema 形状的 JSON；`json_object` / 无约束也返回 JSON 但不保证形状（与预期一致，所以修复结果仍需自己校验）。该网关不拒绝 json_schema，**降级阶梯（noJsonSchema → noStructured）在真实网关上没有被触发**，仍只有单测覆盖
- [x] 10.22.7 「真实浏览器 + 生产 CSP」演示页固化为 `tests/tour/richDemo/`（vite 构建 + 按 `_headers` 起服务 + README 验收清单），不再散落在 tmp
- [x] 10.22.8 独立审查（opus，报告 `.tmp/review-rich-final.md`）+ 文档同步。必修 5 条已处理：**M1** Cloudflare Pages 会把 `/x.html` 308 到 `/x`，专属 CSP 规则匹配不到 → 沙箱页改为目录 `public/rich-sandbox/index.html`、URL `/rich-sandbox/`，验收服务器 `serve.mjs` 补上 308 模拟，守卫断言目录 URL；**M2** 评测题材与 few-shot 重叠 → 换题重测（见 10.22.6）；**M3** 思维导图压缩路径漏展开占位符 → 补；**M4** 缓存键按未展开模板计算 → `resolvePromptTemplates` 对 summary 先展开；**M5** 离线包 mermaid 改为源码呈现（原先指路可能指向不存在的图）。建议项里已做：iframe `key` 改内容哈希。**后续补做**：沙箱页纵深防御（CSP `sandbox allow-scripts` 响应头、页内 `self.origin` 自检、全站 CSP 显式 `frame-src 'self'`，守卫已加，Playwright 复验握手仍通）；离线包未闭合块改为按源码留下而非丢弃；CI 里长期红的 5 个 lint 报错已清（`BookCard`/`envelope` 加带理由的豁免，两个测试删未用项）
- [x] 10.20 CLI 与网页处理镜像等效（用户要求：「cli的自动化处理确保和 web 在线是镜像等效的」「提示词都要抽离、共享」）：提示词与 schema 全部抽到 `src/services/prompts/config/`（`study-kit.md` / `quiz.md` / `ask-book.md` / `key-charts.md` / `rich-repair.md` / `language-instructions.json` / `shared-strings.json` / `{study-kit,quiz,rich-repair}.schema.json`），前端 `getStudyKitPrompt` 等与 CLI `load_shared_text` 读同一份文件，两端的「禁止再内联」守卫锁死（`tests/promptsShared.test.ts` 扫 `services/prompts|ai/*.ts` 的 ≥200 字「你是」模板、`tests/python/test_cli_shared_prompts.py`）。CLI 补齐 v3 章节流程：`chapter_meta.py` 拆旁路 + 程序化清理 + 质量闸（`check_summary_quality`），`chapter_summarizer.py` 质量闸定向重写一次（采用条件与前端逐字相同、两次都计费）+ 富内容块修复（token 记第一章）+ 下游 prompt 只喂正文；结构化输出两端同策略（`src/cli/structured.py` ↔ `src/services/ai/structured.ts`：schema → json → 不带，降级成功才记档，经 `state:modelQuirks` 与浏览器互认）；降级顺序把「结构化参数被拒」排在思考参数之前，避免把这类 400 误判成不支持思考。等效性由 `tests/python/test_cli_parity.py`、`test_cli_rich_blocks.py`、`test_cli_shared_prompts.py` 与共享夹具锁定（pytest 493 通过）。**未做**：CLI 只有 summary 模式，不生成速读包 / 自测 / 问书 / 关键图表（只与前端共用它们的提示词文件）
- [x] 10.21 产物持久化与清理（commit `21a9e9a` 已推送，**独立审查已完成**）：产物信封持久化（`src/services/artifacts/`：`envelope.ts` + `io.ts`）、速读 / 自测 / 答题接入（`src/study/studyStore.ts` 本机优先 + 云端合并 + `SyncNote` 提示）、笔记云同步（`src/notes/notes.ts` v2 + 墓碑 + 条目级合并，`notesStore.ts` 3 秒防抖 + `{名}-笔记.json` 副本）、清理新增「已过时」与「整包」两类（`classifyStalePackages` + `isArtifactPackageDir` + `touchStudyFp` 回写 `LibraryEntry.studyFp`）、契约写进 `specs/artifact-store/spec.md` 并更新 `notes` / `study-tools` 的对应 Requirement。**审查（`review-artifacts` + 一个只读 subagent，两个视角都实测复现）结论**：工程面干净（2815 新增行无 `any`/`console.log`/调色板硬编码、designSystem 通过、四条清理安全闸成立），但发现 4 条「测试全绿而行为错」并已全部修复 + 各配回归测试：更高版本信封被本机覆盖、重生成速读把自测洗白成已跟上、重新出题后旧答案按题号串写、笔记读失败被当成「云端没有存档」而盖掉云端。仍未做：真实 WebDAV 端到端手验（见 10.19）
