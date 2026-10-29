"""CLI 读取 2.0.0（服务商化）配置。

`export-v2.sample.yaml` 由前端 `ConfigExportService.exportConfig()` 从
`legacy-export-2026-08.yaml` 折叠导出而来，因此这里的断言同时校验：
1) 前端 1.0.0 → 服务商 的折叠规则；2) CLI 对 2.0.0 结构的解析；3) 两端契约一致。
"""
from pathlib import Path

import pytest

from src.cli.config import ConfigLoader, active_provider
from src.cli.prompts import PromptTemplates

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "config" / "export-v2.sample.yaml"


@pytest.fixture()
def config():
    cfg = ConfigLoader(str(FIXTURE)).load()
    assert cfg is not None
    return cfg


def test_providers_are_flattened_from_models(config):
    """2.0.0 的一个服务商 + 5 个模型 → CLI 的 5 条 provider（保持既有多提供商模型）"""
    assert [p.model for p in config.ai.providers] == [
        "grok-4.5:online",
        "gpt-5.6-luna:online",
        "deepseek-v4-flash",
        "MiniMax-M3",
        "glm-5.2",
    ]
    # 所有条目共用服务商的 baseUrl
    assert {p.apiUrl for p in config.ai.providers} == {"https://llm.example.com/v1"}
    # active 指向 glm-5.2
    assert active_provider(config.ai).model == "glm-5.2"


def test_export_without_secrets_leaves_key_for_env(monkeypatch):
    """脱敏导出的密钥是 ${VAR} 占位：未设置环境变量时应为空并记入 missingEnvVars"""
    config = ConfigLoader(str(FIXTURE)).load()
    assert config is not None
    assert config.ai.providers[0].apiKey == ""
    assert any("FASTREADER_PROVIDER" in name for name in config.ai.providers[0].missingEnvVars)

    # 设置环境变量后即可直接使用（CLI 与前端共用同一份导出）
    monkeypatch.setenv("FASTREADER_PROVIDER_LLM_EXAMPLE_COM_KEY", "sk-from-env")
    refreshed = ConfigLoader(str(FIXTURE)).load()
    assert refreshed is not None
    assert refreshed.ai.providers[0].apiKey == "sk-from-env"


def test_processing_and_prompt_fields(config):
    assert config.processing.mode == "summary"
    assert config.processing.bookType == "non-fiction"
    assert config.processing.outputLanguage == "zh"

    # 2.0.0 只存「相对默认的覆盖项」；渲染后不应残留字面占位符
    templates = PromptTemplates(prompt_config=config.prompts)
    prompt = templates.build_chapter_prompt("标题ZXQ", "正文ZXQ", "non-fiction")
    assert "标题ZXQ" in prompt and "{{" not in prompt


def test_legacy_v1_declaration_still_loads():
    """1.0.0 里声明 currentPromptVersion: v1 的配置仍可加载并回退 v2"""
    legacy = Path(__file__).resolve().parents[1] / "fixtures" / "config" / "legacy-export-2026-08.yaml"
    config = ConfigLoader(str(legacy)).load()
    assert config is not None
    templates = PromptTemplates(prompt_config=config.prompts)
    rendered = templates.build_chapter_prompt("标题ZXQ", "正文ZXQ", "non-fiction")
    assert "标题ZXQ" in rendered and "{{" not in rendered
