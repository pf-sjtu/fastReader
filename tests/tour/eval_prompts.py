"""
v2 / v3 提示词真实模型评测（长期保留，默认不跑；需要真实 API）。

运行：
  uv run --no-sync python tests/tour/eval_prompts.py --epubs "<epub 目录>" --model MiniMax-M3.1-Flash
凭据：读 .env 里的 VITE_TEST_LLM_BASE_URL / VITE_TEST_LLM_API_KEY（只读，不打印）。

做什么：
1. 从若干本书里按固定种子抽章节；每章分别用 v2 / v3 提示词各生成一次章节总结（v3 再拆旁路、清理）
2. 机器指标（对「模型原始输出」统计，反映提示词本身的格式遵从度）：长度、标题符号/分割线/***、加粗数、客套话、旁路解析成功率与实体/别名数
3. 盲评：同一章的两份总结随机排成 A/B，让模型当评审（忠实 / 覆盖 / 可读），记录胜负（评审与被测同模型，存在偏好风险，报告里写明）
4. 书级：同一批章节的 v2 总结 → v2 关联分析；v3 总结 + 实体表 → v3 关联分析，同样盲评

诚实边界：样本很小（默认 3 本 × 3 章），只能发现明显退化或明显改进，不能给出统计显著的结论。
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


from src.cli.chapter_extractor import EPUBExtractor, matches_skip_title  # noqa: E402
from src.cli.chapter_meta import META_MARK, sanitize_summary, split_chapter_meta  # noqa: E402
from src.cli.prompts import PromptTemplates, get_language_instruction  # noqa: E402
from src.cli.config import PromptConfig  # noqa: E402

MIN_CHARS, MAX_CHARS = 2500, 9000
BOLD_RE = re.compile(r"(?<!\*)\*\*(?!\*)([^*\n]+?)(?<!\*)\*\*(?!\*)")
GREETING_RE = re.compile(r"^\s*(?:好的|当然|没问题|收到|以下是|下面是)")


def read_env(path: str) -> dict:
    """极简 .env 解析（只读；不引入 python-dotenv，避免在缺依赖的环境里跑不起来）"""
    out: dict = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def strip_thinking(text: str) -> str:
    return re.sub(r"<think>[\s\S]*?</think>", "", text or "", flags=re.IGNORECASE).strip()


class Model:
    """OpenAI 兼容 /chat/completions，只用标准库（评测环境不一定装了 openai SDK）"""

    def __init__(self, base_url: str, api_key: str, model: str, reasoning_effort: str | None = "low"):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.key = api_key
        self.model = model
        self.reasoning_effort = reasoning_effort  # None = 不发该参数（非 MiniMax 网关未必接受）
        self.tokens = 0

    def ask(self, prompt: str, max_tokens: int = 24000) -> str:
        payload = {"model": self.model, "messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens, "temperature": 0.3}
        if self.reasoning_effort:
            payload["reasoning_effort"] = self.reasoning_effort
        body = json.dumps(payload).encode("utf-8")
        last: Exception | None = None
        for attempt in range(5):
            try:
                req = urllib.request.Request(
                    self.url, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.key}"}
                )
                with urllib.request.urlopen(req, timeout=240) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                self.tokens += (data.get("usage") or {}).get("total_tokens", 0) or 0
                choice = data["choices"][0]
                text = strip_thinking(choice["message"].get("content") or "")
                if not text:  # 推理模型的思考也计入输出：撞上限时正文为空，不能当成「模型给了空答案」悄悄计入统计
                    raise RuntimeError(f"返回空内容（finish_reason={choice.get('finish_reason')}）")
                return text
            except urllib.error.HTTPError as e:
                detail = ""
                try:
                    detail = e.read().decode("utf-8", "replace")[:200]
                except Exception:  # noqa: BLE001
                    pass
                last = RuntimeError(f"HTTP {e.code} {detail}")
                if e.code == 429 and "Token Plan" in detail:  # 用量上限（不是瞬时限流），等多久都没用
                    break
                if e.code in (408, 429, 500, 502, 503, 504):  # 限流 / 瞬时故障：退避后重试，别瞬间打满重试次数
                    time.sleep(20 * (attempt + 1))
                else:
                    break
            except Exception as e:  # noqa: BLE001 - 评测脚本：重试后仍失败再抛
                last = e
                time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"模型调用失败: {last}")


def pick_chapters(epub_dir: Path, n_books: int, per_book: int, seed: int):
    rng = random.Random(seed)
    files = sorted(epub_dir.glob("*.epub"))
    rng.shuffle(files)
    picked = []
    for f in files:
        if len(picked) >= n_books:
            break
        if f.stat().st_size > 6 * 1024 * 1024:
            continue
        try:
            book = EPUBExtractor().extract(str(f))
        except Exception:  # noqa: BLE001
            continue
        good = [c for c in book.chapters if MIN_CHARS <= len(c.content) <= MAX_CHARS and not matches_skip_title(c.title)]
        if len(good) < per_book:
            continue
        # 取靠前但不是开头的几章：避开序言，又保证有上下文衔接
        start = min(len(good) - per_book, 1)
        picked.append({"book": f.stem, "chapters": good[start : start + per_book]})
    return picked


def raw_metrics(raw: str) -> dict:
    body, meta = split_chapter_meta(raw)
    return {
        "chars": len(body),
        "has_heading": bool(re.search(r"^[ \t]{0,3}#{1,6}[ \t]+", body, re.M)),
        "has_hr": bool(re.search(r"^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$", body, re.M)),
        "has_triple_star": "***" in body,
        "bold": len(BOLD_RE.findall(body)),
        "greeting": bool(GREETING_RE.match(body)),
        "meta_mark": META_MARK in raw,
        "meta_ok": meta is not None,
        "entities": len(meta["entities"]) if meta else 0,
        "aliases": sum(len(e["aliases"]) for e in meta["entities"]) if meta else 0,
    }


def violations(m: dict) -> int:
    return sum([m["has_heading"], m["has_hr"], m["has_triple_star"], m["bold"] > 6, m["greeting"]])


JUDGE = """你是严格的中文书籍编辑，请对同一章节的两份总结做盲评。
评价维度：①忠实（不编造原文没有的内容）②覆盖（核心论点/关键事实是否齐全）③可读（结构清晰、没有废话与格式噪声）。
只输出一行 JSON：{{"winner":"A"|"B"|"tie","reason":"一句话理由"}}。

【章节标题】{title}

【原文（节选前 3500 字）】
{source}

【总结 A】
{a}

【总结 B】
{b}
"""

JUDGE_BOOK = """你是严格的中文书籍编辑，请对同一批章节摘要的两份「章节关联分析」做盲评。
评价维度：①关联是否真实存在于摘要中（不编造）②是否跨章节找出主线与对比③实体称呼是否前后一致（同一人物/概念不出现多种写法）。
只输出一行 JSON：{{"winner":"A"|"B"|"tie","reason":"一句话理由"}}。

【章节摘要（供核对）】
{summaries}

【关联分析 A】
{a}

【关联分析 B】
{b}
"""


def judge(model: Model, template: str, rng: random.Random, x_v2: str, x_v3: str, **fmt) -> dict:
    flip = rng.random() < 0.5
    a, b = (x_v3, x_v2) if flip else (x_v2, x_v3)
    out = model.ask(template.format(a=a, b=b, **fmt), max_tokens=8000)
    m = re.search(r"\{[\s\S]*?\}", out)
    try:
        data = json.loads(m.group(0)) if m else {}
    except ValueError:
        data = {}
    w = data.get("winner")
    winner = "tie" if w not in ("A", "B") else ("v3" if (w == "A") == flip else "v2")
    return {"winner": winner, "reason": str(data.get("reason", ""))[:200], "v3_was_A": flip}


def tally(results: list[dict]) -> dict:
    c = {"v2": 0, "v3": 0, "tie": 0}
    for r in results:
        c[r["winner"]] += 1
    return c


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epubs", required=True)
    ap.add_argument("--model", default="MiniMax-M3.1-Flash")
    ap.add_argument("--books", type=int, default=3)
    ap.add_argument("--per-book", type=int, default=3)
    ap.add_argument("--seed", type=int, default=20261101)
    ap.add_argument("--out", default=".tmp/eval-v3")
    ap.add_argument("--sensenova", action="store_true", help="改用 gen-image-sensenova skill 的 .env（SENSENOVA_API_BASE/KEY）作为网关")
    ap.add_argument("--judge-model", default=None, help="评判用的模型（默认与 --model 相同；建议换成另一家以避免自评偏向）")
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)  # pyright: ignore[reportAttributeAccessIssue]  重定向到文件时也能实时看到进度

    if args.sensenova:
        env = read_env(str(Path.home() / ".claude/skills/gen-image-sensenova/.env"))
        base, key = env.get("SENSENOVA_API_BASE"), env.get("SENSENOVA_API_KEY")
    else:
        env = read_env(".env")
        base, key = env.get("VITE_TEST_LLM_BASE_URL"), env.get("VITE_TEST_LLM_API_KEY")
    if not base or not key:
        print("缺少网关配置（.env 的 VITE_TEST_LLM_BASE_URL / VITE_TEST_LLM_API_KEY，或 --sensenova 的 SENSENOVA_*）")
        return 2
    effort = None if args.sensenova else "low"
    model = Model(base, key, args.model, effort)
    judge_model = Model(base, key, args.judge_model, effort) if args.judge_model else model
    rng = random.Random(args.seed)
    lang = get_language_instruction("zh")
    t_v2 = PromptTemplates(prompt_config=PromptConfig(currentVersion="v2"))
    t_v3 = PromptTemplates(prompt_config=PromptConfig(currentVersion="v3"))

    books = pick_chapters(Path(args.epubs), args.books, args.per_book, args.seed)
    if not books:
        print("没有找到合适的书/章节")
        return 2
    chapter_rows: list[dict] = []
    book_rows: list[dict] = []
    errors: list[dict] = []
    for b in books:
        print(f"\n== {b['book']}")
        s2, s3, titles, metas = [], [], [], []
        for ch in b["chapters"]:
            row = {"book": b["book"], "chapter": ch.title, "src_chars": len(ch.content)}
            raws = {}
            try:
                for ver, tpl in (("v2", t_v2), ("v3", t_v3)):
                    prompt = tpl.build_chapter_prompt(ch.title, ch.content, "non-fiction") + "\n\n" + lang
                    raws[ver] = model.ask(prompt)
                    row[ver] = raw_metrics(raws[ver])
                    row[ver]["violations"] = violations(row[ver])
                if not row["v3"]["meta_ok"]:  # 旁路解析失败时留原文，便于定位是漏写标记还是 JSON 不合法
                    raw_dir = Path(args.out) / "raw"
                    raw_dir.mkdir(parents=True, exist_ok=True)
                    (raw_dir / f"{len(chapter_rows):02d}-v3-{re.sub(r'[^0-9A-Za-z一-鿿]+', '_', ch.title)[:20]}.txt").write_text(raws["v3"], encoding="utf-8")
                body_v2 = sanitize_summary(split_chapter_meta(raws["v2"])[0])
                body_v3, meta_v3 = split_chapter_meta(raws["v3"])
                body_v3 = sanitize_summary(body_v3)
                row["judge"] = judge(judge_model, JUDGE, rng, body_v2, body_v3, title=ch.title, source=ch.content[:3500])
            except Exception as e:  # noqa: BLE001 - 单章失败只记录，不让整次评测作废
                errors.append({"book": b["book"], "chapter": ch.title, "error": str(e)[:300]})
                print(f"  x {ch.title[:24]}: {str(e)[:160]}")
                continue
            print(f"  {ch.title[:24]:<24} v2违规{row['v2']['violations']} v3违规{row['v3']['violations']} meta={row['v3']['meta_ok']} 胜者={row['judge']['winner']}")
            chapter_rows.append(row)
            s2.append((ch.title, body_v2))
            s3.append((ch.title, body_v3))
            titles.append(ch.title)
            metas.append(meta_v3)
        # 书级：关联分析
        def join(pairs):
            return json.dumps([{"index": i + 1, "title": t, "summary": s} for i, (t, s) in enumerate(pairs)], ensure_ascii=False)

        table = {}
        for meta in metas:
            for e in (meta or {}).get("entities", []):
                table.setdefault(e["name"], set()).update(e["aliases"])
        entity_table = "\n".join(f"- {n}" + (f"（别名：{'、'.join(sorted(a))}）" if a else "") for n, a in table.items())
        if len(s2) < 2:
            continue
        try:
            c2 = model.ask(t_v2.build_connections_prompt(json.loads(join(s2))) + "\n\n" + lang)
            c3_prompt = t_v3.build_connections_prompt(json.loads(join(s3)))
            if entity_table:
                c3_prompt += "\n\n已知实体表（请沿用这些规范名与别名，不要另起写法）:\n" + entity_table
            c3 = model.ask(c3_prompt + "\n\n" + lang)
            bj = judge(judge_model, JUDGE_BOOK, rng, c2, c3, summaries="\n".join(f"【{t}】{s[:600]}" for t, s in s3))
        except Exception as e:  # noqa: BLE001
            errors.append({"book": b["book"], "chapter": "(书级关联分析)", "error": str(e)[:300]})
            print(f"  x 书级关联分析: {str(e)[:160]}")
            continue
        print(f"  书级关联分析 胜者={bj['winner']}")
        book_rows.append({"book": b["book"], "judge": bj, "v2_chars": len(c2), "v3_chars": len(c3), "entity_table_size": len(table)})

    def agg(ver: str, k: str):
        return sum(r[ver][k] for r in chapter_rows) / len(chapter_rows)

    summary = {
        "model": args.model,
        "judge_model": judge_model.model,
        "n_chapters": len(chapter_rows),
        "n_books": len(book_rows),
        "tokens_used": model.tokens + (judge_model.tokens if judge_model is not model else 0),
        "avg_violations": {v: round(agg(v, "violations"), 2) for v in ("v2", "v3")},
        "avg_chars": {v: round(agg(v, "chars")) for v in ("v2", "v3")},
        "avg_bold": {v: round(agg(v, "bold"), 2) for v in ("v2", "v3")},
        "v3_meta_ok_rate": round(sum(r["v3"]["meta_ok"] for r in chapter_rows) / len(chapter_rows), 2),
        "v3_avg_entities": round(agg("v3", "entities"), 1),
        "v3_avg_aliases": round(agg("v3", "aliases"), 1),
        "chapter_judge": tally([r["judge"] for r in chapter_rows]),
        "book_judge": tally([r["judge"] for r in book_rows]),
        "failed_calls": len(errors),
    }
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps({"summary": summary, "chapters": chapter_rows, "books": book_rows, "errors": errors}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n" + json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
