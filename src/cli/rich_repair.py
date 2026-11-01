"""
富内容块的「生成后统一修复」（CLI 侧，与前端 src/services/pipeline/richRepair.ts 同语义）：
章节总结跑完后，把所有坏块（mermaid 语法错 / genui JSON 坏 / html 不合规 / 被截断）收集起来，
**一次**（分批）交给 LLM 修一遍。只依据生成内容本身（块源码 + 错误信息 + 前 80 字），不回看原书、不发正文。
修好并通过同一套诊断的才采用；仍然坏的块直接删掉——块是锦上添花，正文逐字不变。

与前端的唯一差别：mermaid 的语法校验。前端用真实解析器（mermaid.parse），CLI 没有浏览器环境，只做结构检查
（非空、不过大、首个有效行是已知图类型）；漏检的坏块会在网页端渲染时回退为源码，不会出错。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Optional

from .genui_schema import parse_genui
from .rich_blocks import RichBlock, fence_rich_block, list_rich_blocks, map_rich_blocks

REPAIR_BATCH = 6
CONTEXT_CHARS = 80
MERMAID_MAX = 8000
HTML_MAX = 20000
_MERMAID_HEAD = re.compile(
    r"^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|"
    r"quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|C4Context)\b"
)

# (items) -> answers；item = {id, lang, error, code, context}，answer = {id, code|None}
RepairFn = Callable[[list[dict]], list[dict]]


def diagnose_block(b: RichBlock) -> Optional[str]:
    """返回问题描述；None = 没问题"""
    if b.truncated:
        return "代码块没有结束围栏（输出被截断）"
    if b.lang == "genui":
        r = parse_genui(b.code)
        return None if r["ok"] else r["error"]
    if b.lang == "html":
        src = b.code.strip()
        if not src:
            return "内容为空"
        return "内容过大" if len(src) > HTML_MAX else None
    # mermaid：结构检查（见模块说明）
    src = b.code.strip()
    if not src:
        return "图为空"
    if len(src) > MERMAID_MAX:
        return "图过大"
    first = next((ln.strip() for ln in src.splitlines() if ln.strip() and not ln.strip().startswith("%%")), "")
    return None if _MERMAID_HEAD.match(first) else "无法识别的图类型"


def _context_before(md: str, code: str) -> str:
    at = md.find(code)
    head = md[:at] if at > 0 else md
    head = re.sub(r"`{3,}[\s\S]*?(`{3,}|$)", " ", head)
    return re.sub(r"\s+", " ", head).strip()[-CONTEXT_CHARS:]


@dataclass
class RepairStats:
    bad: int = 0
    fixed: int = 0
    dropped: int = 0


@dataclass
class RepairResult:
    summaries: list[str]
    changed: list[int]
    stats: RepairStats


def repair_rich_blocks(summaries: list[str], repair: RepairFn, is_usable: Callable[[str], bool] = lambda s: bool(s and s.strip())) -> RepairResult:
    stats = RepairStats()
    out = list(summaries)

    # 1) 逐章诊断；key = (章下标, 块序号)
    bad: list[dict] = []
    for ch, md in enumerate(summaries):
        if not is_usable(md):
            continue
        for idx, block in enumerate(list_rich_blocks(md)):
            error = diagnose_block(block)
            if error:
                bad.append({"key": (ch, idx), "ch": ch, "block": block, "error": error, "context": _context_before(md, block.code)})
    stats.bad = len(bad)
    if not bad:
        return RepairResult(out, [], stats)

    # 2) 统一修复：分批，一批一次调用；调用失败只影响这一批
    verdict: dict[tuple, Optional[str]] = {}
    for i in range(0, len(bad), REPAIR_BATCH):
        batch = bad[i:i + REPAIR_BATCH]
        try:
            answers = repair([{"id": n, "lang": b["block"].lang, "error": b["error"], "code": b["block"].code, "context": b["context"]}
                              for n, b in enumerate(batch)])
        except Exception:  # noqa: BLE001 —— 修复失败不能连累整本书
            answers = []
        for n, b in enumerate(batch):
            fixed = next((a.get("code") for a in answers if a.get("id") == n), None)
            fixed = fixed.strip() if isinstance(fixed, str) else None
            # 修好的必须重新通过同一套诊断才算数
            ok = bool(fixed) and diagnose_block(RichBlock(b["block"].lang, fixed, False, "")) is None
            verdict[b["key"]] = fixed if ok else None

    # 3) 写回：修好的替换、仍坏的删掉；只动块
    changed: set[int] = set()
    bad_keys = {b["key"] for b in bad}
    for ch in sorted({b["ch"] for b in bad}):
        def repl(block: RichBlock, idx: int, ch: int = ch) -> str:
            key = (ch, idx)
            if key not in bad_keys:
                return block.raw
            changed.add(ch)
            fixed = verdict.get(key)
            if fixed:
                stats.fixed += 1
                return fence_rich_block(block.lang, fixed)
            stats.dropped += 1
            return ""

        out[ch] = re.sub(r"\n{3,}", "\n\n", map_rich_blocks(summaries[ch], repl))
    return RepairResult(out, sorted(changed), stats)
