"""提示词与零散文案的单一来源：CLI 读的就是前端读的那份 config/ 文件（tests/promptsShared.test.ts 是前端侧守卫）"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.cli.prompts import (  # noqa: E402
    DEFAULT_PROMPTS_DIR, LANGUAGE_INSTRUCTIONS, SHARED_STRINGS, PromptTemplates, get_language_instruction, load_shared_text,
)
from src.cli.structured import RICH_REPAIR_FORMAT  # noqa: E402


def _json(name):
    return json.loads((DEFAULT_PROMPTS_DIR / name).read_text(encoding="utf-8-sig"))


def test_language_instructions_come_from_shared_json():
    table = _json("language-instructions.json")
    for lang in ("zh", "en", "ja", "fr", "de", "es", "ru"):
        assert get_language_instruction(lang) == table[lang]
    # CLI 没有界面语言：auto 用双语指令
    assert LANGUAGE_INSTRUCTIONS["auto"] == table["autoNoUi"]


def test_rewrite_hint_uses_shared_header():
    p = PromptTemplates().build_chapter_prompt("章", "正文" * 10, "non-fiction", hint=SHARED_STRINGS["rewriteHintTooShort"])
    assert SHARED_STRINGS["rewriteHeader"] in p and SHARED_STRINGS["rewriteHintTooShort"] in p
    # 不带说明时没有这一段
    assert SHARED_STRINGS["rewriteHeader"] not in PromptTemplates().build_chapter_prompt("章", "正文", "non-fiction")


def test_rich_repair_prompt_and_schema_shared():
    p = PromptTemplates().build_rich_repair_prompt([{"id": 0, "lang": "genui", "error": "JSON 无法解析", "code": "{坏", "context": "前文"}])
    assert "排版修复员" in p and '"id":0' in p and "{{blocks}}" not in p
    assert RICH_REPAIR_FORMAT == _json("rich-repair.schema.json")
    assert load_shared_text("rich-repair.md") == (DEFAULT_PROMPTS_DIR / "rich-repair.md").read_text(encoding="utf-8-sig").strip()


def test_custom_prompts_dir_without_shared_file_falls_back(tmp_path):
    assert "排版修复员" in PromptTemplates(prompts_dir=str(tmp_path)).build_rich_repair_prompt([])
