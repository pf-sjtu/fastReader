"""v3 章节提示词的跨体裁 / 跨语言实测：英文非虚构、中文小说、英文小说、PDF 抽取式噪声文本（断行连字符、页眉页码）。
测四件事：旁路元数据可解析率、质量闸问题数（check_summary_quality）、输出语言是否按要求、小说里富内容块是否被乱用。
样本是自写的合成章节（仓库里没有这几类的真书样本）：结论只说明提示词在这几类输入上不崩，不等于真书评测。
凭据：.env 的 VITE_TEST_LLM_*（只读，不打印）。用法：python tests/tour/eval_v3_genres.py [--runs 2]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_rich_guide import Model, read_env  # noqa: E402
from src.cli.chapter_meta import check_summary_quality, split_chapter_meta  # noqa: E402
from src.cli.prompts import PromptTemplates  # noqa: E402
from src.cli.rich_blocks import list_rich_blocks, prose_length  # noqa: E402

EN_NONFIC = (
    "Chapter 4. The Planning Fallacy. In 1994 the psychologists Roger Buehler, Dale Griffin and Michael Ross asked "
    "university students to estimate how long their senior theses would take. The average best-case guess was 27 days "
    "and the average worst-case guess was 48 days. The actual average was 56 days; fewer than a third finished within "
    "their own worst-case estimate. The authors argue that people build forecasts from the plan in front of them, an "
    "inside view, and neglect the distribution of outcomes for similar projects, the outside view. Kahneman adds a "
    "personal story: his own curriculum project, estimated at two years, took eight, and a colleague had warned that "
    "comparable teams failed to finish at all in 40% of cases. The remedy is reference-class forecasting: start from "
    "the base rate of comparable projects, then adjust modestly for the specifics. Organisations that adopted it, "
    "such as the UK Treasury for large infrastructure bids, reduced overruns, though political incentives still "
    "reward optimism. The chapter closes by noting that awareness alone does not cure the bias."
) * 2
ZH_FIC = (
    "第十二章 雪夜。腊月二十三，大雪封了山路。林舟把最后一块炭添进火盆，听见院门被人拍响。门外站着三年没有音讯的"
    "哥哥林渡，棉袍上结着冰，怀里却抱着一只用红布裹着的木匣。母亲从里屋出来，手里的灯晃了一下，什么也没问，只让他进屋。"
    "夜里林舟听见兄长压低声音对母亲说，匣子里是城里布庄的账册，掌柜已经死了，有人在找它。林舟想起白天路过村口时，"
    "看见两个陌生人在茶棚里向老板打听姓林的人家。他没有说话，悄悄把柴刀挪到了床边。天亮前雪停了，林渡把木匣埋在灶膛下，"
    "叮嘱弟弟无论如何不要对任何人提起。这一章在林舟的忐忑里结束，那只红布包裹的木匣成了贯穿全篇的悬念。"
) * 2
EN_FIC = (
    "Chapter Nine. The Lighthouse Keeper's Daughter. Marguerite had not climbed the stairs since the night her father "
    "disappeared, but the storm left her no choice: the lamp had gone dark and a ship was somewhere beyond the rocks. "
    "Two hundred and twelve steps, she counted, as he had taught her. At the top she found his logbook open on the "
    "table, the last entry dated the day he vanished, and beside it a key she did not recognise. She lit the lamp, "
    "and in its first sweep the beam caught a small boat drawn up on the shingle where no boat should be. "
    "Downstairs the door banged; a man's voice she knew called her name, and it was the voice of a man who was "
    "supposed to be dead. The chapter ends with her hand on the key and the lamp turning above her."
) * 2
PDF_NOISE = (
    "Journal of Applied Economics   Vol. 12   No. 3   —   page 47\n"
    "The rela-\ntionship between mini-\nmum wages and employ-\nment has been studied exten-\nsively since 1994. "
    "Card and Krueger compared fast-food restaurants in New Jersey and Penn-\nsylvania before and after the "
    "New Jersey increase and found no loss of employment. Subsequent re-\nanalyses using payroll data "
    "reached mixed conclusions: some found small negative effects for teenagers, others none.\n"
    "47\nJournal of Applied Economics   Vol. 12   No. 3\n"
    "A 2019 meta-analysis of 72 studies reported a median own-wage elasticity of employment of -0.05, "
    "well inside the range consistent with a zero effect. The author concludes that moderate increases "
    "appear to have limited disemployment effects but cautions that large increases are out-of-sample.\n"
    "48\n"
) * 3

SAMPLES = [
    ("英文非虚构", "non-fiction", EN_NONFIC, "Chapter 4. The Planning Fallacy"),
    ("中文小说", "fiction", ZH_FIC, "第十二章 雪夜"),
    ("英文小说", "fiction", EN_FIC, "Chapter Nine. The Lighthouse Keeper's Daughter"),
    ("PDF 噪声", "non-fiction", PDF_NOISE, "Minimum Wages and Employment"),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--out", default=".tmp/eval-genres")
    args = ap.parse_args()
    env = read_env(str(ROOT / ".env"))
    model = Model(env["VITE_TEST_LLM_BASE_URL"], env["VITE_TEST_LLM_API_KEY"], env.get("VITE_TEST_LLM_MODEL", "MiniMax-M3"))
    tpl = PromptTemplates()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for label, btype, text, title in SAMPLES:
        for run in range(args.runs):
            prompt = tpl.build_chapter_prompt(title, text, btype) + "\n\n请用中文输出。"
            try:
                reply = model.ask(prompt)
            except Exception as e:  # noqa: BLE001
                print(f"× {label}: {e}")
                continue
            prose, meta = split_chapter_meta(reply)
            issues = check_summary_quality(prose, len(text), True, meta is not None)
            cjk = len(re.findall(r"[一-鿿]", prose))
            latin = len(re.findall(r"[A-Za-z]", prose))
            rows.append({"sample": label, "meta": meta is not None, "issues": issues, "prose": prose_length(prose),
                         "zh_ratio": round(cjk / max(cjk + latin, 1), 2), "blocks": len(list_rich_blocks(prose)),
                         "hyphen_leak": bool(re.search(r"[a-z]-\n[a-z]", prose))})
            (out / f"{label}-{run}.md").write_text(reply, encoding="utf-8")
            r = rows[-1]
            print(f"{label:8s} meta={r['meta']} issues={r['issues']} prose={r['prose']} zh={r['zh_ratio']} blocks={r['blocks']}")
    summary = {}
    for label, *_ in SAMPLES:
        rs = [r for r in rows if r["sample"] == label]
        n = max(len(rs), 1)
        summary[label] = {"n": len(rs), "旁路可解析率": sum(r["meta"] for r in rs) / n, "质量闸问题数": sum(len(r["issues"]) for r in rs),
                          "平均正文字数": round(sum(r["prose"] for r in rs) / n), "中文占比": round(sum(r["zh_ratio"] for r in rs) / n, 2),
                          "块数": sum(r["blocks"] for r in rs)}
    (out / "summary.json").write_text(json.dumps({"summary": summary, "rows": rows, "tokens": model.tokens}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2), "tokens:", model.tokens)


if __name__ == "__main__":
    main()
