"""
章节提取器
负责从 EPUB 和 PDF 文件中提取章节内容
"""

import io
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from ebooklib import epub
from pypdf import PdfReader


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

    @abstractmethod
    def extract(self, file_path: str) -> BookContent:
        """提取章节内容"""
        pass


class EPUBExtractor(ChapterExtractor):
    """EPUB 章节提取器"""

    # Skip chapter keywords (same as frontend)
    SKIP_CHAPTER_KEYWORDS = [
        '封面', '封面图', '版权', '版权页', '前言', '序言', '说明', '介绍',
        '目录', 'Contents', 'Preface', 'Introduction', 'Copyright',
        'acknowledg', 'dedication', 'about', 'author', 'publisher',
        'isbn', '书号', '定价', '出版', '印刷', 'contents'
    ]

    def extract(self, file_path: str) -> BookContent:
        """从 EPUB 文件提取章节"""
        try:
            # Read file
            with open(file_path, 'rb') as f:
                book = epub.read_epub(f)

            # Get metadata
            title = self._get_metadata(book, 'title', 'Unknown Title')
            author = self._get_metadata(book, 'creator', 'Unknown Author')

            # Extract chapters from spine
            chapters = []
            chapter_index = 0

            for item in book.get_items():
                if item.get_type() == epub.ITEM_DOCUMENT:
                    # Get chapter title from nav or spine
                    item_name = item.get_name()
                    chapter_title = self._extract_title(item.get_content())

                    # Skip short or non-content chapters
                    if self._should_skip_chapter(chapter_title, item.get_content()):
                        continue

                    # Clean and extract content
                    content = self._clean_content(item.get_content())

                    if len(content) > 100:  # Only include substantial chapters
                        chapters.append(Chapter(
                            title=chapter_title or f"Chapter {chapter_index + 1}",
                            content=content,
                            index=chapter_index
                        ))
                        chapter_index += 1

            return BookContent(
                title=title,
                author=author,
                chapters=chapters,
                file_path=file_path,
                file_type='epub'
            )

        except Exception as e:
            raise Exception(f"EPUB 解析失败: {e}")

    def _get_metadata(self, book, key: str, default: str) -> str:
        """获取元数据"""
        meta = book.get_metadata(key)
        if meta:
            return meta[0][0]
        return default

    def _extract_title(self, content: bytes) -> str:
        """从章节内容提取标题"""
        try:
            html_content = content.decode('utf-8', errors='ignore')

            # Try to find title in common patterns
            patterns = [
                r'<h[1-6][^>]*>([^<]+)</h[1-6]>',
                r'<title>([^<]+)</title>',
                r'<p[^>]*class="title"[^>]*>([^<]+)</p>',
            ]

            for pattern in patterns:
                match = re.search(pattern, html_content, re.IGNORECASE)
                if match:
                    return match.group(1).strip()

            # Try to get from first substantial paragraph
            paragraphs = re.findall(r'<p[^>]*>([^<]+)</p>', html_content)
            for p in paragraphs:
                if len(p.strip()) > 10:
                    return p.strip()[:100]

        except Exception:
            pass

        return ""

    def _should_skip_chapter(self, title: str, content: bytes) -> bool:
        """判断是否应该跳过该章节"""
        title_lower = title.lower()

        # Check skip keywords
        for keyword in self.SKIP_CHAPTER_KEYWORDS:
            if keyword.lower() in title_lower:
                return True

        # Skip very short chapters
        content_length = len(content)
        if content_length < 200:
            return True

        return False

    def _clean_content(self, content: bytes) -> str:
        """清理章节内容"""
        try:
            html_content = content.decode('utf-8', errors='ignore')

            # Remove HTML tags but keep line breaks
            text = re.sub(r'<br\s*/?>', '\n', html_content, flags=re.IGNORECASE)
            text = re.sub(r'</p>', '\n\n', text)
            text = re.sub(r'</div>', '\n', text)
            text = re.sub(r'</h[1-6]>', '\n', text)
            text = re.sub(r'<[^>]+>', '', text)

            # Decode HTML entities
            text = text.replace('&nbsp;', ' ')
            text = text.replace('&amp;', '&')
            text = text.replace('&lt;', '<')
            text = text.replace('&gt;', '>')
            text = text.replace('&quot;', '"')

            # Clean up whitespace
            lines = []
            for line in text.split('\n'):
                line = line.strip()
                if line:
                    lines.append(line)

            return '\n'.join(lines)

        except Exception:
            return ""


class PDFExtractor(ChapterExtractor):
    """PDF 章节提取器"""

    def extract(self, file_path: str) -> BookContent:
        """从 PDF 文件提取章节"""
        try:
            reader = PdfReader(file_path)

            # Get metadata
            title = reader.metadata.get('/Title', 'Unknown Title') if reader.metadata else 'Unknown Title'
            author = reader.metadata.get('/Author', 'Unknown Author') if reader.metadata else 'Unknown Author'

            # Extract text from all pages
            all_text = []
            for i, page in enumerate(reader.pages):
                try:
                    text = page.extract_text()
                    if text:
                        all_text.append((i + 1, text))
                except Exception as e:
                    print(f"⚠️  页面 {i + 1} 提取失败: {e}")

            # Split into chapters (simple approach: split by double newlines and look for chapter markers)
            chapters = self._split_into_chapters(all_text)

            return BookContent(
                title=title or 'Unknown Title',
                author=author or 'Unknown Author',
                chapters=chapters,
                file_path=file_path,
                file_type='pdf'
            )

        except Exception as e:
            raise Exception(f"PDF 解析失败: {e}")

    def _split_into_chapters(self, pages: list[tuple[int, str]]) -> list[Chapter]:
        """将 PDF 页面分割成章节"""
        chapters = []
        chapter_index = 0

        # Combine all text
        full_text = '\n'.join([text for _, text in pages])

        # Try to split by chapter markers
        chapter_patterns = [
            r'(?:^|\n)\s*(?:第[一二三四五六七八九十]+章|Chapter\s+\d+)\s*[\n:]',
            r'(?:^|\n)\s*\d+\s*\n(?:第[一二三四五六七八九十]+章|Chapter\s+\d+)',
        ]

        # Simple approach: split by large gaps or chapter patterns
        chunks = []
        current_chunk = ""
        current_page_start = 1

        for page_num, text in pages:
            # Add page break marker
            text_with_break = f"\n[Page {page_num}]\n"
            current_chunk += text_with_break

            # Check if this page starts a new chapter
            is_chapter_start = False
            for pattern in chapter_patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    is_chapter_start = True
                    break

            if is_chapter_start and current_chunk.strip():
                chunks.append((current_page_start, current_chunk.strip()))
                current_chunk = ""
                current_page_start = page_num

        # Add remaining content
        if current_chunk.strip():
            chunks.append((current_page_start, current_chunk.strip()))

        # Create Chapter objects
        for page_start, content in chunks:
            # Clean content
            cleaned = self._clean_content(content)
            if len(cleaned) > 200:  # Only substantial content
                # Extract title from first line
                lines = cleaned.split('\n')
                title = lines[0][:100] if lines else f"Chapter {chapter_index + 1}"

                chapters.append(Chapter(
                    title=title,
                    content=cleaned,
                    index=chapter_index
                ))
                chapter_index += 1

        # If no chapters found, treat entire PDF as one chapter
        if not chapters:
            full_text_cleaned = self._clean_content(full_text)
            if full_text_cleaned:
                chapters.append(Chapter(
                    title="全文",
                    content=full_text_cleaned,
                    index=0
                ))

        return chapters

    def _clean_content(self, content: str) -> str:
        """清理内容"""
        # Remove page numbers
        content = re.sub(r'\[Page \d+\]', '', content)

        # Remove excessive newlines
        content = re.sub(r'\n{3,}', '\n\n', content)

        # Clean up whitespace
        lines = []
        for line in content.split('\n'):
            line = line.strip()
            if line:
                lines.append(line)

        return '\n'.join(lines)


class ChapterExtractorFactory:
    """章节提取器工厂"""

    @staticmethod
    def create(file_path: str) -> ChapterExtractor:
        """根据文件类型创建提取器"""
        if file_path.lower().endswith('.epub'):
            return EPUBExtractor()
        elif file_path.lower().endswith('.pdf'):
            return PDFExtractor()
        else:
            raise ValueError(f"不支持的文件格式: {file_path}")

    @staticmethod
    def extract(file_path: str) -> BookContent:
        """直接提取章节内容"""
        extractor = ChapterExtractorFactory.create(file_path)
        return extractor.extract(file_path)
