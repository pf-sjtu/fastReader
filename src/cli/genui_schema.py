"""
genui 组件 JSON 的宽容解析（模型输出不可信：坏的单项丢弃，一个都读不出来才报错）。

与前端 src/components/markdown/genui/schema.ts 等价；跨端用例 tests/fixtures/rich-blocks/cases.json。
CLI 只用它判断「这个 genui 块能不能渲染」（坏块修复的诊断），不渲染。
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

LIMITS = {"nodes": 8, "items": 12, "columns": 6, "options": 6, "text": 300, "label": 60}
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _text(v: Any, mx: int = LIMITS["text"]) -> str:
    if isinstance(v, str):
        s = v
    elif isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf"):
        s = str(int(v)) if float(v).is_integer() else str(v)
    else:
        s = ""
    return _CTRL_RE.sub("", s).strip()[:mx]


def _opt(v: Any, mx: Optional[int] = None) -> Optional[str]:
    return _text(v, mx if mx is not None else LIMITS["text"]) or None


def _arr(v: Any) -> list:
    return v if isinstance(v, list) else []


def _obj(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def _first(o: dict, *keys: str) -> Any:
    """JS 的 a ?? b：只在 None / 缺失时取下一个"""
    for k in keys:
        if o.get(k) is not None:
            return o[k]
    return None


def _parse_node(raw: Any) -> Optional[dict]:
    r = _obj(raw)
    label_max = LIMITS["label"]
    kind = _text(r.get("type"), 20).lower()
    if kind == "steps":
        items = []
        for i in _arr(_first(r, "items", "steps")):
            if isinstance(i, str):
                items.append({"label": _text(i, label_max)})
            else:
                o = _obj(i)
                items.append({"label": _text(_first(o, "label", "title"), label_max), "detail": _opt(_first(o, "detail", "body"))})
        items = [i for i in items if i["label"]][: LIMITS["items"]]
        return {"type": "steps", "items": items} if items else None
    if kind == "compare":
        columns = [c for c in (_text(c, label_max) for c in _arr(r.get("columns"))) if c][: LIMITS["columns"]]
        rows = []
        for row in _arr(r.get("rows")):
            o = _obj(row)
            rows.append({"label": _text(_first(o, "label", "name"), label_max),
                         "cells": [_text(c) for c in _arr(o.get("cells"))][: len(columns)]})
        rows = [x for x in rows if x["label"]][: LIMITS["items"]]
        return {"type": "compare", "columns": columns, "rows": rows} if columns and rows else None
    if kind == "timeline":
        items = []
        for i in _arr(r.get("items")):
            o = _obj(i)
            items.append({"time": _text(_first(o, "time", "date"), label_max), "label": _text(_first(o, "label", "title"), label_max)})
        items = [i for i in items if i["label"]][: LIMITS["items"]]
        return {"type": "timeline", "items": items} if items else None
    if kind == "cards":
        items = []
        for i in _arr(_first(r, "items", "cards")):
            o = _obj(i)
            items.append({"title": _text(_first(o, "title", "label"), label_max), "body": _text(_first(o, "body", "detail"))})
        items = [i for i in items if i["title"]][: LIMITS["items"]]
        return {"type": "cards", "items": items} if items else None
    if kind == "callout":
        body = _text(_first(r, "body", "text"))
        return {"type": "callout", "body": body} if body else None
    if kind == "tabs":
        tabs = []
        for t in _arr(r.get("tabs")):
            o = _obj(t)
            tabs.append({"label": _text(_first(o, "label", "title"), 30), "body": _text(_first(o, "body", "text"), 600)})
        tabs = [t for t in tabs if t["label"] and t["body"]][: LIMITS["options"]]
        return {"type": "tabs", "tabs": tabs} if tabs else None
    if kind == "quiz":
        options = [o for o in (_text(o, 120) for o in _arr(r.get("options"))) if o][: LIMITS["options"]]
        # 只认数字或非空数字字符串（与前端一致：null / 空串 / 布尔不能当作「选第 0 项」）
        raw_answer = r.get("answer")
        answer = float("nan")
        if isinstance(raw_answer, (int, float)) and not isinstance(raw_answer, bool):
            answer = float(raw_answer)
        elif isinstance(raw_answer, str) and raw_answer.strip():
            try:
                answer = float(raw_answer)
            except ValueError:
                pass
        # 答案必须落在选项里：否则这道题没法判分，宁可整题丢掉
        if not _text(r.get("question")) or len(options) < 2 or answer != answer or not answer.is_integer() or answer < 0 or answer >= len(options):
            return None
        return {"type": "quiz", "question": _text(r.get("question")), "options": options, "answer": int(answer)}
    return None


def _lenient_json(code: str) -> Any:
    try:
        return json.loads(code)
    except ValueError:
        cleaned = re.sub(r",\s*([}\]])", r"\1", re.sub(r"^\s*//.*$", "", code, flags=re.MULTILINE))
        return json.loads(cleaned)


def parse_genui(code: str) -> dict:
    """返回 {"ok": True, "nodes": [...]} 或 {"ok": False, "error": "..."}"""
    try:
        data = _lenient_json(code)
    except ValueError:
        return {"ok": False, "error": "JSON 无法解析"}
    # 三种写法都认：单个节点 {type:…}、数组 [{…},{…}]、{blocks:[…]}
    if isinstance(data, list):
        raw_nodes = data
    elif isinstance(_obj(data).get("blocks"), list):
        raw_nodes = data["blocks"]
    else:
        raw_nodes = [data]
    nodes = [n for n in (_parse_node(r) for r in raw_nodes) if n is not None][: LIMITS["nodes"]]
    return {"ok": True, "nodes": nodes} if nodes else {"ok": False, "error": "没有可渲染的组件"}
