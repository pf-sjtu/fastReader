"""富内容块说明（rich-blocks-guide.md）的真模型实测：有说明 vs 没说明，各跑同一批章节。

看四件事：出块率（结构性章节该画、线性章节不该画）、块合法率（diagnose_block）、正文长度比（有块不得把文字写短）、总字数。
凭据：.env 的 VITE_TEST_LLM_BASE_URL / VITE_TEST_LLM_API_KEY / VITE_TEST_LLM_MODEL（只读，不打印）。
用法：uv run --no-sync python tests/tour/eval_rich_guide.py [--runs 2] [--out .tmp/eval-rich]
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

import time  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402


def read_env(path: str) -> dict:
    out: dict = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


class Model:
    """OpenAI 兼容 /chat/completions，只用标准库（评测环境不一定装全 CLI 依赖）"""

    def __init__(self, base_url: str, api_key: str, model: str, reasoning_effort: str | None = None):
        self.url, self.key, self.model, self.effort, self.tokens = base_url.rstrip("/") + "/chat/completions", api_key, model, reasoning_effort, 0

    def ask(self, prompt: str) -> str:
        payload = {"model": self.model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3}
        if self.effort:
            payload["reasoning_effort"] = self.effort
        body = json.dumps(payload).encode("utf-8")
        last: Exception | None = None
        for attempt in range(3):
            try:
                req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.key}"})
                with urllib.request.urlopen(req, timeout=900) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                self.tokens += (data.get("usage") or {}).get("total_tokens", 0) or 0
                text = re.sub(r"<think>[\s\S]*?</think>", "", data["choices"][0]["message"].get("content") or "", flags=re.I).strip()
                if not text:
                    raise RuntimeError("返回空内容")
                return text
            except urllib.error.HTTPError as e:
                last = RuntimeError(f"HTTP {e.code}")
                if e.code in (408, 429, 500, 502, 503, 504):
                    time.sleep(20 * (attempt + 1))
                else:
                    break
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"模型调用失败: {last}")


from src.cli.prompts import PromptTemplates  # noqa: E402
from src.cli.rich_blocks import list_rich_blocks, prose_length  # noqa: E402
from src.cli.rich_repair import diagnose_block  # noqa: E402

# (类型, 标题, 正文)：structured = 结构性强，值得配图；linear = 线性叙述，不该画
CHAPTERS = [
    ("structured", "第三章 需求信号如何在供应链里被放大", (
        "牛鞭效应描述的是：终端需求只有小幅波动，沿供应链逐级向上游传递时，订单的波动被一级级放大。作者拆出四个环节。"
        "零售商看到销量上升，会按预测多订一点作安全库存；分销商收到的订单已经包含这份冗余，再叠加自己的安全库存后下给制造商；"
        "制造商面对更大的波动，只能按峰值排产并囤积原料；原料供应商收到的订单波动，可能是终端波动的五到十倍。"
        "每一级放大的原因不同：零售端是需求预测的滞后，分销端是批量订货与价格促销，制造端是产能约束与交付周期，供应端是短缺博弈。"
        "作者用一家家电企业三年的订单数据验证：终端销量标准差 8%，渠道订单标准差 21%，工厂排产标准差 37%。"
        "他提出的对策也分层：共享终端销售数据以削弱预测滞后，缩小批量与稳定价格以消除促销扰动，缩短交付周期以降低安全库存需求。"
        "试点企业共享数据后，渠道订单波动从 21% 降到 12%，库存周转天数缩短了 9 天。"
    ) * 2),
    ("structured", "第五章 两种教育路径的取舍", (
        "作者把职业教育与学术教育放在四个维度上比较。入学门槛上，职业教育更看重动手能力，学术教育更看重考试成绩；"
        "培养周期上，职业教育通常两到三年即可就业，学术教育需要四年以上，研究型方向更长；"
        "就业起点上，职业教育毕业生起薪较高、上手快，学术教育毕业生起薪较低但职业天花板更高；"
        "转型灵活性上，职业教育技能针对性强、行业下行时转岗成本高，学术教育的通用能力迁移性更好。"
        "他引用两组追踪数据：毕业五年内，职业路径的平均收入领先 18%；十年后，学术路径反超 6%。"
        "作者的结论是，选择取决于个人对风险的偏好与所在行业的周期，没有普遍优劣；"
        "政策层面应打通两条路径之间的转换通道，让学生在二十五岁之前仍有第二次选择的机会。"
    ) * 2),
    ("linear", "第七章 他的少年时代", (
        "他生在北方的一个小县城，父亲是中学教员，母亲在供销社工作。少年时他体弱多病，常年在家养着，"
        "反倒因此读了许多父亲书架上的旧书。十四岁那年，一位下乡的老医生看他读书入迷，送了他一本医书，"
        "他从此对人体的运作着了迷。作者写道，这段安静的岁月决定了他此后的气质：不爱热闹，凡事爱问为什么。"
        "他后来回忆，最难忘的是冬天的夜里，母亲在灯下纳鞋底，父亲批改作业，他躺在床上听窗外的风，"
        "觉得世界很大，自己很小，却并不害怕。十六岁他考上省城的卫校，离家的那天，母亲把攒了两年的粮票塞进他的行李。"
        "作者在这一章里没有展开任何论证，只是把这些细节一件件摆出来，让读者感受那个年代一个普通家庭的温度。"
    ) * 2),
    ("linear", "第九章 一次失败的远行", (
        "那年夏天他决定独自去西部。出发前三天，他把行李重新打包了五次，最后只带了一个背包和两本笔记。"
        "火车走了两天一夜，窗外的景色从平原变成戈壁。到站后他才发现预订的旅店早已关门，只好在车站的长椅上坐到天亮。"
        "接下来的十天里，他搭过拖拉机，睡过牧民的毡房，也在一场沙尘暴里迷了路。作者描写他第一次真正感到孤独，"
        "并且在孤独里发现自己并不像想象中勇敢。回程的路上他病倒了，是同车厢的一位老太太照顾了他。"
        "他后来说，这次旅行什么目的都没达到，却让他第一次看清了自己。作者以这段经历作为全书情绪的转折点，"
        "但并没有试图总结任何道理，只是安静地讲完，留给读者自己去体会。"
    ) * 2),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--out", default=".tmp/eval-rich")
    ap.add_argument("--model", default=None)
    args = ap.parse_args()

    env = read_env(str(ROOT / ".env"))
    model = Model(env["VITE_TEST_LLM_BASE_URL"], env["VITE_TEST_LLM_API_KEY"], args.model or env.get("VITE_TEST_LLM_MODEL", "MiniMax-M3"), reasoning_effort=None)
    tpl = PromptTemplates()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    def prompt(title: str, text: str, with_guide: bool) -> str:
        p = tpl.build_chapter_prompt(title, text, "non-fiction")
        if with_guide:
            return p
        # 对照组：把整段说明拿掉（等价于「模型不知道有这些块」）
        guide = tpl.expand_rich_guide("{{richBlocksGuide}}")
        return p.replace(guide, "").replace("\n\n\n", "\n\n")

    rows = []
    for kind, title, text in CHAPTERS:
        for run in range(args.runs):
            for with_guide in (True, False):
                try:
                    reply = model.ask(prompt(title, text, with_guide) + "\n\n请用中文输出。")
                except Exception as e:  # noqa: BLE001
                    print(f"× {title} guide={with_guide}: {e}")
                    continue
                body = re.split(r"<!--juhua:meta-->", reply)[0]
                blocks = list_rich_blocks(body)
                bad = [diagnose_block(b) for b in blocks if diagnose_block(b)]
                rows.append({"kind": kind, "title": title, "run": run, "guide": with_guide, "blocks": len(blocks),
                             "langs": [b.lang for b in blocks], "bad": bad, "prose": prose_length(body)})
                (out / f"{kind}-{title[:4]}-{run}-{'g' if with_guide else 'n'}.md").write_text(reply, encoding="utf-8")
                print(f"{kind:10s} guide={with_guide!s:5s} blocks={len(blocks)} {[b.lang for b in blocks]} bad={bad} prose={prose_length(body)}")

    def agg(kind: str, g: bool):
        rs = [r for r in rows if r["kind"] == kind and r["guide"] == g]
        n = max(len(rs), 1)
        return {"n": len(rs), "出块率": sum(1 for r in rs if r["blocks"]) / n, "块总数": sum(r["blocks"] for r in rs),
                "坏块": sum(len(r["bad"]) for r in rs), "平均正文字数": round(sum(r["prose"] for r in rs) / n)}

    summary = {f"{k}/{'有说明' if g else '无说明'}": agg(k, g) for k in ("structured", "linear") for g in (True, False)}
    (out / "summary.json").write_text(json.dumps({"summary": summary, "rows": rows, "tokens": model.tokens}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2), "tokens:", model.tokens)


if __name__ == "__main__":
    main()
