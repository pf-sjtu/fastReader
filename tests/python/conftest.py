"""
pytest 公共配置

1. 把仓库根钉在 sys.path[0]：本机全局 PYTHONPATH / 其他项目的同名 `src` 包不得劫持导入
2. 重试等待一律不真睡（autouse），避免 5xx/网络错误用例拖慢测试
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if sys.path[0] != str(REPO_ROOT):
    sys.path.insert(0, str(REPO_ROOT))

# 若已有别处的 src 被提前导入，清掉以便重新解析到本仓库
_src = sys.modules.get("src")
if _src is not None and not str(getattr(_src, "__file__", "") or "").startswith(str(REPO_ROOT)):
    for _name in [n for n in sys.modules if n == "src" or n.startswith("src.")]:
        del sys.modules[_name]


@pytest.fixture(autouse=True)
def _no_real_sleep(monkeypatch):
    """重试 helper 内部的 time.sleep 置空；需要断言等待时长的用例显式传入 sleep"""
    import src.cli.retry as retry_mod
    monkeypatch.setattr(retry_mod.time, "sleep", lambda _s: None)
    yield


# ---- 代码生成的小型电子书夹具（不依赖仓库外文件）----

def build_epub(path, chapters, title="测试之书", author="作者甲", manifest_reversed=False, toc=None):
    """chapters: [(标题, 正文 HTML)]；manifest_reversed=True 时清单顺序与 spine 相反"""
    from ebooklib import epub

    book = epub.EpubBook()
    book.set_identifier("fastreader-test")
    book.set_title(title)
    book.set_language("zh")
    book.add_author(author)

    items = []
    for i, (chapter_title, body) in enumerate(chapters):
        item = epub.EpubHtml(title=chapter_title, file_name=f"chap_{i}.xhtml", lang="zh")
        item.content = f"<html><body><h1>{chapter_title}</h1>{body}</body></html>"
        items.append(item)
    for item in (reversed(items) if manifest_reversed else items):
        book.add_item(item)

    book.toc = toc(items) if toc else [
        epub.Link(item.file_name, chapter_title, f"c{i}")
        for i, (item, (chapter_title, _)) in enumerate(zip(items, chapters))
    ]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav"] + items
    epub.write_epub(str(path), book)
    return str(path)


def build_pdf(path, pages):
    """pages: [[行文本, ...], ...]；仅 ASCII（标准 Helvetica 字体）"""
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    font_ref = writer._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    }))
    for lines in pages:
        page = writer.add_blank_page(612, 792)
        ops = ["BT", "/F1 12 Tf", "14 TL", "72 740 Td"]
        for line in lines:
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"({escaped}) Tj T*")
        ops.append("ET")
        stream = DecodedStreamObject()
        stream.set_data("\n".join(ops).encode("latin-1"))
        page[NameObject("/Contents")] = writer._add_object(stream)
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref})
        })
    with open(path, "wb") as f:
        writer.write(f)
    return str(path)


def long_body(seed: str, paragraphs: int = 4) -> str:
    """生成足够长（>200 字节、>100 字）的正文 HTML"""
    para = f"{seed}：这是一段用于测试的正文内容，讲述了人物的经历与思考，并包含足够的字数。"
    return "".join(f"<p>{para}{i}</p>" for i in range(paragraphs))
