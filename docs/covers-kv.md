# 云端封面与元数据（Cloudflare KV）

## 为什么

书库 600+ 本（约 2.2GB）。原先「补全书籍信息」要把每本书从 WebDAV 下载下来再解析封面，流量几个 GB、对上游压力大。
现在把压缩后的封面（平均约 2.3KB）与元数据放进 KV：书库首屏只读一份索引 + 可见的十几张封面。

## 数据

| KV 键 | 内容 |
|---|---|
| `covers:index` | JSON `{items: {[id]: {stem, title, author?, pages?, chapterCount?, cover?}}}`（646 本约 136KB） |
| `cover:<id>` | 封面 webp 的 base64（≤48KB；预处理产物约 120×160、2–3KB） |

`id = bk_ + 64 位 FNV-1a(归一后的书名主干) 的 base36`。归一：NFKC → 小写 → 去掉所有空白 / 标点 / 符号 / 控制字符。
前端 `src/services/library/bookId.ts` 与脚本 `scripts/covers_prepare.py` 逐字节等价，契约样例 `tests/fixtures/book-id-cases.json`（两端测试都读）。

## 接口（`functions/api/covers/[[action]].js`，均需登录）

- `GET /api/covers`：索引
- `GET /api/covers/<id>`：封面图（不可变，长缓存）
- `PUT /api/covers/<id>`：上传一张（body = webp 字节，元数据在 `X-Book-Meta`）。已有封面不覆盖
- `POST /api/covers/bulk`：脚本批量写入（≤40 条/次，一次请求只写一次索引）

KV 免费额度写入 1000 次/天：全库 646 本 ≈ 646 次封面写 + 每批 1 次索引写，**一次性预处理够用，但同一天别反复 `overwrite`**。

## 使用流程

1. **预处理（一次性）**——本地 `release-ready` 目录的书与 WebDAV 同名书内容相同，直接在本地解析：

   ```bash
   uv run --no-sync --with pillow python scripts/covers_prepare.py --epubs "<epub 目录>" --out .tmp/covers            # 只生成 bundle，不联网
   uv run --no-sync --with pillow python scripts/covers_prepare.py --epubs "<epub 目录>" --out .tmp/covers --upload   # 并上传
   ```

   `--upload` 直接调 Cloudflare REST API 批量写 KV，**不经应用登录，项目 `.env` 不需要任何变量**：token 取环境变量
   `CLOUDFLARE_API_TOKEN` 或 cloudflare-cli skill 的 `.env`（需 Workers KV Storage 编辑权限），账户自动发现，
   命名空间 id 读 `wrangler.toml`。已有封面不覆盖（重跑不烧额度）；索引在封面之后最后一次写入。
   646 本实测：643 本有封面，平均 2335 字节，共 1.5MB；索引约 136KB；已于 2026-11-01 上传并回读验证。
   （`/api/covers/bulk` 接口保留，供无法直连 Cloudflare API 的环境经应用登录后使用，脚本不再调用它。）
2. **运行时采用**：书库每次扫描成功后读一次索引，按书名主干匹配（先精确，再模糊：二元组 Dice ≥ 0.86 且领先第二名 ≥ 0.06，
   有歧义宁可不配），命中的 stale 条目直接补齐书名 / 作者 / 页数 / 章数并清 `stale`，封面键设为云端 id。「补全书籍信息」按钮随之消失。
3. **匹配不上的书**：用户点开（下载）后，应用顺手解析封面与元数据，补传云端（`contributeOpened`），之后谁都能直接命中。
   手动「补全书籍信息」同样会补传。
4. **取图**：封面键以 `bk_` 开头走云端（独立并发 6，取到写 IndexedDB）；旧的路径哈希键仍走 WebDAV `covers/`，互不影响。

## 限制

- 模糊匹配只看书名主干；分卷书、不同版本只差一两个字时会被判歧义而不配（由「点开后补传」兜底）。
- 封面 2–3KB 在高分屏上偏软，换来的是首屏流量极小；要更清晰改 `scripts/covers_prepare.py` 的 `COVER_W/H`、`MAX_BYTES`。
- 本地没有 wrangler 的 x64 workerd，Functions 只做了单测（`tests/securityCovers.test.ts`），未在真实 Pages 上联调。
