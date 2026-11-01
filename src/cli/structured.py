"""
格式化（JSON）请求用上游的结构化输出标准（与前端 src/services/ai/structured.ts 同语义）：
  OpenAI 兼容  response_format: json_schema(strict) → json_object → 不带
  Gemini       response_mime_type + response_json_schema → 仅 response_mime_type → 不带
不认识的网关会 400：客户端逐档降级重试，降级后成功的经验才记住（noJsonSchema / noStructured，与浏览器共用后端存档）。
CLI 目前只有「富内容块修复」一个 JSON 输出请求；它的 schema 与前端共用 config/rich-repair.schema.json。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

_CONFIG_DIR = Path(__file__).resolve().parent.parent / "services" / "prompts" / "config"

RICH_REPAIR_FORMAT: dict = json.loads((_CONFIG_DIR / "rich-repair.schema.json").read_text(encoding="utf-8-sig"))

_STRUCTURED_RE = re.compile(
    r"response_format|json_schema|json_object|responseSchema|responseJsonSchema|response_json_schema|"
    r"responseMimeType|response_mime_type|output_config|output_format|structured|schema|\bformat\b",
    re.IGNORECASE,
)


def is_structured_format_error(status: Optional[int], text: str) -> bool:
    """上游是否因为「不认识 / 不支持结构化输出参数」而拒绝（400/422 且正文提到相关字段）"""
    return status in (400, 422) and bool(_STRUCTURED_RE.search(text or ""))


def initial_tier(fmt: Optional[dict], no_json_schema: bool, no_structured: bool) -> Optional[str]:
    """起始档位：schema → json → None（学到的档位直接沿用）"""
    if not fmt or no_structured:
        return None
    return "schema" if fmt.get("schema") and not no_json_schema else "json"
