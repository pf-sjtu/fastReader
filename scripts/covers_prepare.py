"""
书封面 / 元数据预处理：本地 epub → 压缩封面 + 元数据 → 上传到 Cloudflare KV（经 /api/covers/bulk）。

背景：书库 600+ 本、2GB+，靠「逐本下载再解析」补全要拉几个 GB。WebDAV 上的书与本地 release-ready 目录里
同名文件内容相同，所以直接在本地解析，只把 ~3-6KB 的封面与元数据送上云；之后匹配不上的书由应用在用户
点开（下载）后自动解析并补传。

用法：
  uv run --no-sync --with pillow python scripts/covers_prepare.py --epubs "<epub 目录>" --out .tmp/covers
      只生成本地 bundle（不联网）
  ... --upload
      同时上传（.env 里需要 FASTREADER_SERVER_URL 与 FASTREADER_APP_PASSWORD；已存在的封面不会覆盖）

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
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

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
    out: dict = {"title": "", "author": "", "cover": None, "chapterCount": None}
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


def post_bulk(server: str, cookie: str, items: list[dict]) -> list[dict]:
    req = urllib.request.Request(
        server.rstrip("/") + "/api/covers/bulk",
        data=json.dumps({"items": items}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Cookie": cookie},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))["results"]


def login(server: str, password: str) -> str:
    req = urllib.request.Request(
        server.rstrip("/") + "/api/auth/login",
        data=json.dumps({"password": password}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        cookies = r.headers.get_all("Set-Cookie") or []
    if not cookies:
        raise RuntimeError("登录失败：没有拿到会话 Cookie")
    return "; ".join(c.split(";", 1)[0] for c in cookies)


def read_env(path: str = ".env") -> dict:
    out: dict = {}
    p = Path(path)
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epubs", required=True)
    ap.add_argument("--out", default=".tmp/covers")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--upload", action="store_true")
    ap.add_argument("--batch", type=int, default=25)
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
        meta = {"stem": book_stem(f.name), "title": info["title"] or book_stem(f.name), "author": info["author"], "chapterCount": info["chapterCount"]}
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
        env = read_env()
        server = env.get("FASTREADER_SERVER_URL")
        pwd = env.get("FASTREADER_APP_PASSWORD")
        if not server or not pwd:
            print("缺少 FASTREADER_SERVER_URL / FASTREADER_APP_PASSWORD（.env），已跳过上传；bundle 在", out)
            return 2
        cookie = login(server, pwd)
        tally: dict = {}
        for i in range(0, len(items), args.batch):
            for r in post_bulk(server, cookie, items[i : i + args.batch]):
                tally[r["status"]] = tally.get(r["status"], 0) + 1
            print(f"  已上传 {min(i + args.batch, len(items))}/{len(items)}")
        print("上传结果", tally)
    return 0


if __name__ == "__main__":
    sys.exit(main())
