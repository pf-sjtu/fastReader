# library Delta

## ADDED Requirements

### Requirement: 书库首页
首页 MUST 以书库形式展示 WebDAV 上的书籍封面墙、继续阅读条与拖拽上传区；MUST 支持搜索、排序与按处理状态筛选。

#### Scenario: 首屏无空白等待
- **WHEN** 用户打开首页且本地已有书库镜像
- **THEN** 先显示镜像内容，再在后台刷新，不出现整页"加载中"

#### Scenario: WebDAV 未启用
- **WHEN** WebDAV 未启用
- **THEN** 书库显示引导启用的空状态，上传区仍可用

### Requirement: 一键进入已处理的书
已处理（status=done）的书 MUST 能在书库中一键进入阅读工作台，直接使用云端缓存，不经过章节选择。

#### Scenario: 点击已处理的书
- **WHEN** 用户点击状态为已处理的书
- **THEN** 加载云端缓存并进入工作台

### Requirement: 快速开始
未处理的书 MUST 通过快速开始面板启动：默认智能勾选章节（排除版权、目录、致谢、索引等及字符数过少的章节），显示预估 token、费用与耗时；价格未知时 MUST NOT 显示估价；开始后 MUST 立即进入工作台并流式呈现已完成章节。

#### Scenario: 价格未知
- **WHEN** 所选模型在目录中查不到价格
- **THEN** 面板只显示 token 预估，并标注价格未知

### Requirement: 书库索引生命周期
书库索引 MUST 存于 `{syncPath}/.juhua/library.json`（含 `schemaVersion`），封面存于 `.juhua/covers/`；系统 MUST 实现失效检测、懒补全、状态同步、垃圾回收、版本迁移与重建。

#### Scenario: 源文件变化
- **WHEN** 扫描发现某书的 size 或 mtime 与索引不一致
- **THEN** 该条目标记为 stale，并在下次打开或空闲时重新提取元数据与封面

#### Scenario: 源文件被删除
- **WHEN** 某书在连续两次扫描中均缺失
- **THEN** 其索引条目与封面被删除；仅缺失一次时保留

#### Scenario: 处理完成后状态同步
- **WHEN** 一本书处理完成或其云端缓存被清除
- **THEN** 同一次服务调用内更新其 status 与 summaryFile

#### Scenario: 索引版本不匹配
- **WHEN** 读到的 `schemaVersion` 与当前不同
- **THEN** 就地迁移；无法迁移则重建索引且不影响原书与摘要文件

#### Scenario: 索引过大
- **WHEN** 索引超过 2MB
- **THEN** 淘汰最久未打开的条目直到低于阈值

### Requirement: 并发写入合并
索引写入 MUST 先重新读取再按条目 `updatedAt` 合并；系统 MUST 接受 WebDAV 无 CAS 带来的偶发覆盖，且覆盖最多影响阅读进度等低价值字段。

#### Scenario: 两端同时更新不同书
- **WHEN** 两个浏览器几乎同时更新不同书的条目
- **THEN** 合并后两条更新都保留

### Requirement: 书架分类、排序与推荐
书库 SHALL 提供按状态/格式/作者/目录的分组，以及按最近/书名/作者/状态/进度/大小/更新时间的排序；SHALL 提供「随机推荐」行：带种子的加权无放回抽样（读到一半的书权重最高，其次未翻开、打开过未读，最近读过的作者的其它书加权），读完的书不推荐，已出现在「继续阅读」的书不重复推荐；「换一批」SHALL 避开上一批（候选不足时才回填）。

#### Scenario: 同种子可复现
- **WHEN** 书库与种子都相同
- **THEN** 推荐结果 SHALL 相同；换种子即换一批

#### Scenario: 常见信息不占位
- **WHEN** 渲染书卡
- **THEN** 书名/作者/章数（或 PDF 页数）SHALL 显示在封面内部底部的阴影层；EPUB 格式 SHALL 不显示标签，非 EPUB 格式 SHALL 以封面角标显示；体积 SHALL 仅在悬停提示中出现，按「大小」排序时才直接显示

### Requirement: 元数据补全与真实封面
书库 SHALL 支持由用户触发的元数据补全：下载书籍提取书名/作者/页数/封面，并发 ≤ 2、可取消；下载失败 SHALL 保持待补全（可重试），解析失败或文件过大 SHALL 清除待补全标记（不重复下载）。封面 SHALL 缩为 ≤60KB 的 webp，仅在书卡进入视口时才请求，远端读取 SHALL 走并发 ≤ 2 的全局队列，同一封面的并发请求合并，失败在本会话内不重试；没有封面 SHALL 回退为生成式封面。

#### Scenario: 下载失败可重试
- **WHEN** 补全某本书时下载失败
- **THEN** 该条目 SHALL 保持待补全，下次仍会尝试

#### Scenario: 解析失败不重复下载
- **WHEN** 书籍下载成功但解析失败，或文件超过大小上限
- **THEN** 该条目的待补全标记 SHALL 被清除

#### Scenario: 封面只加载可见区
- **WHEN** 书架有 60 本带封面的书
- **THEN** 首屏 SHALL 只请求可见（含预取边距）的封面，滚动后增量请求

### Requirement: 文字元数据整体压缩
书库索引 SHALL 以 gzip 存放为单个文件（`.juhua/library.json.gz`）并一次请求读完；读取 SHALL 兼容旧的明文 `library.json`。条目被 GC 或索引重建时 SHALL 清理其孤儿封面。

#### Scenario: 兼容旧索引
- **WHEN** 远端只有明文 `library.json`
- **THEN** SHALL 能读取并在下次写回时存为 gzip

#### Scenario: GC 清理孤儿封面
- **WHEN** 条目因源文件连续缺席被 GC
- **THEN** 其本地与远端封面 SHALL 一并删除

