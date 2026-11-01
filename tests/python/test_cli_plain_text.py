"""CLI 纯文本（.txt / .md / .markdown）支持：切章与网页端 plainText.ts 共读三份契约夹具
（切章 / 字节解码 / 书名），外加读取、工厂分派与 WebDAV 扩展名的落地检查。

前端侧对应：tests/plainTextParity.test.ts、tests/plainText.test.ts
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.cli.chapter_extractor import (  # noqa: E402
    EPUBExtractor,
    PDFExtractor,
    ChapterExtractorFactory,
)
from src.cli.plain_text import (  # noqa: E402
    PLAIN_TEXT_EXTENSIONS,
    PlainTextExtractor,
    plain_book_title,
    read_plain_text,
    split_plain_text,
)
from src.cli.webdav_client import WebDAVClientWrapper  # noqa: E402

CASES = json.loads(
    (ROOT / "tests" / "fixtures" / "plain-text-cases.json").read_text(encoding="utf-8")
)
DECODE_CASES = json.loads(
    (ROOT / "tests" / "fixtures" / "plain-decode-cases.json").read_text(encoding="utf-8")
)
TITLE_CASES = json.loads(
    (ROOT / "tests" / "fixtures" / "plain-title-cases.json").read_text(encoding="utf-8")
)


def _dump(chapters) -> list[dict]:
    return [{"index": c.index, "title": c.title, "content": c.content} for c in chapters]


# ---- 共享夹具：与前端 plainText.ts 的 splitPlainText 逐字对齐 ----

@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_split_plain_text_matches_shared_fixture(case):
    assert _dump(split_plain_text(case["content"], case["fallbackTitle"])) == case["expected"]


def test_fixture_covers_required_edges():
    """夹具必须覆盖任务点名的边界，避免以后被删掉"""
    names = " ".join(c["name"] for c in CASES)
    for keyword in (
        "无标题",
        "一二级标题",
        "行尾的 #",
        "三级",
        "连续标题",
        "CRLF",
        "BOM",
        "空内容",
        "纯空白",
        "U+0085",
        "U+001C",
        "NBSP",
        "astral",
    ):
        assert keyword in names, f"夹具缺少覆盖：{keyword}"
    assert len(CASES) >= 18


# ---- 共享夹具：字节解码（与前端 decodePlainText 同一份字节判定）----

@pytest.mark.parametrize("case", DECODE_CASES, ids=[c["name"] for c in DECODE_CASES])
def test_read_plain_text_matches_shared_fixture(case):
    assert read_plain_text(bytes(case["bytes"])) == case["expected"]


# ---- 共享夹具：书名提取 ----

@pytest.mark.parametrize("case", TITLE_CASES, ids=[c["name"] for c in TITLE_CASES])
def test_plain_book_title_matches_shared_fixture(case):
    assert plain_book_title(case["input"]) == case["expected"]


# ---- 读取：解码与归一化 ----

def test_read_plain_text_strips_bom_and_normalizes_newlines():
    raw = "\ufeff第一行\r\n第二行\r第三行".encode("utf-8")
    assert read_plain_text(raw) == "第一行\n第二行\n第三行"


def test_read_plain_text_decodes_utf8_and_replaces_invalid_bytes():
    assert read_plain_text("中文正文".encode("utf-8")) == "中文正文"
    # 两条严格解码都失败时退回 UTF-8 的替换符结果（不抛异常），与浏览器 TextDecoder 一致
    # 注意用 \xff\xff 而不是 \xff\xfe：后者是 UTF-16LE 的 BOM，会按 UTF-16 解码
    assert read_plain_text(b"\xff\xff") == "\ufffd\ufffd"


def test_read_plain_text_keeps_valid_utf8_with_placeholder_chars():
    """合法 UTF-8 里的 U+FFFD 占位符必须原样保留——旧逻辑会按密度把它当编码坏了重解成乱码"""
    original = "\ufffd" * 10 + "中文正文"
    assert read_plain_text(original.encode("utf-8")) == original


def test_read_plain_text_falls_back_to_gb18030_for_gbk_txt():
    # 「中文。」的 GBK 字节不是合法 UTF-8，严格解码失败后才按 GB18030（GBK 超集）解
    assert read_plain_text(b"\xd6\xd0\xce\xc4\xa1\xa3") == "中文。"


def test_read_plain_text_honors_utf16_bom():
    assert read_plain_text("\ufeff第一行\n第二行".encode("utf-16-le")) == "第一行\n第二行"
    assert read_plain_text("\ufeff第一行\n第二行".encode("utf-16-be")) == "第一行\n第二行"


def test_read_plain_text_keeps_utf8_when_only_one_bad_byte():
    """0xFF 不是合法 GB18030 首字节：两条严格解码都失败，退回 UTF-8 替换，正文不被猜坏"""
    good = "这是一段足够长的中文正文，坏字节只应影响它自己。"
    text = read_plain_text(good.encode("utf-8") + b"\xff")
    assert text == good + "\ufffd"


def test_read_plain_text_only_strips_leading_bom():
    assert read_plain_text("正文\ufeff".encode("utf-8")) == "正文\ufeff"


# ---- 书名 ----

def test_plain_book_title():
    assert plain_book_title("决策思维.txt") == "决策思维"
    assert plain_book_title("/books/深奥的简洁.epub") == "深奥的简洁"
    assert plain_book_title("没有扩展名") == "没有扩展名"
    assert plain_book_title(".hidden") == ".hidden"


# ---- 工厂分派与端到端提取 ----

@pytest.mark.parametrize("name", ["笔记.txt", "笔记.TXT", "readme.md", "notes.markdown"])
def test_factory_dispatches_plain_text(name):
    assert isinstance(ChapterExtractorFactory.create(name), PlainTextExtractor)


def test_factory_keeps_epub_and_pdf_paths():
    assert isinstance(ChapterExtractorFactory.create("书.epub"), EPUBExtractor)
    assert isinstance(ChapterExtractorFactory.create("书.PDF"), PDFExtractor)


def test_factory_still_rejects_unknown_formats():
    with pytest.raises(ValueError, match="不支持的文件格式"):
        ChapterExtractorFactory.create("书.mobi")


def test_extract_markdown_file_end_to_end(tmp_path):
    md = tmp_path / "深奥的简洁.md"
    md.write_bytes("\ufeff导语。\r\n\r\n# 第一章\r\n正文一。\r\n\r\n## 第二节\r\n正文二。".encode("utf-8"))

    book = ChapterExtractorFactory.extract(str(md))

    assert book.title == "深奥的简洁"          # 书名来自文件名（无扩展名）
    assert book.file_type == "plain"
    assert book.author == "Unknown Author"
    assert _dump(book.chapters) == [
        {"index": 0, "title": "深奥的简洁", "content": "导语。"},
        {"index": 1, "title": "第一章", "content": "正文一。"},
        {"index": 2, "title": "第二节", "content": "正文二。"},
    ]


def test_extract_txt_file_is_single_chapter(tmp_path):
    txt = tmp_path / "一本纯文本.txt"
    txt.write_text("第一段。\n\n第二段。", encoding="utf-8")

    book = ChapterExtractorFactory.create(str(txt)).extract(str(txt))

    assert book.title == "一本纯文本"
    assert _dump(book.chapters) == [
        {"index": 0, "title": "一本纯文本", "content": "第一段。\n\n第二段。"},
    ]


def test_extract_warns_for_epub_toc_mode(tmp_path):
    txt = tmp_path / "a.txt"
    txt.write_text("# 一\n正文", encoding="utf-8")

    extractor = ChapterExtractorFactory.create(str(txt), detection_mode="epub-toc")
    extractor.extract(str(txt))

    assert any("epub-toc" in w for w in extractor.warnings)


# ---- WebDAV 扫描扩展名（对齐 src/services/webdav/browse.ts 的 SUPPORTED_EXTENSIONS）----

def test_webdav_supported_extensions_include_plain_text():
    assert WebDAVClientWrapper.SUPPORTED_EXTENSIONS == {".epub", ".pdf", ".txt", ".md", ".markdown"}
    assert PLAIN_TEXT_EXTENSIONS == (".txt", ".md", ".markdown")
