# 云端书目（Cloudflare KV）：封面与元数据

## 为什么

书库 600+ 本（约 2.2GB）。原先「补全书籍信息」要把每本书从 WebDAV 下载下来再解析，流量几个 GB、对上游压力大，
书架也要等 WebDAV 扫描（约 7 秒）才能显示。现在**云端书目是书架的主数据**：压缩后的封面（平均约 2.3KB）+ 元数据放进 KV，
书架只读一份索引 + 可见的十几张封面就能完整显示；**WebDAV 只在真正用到内容（打开书、处理、手动刷新）时才访问**。

## 数据

| KV 键 | 内容 |
|---|---|
| `covers:index` | JSON `{rev, items: {[id]: Item}}`，646 本约 650KB（gzip 后约 1/3，后续请求走 304） |
| `cover:<id>` | 封面 webp 的 base64（≤48KB；预处理产物约 120×160、2–3KB） |

`Item` 字段（服务端 `cleanMeta` 清洗、限长，客户端不可信）：

| 字段 | 说明 |
|---|---|
| `stem` `title` `author` | 书名主干 / 书名 / 作者 |
| `file` `size` | 源文件名（含扩展名）与字节数：书架据此显示格式；点开时与下载到的文件比对，不一致 = 书被换过 |
| `subjects` | **分类**（EPUB 的 `dc:subject`，最多 8 个）。本库是一套受控的 18 类词表（Business/History/Economics/China/…），643/646 本有 |
| `desc` `publisher` `year` `lang` | 简介（≤400 字）/ 出版社 / 出版年 / 语言 |
| `pages` `chapterCount` | PDF 页数 / EPUB 章数（spine 近似） |
| `cover` `updatedAt` | 是否有封面 / 服务端在**内容真有变化**时写入的时间戳 |

`id = bk_ + 64 位 FNV-1a(归一后的书名主干) 的 base36`。归一：NFKC → 小写 → 去掉所有空白 / 标点 / 符号 / 控制字符。
前端 `bookId.ts` 与脚本 `scripts/covers_prepare.py` 逐字节等价，契约样例 `tests/fixtures/book-id-cases.json`（两端测试都读）。

## 接口（`functions/api/covers/[[action]].js`，均需登录；写操作要求同源或无 Origin）

| 接口 | 作用 |
|---|---|
| `GET /api/covers` | 索引。带 `ETag`（= `rev`），`Cache-Control: private, no-cache`：浏览器自动条件请求，没变化回 304 |
| `GET /api/covers/<id>` | 封面图（不可变，长缓存） |
| `PUT /api/covers/<id>` | 上传封面 + 元数据（`X-Book-Meta`）。**空 body = 只更新元数据**；已有封面默认不覆盖，`?replace=1` 才覆盖 |
| `DELETE /api/covers/<id>`、`POST /api/covers/delete {ids≤200}` | 删除封面与元数据（索引只写一次，幂等） |
| `POST /api/covers/bulk` | 批量写入（≤40 条/次），供无法直连 Cloudflare API 的环境使用 |

KV 免费额度写入 1000 次/天。**没有真实变化就不写**（`updatedAt` / `rev` 只在内容变化时更新），重跑脚本是幂等的。

## 书架的数据流（`cloudCatalog.ts`）

```
                云端书目 catalog（KV，主数据）          WebDAV 书库索引 index（本地镜像 / 扫描）
                        │                                       │  只提供：状态 / 进度 / 真实路径
                        └──────────── buildShelf ───────────────┘
 书架 = ① WebDAV 真实条目（用 catalog 补全分类/简介/封面…，已有的书名作者不覆盖）
      ∪ ② 虚拟条目：云端有、WebDAV 暂无记录的书（路径 cloud://<id>/<文件名>，不是 WebDAV 路径）
```

- 叠加只在**内存**里做，不写进 WebDAV 的 `library.json`：云端是唯一事实来源，不在 WebDAV 上留第二份。
- 匹配：先 id 精确，再模糊（二元组 Dice ≥ 0.86 且领先第二名 ≥ 0.06，歧义宁可不配）；结果按路径缓存。
- 进入书库只读「云端书目」和「本地镜像」，**不扫描 WebDAV**；WebDAV 没启用也能浏览。

## 全生命周期

| 阶段 | 触发 | 做什么 |
|---|---|---|
| **创建** | 预处理脚本（一次性）；点开一本云端没有的书 | 脚本本地解析 → 直写 KV；应用点开后 `contributeOpened` 解析并补传 |
| **更新** | 点开时发现云端条目**不完整**（缺封面/分类/文件名）或**文件大小与云端记录不一致**；**扫描后**也会发现大小不一致的书（叠加层把它重新标为 stale，「补全书籍信息」按钮会计入，补全重传时 `?replace=1` 覆盖旧封面，随后重读云端目录使标记消失）| 不完整 → 补传元数据（已有封面不重传）；大小变了 → 重新提取并 `?replace=1` 覆盖封面。完整且一致则什么都不做 |
| **消费** | 书架 | 分类条 / 筛选 / 多字段搜索 / 按分类·年份·出版社分组 / 同类推荐 / 悬浮卡 / 详情 |
| **缺失** | 点开时 WebDAV 上没有这本书 | 见下 |
| **删除** | 用户确认 | `DELETE`；只删云端封面与资料，**不碰 WebDAV 任何文件** |

### 点开一本书

1. 虚拟条目：等 WebDAV 连上（最多 15s）→ 本会话还没成功扫描过就扫一次 → 在索引里找真实文件。
2. 三种结果：
   - **ok**：找到，正常下载打开。
   - **missing**：连接正常、扫描成功、且扫到了别的书，却没有这一本 → 弹确认框「是否删除云端资料」。
   - **unreachable**：WebDAV 没启用 / 连不上 / 扫描失败 / **扫描「成功」却一本书都没扫到（多半目录配错）** → 只提示原因，**绝不提示删除**。
3. 真实条目下载失败：再用 `existsStatus` 区分——确认 `missing` 才走删除确认；`exists` / `unknown`（网络、权限）只报错。

### 整批提示

一次**成功扫描之后**（且扫到了书、不在刷新中），云端有而 WebDAV 没有的书会合并成一条提示「N 本在 WebDAV 上找不到 · 查看并清理」，
列出书名，用户确认才批量删除。从不自动删除。

## 并发

| 项 | 并发 | 说明 |
|---|---|---|
| 云端封面取图 | 6 → **16** | Cloudflare Pages 同源、封面 2–3KB，不碰 WebDAV；**WebDAV 没连上也能取**（不写本地缓存，交给浏览器 HTTP 缓存） |
| WebDAV 封面（旧键） | 2 → 4 | 旧路径哈希键，仍走 WebDAV |
| 目录扫描 | 6 → 10 | 目录级并行 |
| 补全元数据（要下载整本） | 2 → 4 | 用户主动触发，可取消 |

## 预处理（一次性）

```bash
uv run --no-sync --with pillow python scripts/covers_prepare.py --epubs "<epub 目录>" --out .tmp/covers            # 只生成 bundle，不联网
uv run --no-sync --with pillow python scripts/covers_prepare.py --epubs "<epub 目录>" --out .tmp/covers --upload   # 并直写 KV
```

`--upload` 直接调 Cloudflare REST API 批量写 KV，**不经应用登录，项目 `.env` 不需要任何变量**：token 取环境变量
`CLOUDFLARE_API_TOKEN` 或 cloudflare-cli skill 的 `.env`（需 Workers KV Storage 编辑权限），账户自动发现，命名空间 id 读 `wrangler.toml`。
已有封面不覆盖；索引在封面之后最后一次写入。646 本实测：643 本有封面、平均 2335 字节；2026-11-01 已上传并回读验证。

## UI 说明

- **分类条**：直接摆数量最多的 8 个，其余收进「更多分类」；选中的冷门分类仍以 chip 可见。手机上单行横向滚动。
  chip 的计数含次要标签（一本书可属多个分类）；「按分类分组」的组标题按**主分类**（第一个标签）计，所以两者数字不同。
- **悬浮卡**（鼠标悬停 / 键盘聚焦）：书名、作者、出版社·年份、分类、简介、格式·大小·章数、阅读进度；虚拟条目注明「来自云端书目」。
- **详情对话框**：卡片右下角 ⓘ（鼠标 / 键盘 / 平板）；**手机触屏长按**（卡片太窄，ⓘ 会盖住书名）。点分类标签回到书架筛选。
- 推荐新增「同类别」理由：最近读过的 3 本书的主分类加权（弱于同作者）。

## 限制

- 模糊匹配只看书名主干；分卷书、不同版本只差一两个字时会被判歧义而不配（多出一个虚拟条目，由点开时的核对兜底）。
- 封面 2–3KB 在高分屏上偏软，换来的是首屏流量极小；要更清晰改 `scripts/covers_prepare.py` 的 `COVER_W/H`、`MAX_BYTES`。
- 索引约 650KB（含简介）；首次加载 gzip 后约 200KB，之后 304。书再多可把简介拆成按需读取。
- 简介来自 EPUB 元数据，质量参差（有的是出版信息拼接）；超过 400 字截断并加省略号。
- 本地没有 wrangler 的 x64 workerd，Functions 只做了单测（`tests/securityCovers*.test.ts`），未在真实 Pages 上联调；
  书架 UI 已用真实目录数据（646 本）在浏览器里验证过（桌面 / 手机 / 深色）。
