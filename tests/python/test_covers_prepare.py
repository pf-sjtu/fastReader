"""封面预处理脚本：book_id 与前端 bookId.ts 逐字节等价（共用 tests/fixtures/book-id-cases.json）；epub 解析与封面压缩"""
import importlib.util
import io
import json
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("covers_prepare", ROOT / "scripts" / "covers_prepare.py")
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)

CASES = json.loads((ROOT / "tests" / "fixtures" / "book-id-cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"][:20] or "empty")
def test_book_id_matches_frontend_fixture(case):
    assert cp.book_id(case["name"]) == case["id"]
    assert cp.normalize_stem(cp.book_stem(case["name"])) == case["normalized"]


def test_same_book_different_punctuation_width_extension_same_id():
    a = cp.book_id("“错误”的行为：行为经济学的形成 - 理查德·塞勒.epub")
    b = cp.book_id('"错误"的行为:行为经济学的形成 - 理查德・塞勒.pdf')
    assert a == b
    assert a != cp.book_id("另一本书.epub")


def _epub(with_cover: bool, cover_bytes: bytes = b"") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
        cover_meta = '<meta name="cover" content="cov"/>' if with_cover else ""
        cover_item = '<item id="cov" href="images/cover.jpg" media-type="image/jpeg"/>' if with_cover else ""
        z.writestr(
            "OEBPS/content.opf",
            '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>'
            f"<dc:title>测试书</dc:title><dc:creator>某作者</dc:creator>{cover_meta}</metadata>"
            f'<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>{cover_item}</manifest>'
            '<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
        )
        if with_cover:
            z.writestr("OEBPS/images/cover.jpg", cover_bytes)
    return buf.getvalue()


def _png(w, h):
    pil = pytest.importorskip("PIL.Image")
    out = io.BytesIO()
    im = pil.new("RGB", (w, h), (200, 30, 30))
    for x in range(0, w, 7):  # 一点纹理，别让压缩器把它当纯色
        for y in range(0, h, 5):
            im.putpixel((x, y), (20, 20, 200))
    im.save(out, "PNG")
    return out.getvalue()


def test_read_epub_reads_title_author_spine_and_cover(tmp_path):
    f = tmp_path / "x.epub"
    f.write_bytes(_epub(True, b"IMG"))
    info = cp.read_epub(f)
    assert info["title"] == "测试书" and info["author"] == "某作者"
    assert info["chapterCount"] == 2
    assert info["cover"] == b"IMG"


def test_read_epub_without_cover(tmp_path):
    f = tmp_path / "y.epub"
    f.write_bytes(_epub(False))
    assert cp.read_epub(f)["cover"] is None


def test_compress_cover_is_small_fixed_size_webp_and_survives_bad_input():
    pil = pytest.importorskip("PIL.Image")
    out = cp.compress_cover(_png(1200, 1800))
    assert out is not None and len(out) <= cp.MAX_BYTES
    im = pil.open(io.BytesIO(out))
    assert im.format == "WEBP" and im.size == (cp.COVER_W, cp.COVER_H)
    wide = pil.open(io.BytesIO(cp.compress_cover(_png(2000, 800))))
    assert wide.size == (cp.COVER_W, cp.COVER_H)  # 横图也被裁成 3:4
    assert cp.compress_cover(b"not an image") is None
