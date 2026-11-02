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

# 每章：(书型, 类别, 标题, 正文, 期望选型)
#   structured = 结构性强，值得配块；linear = 线性叙述，不该画；relations = 人物关系错综，可画
#   期望选型：flow / compare / concept / hierarchy / none（none = 出块即误画）
CHAPTERS = [
    ("non-fiction", "structured", "第三章 需求信号如何在供应链里被放大", (
        "牛鞭效应描述的是：终端需求只有小幅波动，沿供应链逐级向上游传递时，订单的波动被一级级放大。作者拆出四个环节。"
        "零售商看到销量上升，会按预测多订一点作安全库存；分销商收到的订单已经包含这份冗余，再叠加自己的安全库存后下给制造商；"
        "制造商面对更大的波动，只能按峰值排产并囤积原料；原料供应商收到的订单波动，可能是终端波动的五到十倍。"
        "每一级放大的原因不同：零售端是需求预测的滞后，分销端是批量订货与价格促销，制造端是产能约束与交付周期，供应端是短缺博弈。"
        "作者用一家家电企业三年的订单数据验证：终端销量标准差 8%，渠道订单标准差 21%，工厂排产标准差 37%。"
        "他提出的对策也分层：共享终端销售数据以削弱预测滞后，缩小批量与稳定价格以消除促销扰动，缩短交付周期以降低安全库存需求。"
        "试点企业共享数据后，渠道订单波动从 21% 降到 12%，库存周转天数缩短了 9 天。"
    ) * 2, "flow"),
    ("non-fiction", "structured", "第五章 两种教育路径的取舍", (
        "作者把职业教育与学术教育放在四个维度上比较。入学门槛上，职业教育更看重动手能力，学术教育更看重考试成绩；"
        "培养周期上，职业教育通常两到三年即可就业，学术教育需要四年以上，研究型方向更长；"
        "就业起点上，职业教育毕业生起薪较高、上手快，学术教育毕业生起薪较低但职业天花板更高；"
        "转型灵活性上，职业教育技能针对性强、行业下行时转岗成本高，学术教育的通用能力迁移性更好。"
        "他引用两组追踪数据：毕业五年内，职业路径的平均收入领先 18%；十年后，学术路径反超 6%。"
        "作者的结论是，选择取决于个人对风险的偏好与所在行业的周期，没有普遍优劣；"
        "政策层面应打通两条路径之间的转换通道，让学生在二十五岁之前仍有第二次选择的机会。"
    ) * 2, "compare"),
    ("non-fiction", "structured", "第十一章 两种常被混用的成本", (
        "作者在这一章专门辨析两个被反复混用的概念。沉没成本是已经付出、无法收回的支出，比如已经投入的研发费用与已经花掉的广告预算；"
        "它最容易被误用——人们常因为「已经投了这么多」而继续追加投入，作者把这种现象叫作沉没成本谬误。"
        "机会成本则是为当前这个选择而放弃的次优选项的价值，比如把同一笔钱拿去还债所省下的利息；它看不见，因此常被忽略，"
        "但决策时恰恰必须计入。作者的规则很硬：沉没成本在决策中一律视为零，机会成本则要完整计入。"
        "他用一个例子收束：一个人花 200 元买了电影票，看到一半发现很难看——票钱是沉没成本，不该影响走还是留，"
        "真正该问的是「接下来的两小时我还能做什么」，那才是有可比性的机会成本。"
    ) * 2, "concept"),
    ("non-fiction", "structured", "第十四章 知识的分类体系", (
        "作者把组织知识分成三层：最上层是显性知识，也就是能写下来、能传递的部分，例如操作手册与流程文档；"
        "中间层是隐性知识，存在个人经验里、难以言传，例如老师傅听声音判断机器状态；"
        "最下层是集体默契，只在团队互动中显现，例如一支球队的跑位配合。三层之间的转化才是重点：显性可以培训复制，"
        "隐性只能靠师徒与项目共事来转移，集体默契则依赖稳定的团队与反复协作。"
        "他进一步指出，显性知识里又分两类：事实性知识（知道是什么）与程序性知识（知道怎么做）；"
        "隐性知识里也分两类：认知类（直觉与判断）与技术类（手上的技巧）。这个分类解释了为什么培训能解决一部分问题，"
        "却解决不了员工流动带来的经验断层。"
    ) * 2, "hierarchy"),
    ("non-fiction", "linear", "第七章 他的少年时代", (
        "他生在北方的一个小县城，父亲是中学教员，母亲在供销社工作。少年时他体弱多病，常年在家养着，"
        "反倒因此读了许多父亲书架上的旧书。十四岁那年，一位下乡的老医生看他读书入迷，送了他一本医书，"
        "他从此对人体的运作着了迷。作者写道，这段安静的岁月决定了他此后的气质：不爱热闹，凡事爱问为什么。"
        "他后来回忆，最难忘的是冬天的夜里，母亲在灯下纳鞋底，父亲批改作业，他躺在床上听窗外的风，"
        "觉得世界很大，自己很小，却并不害怕。十六岁他考上省城的卫校，离家的那天，母亲把攒了两年的粮票塞进他的行李。"
        "作者在这一章里没有展开任何论证，只是把这些细节一件件摆出来，让读者感受那个年代一个普通家庭的温度。"
    ) * 2, "none"),
    ("non-fiction", "linear", "第九章 一次失败的远行", (
        "那年夏天他决定独自去西部。出发前三天，他把行李重新打包了五次，最后只带了一个背包和两本笔记。"
        "火车走了两天一夜，窗外的景色从平原变成戈壁。到站后他才发现预订的旅店早已关门，只好在车站的长椅上坐到天亮。"
        "接下来的十天里，他搭过拖拉机，睡过牧民的毡房，也在一场沙尘暴里迷了路。作者描写他第一次真正感到孤独，"
        "并且在孤独里发现自己并不像想象中勇敢。回程的路上他病倒了，是同车厢的一位老太太照顾了他。"
        "他后来说，这次旅行什么目的都没达到，却让他第一次看清了自己。作者以这段经历作为全书情绪的转折点，"
        "但并没有试图总结任何道理，只是安静地讲完，留给读者自己去体会。"
    ) * 2, "none"),
    ("fiction", "linear", "第十章 雨夜敲门", (
        "雨下了一夜。他听见有人敲门，起身去开门，门外站着一个湿透的陌生人。他让那人进来，给他倒了杯热水。"
        "两人坐在灶台边，谁都没先说话。过了一会儿，陌生人说自己只是路过，天亮了就走。"
        "他点点头，把被子抱到里屋，自己靠在门边睡了一夜。天亮时雨停了，陌生人果然走了，只留下桌上叠得整齐的被子。"
        "他后来对这件事一句话也没提过，只是每年初雨的时候会想起那个敲门声。作者在这里没有交代陌生人的来历，"
        "也没有让这件事影响后面任何情节——它只是那个冬天夜里发生的一件事，安静地开始，安静地结束。"
    ) * 2, "none"),
    ("fiction", "relations", "第十二章 三家人的账", (
        "这一章把三个家庭几十年的纠葛一次铺开。老周的弟弟早年借了陈家一笔钱去做买卖，赔光了，钱一直没还；"
        "老周为了替弟弟挡下这笔债，把女儿嫁给了陈家的老二，两家从此表面亲厚、暗里互相提防。"
        "陈家的老二并不知情，只当父亲看中老周家的门第；而他妹妹偏偏与老周的儿子在城里相好了三年。"
        "与此同时，当年经手这笔借款的中间人是老周的旧友，如今成了陈家的账房，他在两边都说得上话，也两边都不得罪。"
        "作者用一场婚宴把这些关系同时推到台前：谁坐在哪一桌、谁先敬酒、谁中途离席，每一处安排都是一次表态。"
        "宴席散后，账房把一本旧账簿交还给老周，上面的数目与陈家说的对不上，故事从这里的裂缝继续往下走。"
    ) * 2, "flow"),
]

# 选型判定：块 → 它能表达的语义标签；章节期望标签命中即算「选型合适」
MERMAID_TAGS = {
    "graph": {"flow", "hierarchy"},
    "flowchart": {"flow", "hierarchy"},
    "sequencediagram": {"flow"},
    "timeline": {"flow"},
    "statediagram-v2": {"flow"},
    "statediagram": {"flow"},
    "mindmap": {"hierarchy"},
    "quadrantchart": {"compare"},
}
GENUI_TAGS = {
    "steps": {"flow"},
    "compare": {"compare"},
    "timeline": {"flow"},
    "hierarchy": {"hierarchy"},
    "concept": {"concept"},
}


def block_tags(block) -> set:
    """这个块表达了什么（认不出来的图型算 other，不影响正确性判定）"""
    if block.lang == "genui":
        from src.cli.genui_schema import parse_genui  # noqa: PLC0415

        r = parse_genui(block.code)
        return {t for n in (r.get("nodes") or []) for t in GENUI_TAGS.get(n["type"], {"other"})}
    if block.lang == "mermaid":
        first = next((ln.strip() for ln in block.code.splitlines() if ln.strip() and not ln.strip().startswith("%%")), "")
        return MERMAID_TAGS.get(first.split(" ")[0].lower(), {"other"})
    return {"other"}


def fits(expect: str, blocks: list) -> bool:
    """选型是否合适：不该画的章节出了块就是误画；该画的章节出块的语义标签要命中期望"""
    if expect == "none":
        return not blocks
    return any(expect in block_tags(b) for b in blocks)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--out", default=".tmp/eval-rich")
    ap.add_argument("--model", default=None)
    ap.add_argument("--only", default=None, help="只跑标题包含这些子串的章节（逗号分隔），用于改措辞后的定向复测")
    args = ap.parse_args()
    only = tuple(s.strip() for s in args.only.split(",") if s.strip()) if args.only else ()
    chapters = [c for c in CHAPTERS if not only or any(s in c[2] for s in only)]
    if not chapters:
        raise SystemExit(f"--only {args.only} 没有匹配到任何章节")

    env = read_env(str(ROOT / ".env"))
    model = Model(env["VITE_TEST_LLM_BASE_URL"], env["VITE_TEST_LLM_API_KEY"], args.model or env.get("VITE_TEST_LLM_MODEL", "MiniMax-M3"), reasoning_effort=None)
    tpl = PromptTemplates()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    def prompt(book_type: str, title: str, text: str, with_guide: bool) -> str:
        p = tpl.build_chapter_prompt(title, text, book_type)
        if with_guide:
            return p
        # 对照组：把整段说明拿掉（等价于「模型不知道有这些块」）
        guide = tpl.expand_rich_guide("{{richBlocksGuide}}")
        return p.replace(guide, "").replace("\n\n\n", "\n\n")

    rows = []
    for book_type, kind, title, text, expect in chapters:
        group = f"{book_type}/{kind}"
        for run in range(args.runs):
            for with_guide in (True, False):
                try:
                    reply = model.ask(prompt(book_type, title, text, with_guide) + "\n\n请用中文输出。")
                except Exception as e:  # noqa: BLE001
                    print(f"× {title} guide={with_guide}: {e}")
                    continue
                body = re.split(r"<!--juhua:meta-->", reply)[0]
                blocks = list_rich_blocks(body)
                bad = [diagnose_block(b) for b in blocks if diagnose_block(b)]
                rows.append({"group": group, "book_type": book_type, "kind": kind, "title": title, "expect": expect,
                             "run": run, "guide": with_guide, "blocks": len(blocks), "langs": [b.lang for b in blocks],
                             "types": sorted({t for b in blocks for t in block_tags(b) if t != "other"}),
                             "fits": fits(expect, blocks), "bad": bad, "prose": prose_length(body),
                             "mermaid": [b.code for b in blocks if b.lang == "mermaid"]})
                (out / f"{kind}-{title[:4]}-{run}-{'g' if with_guide else 'n'}.md").write_text(reply, encoding="utf-8")
                print(f"{group:22s} guide={with_guide!s:5s} blocks={len(blocks)} {[b.lang for b in blocks]} "
                      f"fits={fits(expect, blocks)} bad={bad} prose={prose_length(body)}")

    def agg(group: str, g: bool):
        rs = [r for r in rows if r["group"] == group and r["guide"] == g]
        n = max(len(rs), 1)
        return {"n": len(rs), "出块率": sum(1 for r in rs if r["blocks"]) / n,
                "选型合适率": sum(1 for r in rs if r["fits"]) / n, "块总数": sum(r["blocks"] for r in rs),
                "坏块": sum(len(r["bad"]) for r in rs), "平均正文字数": round(sum(r["prose"] for r in rs) / n)}

    groups = sorted({c[0] + "/" + c[1] for c in chapters})
    summary = {f"{k}/{'有说明' if g else '无说明'}": agg(k, g) for k in groups for g in (True, False)}
    # 结构检查之外，再用网页端同款真解析器复检 mermaid（tests/tour/evalMermaid.test.ts 读这个文件）
    mermaid = [{"title": r["title"], "run": r["run"], "guide": r["guide"], "code": code} for r in rows for code in r["mermaid"]]
    (out / "mermaid.json").write_text(json.dumps(mermaid, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "summary.json").write_text(json.dumps({"summary": summary, "rows": rows, "tokens": model.tokens}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2), "tokens:", model.tokens)
    print(f"mermaid 块 {len(mermaid)} 个已写入 {out / 'mermaid.json'}；用 EVAL_MERMAID_JSON 跑真解析器复检")


if __name__ == "__main__":
    main()
