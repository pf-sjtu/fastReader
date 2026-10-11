"""
章节跳过词：CLI 与前端共用 tests/fixtures/chapter-skip-cases.json（skip 字段）
"""

import json
from pathlib import Path

import pytest

from src.cli.chapter_extractor import matches_skip_title

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures" / "chapter-skip-cases.json").read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["title"] or "<empty>" for c in CASES])
def test_shared_skip_cases(case):
    assert matches_skip_title(case["title"]) is case["skip"]


def test_leading_noise_is_stripped_but_letters_kept():
    assert matches_skip_title("§ 2. — Copyright")
    assert matches_skip_title("①目录")
    assert not matches_skip_title("x Copyright")
