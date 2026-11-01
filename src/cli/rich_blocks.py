"""
总结里的「富内容块」：围栏代码块写的 mermaid 图 / genui 交互组件 / html 小部件。

与前端 src/lib/richBlocks.ts 等价；跨端用例 tests/fixtures/rich-blocks/cases.json（两端测试都读）。
它们 **不计入字数**：质量闸、加粗上限、下游 prompt 的输入，一律先剔除这些块，只看文字。
围栏规则：3 个以上反引号或波浪线开栏，同种且不更短的围栏闭栏；没有闭合（输出被截断）按「到文末都是块」处理。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

RICH_LANGS = ("mermaid", "genui", "html")
_LANG = "|".join(RICH_LANGS)

_CAP = r"^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(" + _LANG + r")\b([^\n]*)"
# 已闭合块优先；找不到闭栏时退而求其次吃到文末（8 个捕获组：闭合 1-4 / 未闭合 5-8）
_BLOCK_SCAN = re.compile(
    _CAP + r"\n([\s\S]*?)\n[ \t]{0,3}\1[ \t]*$|" + _CAP + r"(?:\n([\s\S]*))?$",
    re.IGNORECASE | re.MULTILINE,
)
# 任意围栏代码块（含普通代码）：只该处理正文的逻辑（加粗上限、标题 / 分割线清理）要避开它们
_ANY_FENCE_RE = re.compile(r"(^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]{0,3}\2[ \t]*$)", re.MULTILINE)


@dataclass
class RichBlock:
    lang: str
    code: str
    truncated: bool
    raw: str


def map_rich_blocks(md: str, fn: Callable[[RichBlock, int], str]) -> str:
    """逐个富内容块替换：fn 返回新的整块文本（含围栏），返回空串 = 删除该块。正文原样保留"""
    if not md:
        return ""
    counter = {"i": 0}

    def repl(m: re.Match) -> str:
        closed = m.group(4) is not None
        lang = (m.group(2) if closed else m.group(6)).lower()
        code = (m.group(4) if closed else m.group(8)) or ""
        block = RichBlock(lang, code, not closed, m.group(0))
        i = counter["i"]
        counter["i"] += 1
        return fn(block, i)

    return _BLOCK_SCAN.sub(repl, md)


def list_rich_blocks(md: str) -> list[RichBlock]:
    out: list[RichBlock] = []

    def collect(b: RichBlock, _i: int) -> str:
        out.append(b)
        return ""

    map_rich_blocks(md, collect)
    return out


def fence_rich_block(lang: str, code: str) -> str:
    """按围栏长度安全地写回一个块：源码里出现 ``` 时用更长的围栏"""
    longest = max([2] + [len(s) for s in re.findall(r"`+", code)])
    fence = "`" * (longest + 1)
    return f"{fence}{lang}\n{re.sub(chr(10) + '+$', '', code)}\n{fence}"


def strip_rich_blocks(md: str) -> str:
    """去掉所有富内容块（含未闭合的尾部），留下纯文字部分"""
    if not md:
        return ""
    return re.sub(r"\n{3,}", "\n\n", map_rich_blocks(md, lambda _b, _i: ""))


def prose_length(md: str) -> int:
    """「字数」：富内容块不计入，首尾空白不计"""
    return len(strip_rich_blocks(md).strip())


def rich_block_count(md: str) -> int:
    return len(list_rich_blocks(md)) if md else 0


def split_by_fences(md: str) -> list[str]:
    """偶数下标是正文、奇数下标是围栏块；拼回去等于原文"""
    return [p for i, p in enumerate(_ANY_FENCE_RE.split(md)) if i % 3 != 2]
