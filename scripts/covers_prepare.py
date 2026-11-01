"""
书封面 / 元数据预处理：本地 epub → 压缩封面 + 元数据 → 上传到 Cloudflare KV（经 /api/covers/bulk）。

背景：书库 600+ 本、2GB+，靠「逐本下载再解析」补全要拉几个 GB。WebDAV 上的书与本地 release-ready 目录里
同名文件内容相同，所以直接在本地解析，只把 ~3-6KB 的封面与元数据送上云；之后匹配不上的书由应用在用户
点开（下载）后自动解析并补传。

用法：
  uv run --no-sync --with pillow python scripts/covers_prepare.py --epubs "<epub 目录>" --out .tmp/covers
      只生成本地 bundle（不联网）
  ... --upload
      同时直写 Cloudflare KV（REST API）。token 取环境变量 CLOUDFLARE_API_TOKEN 或 cloudflare-cli skill 的 .env，
      需 Workers KV Storage 编辑权限；账户自动发现，命名空间读 wrangler.toml；已存在的封面不会覆盖

book_id 与 src/services/library/bookId.ts 逐字节等价（契约：tests/fixtures/book-id-cases.json）。
只用标准库解析 epub（zip + OPF），不依赖 ebooklib；压缩封面才需要 Pillow。
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import posixpath
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))
import covers_d1  # noqa: E402  与 functions/_lib/coversStore.js 同口径的 D1 存取

OFFSET = 0xCBF29CE484222325
PRIME = 0x100000001B3
MASK = 0xFFFFFFFFFFFFFFFF
B36 = "0123456789abcdefghijklmnopqrstuvwxyz"

COVER_W, COVER_H = 120, 160
MAX_BYTES = 12 * 1024  # 远低于服务端 48KB 上限：目标是「非常小但可用」


def book_stem(path_or_name: str) -> str:
    base = re.split(r"[\\/]", path_or_name)[-1]
    return re.sub(r"\.[A-Za-z0-9]{1,5}$", "", base)


def normalize_stem(stem: str) -> str:
    s = unicodedata.normalize("NFKC", stem).lower()
    return "".join(ch for ch in s if unicodedata.category(ch)[0] not in "PSZC")


def _b36(n: int) -> str:
    if n == 0:
        return "0"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = B36[r] + out
    return out


def book_id(path_or_name: str) -> str:
    h = OFFSET
    for byte in normalize_stem(book_stem(path_or_name)).encode("utf-8"):
        h = ((h ^ byte) * PRIME) & MASK
    return "bk_" + _b36(h)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def read_epub(path: Path) -> dict:
    """只读 OPF 与封面图（不展开整本）：标题、作者、封面字节、章节数（spine 项数，近似）"""
    out: dict = {"title": "", "author": "", "cover": None, "chapterCount": None, "subjects": [], "description": "", "publisher": "", "date": "", "lang": ""}
    with zipfile.ZipFile(path) as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        opf = next((el.attrib.get("full-path") for el in container.iter() if _local(el.tag) == "rootfile"), None)
        if not opf:
            return out
        root = ET.fromstring(z.read(opf))
        manifest: dict[str, dict] = {}
        spine = 0
        cover_id = None
        for el in root.iter():
            name = _local(el.tag)
            if name == "title" and not out["title"]:
                out["title"] = (el.text or "").strip()
            elif name == "creator" and not out["author"]:
                out["author"] = (el.text or "").strip()
            elif name == "subject" and (el.text or "").strip():
                out["subjects"].append(el.text.strip())
            elif name in ("description", "publisher", "date", "language") and not out["lang" if name == "language" else name]:
                out["lang" if name == "language" else name] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", "".join(el.itertext()))).strip()
            elif name == "item":
                manifest[el.attrib.get("id", "")] = el.attrib
            elif name == "itemref":
                spine += 1
            elif name == "meta" and el.attrib.get("name") == "cover":
                cover_id = el.attrib.get("content")
        out["chapterCount"] = spine or None
        href = manifest.get(cover_id or "", {}).get("href")
        if not href:  # EPUB3：properties="cover-image"
            href = next((a.get("href") for a in manifest.values() if "cover-image" in (a.get("properties") or "")), None)
        if not href:  # 兜底：manifest 里名字像封面的图片
            href = next(
                (a.get("href") for a in manifest.values() if (a.get("media-type") or "").startswith("image/") and re.search(r"cover", a.get("href", ""), re.I)),
                None,
            )
        if href:
            full = posixpath.normpath(posixpath.join(posixpath.dirname(opf), href))
            try:
                out["cover"] = z.read(full)
            except KeyError:
                pass
    return out


def compress_cover(raw: bytes) -> bytes | None:
    """缩到 120×160（居中裁到 3:4），webp 质量逐步降到 ≤12KB；仍超限返回 None（让界面回退生成式封面）"""
    from PIL import Image  # 延迟导入：只看元数据时不需要

    try:
        im = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:  # noqa: BLE001
        return None
    w, h = im.size
    target = COVER_W / COVER_H
    if w / h > target:  # 太宽：裁左右
        nw = int(h * target)
        left = (w - nw) // 2
        im = im.crop((left, 0, left + nw, h))
    else:  # 太高：裁上下（偏向保留顶部，封面标题多在上半部分）
        nh = int(w / target)
        top = int((h - nh) * 0.25)
        im = im.crop((0, top, w, top + nh))
    im = im.resize((COVER_W, COVER_H), Image.Resampling.LANCZOS)
    for q in (50, 40, 32, 25, 18):
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= MAX_BYTES:
            return buf.getvalue()
    return None


INDEX_KEY = "covers:index"  # 与 functions/_lib/covers.js 的键约定一致


def _clip(v, n: int) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def clean_meta(m: dict) -> dict:
    """与 functions/_lib/covers.js#cleanMeta 同口径：只留已知字段并限长"""
    out: dict = {"stem": _clip(m.get("stem"), 240), "title": _clip(m.get("title"), 240)}
    for k, n in (("author", 120), ("file", 240), ("desc", 400), ("publisher", 80), ("lang", 12)):
        if _clip(m.get(k), n):
            out[k] = _clip(m.get(k), n)
    for k in ("pages", "chapterCount"):
        try:
            n = int(m.get(k) or 0)
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            out[k] = min(n, 100000)
    try:
        size = int(float(m.get("size") or 0))
    except (TypeError, ValueError):
        size = 0
    if size > 0:
        out["size"] = min(size, 2**40)
    subjects = list(dict.fromkeys(s for s in (_clip(x, 40) for x in (m.get("subjects") if isinstance(m.get("subjects"), list) else []) if isinstance(x, str)) if s))[:8]
    if subjects:
        out["subjects"] = subjects
    year = m.get("year")
    if isinstance(year, int) and 1000 <= year <= 2200:
        out["year"] = year
    return out


def year_of(date: str) -> int | None:
    """EPUB dc:date 的年份（'2020-12-31' / '2015' / 'Nov 3, 2018' 都取第一个 4 位年）"""
    m = re.search(r"(1[0-9]{3}|2[01][0-9]{2})", date or "")
    return int(m.group(1)) if m else None


def build_kv_writes(items: list[dict], index: dict, overwrite: bool = False) -> tuple[list[dict], dict, dict]:
    """
    把 bundle 变成要写入 KV 的键值对，并合并进已有索引。
    已有封面不覆盖（重跑不白烧每日 1000 次的写入额度）；元数据总是合并。
    返回 (writes, new_index, tally)。
    """
    old = index or {}
    idx = {"rev": int(old.get("rev") or 0), "items": dict(old.get("items") or {})}
    writes: list[dict] = []
    tally = {"stored": 0, "exists": 0, "meta": 0}
    changed = False
    for it in items:
        bid, prev = it["id"], idx["items"].get(it["id"])
        has_cover = bool(prev and prev.get("cover"))
        status = "meta"
        if it.get("image"):
            if has_cover and not overwrite:
                status = "exists"
            else:
                writes.append({"key": f"cover:{bid}", "value": it["image"]})
                has_cover, status = True, "stored"
        nxt = {**(prev or {}), **clean_meta(it.get("meta") or {}), **({"cover": 1} if has_cover else {})}
        if nxt != prev:  # 与服务端 putItems 同语义：只有真实变化才更新 updatedAt
            idx["items"][bid] = {**nxt, "updatedAt": now_ms()}
            changed = True
        tally[status] += 1
    if changed or writes:
        idx["rev"] += 1  # ETag 版本号：每次写索引 +1
        writes.append({"key": INDEX_KEY, "value": json.dumps(idx, ensure_ascii=False)})
    return writes, idx, tally


def now_ms() -> int:
    import time

    return int(time.time() * 1000)


# ---- Cloudflare KV 直写（REST API）：不经应用登录，也不需要项目 .env 里的任何变量 ----
CF_API = "https://api.cloudflare.com/client/v4"
SKILL_ENV = Path.home() / ".agents/skills/cloudflare-cli/scripts/.env"


def _read_env_file(p: Path) -> dict:
    out: dict = {}
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def cf_token() -> str | None:
    import os

    return os.environ.get("CLOUDFLARE_API_TOKEN") or _read_env_file(SKILL_ENV).get("CLOUDFLARE_API_TOKEN")


def kv_namespace_id(toml_path: Path = Path("wrangler.toml")) -> str | None:
    m = re.search(r'binding\s*=\s*"FASTREADER_KV"\s*,\s*id\s*=\s*"([0-9a-f]{32})"', toml_path.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def cf_call(token: str, method: str, path: str, body: bytes | None = None, ctype: str = "application/json"):
    req = urllib.request.Request(CF_API + path, data=body, method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    return json.loads(raw) if raw[:1] in (b"{", b"[") else raw.decode("utf-8")


def kv_upload(items: list[dict], batch: int = 100, overwrite: bool = False) -> dict:
    token, ns = cf_token(), kv_namespace_id()
    if not token or not ns:
        raise RuntimeError("缺少 Cloudflare token（CLOUDFLARE_API_TOKEN，或 cloudflare-cli skill 的 .env）或 wrangler.toml 里的 KV id")
    accounts = cf_call(token, "GET", "/accounts")["result"]
    if len(accounts) != 1:
        raise RuntimeError(f"期望恰好 1 个 Cloudflare 账户，实际 {len(accounts)}；请设置只含一个账户的 token")
    acct = accounts[0]["id"]
    base = f"/accounts/{acct}/storage/kv/namespaces/{ns}"
    d1_id = covers_d1.d1_database_id()
    d1_base = f"/accounts/{acct}/d1/database/{d1_id}" if d1_id else None
    d1_call = lambda method, path, body=None: cf_call(token, method, path, body)  # noqa: E731
    if d1_base:  # 声明了 D1：索引以 D1 为准（应用只读写 D1；这里再写 KV 索引没人读）
        index = covers_d1.read_index(d1_call, d1_base)
    else:
        try:  # 读现有索引（不存在 = 空）
            cur = cf_call(token, "GET", f"{base}/values/{urllib.parse.quote(INDEX_KEY, safe='')}")
            index = cur if isinstance(cur, dict) else json.loads(cur)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            index = {"items": {}}
    writes, new_index, tally = build_kv_writes(items, index, overwrite)
    if d1_base:
        writes = [w for w in writes if w["key"] != INDEX_KEY]  # 封面仍写 KV，索引改写 D1
    for i in range(0, len(writes), batch):  # 索引是最后一条：封面都写成功后才更新索引，中途失败不会留下指向空封面的条目
        cf_call(token, "PUT", f"{base}/bulk", json.dumps(writes[i : i + batch]).encode("utf-8"))
        print(f"  已写入 {min(i + batch, len(writes))}/{len(writes)}")
    if d1_base:
        print(f"  索引写入 D1：{covers_d1.write_diff(d1_call, d1_base, index['items'], new_index)} 条变化")
    return tally


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epubs", required=True)
    ap.add_argument("--out", default=".tmp/covers")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--upload", action="store_true")
    ap.add_argument("--batch", type=int, default=100, help="每次 KV bulk 请求写多少个键")
    ap.add_argument("--overwrite", action="store_true", help="覆盖云端已有封面（会消耗每日 1000 次写入额度）")
    args = ap.parse_args()

    files = sorted(Path(args.epubs).glob("*.epub"))
    if args.limit:
        files = files[: args.limit]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    items: list[dict] = []
    stats = {"books": len(files), "with_cover": 0, "no_cover": 0, "failed": 0, "bytes": 0}
    seen: dict[str, str] = {}
    for f in files:
        bid = book_id(f.name)
        if bid in seen:
            print(f"! id 冲突：{f.name} 与 {seen[bid]}")
        seen[bid] = f.name
        try:
            info = read_epub(f)
        except Exception as e:  # noqa: BLE001
            stats["failed"] += 1
            print(f"x {f.name}: {e}")
            continue
        img = compress_cover(info["cover"]) if info["cover"] else None
        meta = {
            "stem": book_stem(f.name),
            "title": info["title"] or book_stem(f.name),
            "author": info["author"],
            "chapterCount": info["chapterCount"],
            "file": f.name,
            "size": f.stat().st_size,
            "subjects": info["subjects"],
            "desc": info["description"],
            "publisher": info["publisher"],
            "year": year_of(info["date"]),
            "lang": info["lang"],
        }
        item: dict = {"id": bid, "meta": meta}
        if img:
            item["image"] = base64.b64encode(img).decode("ascii")
            stats["with_cover"] += 1
            stats["bytes"] += len(img)
            (out / f"{bid}.webp").write_bytes(img)
        else:
            stats["no_cover"] += 1
        items.append(item)
    (out / "bundle.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False))
    if stats["with_cover"]:
        print(f"平均封面 {stats['bytes'] // stats['with_cover']} 字节")

    if args.upload:
        try:
            print("上传结果", kv_upload(items, args.batch, args.overwrite))
        except Exception as e:  # noqa: BLE001
            print(f"上传失败：{e}；bundle 在 {out}")
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
