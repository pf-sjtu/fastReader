"""
v3 章节输出 = 正文 + `<!--juhua:meta-->` + JSON 旁路。CLI 只需要正文：拆出旁路并做程序化清理。

与前端 src/services/prompts/chapterMeta.ts 等价；跨端用例 tests/fixtures/prompts-v3/meta-cases.json
"""

from __future__ import annotations

import json
import re
from typing import Optional

META_MARK = "<!--juhua:meta-->"
_META_MARK_RE = re.compile(r"<!--\s*juhua:meta\s*-->", re.IGNORECASE)

# 每章加粗上限（规格 prompts-v3）
MAX_BOLD_PER_CHAPTER = 6
_BOLD_RE = re.compile(r"(?<!\*)\*\*(?!\*)([^*\n]+?)(?<!\*)\*\*(?!\*)")

# 开头的客套话（带标点的短语）：本地剥掉，不为它付费重写（与前端 GREETING_LINE_RE 一致）
_GREETING_LINE_RE = re.compile(
    r"^[ \t]*(?:(?:好的|当然|没问题|收到|可以)[，,！!。.:：][^\n]{0,30}"
    r"|(?:以下是|下面是)[^。\n]{0,30}(?:总结|摘要)[：:。.]?)[ \t]*\n+"
)
# 模型漏写标记、只在末尾给了 ```json 元数据代码块
_TRAILING_FENCE_RE = re.compile(r"```json\s*(\{[\s\S]*?\})\s*```\s*$", re.IGNORECASE)
# 任意围栏代码块（含 mermaid / genui / html 富内容块）：``` 或 ~~~，3 个以上，同种不更短的围栏闭栏（与前端 splitByFences 一致）
_ANY_FENCE_RE = re.compile(r"(^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]{0,3}\2[ \t]*$)", re.MULTILINE)


def _first_json_object(raw: str) -> Optional[str]:
    text = re.sub(r"```(?:json)?", "", raw, flags=re.IGNORECASE)
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _as_str(v, max_len: int = 200) -> str:
    return v.strip()[:max_len] if isinstance(v, str) else ""


def _as_str_list(v, max_items: int, max_len: int = 80) -> list[str]:
    if not isinstance(v, list):
        return []
    return [s for s in (_as_str(x, max_len) for x in v) if s][:max_items]


def _coerce_meta(obj) -> Optional[dict]:
    if not isinstance(obj, dict):
        return None
    entities = []
    raw_entities = obj.get("entities")
    for e in raw_entities if isinstance(raw_entities, list) else []:
        if not isinstance(e, dict):
            continue
        name = _as_str(e.get("name"), 60)
        if not name:
            continue
        ent = {"name": name, "aliases": _as_str_list(e.get("aliases"), 6, 60)}
        if _as_str(e.get("type"), 20):
            ent["type"] = _as_str(e.get("type"), 20)
        if _as_str(e.get("role"), 60):
            ent["role"] = _as_str(e.get("role"), 60)
        entities.append(ent)
    meta = {
        "oneLine": _as_str(obj.get("oneLine"), 80),
        "takeaways": _as_str_list(obj.get("takeaways"), 5, 120),
        "entities": entities[:20],
        "terms": _as_str_list(obj.get("terms"), 12, 40),
    }
    if not (meta["oneLine"] or meta["takeaways"] or meta["entities"] or meta["terms"]):
        return None
    return meta


def _split_trailing_fence(s: str) -> tuple[str, Optional[dict]]:
    """没有标记：末尾若是我们的元数据代码块就识别出来，避免 JSON 留在正文里被上传"""
    m = _TRAILING_FENCE_RE.search(s)
    if m:
        try:
            meta = _coerce_meta(json.loads(m.group(1)))
            if meta:
                return s[:m.start()].rstrip(), meta
        except (ValueError, TypeError):
            pass
    return s.rstrip(), None


def split_chapter_meta(raw: str) -> tuple[str, Optional[dict]]:
    """拆出 (正文, 旁路)；永不抛错，旁路损坏时 meta 为 None"""
    s = raw or ""
    # 取最后一个标记：正文里即使出现标记字样，真正的旁路也在末尾
    matches = list(_META_MARK_RE.finditer(s))
    if not matches:
        return _split_trailing_fence(s)
    m = matches[-1]
    text = s[:m.start()].rstrip()
    after = s[m.end():]
    js = _first_json_object(after)
    if not text:
        # 模型把旁路写在了正文前面：旁路之后剩下的才是正文
        rest = after.replace(js, "", 1) if js else after
        text = re.sub(r"```(?:json)?", "", rest, flags=re.IGNORECASE).strip()
    if not js:
        return text, None
    try:
        return text, _coerce_meta(json.loads(js))
    except (ValueError, TypeError):
        return text, None


def _sanitize_prose(part: str) -> str:
    out = re.sub(r"^[ \t]{0,3}#{1,6}[ \t]+", "", part, flags=re.MULTILINE)
    out = re.sub(r"^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$", "", out, flags=re.MULTILINE)
    out = re.sub(r"\*\*\*([^*\n]+?)\*\*\*", r"**\1**", out)
    return re.sub(
        r"`([^`\n]{1,40})`",
        lambda m: m.group(0) if re.search(r"[(){}=;<>/\\]", m.group(1)) else m.group(1),
        out,
    )


def _split_by_fences(md: str) -> list[str]:
    """偶数下标是正文、奇数下标是围栏块；拼回去等于原文"""
    return [p for i, p in enumerate(_ANY_FENCE_RE.split(md)) if i % 3 != 2]


# ---- 章末「启发性问题」统一成每题一段（与前端 src/lib/tailQuestions.ts 一致） ----
_Q_MARK_RE = re.compile(r"^\s*(?:[-*+]|\d{1,2}[.、)）]|[（(]\d{1,2}[)）]|Q\d{1,2}\s*[:：.])\s*", re.IGNORECASE)
_Q_END_RE = re.compile(r"[？?]$")
_Q_SENTENCE_RE = re.compile(r"[^？?]+[？?]+")
_QUESTION_MAX = 90
_QUESTION_MULTI_MAX = 60


def _questions_of_line(line: str) -> Optional[list[str]]:
    t = _Q_MARK_RE.sub("", line, count=1).strip()
    if not t or not _Q_END_RE.search(t):
        return None
    sentences = [s for s in (_Q_MARK_RE.sub("", m, count=1).strip() for m in _Q_SENTENCE_RE.findall(t)) if s]
    if not sentences:
        return None
    mx = _QUESTION_MULTI_MAX if len(sentences) > 1 else _QUESTION_MAX
    return sentences if all(len(s) <= mx for s in sentences) else None


def _normalize_tail_questions(prose: str) -> str:
    lines = re.sub(r"\s+$", "", prose).split("\n")
    questions: list[str] = []
    i = len(lines)
    while i > 0:
        if not lines[i - 1].strip():
            i -= 1
            continue
        qs = _questions_of_line(lines[i - 1])
        if not qs:
            break
        questions = qs + questions
        i -= 1
    if len(questions) < 2:
        return prose
    head = re.sub(r"\s+$", "", "\n".join(lines[:i]))
    return head + ("\n\n" if head else "") + "\n\n".join(questions)


def sanitize_summary(text: str) -> str:
    """程序化修复 AI 常见的格式违规：标题符号、分割线、加粗斜体、滥用的反引号、超限的加粗、开头客套话"""
    # 围栏代码块（含富内容块）整体不动：里面的 # 是注释、--- 是内容、** 是源码
    parts = [p if i % 2 == 1 else _sanitize_prose(p) for i, p in enumerate(_split_by_fences(text))]

    # 加粗上限只数正文里的；超限时保留最短的几处（主旨句通常短）
    bolds = [m for k in range(0, len(parts), 2) for m in _BOLD_RE.finditer(parts[k])]
    if len(bolds) > MAX_BOLD_PER_CHAPTER:
        order = sorted(range(len(bolds)), key=lambda i: (len(bolds[i].group(1)), i))
        keep = set(order[:MAX_BOLD_PER_CHAPTER])
        counter = {"i": -1}

        def repl(m: re.Match) -> str:
            counter["i"] += 1
            return m.group(0) if counter["i"] in keep else m.group(1)

        for k in range(0, len(parts), 2):
            parts[k] = _BOLD_RE.sub(repl, parts[k])
    # 章末问题统一成「每题一段」（只处理文末的正文段；以围栏块结尾的不动）
    if len(parts) % 2 == 1:
        parts[-1] = _normalize_tail_questions(parts[-1])
    out = re.sub(r"\n{3,}", "\n\n", "".join(parts))
    return _GREETING_LINE_RE.sub("", out, count=1).strip()


def clean_chapter_summary(raw: str) -> str:
    """CLI 用：拆旁路 + 清理，返回可直接写入输出的正文"""
    text, _ = split_chapter_meta(raw)
    return sanitize_summary(text)
