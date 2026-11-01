"""真实网关的结构化输出探测：json_schema(strict) → json_object → 无约束，各发一次，看网关接不接受、返回能否解析成符合 schema 的 JSON。
对应 src/services/ai/structured.ts 的降级阶梯（noJsonSchema / noStructured）。凭据读 .env，只读不打印。
用法：python tests/tour/probe_structured.py
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "src/services/prompts/config/rich-repair.schema.json").read_text(encoding="utf-8-sig"))
PROMPT = (
    "下面是一个坏掉的 genui 块，请修复，只返回修复结果。\n"
    '[{"id":"b1","lang":"genui","error":"JSON 无法解析","code":"{\\"type\\":\\"callout\\",\\"body\\":\\"要点\\",}","context":"……规模效应的前提是边际成本递减。"}]'
)


def env() -> dict:
    out = {}
    for ln in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in ln and not ln.lstrip().startswith("#"):
            k, v = ln.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def call(e: dict, fmt: dict | None) -> str:
    payload = {"model": e["VITE_TEST_LLM_MODEL"], "messages": [{"role": "user", "content": PROMPT}], "temperature": 0}
    if fmt:
        payload["response_format"] = fmt
    req = urllib.request.Request(
        e["VITE_TEST_LLM_BASE_URL"].rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {e['VITE_TEST_LLM_API_KEY']}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}: {ex.read().decode('utf-8', 'replace')[:160]}"
    text = re.sub(r"<think>[\s\S]*?</think>", "", data["choices"][0]["message"].get("content") or "", flags=re.I).strip()
    try:
        obj = json.loads(text)
        ok = isinstance(obj, dict) and isinstance(obj.get("fixes"), list)
        return f"HTTP 200，JSON 可解析，符合 schema 形状={ok}"
    except Exception:  # noqa: BLE001
        return f"HTTP 200，但正文不是纯 JSON（前 80 字：{text[:80]!r}）"


if __name__ == "__main__":
    e = env()
    print("模型:", e["VITE_TEST_LLM_MODEL"])
    for name, fmt in (
        ("json_schema(strict)", {"type": "json_schema", "json_schema": {"name": "rich_repair", "strict": True, "schema": SCHEMA}}),
        ("json_object", {"type": "json_object"}),
        ("无约束", None),
    ):
        print(f"{name:20s} →", call(e, fmt))
