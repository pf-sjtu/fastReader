"""CLI 直接读取 Web 端导出的旧版配置（2026-08）。

样例由真实导出文件脱敏而来，保留了未加引号的时间戳（PyYAML 为 YAML 1.1，会解析成 datetime）。
"""
from pathlib import Path

import pytest

from src.cli.config import ConfigLoader, active_provider, validate_config
from src.cli.prompts import PromptTemplates

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "config" / "legacy-export-2026-08.yaml"


@pytest.fixture()
def config():
    cfg = ConfigLoader(str(FIXTURE)).load()
    assert cfg is not None
    return cfg


def test_providers_and_current_model_are_one_based(config):
    assert [p.model for p in config.ai.providers] == [
        "grok-4.5:online",
        "gpt-5.6-luna:online",
        "deepseek-v4-flash",
        "MiniMax-M3",
        "glm-5.2",
    ]
    # Web 端 currentModelId=5（1-based）→ CLI 下标 4
    assert config.ai.currentProviderIndex == 4
    assert active_provider(config.ai).model == "glm-5.2"
    assert all(isinstance(p.customFields, dict) for p in config.ai.providers)


def test_webdav_and_processing_fields(config):
    assert config.webdav.serverUrl == "https://dav.example.com/dav/"
    assert config.webdav.syncPath == "/fastReader"
    assert config.processing.bookType == "non-fiction"
    assert config.processing.chapterDetectionMode == "epub-toc"
    assert config.processing.epubTocDepth == 1
    assert config.processing.outputLanguage == "zh"


def test_explicit_prompt_version_is_kept_and_renders_cleanly(config):
    assert config.prompts.currentVersion == "v2"
    tpl = PromptTemplates(config.prompts)
    assert tpl.version == "v2"

    prompt = tpl.build_chapter_prompt("唯一标题ZXQ", "唯一正文ZXQ", config.processing.bookType)
    assert "{{" not in prompt
    assert prompt.count("唯一标题ZXQ") == 1
    assert prompt.count("唯一正文ZXQ") == 1


def test_web_export_has_no_batch_section_and_is_reported_clearly(config):
    # Web 端导出的配置不含 batch 段：用户需自行补 sourcePath，错误信息要明确
    assert validate_config(config) == ["批量处理 sourcePath 不能为空"]


def test_missing_prompt_version_falls_back_to_default_v2(tmp_path):
    """旧文件缺 currentPromptVersion 时，CLI 与前端一样默认 v2。"""
    text = FIXTURE.read_text(encoding="utf-8")
    start = text.index("  currentPromptVersion:")
    end = text.index("\n", start) + 1
    stripped = tmp_path / "no-version.yaml"
    stripped.write_text(text[:start] + text[end:], encoding="utf-8")

    cfg = ConfigLoader(str(stripped)).load()
    assert cfg is not None
    assert cfg.prompts.currentVersion == "v2"
