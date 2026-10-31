"""v3 章节旁路：与前端共用 tests/fixtures/prompts-v3/meta-cases.json"""
import json
from pathlib import Path

import pytest

from src.cli.chapter_meta import clean_chapter_summary, sanitize_summary, split_chapter_meta
from src.cli.prompts import DEFAULT_PROMPT_VERSION, SUPPORTED_PROMPT_VERSIONS, load_yaml_prompts

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures" / "prompts-v3" / "meta-cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES["split"], ids=lambda c: c["name"])
def test_split_matches_frontend(case):
    text, meta = split_chapter_meta(case["raw"])
    assert text == case["text"]
    if case["meta"] is None:
        assert meta is None
    else:
        assert meta is not None
        for key, value in case["meta"].items():
            if key == "entities":
                assert [e["name"] for e in meta["entities"]] == [e["name"] for e in value]
                assert [e["aliases"] for e in meta["entities"]] == [e.get("aliases", []) for e in value]
            else:
                assert meta[key] == value


@pytest.mark.parametrize("case", CASES["sanitize"], ids=lambda c: c["name"])
def test_sanitize_matches_frontend(case):
    assert sanitize_summary(case["input"]) == case["output"]


def test_clean_chapter_summary_drops_meta_and_fixes_format():
    raw = "# 标题\n正文***洞察***\n<!--juhua:meta-->\n{\"oneLine\":\"x\",\"takeaways\":[],\"entities\":[],\"terms\":[]}"
    assert clean_chapter_summary(raw) == "标题\n正文**洞察**"


def test_v3_is_default_and_v2_still_loads():
    assert DEFAULT_PROMPT_VERSION == "v3"
    assert SUPPORTED_PROMPT_VERSIONS == ("v2", "v3")
    v2 = load_yaml_prompts("v2")["chapterSummary"]["nonFiction"]
    v3 = load_yaml_prompts("v3")["chapterSummary"]["nonFiction"]
    assert v2 != v3
    assert "<!--juhua:meta-->" in v3 and "<!--juhua:meta-->" not in v2


def test_legacy_v2_entries_equal_to_v2_default_follow_v3_but_customized_ones_stay():
    """旧导出里只存在 v2 条目：没改过的（== v2 默认全文）跟随 v3；改过的保持原样（与前端导入的覆盖项语义一致）"""
    from src.cli.config import PromptConfig, PromptVersionConfig
    from src.cli.prompts import PromptTemplates

    v2 = load_yaml_prompts("v2")
    v3 = load_yaml_prompts("v3")
    cfg = PromptConfig(
        currentVersion="v3",
        versions={
            "v2": PromptVersionConfig(
                chapterSummary_nonFiction=v2["chapterSummary"]["nonFiction"],  # 未改：等于 v2 默认
                chapterSummary_fiction="我自己写的小说提示词",  # 改过
                connectionAnalysis=v2["connectionAnalysis"],
            )
        },
    )
    t = PromptTemplates(prompt_config=cfg)
    assert t.get_prompt("chapterSummary", "non-fiction") == v3["chapterSummary"]["nonFiction"]
    assert t.get_prompt("chapterSummary", "fiction") == "我自己写的小说提示词"
    assert t.get_prompt("connectionAnalysis") == v3["connectionAnalysis"]
