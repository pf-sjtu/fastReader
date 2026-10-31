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
