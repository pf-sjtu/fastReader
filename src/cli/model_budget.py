"""模型参数自动化：输入预算 / 超长正文分段 / 后处理阈值 / 温度报错识别。

与前端 src/services/ai/outputBudget.ts 同语义，契约见 tests/fixtures/model-budget-cases.json（两端测试共读）。
"""
from __future__ import annotations

import math
import re
from typing import Optional

DEFAULT_OUTPUT_RESERVE = 8192
PROMPT_OVERHEAD = 2048
MIN_INPUT_CHARS = 2000
DEFAULT_POST_PROCESS_LIMITS = {"chapters": 200_000, "connections": 50_000}
# 字符 → token 保守系数（CJK 生僻字 / 字节级 BPE 可能 >1 token/字）
TOKENS_PER_CHAR = 1.25
CONTEXT_SAFETY_MARGIN = 1024
MIN_OUTPUT_TOKENS = 1024
# 不按模型最大输出预占：服务商按 max_tokens 预扣限速 / 额度。短提示封顶 32768，长提示给到输入的 4 倍
OUTPUT_SOFT_CAP = 32768
OUTPUT_PER_INPUT = 4

# 只从明确表达「上限」的句式里读数字（报错里的日期、输入 token 数等都不是上限）
_CAP_PATTERNS = [
    re.compile(r"should be in \[\s*\d+\s*,\s*(\d+)\s*\]", re.I),
    re.compile(r"max(?:imum)?[ _]?tokens?\s*>\s*(\d+)", re.I),
    re.compile(r"(?:<=|≤|less than or equal to|at most|maximum of|up to)\s*(\d+)", re.I),
    re.compile(r"\d+\s*>\s*(\d+),?\s*which is the maximum", re.I),
]
_CAP_CONTEXT = re.compile(r"max.?tokens|max_completion_tokens|maxOutputTokens|output tokens", re.I)


def estimate_prompt_tokens(*parts: Optional[str]) -> int:
    """粗估提示词 token 数（按 TOKENS_PER_CHAR 保守系数，宁可高估）"""
    return math.ceil(sum(len(p or "") for p in parts) * TOKENS_PER_CHAR)


def resolve_max_output_tokens(output_limit: Optional[int], context_window: Optional[int],
                              prompt_tokens: int) -> Optional[int]:
    """请求输出上限 = min(模型最大输出, max(32768, 输入×4), 窗口 − 输入 − 1024)，保底 1024；未知返回 None"""
    if not output_limit or output_limit <= 0:
        return None
    budget = min(int(output_limit), max(OUTPUT_SOFT_CAP, prompt_tokens * OUTPUT_PER_INPUT))
    if context_window and context_window > 0:
        room = int(context_window - prompt_tokens - CONTEXT_SAFETY_MARGIN)
        if room < budget:
            budget = max(room, MIN_OUTPUT_TOKENS)
    return budget


def parse_max_tokens_cap(message: Optional[str], current: int) -> Optional[int]:
    """从「输出上限超出范围」报错读出真实上限；读不出返回 None（不猜）"""
    if not message or not _CAP_CONTEXT.search(message):
        return None
    for pattern in _CAP_PATTERNS:
        m = pattern.search(message)
        if m and MIN_OUTPUT_TOKENS <= int(m.group(1)) < current:
            return int(m.group(1))
    return None


# 读不出上限时的退避系数与单次请求内的最多退避次数（与前端 OUTPUT_CAP_BACKOFF / MAX_CAP_BACKOFFS 一致）
OUTPUT_CAP_BACKOFF = 0.8
MAX_CAP_BACKOFFS = 3
_ABOUT_OUTPUT = re.compile(r"max.?tokens|max_completion_tokens|maxOutputTokens|max_output_tokens|output tokens", re.I)
_TOO_LARGE = re.compile(r"too large|too many|exceed|greater than|larger than|out of range|must be (?:less|<=)|invalid|maximum", re.I)
_CONTEXT_OVERFLOW = re.compile(r"(?:maximum|max) context length|context.{0,20}(?:exceed|too long|overflow)|context_length_exceeded", re.I)


def is_output_limit_error(status: Optional[int], body: Optional[str]) -> bool:
    """「输出上限太大 / 超出上下文」但报错里没有可信上限数字；认证、限流、内容审核等其它 400 不算"""
    if status not in (400, 422):
        return False
    text = body or ""
    return bool((_ABOUT_OUTPUT.search(text) and _TOO_LARGE.search(text)) or _CONTEXT_OVERFLOW.search(text))


def next_output_cap(status: Optional[int], body: Optional[str], current: int) -> Optional[int]:
    """被拒后的下一个尝试值：报错里有可信上限用它；否则若确属输出上限 / 上下文超限按 ×0.8 退避；不是或已到保底返回 None"""
    parsed = parse_max_tokens_cap(body, current)
    if parsed:
        return parsed
    if not is_output_limit_error(status, body):
        return None
    backed = int(current * OUTPUT_CAP_BACKOFF)
    return backed if MIN_OUTPUT_TOKENS <= backed < current else None


def is_max_tokens_param_error(status: Optional[int], body: Optional[str]) -> bool:
    """「max_tokens 参数名不被接受，请用 max_completion_tokens」（OpenAI 推理模型）"""
    if status not in (400, 422):
        return False
    text = body or ""
    return bool(re.search(r"max_completion_tokens", text, re.I)
                and re.search(r"unsupported|not supported|use '?max_completion_tokens", text, re.I))

_PARA_SPLIT = re.compile(r"\n\s*\n")
_SENTENCE = re.compile(r"[^。！？!?.；;\n]+[。！？!?.；;\n]*")
# 必须是「temperature 这个参数 / 取值不被支持」，而不是正文里恰好出现 temperature 一词（与前端同正则）
_TEMP_REJECT = re.compile(
    r"(?:parameter|value)[:\s]+'?temperature'?|'temperature'|"
    r"temperature (?:is not supported|does not support|is unsupported)|only the default \(1\)",
    re.I,
)


def resolve_input_budget(context_window: Optional[int], output_limit: Optional[int]) -> Optional[int]:
    """单次请求可放入的正文字符数（1 字 ≈ 1 token 保守估计）；无上下文元数据返回 None（不限制）"""
    if not context_window or context_window <= 0:
        return None
    reserve = min(output_limit if output_limit and output_limit > 0 else DEFAULT_OUTPUT_RESERVE,
                  context_window // 4)
    return max(int((context_window - reserve - PROMPT_OVERHEAD) / TOKENS_PER_CHAR), MIN_INPUT_CHARS)


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
    return bool(_TEMP_REJECT.search(body or ""))
