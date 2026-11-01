"""富内容块：CLI 与前端的镜像等效（共享夹具 tests/fixtures/rich-blocks/cases.json，前端 tests/richBlocks.test.ts 也读它）"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.cli.chapter_meta import check_summary_quality, sanitize_summary  # noqa: E402
from src.cli.genui_schema import parse_genui  # noqa: E402
from src.cli.rich_blocks import fence_rich_block, list_rich_blocks, map_rich_blocks, prose_length, strip_rich_blocks  # noqa: E402
from src.cli.rich_repair import diagnose_block  # noqa: E402

CASES = json.loads((ROOT / "tests" / "fixtures" / "rich-blocks" / "cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES["strip"], ids=lambda c: c["name"])
def test_strip_matches_frontend(case):
    assert strip_rich_blocks(case["input"]) == case["prose"]
    assert prose_length(case["input"]) == len(case["prose"].strip())


@pytest.mark.parametrize("case", CASES["list"], ids=lambda c: c["name"])
def test_list_matches_frontend(case):
    got = [{"lang": b.lang, "code": b.code, "truncated": b.truncated} for b in list_rich_blocks(case["input"])]
    assert got == case["blocks"]


@pytest.mark.parametrize("case", CASES["genui"], ids=lambda c: c["name"])
def test_genui_matches_frontend(case):
    r = parse_genui(case["code"])
    assert r["ok"] is case["ok"]
    if case["ok"]:
        assert [n["type"] for n in r["nodes"]] == case["types"]
    else:
        assert r["error"] == case["error"]


@pytest.mark.parametrize("case", CASES["diagnose"], ids=lambda c: c["name"])
def test_diagnose_matches_frontend(case):
    from src.cli.rich_blocks import RichBlock
    block = RichBlock(case["lang"], case["code"], case["truncated"], "")
    assert diagnose_block(block) == case["error"]


def test_map_keeps_untouched_blocks_verbatim_and_fence_roundtrip():
    md = "前\n\n```mermaid\ngraph LR\nA-->B\n```\n\n后"
    assert map_rich_blocks(md, lambda b, i: b.raw) == md
    assert fence_rich_block("html", "<pre>```x```</pre>").startswith("````html")


def test_mermaid_structural_check_is_a_heuristic():
    from src.cli.rich_blocks import RichBlock
    ok = RichBlock("mermaid", "graph LR\nA-->B", False, "")
    assert diagnose_block(ok) is None
    assert diagnose_block(RichBlock("mermaid", "这不是图", False, ""))
    assert diagnose_block(RichBlock("mermaid", "%% 注释\nsequenceDiagram\nA->>B: hi", False, "")) is None
    assert diagnose_block(RichBlock("mermaid", "", False, ""))


def test_sanitize_and_quality_ignore_rich_blocks():
    block = "```genui\n" + '{"type":"callout","body":"' + "长" * 500 + '"}\n```'
    # 文字很短、块很长：不能蒙混过关
    assert check_summary_quality("短。\n\n" + block, 3000, True, True) == ["tooShort"]
    prose = "足够长的正文。" * 40
    assert check_summary_quality(prose + "\n\n" + block, 3000, True, True) == []
    assert check_summary_quality("无需总结", 3000, True, False) == []
    assert check_summary_quality("x", 100, True, False) == ["noMeta"]
    # 块里的 ** 不计入加粗上限、不被改写
    out = sanitize_summary("**甲**。\n\n" + block.replace("长" * 500, "**块内**"))
    assert "**块内**" in out and "**甲**" in out
