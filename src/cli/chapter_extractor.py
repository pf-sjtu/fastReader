"""
章节提取器
负责从 EPUB 和 PDF 文件中提取章节内容

章节识别模式（与前端同名，CLI 支持其中两种，其余在启动校验时报错）：
- normal：EPUB 按 spine 阅读顺序逐文档；PDF 按「第X章 / Chapter N」标记切分
- epub-toc：EPUB 按目录（TOC）指定层级切分，相邻目录项之间的 spine 文档聚合为一章；
  PDF 无目录概念，按 normal 处理并给出提示
"""

import re
import unicodedata
from abc import ABC, abstractmethod
from dataclasses import dataclass
from ebooklib import epub
import ebooklib
from pypdf import PdfReader


# 与前端 src/services/constants.ts SKIP_CHAPTER_KEYWORDS 保持一致
# （跨端用例 tests/fixtures/chapter-skip-cases.json）
SKIP_CHAPTER_KEYWORDS = [
    # 英文
    'acknowledgments', 'acknowledgements', 'ack', 'acknowledgement', 'thanks', 'gratitude',
    'recommended reading', 'further reading', 'bibliography', 'references',
    'about the author', 'about author', 'author bio', 'biography',
    'praise for', 'reviews', 'testimonials', 'endorsements',
    'title page', 'copyright', 'dedication', 'contents', 'table of contents',
    'index', 'glossary', 'appendix', 'appendices',
    'notes', 'endnotes', 'footnotes',
    'illustration credits', 'image credits', 'other titles', 'epigraph',
    'about the book', 'also by', 'about the cover illustration',
    'colophon', 'cast of characters', 'list of characters',
    'preface', 'afterword', 'foreword',
    '序言', '前言', '后记',
    # 中文
    '作者简介', '译者简介', '作者／译者', '作者/译者', '关于作者', '关于译者',
    '人物表', '登场人物', '角色表',
    '致谢', '感谢',
    '图片来源', '插图来源', '图片说明',
    '版权', '版权页',
    '封面', '书名页', '目录',
    '献词', '献辞',
    '索引', '附录', '参考文献', '参考书目', '推荐阅读',
    '出版信息', '版本记录',
]


def _strip_leading_noise(text: str) -> str:
    """剥掉标题前导的编号/标点/空白（如 "1. "、"§"、"— "）；与前端 LEADING_NOISE 正则等价（非字母、非组合符号）"""
    i = 0
    while i < len(text) and not (text[i].isalpha() or unicodedata.category(text[i]).startswith('M')):
        i += 1
    return text[i:]


def matches_skip_title(title: str) -> bool:
    """标题是否命中跳过词表。

    与前端 matchesKeywords 一致，按「标题前缀 + 整词」匹配：
    'About the Author' / 'Copyright ©' / '致谢' 命中；
    'Authority and Power' / 'The Abouts' / 'Black Hack' 不会因 author/about/ack 子串被误杀。
    """
    if not title:
        return False
    normalized = _strip_leading_noise(title.strip().lower())
    for keyword in SKIP_CHAPTER_KEYWORDS:
        k = keyword.lower()
        if not normalized.startswith(k):
            continue
        rest = normalized[len(k):]
        # 英文关键词需整词：后一个字符不能是字母/数字
        if k[-1].isascii() and rest and rest[0].isalnum():
            continue
        return True
    return False


@dataclass
class Chapter:
    """章节信息"""
    title: str
    content: str
    index: int


@dataclass
class BookContent:
    """书籍内容"""
    title: str
    author: str
    chapters: list[Chapter]
    file_path: str
    file_type: str  # 'epub' or 'pdf'


class ChapterExtractor(ABC):
    """章节提取器基类"""

    def __init__(self, detection_mode: str = 'normal', toc_depth: int = 1):
        self.detection_mode = detection_mode
        self.toc_depth = max(1, toc_depth)
        self.warnings: list[str] = []

    @abstractmethod
    def extract(self, file_path: str) -> BookContent:
        """提取章节内容"""
        pass


def _html_to_text(content: bytes) -> str:
    """HTML → 纯文本（保留段落换行）"""
    try:
        html_content = content.decode('utf-8', errors='ignore')
        html_content = re.sub(r'<(script|style)[^>]*>[\s\S]*?</\1>', '', html_content, flags=re.IGNORECASE)
        html_content = re.sub(r'<head[^>]*>[\s\S]*?</head>', '', html_content, flags=re.IGNORECASE)

        text = re.sub(r'<br\s*/?>', '\n', html_content, flags=re.IGNORECASE)
        text = re.sub(r'</p>', '\n\n', text, flags=re.IGNORECASE)
        text = re.sub(r'</div>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'</h[1-6]>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', '', text)

        for entity, char in (('&nbsp;', ' '), ('&lt;', '<'), ('&gt;', '>'), ('&quot;', '"'), ('&amp;', '&')):
            text = text.replace(entity, char)

        lines = [line.strip() for line in text.split('\n')]
        return '\n'.join(line for line in lines if line)
    except Exception:
        return ""


def _extract_html_title(content: bytes) -> str:
    """从章节 HTML 提取标题"""
    try:
        html_content = content.decode('utf-8', errors='ignore')
        patterns = [
            r'<h[1-6][^>]*>(.*?)</h[1-6]>',
            r'<title>([^<]+)</title>',
            r'<p[^>]*class="title"[^>]*>([^<]+)</p>',
        ]
        for pattern in patterns:
            match = re.search(pattern, html_content, re.IGNORECASE | re.DOTALL)
            if match:
                title = re.sub(r'<[^>]+>', '', match.group(1)).strip()
                if title:
                    return title
        for p in re.findall(r'<p[^>]*>([^<]+)</p>', html_content):
            if len(p.strip()) > 10:
                return p.strip()[:100]
    except Exception:
        pass
    return ""


class EPUBExtractor(ChapterExtractor):
    """EPUB 章节提取器"""

    # 原始 HTML 小于该字节数视为空页
    MIN_RAW_BYTES = 200
    # 清洗后正文小于该字数不收录
    MIN_TEXT_CHARS = 100

    def extract(self, file_path: str) -> BookContent:
        """从 EPUB 文件提取章节"""
        try:
            book = epub.read_epub(file_path)
            title = self._get_metadata(book, 'title', 'Unknown Title')
            author = self._get_metadata(book, 'creator', 'Unknown Author')

            spine_docs = self._spine_documents(book)
            chapters: list[Chapter] = []
            if self.detection_mode == 'epub-toc':
                chapters = self._chapters_from_toc(book, spine_docs)
                if not chapters:
                    self.warnings.append("EPUB 目录为空或无法对应正文，已回退为 normal 模式")
            if not chapters:
                chapters = self._chapters_from_spine(spine_docs)

            return BookContent(
                title=title, author=author, chapters=chapters,
                file_path=file_path, file_type='epub',
            )
        except Exception as e:
            raise Exception(f"EPUB 解析失败: {e}")

    def _get_metadata(self, book, key: str, default: str) -> str:
        meta = book.get_metadata('DC', key)
        if meta and meta[0][0]:
            return meta[0][0]
        return default

    def _spine_documents(self, book) -> list:
        """按 spine 阅读顺序返回正文文档（而非 manifest 清单顺序）"""
        docs = []
        for entry in book.spine:
            idref = entry[0] if isinstance(entry, (tuple, list)) else entry
            item = book.get_item_with_id(idref)
            if item is not None and item.get_type() == ebooklib.ITEM_DOCUMENT:
                docs.append(item)
        return docs

    def _make_chapters(self, candidates: list[tuple[str, bytes]]) -> list[Chapter]:
        chapters = []
        for title, raw in candidates:
            if matches_skip_title(title) or len(raw) < self.MIN_RAW_BYTES:
                continue
            content = _html_to_text(raw)
            if len(content) > self.MIN_TEXT_CHARS:
                chapters.append(Chapter(
                    title=title or f"Chapter {len(chapters) + 1}",
                    content=content,
                    index=len(chapters),
                ))
        return chapters

    def _chapters_from_spine(self, spine_docs: list) -> list[Chapter]:
        candidates = []
        for item in spine_docs:
            raw = item.get_content()
            candidates.append((_extract_html_title(raw), raw))
        return self._make_chapters(candidates)

    def _flatten_toc(self, entries, depth: int = 1) -> list[tuple[int, str, str]]:
        """展开 TOC 为 (depth, title, href)"""
        flat = []
        for entry in entries:
            if isinstance(entry, (tuple, list)) and len(entry) == 2:
                section, children = entry
                href = getattr(section, 'href', '') or ''
                if href:
                    flat.append((depth, getattr(section, 'title', '') or '', href))
                flat.extend(self._flatten_toc(children, depth + 1))
            elif hasattr(entry, 'href'):
                flat.append((depth, entry.title or '', entry.href))
        return flat

    def _chapters_from_toc(self, book, spine_docs: list) -> list[Chapter]:
        flat = self._flatten_toc(book.toc)
        targets = [e for e in flat if e[0] == self.toc_depth] or flat
        name_to_pos = {item.get_name(): i for i, item in enumerate(spine_docs)}

        # 目录项 → spine 起始位置（同一文档内的锚点项只保留第一个）
        starts: list[tuple[str, int]] = []
        for _, title, href in targets:
            pos = name_to_pos.get(href.split('#', 1)[0])
            if pos is None or any(p == pos for _, p in starts):
                continue
            starts.append((title, pos))
        starts.sort(key=lambda x: x[1])

        candidates = []
        for i, (title, pos) in enumerate(starts):
            end = starts[i + 1][1] if i + 1 < len(starts) else len(spine_docs)
            raw = b'\n'.join(spine_docs[j].get_content() for j in range(pos, end))
            candidates.append((title, raw))
        return self._make_chapters(candidates)


class PDFExtractor(ChapterExtractor):
    """PDF 章节提取器"""

    CHAPTER_PATTERNS = [
        r'(?:^|\n)\s*(?:第[一二三四五六七八九十百零\d]+章|Chapter\s+\d+)\s*(?:[\n:：]|$)',
        r'(?:^|\n)\s*\d+\s*\n(?:第[一二三四五六七八九十百零\d]+章|Chapter\s+\d+)',
    ]
    MIN_CHAPTER_CHARS = 200

    def extract(self, file_path: str) -> BookContent:
        """从 PDF 文件提取章节"""
        if self.detection_mode == 'epub-toc':
            self.warnings.append("PDF 不支持 epub-toc，按 normal 模式切分")
        try:
            reader = PdfReader(file_path)
            meta = reader.metadata or {}
            title = meta.get('/Title') or 'Unknown Title'
            author = meta.get('/Author') or 'Unknown Author'

            pages = []
            for i, page in enumerate(reader.pages):
                try:
                    text = page.extract_text()
                    if text:
                        pages.append((i + 1, text))
                except Exception as e:
                    self.warnings.append(f"页面 {i + 1} 提取失败: {e}")

            return BookContent(
                title=title, author=author, chapters=self._split_into_chapters(pages),
                file_path=file_path, file_type='pdf',
            )
        except Exception as e:
            raise Exception(f"PDF 解析失败: {e}")

    def _is_chapter_start(self, text: str) -> bool:
        return any(re.search(p, text, re.IGNORECASE) for p in self.CHAPTER_PATTERNS)

    def _split_into_chapters(self, pages: list[tuple[int, str]]) -> list[Chapter]:
        """按章节标记切分：遇到章节起始页先收束上一章，再以该页开启新章"""
        chunks: list[str] = []
        current = ""
        for page_num, text in pages:
            if self._is_chapter_start(text) and current.strip():
                chunks.append(current)
                current = ""
            current += f"\n[Page {page_num}]\n{text}"
        if current.strip():
            chunks.append(current)

        chapters = []
        for chunk in chunks:
            cleaned = self._clean_content(chunk)
            if len(cleaned) > self.MIN_CHAPTER_CHARS:
                first_line = cleaned.split('\n', 1)[0]
                chapters.append(Chapter(
                    title=first_line[:100] or f"Chapter {len(chapters) + 1}",
                    content=cleaned,
                    index=len(chapters),
                ))

        # 未切出有效章节时整本作为一章
        if not chapters:
            full = self._clean_content('\n'.join(text for _, text in pages))
            if full:
                chapters.append(Chapter(title="全文", content=full, index=0))
        return chapters

    def _clean_content(self, content: str) -> str:
        content = re.sub(r'\[Page \d+\]', '', content)
        lines = [line.strip() for line in content.split('\n')]
        return '\n'.join(line for line in lines if line)


class ChapterExtractorFactory:
    """章节提取器工厂"""

    @staticmethod
    def create(file_path: str, detection_mode: str = 'normal', toc_depth: int = 1) -> ChapterExtractor:
        """根据文件类型创建提取器"""
        lower = file_path.lower()
        if lower.endswith('.epub'):
            return EPUBExtractor(detection_mode, toc_depth)
        if lower.endswith('.pdf'):
            return PDFExtractor(detection_mode, toc_depth)
        raise ValueError(f"不支持的文件格式: {file_path}")

    @staticmethod
    def extract(file_path: str, detection_mode: str = 'normal', toc_depth: int = 1) -> BookContent:
        """直接提取章节内容"""
        return ChapterExtractorFactory.create(file_path, detection_mode, toc_depth).extract(file_path)
