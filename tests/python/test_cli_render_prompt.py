"""
render_prompt 与真实 YAML 渲染
- 与前端 tests/w2prompt.render.test.ts 共用 tests/fixtures/prompts/render-cases.json
- 真实 v1/v2 YAML：渲染后不含 {{，标题与正文各恰好一次
"""

import json
import logging
import re
from pathlib import Path

import pytest

from src.cli.config import PromptConfig
from src.cli.prompts import PromptTemplates, load_yaml_prompts, prepare_post_process_chapters, render_prompt

FIXTURE = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures" / "prompts" / "render-cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_shared_render_cases(case, caplog):
    variables = FIXTURE[case["vars"]] if isinstance(case["vars"], str) else case["vars"]
    with caplog.at_level(logging.WARNING, logger="src.cli.prompts"):
        assert render_prompt(case["template"], variables) == case["expected"]
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    if case["unknown"]:
        assert len(warnings) == 1 and all(n in warnings[0] for n in case["unknown"])
    else:
        assert warnings == []


def test_no_vars_no_placeholder_returns_template():
    assert render_prompt("原样\n", []) == "原样\n"


TITLE, BODY, BOOK, CONN = "TITLE_MARK_甲", "BODY_MARK_乙" + "正文" * 80, "BOOK_MARK_丙", "CONN_MARK_丁"


def _templates(version: str) -> PromptTemplates:
    return PromptTemplates(prompt_config=PromptConfig(currentVersion=version))


def _names(template: str) -> list[str]:
    return sorted(set(re.findall(r"\{\{\s*(\w+)\s*\}\}", template)))


@pytest.mark.parametrize("version", ["v1", "v2"])
class TestRealYaml:
    @pytest.mark.parametrize("book_type", ["fiction", "non-fiction"])
    def test_chapter(self, version, book_type):
        prompt = _templates(version).build_chapter_prompt(TITLE, BODY, book_type)
        assert "{{" not in prompt
        assert prompt.count(TITLE) == 1 and prompt.count(BODY) == 1
        assert "章节内容:\n" not in prompt  # 模板已引用 {{content}}，不再追加

    def test_connections(self, version):
        items = prepare_post_process_chapters([("CH1_MARK", "SUM1_MARK"), ("CH2_MARK", "SUM2_MARK")])
        prompt = _templates(version).build_connections_prompt(items)
        assert "{{" not in prompt
        for mark in ("CH1_MARK", "SUM1_MARK", "SUM2_MARK"):
            assert prompt.count(mark) == 1

    def test_overall(self, version):
        items = prepare_post_process_chapters([("CH1_MARK", "SUM1_MARK")])
        prompt = _templates(version).build_overall_prompt(BOOK, items, CONN)
        assert "{{" not in prompt
        for mark in (BOOK, "SUM1_MARK", CONN):
            assert prompt.count(mark) == 1
        assert f"《{BOOK}》" in prompt and "书名:" not in prompt

    def test_yaml_placeholder_names_match_code(self, version):
        data = load_yaml_prompts(version)
        assert _names(data["chapterSummary"]["fiction"]) == ["content", "title"]
        assert _names(data["chapterSummary"]["nonFiction"]) == ["content", "title"]
        assert _names(data["connectionAnalysis"]) == ["chapterSummaries"]
        assert _names(data["overallSummary"]) == ["bookTitle", "chapterInfo", "connections"]


def test_v1_chapter_body_sits_in_template_slot():
    """正文落在模板占位处，指令在正文之后（与前端 w2prompt.yamlPrompts 断言一致）"""
    prompt = _templates("v1").build_chapter_prompt("T", "C", "non-fiction")
    assert "章节标题：T\n\n章节内容：\nC\n\n请用自然流畅的语言" in prompt
