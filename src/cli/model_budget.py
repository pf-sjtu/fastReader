"""模型参数自动化：输入预算 / 超长正文分段 / 后处理阈值 / 温度报错识别。

与前端 src/services/ai/outputBudget.ts 同语义，契约见 tests/fixtures/model-budget-cases.json（两端测试共读）。
"""
from __future__ import annotations

import re
from typing import Optional

DEFAULT_OUTPUT_RESERVE = 8192
PROMPT_OVERHEAD = 2048
MIN_INPUT_CHARS = 2000
DEFAULT_POST_PROCESS_LIMITS = {"chapters": 200_000, "connections": 50_000}

_PARA_SPLIT = re.compile(r"\n\s*\n")
_SENTENCE = re.compile(r"[^。！？!?.；;\n]+[。！？!?.；;\n]*")
_TEMP_PARAM = re.compile(r"temperature", re.I)
_TEMP_REJECT = re.compile(r"unsupported|not support|only the default|does not support|invalid", re.I)


def resolve_input_budget(context_window: Optional[int], output_limit: Optional[int]) -> Optional[int]:
    """单次请求可放入的正文字符数（1 字 ≈ 1 token 保守估计）；无上下文元数据返回 None（不限制）"""
    if not context_window or context_window <= 0:
        return None
    reserve = min(output_limit if output_limit and output_limit > 0 else DEFAULT_OUTPUT_RESERVE,
                  context_window // 4)
    return max(int(context_window - reserve - PROMPT_OVERHEAD), MIN_INPUT_CHARS)


def resolve_post_process_limits(context_window: Optional[int], output_limit: Optional[int]) -> dict:
    """后处理压缩上限：预算按 3:1 分给章节摘要与关联分析，且不超过历史默认"""
    budget = resolve_input_budget(context_window, output_limit)
    if not budget:
        return dict(DEFAULT_POST_PROCESS_LIMITS)
    connections = budget // 4
    return {
        "chapters": min(DEFAULT_POST_PROCESS_LIMITS["chapters"], budget - connections),
        "connections": min(DEFAULT_POST_PROCESS_LIMITS["connections"], connections),
    }


def split_by_budget(text: str, budget: int) -> list[str]:
    """超长正文按段落 → 句末标点 → 硬切 的优先级切成不超过 budget 字符的段，内容不丢"""
    if len(text) <= budget:
        return [text]
    pieces: list[tuple[str, str]] = []  # (前置分隔符, 文本)
    for pi, para in enumerate(_PARA_SPLIT.split(text)):
        para_sep = "" if pi == 0 else "\n\n"
        if len(para) <= budget:
            pieces.append((para_sep, para))
            continue
        first = True
        for sentence in _SENTENCE.findall(para) or [para]:
            for i in range(0, len(sentence), budget):
                pieces.append((para_sep if first else "", sentence[i:i + budget]))
                first = False
    chunks: list[str] = []
    current = ""
    for sep, piece in pieces:
        if current and len(current) + len(sep) + len(piece) > budget:
            chunks.append(current)
            current = piece
        else:
            current = current + sep + piece if current else piece
    if current:
        chunks.append(current)
    return chunks


def is_temperature_param_error(status: Optional[int], body: Optional[str]) -> bool:
    """服务商因不支持 temperature 拒绝请求（OpenAI o 系列 / gpt-5 等）"""
    if status not in (400, 422):
        return False
    text = body or ""
    return bool(_TEMP_PARAM.search(text) and _TEMP_REJECT.search(text))
