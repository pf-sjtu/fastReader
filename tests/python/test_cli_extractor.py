"""
章节提取器测试：用代码生成的小 EPUB / PDF，覆盖 spine 顺序、epub-toc、跳过词表、PDF 正文拼接
"""

import pytest
from ebooklib import epub

from conftest import build_epub, build_pdf, long_body
from src.cli.chapter_extractor import (
    ChapterExtractorFactory,
    EPUBExtractor,
    PDFExtractor,
    matches_skip_title,
)


class TestSkipTitle:
    @pytest.mark.parametrize("title", [
        "About the Author", "Copyright © 2024", "Acknowledgments", "Contents",
        "Table of Contents", "Notes", "Appendix A", "致谢", "版权页", "目录",
        "  1. Index", "Preface",
    ])
    def test_skip_hits(self, title):
        assert matches_skip_title(title) is True

    @pytest.mark.parametrize("title", [
        "Authority and Power",      # 不再因 author 子串误杀
        "The Abouts of Life",       # about 非前缀
        "Black Hack",               # ack 子串
        "Indexing the World",       # index 需整词
        "第一章 版权之争",           # 中文按前缀匹配
        "Chapter 1",
        "",
    ])
    def test_skip_misses(self, title):
        assert matches_skip_title(title) is False


class TestEPUBExtractor:
    def test_spine_order_not_manifest_order(self, tmp_path):
        path = build_epub(
            tmp_path / "book.epub",
            [("第一章 出发", long_body("一")), ("第二章 抵达", long_body("二")), ("第三章 回望", long_body("三"))],
            manifest_reversed=True,
        )
        book = ChapterExtractorFactory.extract(path)
        assert book.file_type == "epub"
        assert book.title == "测试之书"
        assert book.author == "作者甲"
        assert [c.title for c in book.chapters] == ["第一章 出发", "第二章 抵达", "第三章 回望"]
        assert [c.index for c in book.chapters] == [0, 1, 2]
        assert "一：这是一段" in book.chapters[0].content
        assert "<p>" not in book.chapters[0].content

    def test_skips_non_essential_and_short(self, tmp_path):
        path = build_epub(
            tmp_path / "book.epub",
            [("致谢", long_body("谢")), ("Authority and Power", long_body("权")), ("短章", "<p>太短</p>")],
        )
        titles = [c.title for c in ChapterExtractorFactory.extract(path).chapters]
        assert titles == ["Authority and Power"]

    def test_epub_toc_aggregates_spine_range(self, tmp_path):
        """epub-toc：目录只列 1、3 两项时，第 2 个文档并入第 1 章"""
        def toc(items):
            return [epub.Link(items[0].file_name, "上篇", "a"), epub.Link(items[2].file_name, "下篇", "b")]

        path = build_epub(
            tmp_path / "book.epub",
            [("甲", long_body("甲")), ("乙", long_body("乙")), ("丙", long_body("丙"))],
            toc=toc,
        )
        extractor = ChapterExtractorFactory.create(path, "epub-toc", 1)
        book = extractor.extract(path)
        assert [c.title for c in book.chapters] == ["上篇", "下篇"]
        assert "甲：" in book.chapters[0].content and "乙：" in book.chapters[0].content
        assert "丙：" in book.chapters[1].content
        assert extractor.warnings == []

    def test_epub_toc_nested_depth(self, tmp_path):
        def toc(items):
            return [(epub.Section("第一部", items[0].file_name),
                     [epub.Link(items[0].file_name, "1.1", "a"), epub.Link(items[1].file_name, "1.2", "b")])]

        path = build_epub(tmp_path / "book.epub", [("甲", long_body("甲")), ("乙", long_body("乙"))], toc=toc)
        depth2 = ChapterExtractorFactory.extract(path, "epub-toc", 2)
        assert [c.title for c in depth2.chapters] == ["1.1", "1.2"]
        depth1 = ChapterExtractorFactory.extract(path, "epub-toc", 1)
        assert [c.title for c in depth1.chapters] == ["第一部"]

    def test_epub_toc_falls_back_with_warning(self, tmp_path):
        path = build_epub(tmp_path / "book.epub", [("甲", long_body("甲"))], toc=lambda items: [])
        extractor = EPUBExtractor("epub-toc")
        book = extractor.extract(path)
        assert [c.title for c in book.chapters] == ["甲"]
        assert any("回退" in w for w in extractor.warnings)

    def test_invalid_epub_raises(self, tmp_path):
        bad = tmp_path / "bad.epub"
        bad.write_bytes(b"not a zip")
        with pytest.raises(Exception, match="EPUB 解析失败"):
            ChapterExtractorFactory.extract(str(bad))


class TestPDFExtractor:
    BODY = ["This is body text line number %d with enough characters to count." % i for i in range(6)]

    def test_chapter_text_is_included(self, tmp_path):
        """修复：切分后的 chunk 必须包含正文，而不只是 [Page N] 标记"""
        path = build_pdf(tmp_path / "book.pdf", [
            ["Chapter 1", *self.BODY],
            ["Chapter 2", *self.BODY],
            ["continued page of chapter two", *self.BODY],
        ])
        book = ChapterExtractorFactory.extract(path)
        assert book.file_type == "pdf"
        assert len(book.chapters) == 2
        assert book.chapters[0].title.startswith("Chapter 1")
        assert "body text line number 0" in book.chapters[0].content
        assert "continued page of chapter two" in book.chapters[1].content
        assert "continued page" not in book.chapters[0].content
        assert "[Page" not in book.chapters[1].content

    def test_no_markers_whole_book(self, tmp_path):
        path = build_pdf(tmp_path / "book.pdf", [["plain"], ["text only"]])
        book = PDFExtractor().extract(path)
        assert [c.title for c in book.chapters] == ["全文"]

    def test_epub_toc_on_pdf_warns(self, tmp_path):
        path = build_pdf(tmp_path / "book.pdf", [["Chapter 1", *self.BODY]])
        extractor = ChapterExtractorFactory.create(path, "epub-toc")
        extractor.extract(path)
        assert any("epub-toc" in w for w in extractor.warnings)

    def test_unsupported_extension(self):
        with pytest.raises(ValueError):
            ChapterExtractorFactory.create("book.mobi")
