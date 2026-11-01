"""CLI 自动化与网页在线处理「镜像等效」：质量闸 + 定向重写、富内容块坏块修复、下游 prompt 只喂正文、结构化输出降级。
（前端侧对应：tests/richRepair.test.ts、tests/structuredOutput.test.ts、promptsV3.test.ts；共享夹具保证规则一致）"""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.cli.ai_client import AIResponse, OpenAIClient  # noqa: E402
from src.cli.chapter_extractor import Chapter  # noqa: E402
from src.cli.chapter_summarizer import ChapterOutcome, post_process, summarize_chapters  # noqa: E402
from src.cli.checkpoint import ChapterCheckpoint  # noqa: E402
from src.cli.config import AIProviderConfig  # noqa: E402
from src.cli.prompts import SHARED_STRINGS  # noqa: E402
from src.cli.rich_blocks import list_rich_blocks, strip_rich_blocks  # noqa: E402
from src.cli.structured import RICH_REPAIR_FORMAT  # noqa: E402

F = "```"
META = '\n<!--juhua:meta-->\n{"oneLine":"一句话","takeaways":["a","b","c"],"entities":[],"terms":[]}'
LONG_BODY = "这是一段足够长的章节总结正文。" * 40
BAD_GENUI = f"{F}genui\n{{坏\n{F}"
GOOD_GENUI = '{"type":"callout","body":"好"}'


class FakeAI:
    """脚本化的 AI：按章节标题给总结，记录每次调用"""

    def __init__(self, summaries, repair=None):
        self.summaries = summaries  # title -> [第一次输出, 重写后输出?]
        self.calls = []
        self.repair_calls = []
        self._repair = repair
        self.conn_args = None
        self.overall_args = None

    def summarize_chapter(self, info, book_type, language, hint=None):
        outs = self.summaries[info.title]
        self.calls.append((info.title, hint))
        text = outs[1] if hint and len(outs) > 1 else outs[0]
        return AIResponse(success=True, content=text, input_tokens=10, output_tokens=20)

    def repair_rich_blocks(self, items, language):
        self.repair_calls.append(items)
        fixes = self._repair(items) if self._repair else []
        return fixes, 7, 3

    def analyze_connections(self, chapters, language):
        self.conn_args = chapters
        return AIResponse(success=True, content="关联", input_tokens=1, output_tokens=1)

    def generate_overall_summary(self, title, chapters, connections, language):
        self.overall_args = chapters
        return AIResponse(success=True, content="全书", input_tokens=1, output_tokens=1)


def _run(ai, chapters, tmp_path):
    cp = ChapterCheckpoint(tmp_path / "cp.json", "m", "v3", "non-fiction", "zh")
    outcomes = summarize_chapters(ai, cp, chapters, "non-fiction", "zh", 1)
    return outcomes, cp


def _chapters(*titles, size=3000):
    return [Chapter(index=i, title=t, content="原文" * size) for i, t in enumerate(titles)]


def test_bad_blocks_repaired_once_across_chapters_and_prose_unchanged(tmp_path):
    prose = f"{LONG_BODY}\n\n{BAD_GENUI}\n\n{LONG_BODY}"
    a = f"{prose}{META}"
    b = f"{LONG_BODY}\n\n{F}genui\n{GOOD_GENUI}\n{F}{META}"
    ai = FakeAI({"甲": [a], "乙": [b]}, repair=lambda items: [{"id": it["id"], "code": GOOD_GENUI} for it in items])
    outcomes, cp = _run(ai, _chapters("甲", "乙"), tmp_path)
    assert len(ai.repair_calls) == 1 and len(ai.repair_calls[0]) == 1  # 一次调用，只发坏块
    assert ai.repair_calls[0][0]["error"] == "JSON 无法解析" and "context" in ai.repair_calls[0][0]
    assert [x.code for x in list_rich_blocks(outcomes[0].summary)] == [GOOD_GENUI]
    # 正文逐字不变（清理只裁尾部空白：split_chapter_meta/sanitize_summary 与前端同样是 trim）
    assert strip_rich_blocks(outcomes[0].summary) == strip_rich_blocks(prose)
    # 修好的写回断点（重跑不会重修）
    key = cp.key("甲", "原文" * 3000)
    assert "JSON 无法解析" not in cp.get(key)["summary"] and GOOD_GENUI in cp.get(key)["summary"]
    # 修复的 token 计入
    assert outcomes[0].input_tokens == 10 + 7 and outcomes[0].output_tokens == 20 + 3


def test_unrepairable_block_is_dropped_not_kept(tmp_path):
    ai = FakeAI({"甲": [f"{LONG_BODY}\n\n{BAD_GENUI}\n\n尾段。{META}"]}, repair=lambda items: [{"id": it["id"], "code": None} for it in items])
    outcomes, _ = _run(ai, _chapters("甲"), tmp_path)
    assert list_rich_blocks(outcomes[0].summary) == []
    assert "尾段。" in outcomes[0].summary


def test_repair_failure_does_not_break_the_run(tmp_path):
    def boom(_items):
        raise RuntimeError("网络")

    ai = FakeAI({"甲": [f"{LONG_BODY}\n\n{BAD_GENUI}{META}"]}, repair=boom)
    outcomes, _ = _run(ai, _chapters("甲"), tmp_path)
    assert outcomes[0].status == "ok" and list_rich_blocks(outcomes[0].summary) == []  # 修不好 → 删


def test_no_blocks_means_no_repair_call(tmp_path):
    ai = FakeAI({"甲": [f"{LONG_BODY}{META}"]})
    _run(ai, _chapters("甲"), tmp_path)
    assert ai.repair_calls == []


def test_too_short_triggers_one_targeted_rewrite_with_shared_hint(tmp_path):
    ai = FakeAI({"甲": ["太短。" + META, LONG_BODY + META]})
    outcomes, _ = _run(ai, _chapters("甲"), tmp_path)
    assert [h for _, h in ai.calls] == [None, SHARED_STRINGS["rewriteHintTooShort"]]
    assert outcomes[0].summary == LONG_BODY
    assert outcomes[0].input_tokens == 20 and outcomes[0].output_tokens == 40  # 重写也计费


def test_rewrite_not_adopted_when_clearly_shorter(tmp_path):
    """首轮偏短、重写更短（不足首轮的 80%）：保留首轮（采用规则与前端 bookPipeline 逐字相同）"""
    ai = FakeAI({"甲": ["太短。" + META, "短。" + META]})
    outcomes, _ = _run(ai, _chapters("甲"), tmp_path)
    assert len(ai.calls) == 2 and outcomes[0].summary == "太短。"  # 首轮保留
    assert outcomes[0].input_tokens == 20 and outcomes[0].output_tokens == 40  # 两次调用都计费


def test_long_block_cannot_pass_as_prose(tmp_path):
    """文字很短、块很长：字数只看正文，仍判过短"""
    big = f"{F}genui\n" + '{"type":"callout","body":"' + "长" * 250 + '"}\n' + F
    ai = FakeAI({"甲": [f"短。\n\n{big}{META}", LONG_BODY + META]})
    outcomes, _ = _run(ai, _chapters("甲"), tmp_path)
    assert len(ai.calls) == 2 and outcomes[0].summary == LONG_BODY


def test_downstream_prompts_get_prose_only():
    block = f"{F}mermaid\ngraph LR\nA-->B\n{F}"
    outcomes = [
        ChapterOutcome("甲", f"正文甲。\n\n{block}\n\n结尾。", "ok"),
        ChapterOutcome("乙", block, "ok"),  # 剔完没有正文：不喂
        ChapterOutcome("丙", "正文丙。", "failed"),
    ]
    ai = FakeAI({})
    post_process(ai, outcomes, "书", "zh")
    assert ai.conn_args == [("甲", "正文甲。\n\n结尾。")] == ai.overall_args


# ---- 结构化输出（OpenAI 兼容客户端，SDK 打桩）----


class _Err(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status_code = status


def _client():
    c = OpenAIClient(AIProviderConfig(provider="openai", apiKey="k", apiUrl="https://x/v1", model="m"), MagicMock())
    calls, replies = [], []

    def create(**kw):
        calls.append(kw)
        r = replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    c._client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    ok = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"fixes":[]}'))],
                         usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1))
    return c, calls, replies, ok


def test_openai_sends_json_schema_strict():
    c, calls, replies, ok = _client()
    replies.append(ok)
    c._call("p", "s", 100, fmt=RICH_REPAIR_FORMAT)
    assert calls[0]["response_format"] == {
        "type": "json_schema", "json_schema": {"name": "rich_block_fixes", "strict": True, "schema": RICH_REPAIR_FORMAT["schema"]}}


def test_openai_degrades_schema_then_json_then_none_and_remembers_only_on_success():
    c, calls, replies, ok = _client()
    replies.extend([_Err(400, "response_format json_schema is not supported"), _Err(400, "response_format json_object unsupported"), ok, ok])
    c._call("p", "s", 100, fmt=RICH_REPAIR_FORMAT)
    assert [k.get("response_format", {}).get("type") for k in calls] == ["json_schema", "json_object", None]
    assert c.no_json_schema and c.no_structured
    c._call("p", "s", 100, fmt=RICH_REPAIR_FORMAT)  # 之后直接不带
    assert "response_format" not in calls[3]


def test_openai_failed_probe_is_not_remembered():
    c, calls, replies, ok = _client()
    replies.extend([_Err(400, "response_format not supported"), _Err(500, "boom")])
    with pytest.raises(_Err):
        c._call("p", "s", 100, fmt=RICH_REPAIR_FORMAT)
    assert not c.no_json_schema and not c.no_structured


def test_repair_rich_blocks_parses_fixes_and_tolerates_garbage():
    c, calls, replies, _ = _client()
    good = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"fixes":[{"id":0,"code":"x"},{"id":1,"code":null},{"id":"bad","code":"y"}]}'))],
                           usage=SimpleNamespace(prompt_tokens=5, completion_tokens=6))
    replies.append(good)
    fixes, i, o = c.repair_rich_blocks([{"id": 0, "lang": "html", "error": "e", "code": "c", "context": ""}], "zh")
    assert fixes == [{"id": 0, "code": "x"}, {"id": 1, "code": None}] and (i, o) == (5, 6)
    replies.append(SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="不是 JSON"))],
                                   usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1)))
    assert c.repair_rich_blocks([], "zh")[0] == []
