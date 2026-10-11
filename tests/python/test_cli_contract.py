"""
CLI ↔ 前端产物契约测试

- 文件名 sanitize 对齐 cloudCacheService.sanitizeFileName
- Markdown 产物与 tests/fixtures/contract/unified-summary.sample.md 完全一致
- 用前端 parseUnifiedMarkdown 的正则（Python 移植）解析 CLI 产物，章节/元数据不被污染
"""

import re
from pathlib import Path

import pytest

from src.cli.formatter import (
    build_metadata,
    format_metadata_comment,
    format_unified_markdown,
    js_iso_now,
    js_number,
)
from src.cli.models import BookFile, sanitize_file_name
from datetime import datetime

SAMPLE = Path(__file__).resolve().parents[1] / "fixtures" / "contract" / "unified-summary.sample.md"


def load_sample() -> str:
    text = SAMPLE.read_text(encoding="utf-8")
    # 第 1 行为用途说明注释，不属于 formatUnifiedMarkdown 输出
    return text.split("\n", 1)[1]


# ---- 前端 metadataFormatter.parseUnifiedMarkdown 的 Python 移植（只用于断言）----

def fe_parse_metadata(content: str) -> dict:
    m = re.search(r"<!--\s*\n([\s\S]*?)\n-->", content)
    meta = {}
    if m:
        for line in m.group(1).split("\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                meta[key.strip()] = value.strip()
    return meta


def fe_parse(content: str) -> dict:
    clean = re.sub(r"<!--\s*\n[\s\S]*?\n-->\n*", "", content, count=1)
    stop = r"\n##[ \t]+(?:全书总结|章节关联分析|关键图表|章节摘要)(?:\s|$)"
    data = {"title": re.search(r"^#\s+(.+)$", clean, re.M).group(1).strip()}
    author = re.search(r"\*\*作者\*\*:\s*(.+)$", clean, re.M)
    data["author"] = author.group(1).strip() if author else ""
    for key, name in (("overall", "全书总结"), ("connections", "章节关联分析")):
        m = re.search(rf"##[ \t]+{name}\s*\n+([\s\S]*?)(?={stop}|$(?![\s\S]))", clean)
        data[key] = m.group(1).strip() if m else None
    chapters = []
    section = re.search(r"##\s+章节摘要\n\n([\s\S]*$)", clean)
    if section:
        # JS 无 m 标志时 $ 只匹配串尾，Python 用 \Z
        for m in re.finditer(r"###\s+(.+?)\n\n([\s\S]*?)(?=\n###|\n##|\n#|\Z)", section.group(1)):
            chapters.append((m.group(1).strip(), m.group(2).strip()))
    data["chapters"] = chapters
    return data


def sample_inputs():
    chapters = [
        ("第一章 起点", "主人公在小镇上做出离开的决定。\n\n本章交代了人物动机与时代背景。"),
        ("第二章 远方", "主人公抵达海边城市，重新理解了故乡。"),
    ]
    overall = "本书以两段旅程为线索，讨论了出发的勇气与抵达的意义。\n\n全书结构清晰，适合初次接触该主题的读者。"
    connections = "第一章提出问题，第二章给出回应；两章在「选择」这一主题上前后呼应。"
    metadata = build_metadata(
        file_name="示例之书.epub", model="gemini-1.5-flash", chapter_detection_mode="normal",
        selected_chapters=[1, 2], chapter_count=2, original_char_count=12000,
        processed_char_count=156, input_tokens=10000, output_tokens=2000,
        cost_usd=0.003, cost_cny=0.021, skipped_chapters=0, is_partial=False,
        processed_at="2026-10-11T08:00:00.000Z",
    )
    return chapters, overall, connections, metadata


class TestSanitizeFileName:
    @pytest.mark.parametrize("name,expected", [
        ("Book.EPUB", "Book"),                       # 大小写无关
        ("Python.pdf 指南.pdf", "Python.pdf 指南"),   # 只去最后一个扩展名
        ("a.b.c.epub", "a.b.c"),
        ("无扩展名", "无扩展名"),
        ('坏:名*字?<>|"\\.epub', "坏名字"),          # Windows 非法字符
        ("  多   空格\t书名 .pdf", "多 空格 书名"),
        ("书\ufeff名.epub", "书 名"),                 # JS \s 含 BOM
        (".hidden", ""),
    ])
    def test_matches_frontend(self, name, expected):
        assert sanitize_file_name(name) == expected

    def test_book_file_cache_name(self):
        book = BookFile(name="Python.pdf 指南.pdf", path="/b/x", extension=".pdf", size=1,
                        last_modified=datetime(2024, 1, 1))
        assert book.sanitized_name == "Python.pdf 指南"
        assert book.cache_file_name == "Python.pdf 指南-完整摘要.md"


class TestUnifiedMarkdownContract:
    def test_output_equals_sample(self):
        chapters, overall, connections, metadata = sample_inputs()
        out = format_unified_markdown("示例之书", "张三", chapters, overall, connections, metadata, 7.0)
        assert out == load_sample()

    def test_structure_matches_sample(self):
        """结构断言（样例被前端复用时，即使文案变化也应保持这些不变量）"""
        sample = load_sample()
        chapters, overall, connections, metadata = sample_inputs()
        out = format_unified_markdown("示例之书", "张三", chapters, overall, connections, metadata, 7.0)

        assert list(fe_parse_metadata(out).keys()) == list(fe_parse_metadata(sample).keys())

        def headings(text):
            return re.findall(r"^(#{1,3}) (.+)$", text, re.M)

        assert headings(out) == headings(sample)
        assert [h for lvl, h in headings(out) if lvl == "##"] == ["全书总结", "章节关联分析", "章节摘要"]

    def test_frontend_parser_round_trip(self):
        chapters, overall, connections, metadata = sample_inputs()
        out = format_unified_markdown("示例之书", "张三", chapters, overall, connections, metadata, 7.0)
        parsed = fe_parse(out)
        assert parsed["title"] == "示例之书"
        assert parsed["author"] == "张三"
        assert parsed["overall"] == overall
        assert parsed["connections"] == connections
        # 最后一章不被尾部内容污染（CLI 不再追加时间戳行）
        assert parsed["chapters"] == chapters
        meta = fe_parse_metadata(out)
        assert meta["isPartial"] == "false"
        assert meta["costRMB"] == "0.021 (USD/CNY: 7)"
        assert meta["epubTocDepth"] == "N/A"

    def test_chapter_title_fallback_and_empty_summary(self):
        out = format_unified_markdown("书", "", [("", ""), ("真标题", "x")])
        assert "### 第1章\n\n（暂无总结）" in out
        assert "### 真标题" in out
        assert "**作者**" not in out
        assert "<!--" not in out

    def test_failed_chapter_and_partial_metadata(self):
        meta = build_metadata(
            file_name="a.epub", model="m", chapter_detection_mode="epub-toc", epub_toc_depth=2,
            selected_chapters=[1, 2, 3], chapter_count=3, original_char_count=1, processed_char_count=1,
            input_tokens=1, output_tokens=1, cost_usd=0.0, cost_cny=0.0, skipped_chapters=1, is_partial=True,
        )
        comment = format_metadata_comment(meta, 7.25)
        assert "isPartial: true" in comment
        assert "epubTocDepth: 2" in comment
        assert "selectedChapterCount: 3" in comment
        assert "costUSD: 0\n" in comment
        assert "(USD/CNY: 7.25)" in comment
        assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", meta["processedAt"])


class TestJsNumber:
    @pytest.mark.parametrize("value,expected", [
        (7.0, "7"), (0.00001, "0.00001"), (0.021, "0.021"), (3, "3"), (0.0, "0"), (True, "true"),
    ])
    def test_js_like(self, value, expected):
        assert js_number(value) == expected

    def test_iso_now(self):
        assert js_iso_now().endswith("Z")
