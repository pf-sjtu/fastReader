"""换模型评判：用另一个模型（默认 ~/.pi/agent/models.json 的 minimax / MiniMax-M3.1-Flash，Anthropic Messages 协议）
给 eval_v3_genres.py 产出的章节总结打分，补「生成者自己评自己」的盲区。
注意：与生成者同属 MiniMax 厂商，只能抵消「同一个模型偏爱自己的措辞」，不是真正的跨厂商评判；有别家密钥时改 --provider。
凭据只在运行时从 pi 配置读入内存，不打印、不落盘。
用法：python tests/tour/judge_genres.py [--dir .tmp/eval-genres2] [--provider minimax] [--model MiniMax-M3.1-Flash]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_v3_genres import SAMPLES  # noqa: E402
from src.cli.chapter_meta import split_chapter_meta  # noqa: E402

RUBRIC = """你是严格的评审。下面是一章原文和一份中文章节总结。逐项打 1-5 分（5 最好），只依据原文判断：
- faithful：只核对总结里**复述原文的内容段落**（开头到「脉络与评析」之前）的事实、数字、人名是否都能在原文找到（编造/张冠李戴要扣到 2 以下）。
  总结末尾的「脉络（含本章在全书中的角色）」「评价与延伸」「启发性问题」是提示词明确允许的评述，可以超出原文，**不计入 faithful、也不列入 fabricated**；
  但内容段落里原文没有的具体论断（把一句话扩写成多个原文没说的机制、凭空加的数字与案例）要列入 fabricated
- coverage：是否抓住了原文的主要论点或情节
- language：是否为通篇中文（专有名词可保留原文）
- clean：是否没有把原文的页眉页码、断行连字符、元数据 JSON 之类噪声带进正文
同时列出 fabricated：总结里原文没有的具体事实（没有就给空数组）。
只输出一个 JSON：{"faithful":n,"coverage":n,"language":n,"clean":n,"fabricated":["..."]}，不要其他文字。"""


def load_provider(name: str) -> dict:
    path = Path(os.environ.get("PI_MODELS_JSON") or Path.home() / ".pi" / "agent" / "models.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    return (data.get("providers") or data)[name]


def ask(prov: dict, model: str, prompt: str) -> str:
    """按 pi 配置里的 api 字段选协议：anthropic-messages / openai-responses。思考块会占 token，上限给足（Flash 类模型 1500 不够）。"""
    key = prov["apiKey"]
    base = prov["baseUrl"].rstrip("/")
    if prov.get("api") == "openai-responses":
        url, payload = base + "/responses", {"model": model, "input": prompt, "max_output_tokens": 8000}
        headers = {"authorization": "Bearer " + key, "content-type": "application/json"}
    else:
        url = base + "/v1/messages"
        payload = {"model": model, "max_tokens": 8000, "messages": [{"role": "user", "content": prompt}]}
        headers = {"x-api-key": key, "authorization": "Bearer " + key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=300) as r:
        body = json.loads(r.read().decode())
    if prov.get("api") == "openai-responses":
        return "".join(c.get("text", "") for o in body.get("output", []) for c in (o.get("content") or []) if c.get("type") == "output_text")
    return "".join(b.get("text", "") for b in body.get("content", []) if b.get("type") == "text")


def parse(text: str) -> dict | None:
    m = re.search(r"\{[\s\S]*\}", text)
    try:
        return json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=".tmp/eval-genres2")
    ap.add_argument("--provider", default="minimax")
    ap.add_argument("--model", default="MiniMax-M3.1-Flash")
    args = ap.parse_args()
    prov = load_provider(args.provider)
    src = {label: text for label, _t, text, _title in SAMPLES}
    rows = []
    for f in sorted(Path(args.dir).glob("*.md")):
        label = f.stem.rsplit("-", 1)[0]
        if label not in src:
            continue
        prose, _meta = split_chapter_meta(f.read_text(encoding="utf-8"))
        try:
            score = parse(ask(prov, args.model, f"{RUBRIC}\n\n【原文】\n{src[label]}\n\n【总结】\n{prose}"))
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"× {f.name}: {type(e).__name__}")
            continue
        if not score:
            print(f"× {f.name}: 评判输出不是 JSON")
            continue
        rows.append({"sample": label, "file": f.name, **score})
        print(f"{label:8s} {f.name:22s} faithful={score.get('faithful')} coverage={score.get('coverage')} language={score.get('language')} clean={score.get('clean')} fabricated={len(score.get('fabricated') or [])}")
    summary: dict = {}
    for label in src:
        rs = [r for r in rows if r["sample"] == label]
        if rs:
            summary[label] = {k: round(sum(r[k] for r in rs) / len(rs), 2) for k in ("faithful", "coverage", "language", "clean")}
            summary[label]["fabricated_items"] = sum(len(r.get("fabricated") or []) for r in rs)
            summary[label]["n"] = len(rs)
    out = Path(args.dir) / f"judge-summary-{args.provider}.json"
    out.write_text(json.dumps({"judge": f"{args.provider}/{args.model}", "summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
