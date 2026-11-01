"""
纯文本类书籍（.txt / .md / .markdown）当作书来处理。

与网页端 `src/services/pipeline/plainText.ts` **逐字同语义**：没有解析器，正文就是文件本身；
`.md` 额外按一二级标题切章（有结构就顺着结构走），一个标题都没有就整篇一章，标题用文件名（无扩展名）。
跨端契约：`tests/fixtures/plain-text-cases.json`，两端测试共读
（前端 `tests/plainTextParity.test.ts`、CLI `tests/python/test_cli_plain_text.py`）。

放在本模块而不是 `chapter_extractor.py` 的原因：本模块要用后者的 `Chapter` / `BookContent` /
`ChapterExtractor`，因此由 `chapter_extractor.ChapterExtractorFactory` 按扩展名**延迟导入**本模块，
模块级互相导入会成环（`from __future__` 解决不了运行期构造 Chapter 的依赖）。
"""

from __future__ import annotations

import re

from .chapter_extractor import BookContent, Chapter, ChapterExtractor

# 与前端一致：`.markdown` 也认（书库列表/扫描只列 .txt / .md，见 src/services/webdav/browse.ts）
PLAIN_TEXT_EXTENSIONS = ('.txt', '.md', '.markdown')

# markdown 一二级标题（行尾的 # 允许省略或带空格）——与前端 plainText.ts 的 HEADING 同一条正则：
# 三级及以下标题不匹配（`#{1,2}` 后面紧跟 `#` 而不是空白），所以留在正文里。
# 空白集**显式写死**成与 JS `\s` / `String.trim()` 相同的集合：Python 的 `\s` 还会认
# U+001C–U+001F 与 U+0085，不写死会让 `正文\u0085`、`#\u001c标题` 这类行两端切章不同。
_WS_CLASS = '\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
_HEADING = re.compile(rf'^#{{1,2}}[{_WS_CLASS}]+(.+?)[{_WS_CLASS}]*#*[{_WS_CLASS}]*$')
_WS_EDGES = re.compile(rf'^[{_WS_CLASS}]+|[{_WS_CLASS}]+$')

# 纯文本没有作者元数据，与 epub/pdf 缺元数据时的兜底一致
UNKNOWN_AUTHOR = 'Unknown Author'


def _normalize(text: str) -> str:
    """去首 BOM + `\\r\\n?` → `\\n`（前端 readPlainText / splitPlainText 两处都做，这里同样两处都做）"""
    if text.startswith('\ufeff'):
        text = text[1:]
    return re.sub(r'\r\n?', '\n', text)


def _trim(text: str) -> str:
    """对齐 JS `String.trim()`：Python 的 `str.strip()` 认的空白集更大（含 U+001C–U+001F / U+0085）"""
    return _WS_EDGES.sub('', text)


def read_plain_text(data: bytes) -> str:
    """字节 → 文本。

    UTF-16 认 BOM；否则先按**严格** UTF-8 试，失败了才当 GBK 系中文 txt 按 GB18030
    （GBK / GB2312 的超集）严格解，两者都不合法时退回 UTF-8 的替换符结果。
    与前端 `src/services/pipeline/plainText.ts` 的 `decodePlainText` **同规则**（夹具 `plain-text-cases.json`）。

    为什么不用「替换符占比」猜编码（旧做法，被独立审查实测出两个坑）：书里的「□」等 U+FFFD 占位符
    是合法 UTF-8，旧逻辑会整篇按 GB18030 重解成「锟斤拷」（把好文件解坏）；而且占位符密度的分母
    两端不一致（JS 用 UTF-16 长度、Python 用码点）。严格解码只回答「是不是合法 UTF-8」。
    """
    return _normalize(_decode(data))


def _decode(data: bytes) -> str:
    if data[:2] == b'\xff\xfe':
        return data.decode('utf-16-le', errors='replace')
    if data[:2] == b'\xfe\xff':
        return data.decode('utf-16-be', errors='replace')

    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        pass
    try:
        return data.decode('gb18030')
    except UnicodeDecodeError:
        return data.decode('utf-8', errors='replace')


def plain_book_title(file_name: str) -> str:
    """`书名.epub` → `书名`；没有扩展名就用原样（去掉路径分隔符后的部分）"""
    base = re.split(r'[\\/]', file_name)[-1]
    stem = _trim(re.sub(r'\.[^.]+$', '', base))
    return stem or _trim(base) or file_name


def split_plain_text(content: str, fallback_title: str) -> list[Chapter]:
    """切章：一二级标题各起一章，标题里的 `#` 与行尾装饰去掉；标题前的前导内容（前言）也算一章。

    一个标题都没有（纯 txt、或 md 里只用三级及以下标题）时整篇一章。
    空段（含「连续两个标题」这种空段）不生成空章节；`index` 从 0 连续、`title` 为标题文本、
    `content` 为段内容。
    """
    text = _normalize(content)
    chapters: list[Chapter] = []
    title: str | None = None
    buffer: list[str] = []

    def flush() -> None:
        body = _trim('\n'.join(buffer))
        buffer.clear()
        if not body:
            return
        chapters.append(Chapter(
            title=title if title is not None else fallback_title,
            content=body,
            index=len(chapters),
        ))

    for line in text.split('\n'):
        heading = _HEADING.match(line)
        if heading is None:
            buffer.append(line)
            continue
        flush()
        title = heading.group(1).strip()
    flush()

    if chapters:
        return chapters
    return [Chapter(title=fallback_title, content=_trim(text), index=0)]


class PlainTextExtractor(ChapterExtractor):
    """纯文本（.txt / .md / .markdown）章节提取器：整篇即正文，md 按一二级标题切章"""

    def extract(self, file_path: str) -> BookContent:
        try:
            with open(file_path, 'rb') as fh:
                content = read_plain_text(fh.read())
        except OSError as e:
            raise Exception(f"读取纯文本失败: {e}") from e

        if self.detection_mode == 'epub-toc':
            self.warnings.append("纯文本不支持 epub-toc，按一二级标题切分")

        title = plain_book_title(file_path)
        return BookContent(
            title=title,
            author=UNKNOWN_AUTHOR,
            chapters=split_plain_text(content, title),
            file_path=file_path,
            file_type='plain',
        )
