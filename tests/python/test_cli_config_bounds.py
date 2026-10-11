"""
配置边界测试：未定义环境变量、validate_config、currentProviderIndex、main 启动校验
"""

import os
import textwrap

import pytest

from src.cli.config import ConfigLoader, active_provider, validate_config

UNDEFINED = "FASTREADER_TEST_UNDEFINED_VAR_7F3A"

BASE = """
webdavConfig:
  serverUrl: "https://dav.example.com/dav/"
  username: "user"
  password: "pass"
batch:
  sourcePath: "/books"
"""


def load(tmp_path, text):
    path = tmp_path / "config.yaml"
    path.write_text(textwrap.dedent(text), encoding="utf-8")
    config = ConfigLoader(str(path)).load()
    assert config is not None
    return config


def providers_yaml(index_line: str, api_key: str = '"k2"') -> str:
    return BASE + f"""
aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "${{{UNDEFINED}}}"
      model: "gemini-1.5-pro"
    - provider: openai
      apiKey: {api_key}
      model: "gpt-4o"
  {index_line}
"""


class TestEnvVars:
    def test_undefined_var_reported_and_not_sent(self, tmp_path):
        os.environ.pop(UNDEFINED, None)
        config = load(tmp_path, providers_yaml("currentModelId: 1"))
        provider = active_provider(config.ai)
        assert provider.apiKey == ""                      # 不会把 "${VAR}" 字面量当密钥
        assert provider.missingEnvVars == [UNDEFINED]
        errors = validate_config(config)
        assert any(UNDEFINED in e for e in errors)

    def test_undefined_var_in_inactive_provider_is_ok(self, tmp_path):
        os.environ.pop(UNDEFINED, None)
        config = load(tmp_path, providers_yaml("currentModelId: 2"))
        assert validate_config(config) == []

    def test_undefined_var_in_webdav(self, tmp_path, monkeypatch):
        monkeypatch.delenv(UNDEFINED, raising=False)
        config = load(tmp_path, f"""
webdav:
  serverUrl: "https://dav.example.com/dav/"
  username: "u"
  password: "${{{UNDEFINED}}}"
ai:
  provider: gemini
  apiKey: k
  model: m
batch:
  sourcePath: /b
""")
        assert config.webdav.password == ""
        assert any(UNDEFINED in e and "webdav" in e for e in validate_config(config))

    def test_defined_var_substituted(self, tmp_path, monkeypatch):
        monkeypatch.setenv(UNDEFINED, "secret")
        config = load(tmp_path, providers_yaml("currentModelId: 1"))
        assert config.ai.providers[0].apiKey == "secret"


class TestProviderIndex:
    def test_explicit_zero_based_index_not_decremented(self, tmp_path):
        config = load(tmp_path, providers_yaml("currentProviderIndex: 1"))
        assert config.ai.currentProviderIndex == 1
        assert active_provider(config.ai).provider == "openai"

    def test_default_index_is_first(self, tmp_path):
        config = load(tmp_path, providers_yaml(""))
        assert config.ai.currentProviderIndex == 0

    @pytest.mark.parametrize("line", ["currentModelId: 3", "currentModelId: 0", "currentProviderIndex: 9"])
    def test_out_of_range_is_error(self, tmp_path, line):
        config = load(tmp_path, providers_yaml(line))
        assert active_provider(config.ai) is None
        assert any("越界" in e for e in validate_config(config))


class TestValidate:
    def single(self, tmp_path, processing="", extra=""):
        return load(tmp_path, BASE + f"""
ai:
  provider: gemini
  apiKey: k
  model: gemini-1.5-pro
processing:
  mode: summary
{processing}
{extra}
""")

    def test_valid_single_provider(self, tmp_path):
        assert validate_config(self.single(tmp_path)) == []

    def test_mindmap_mode_rejected(self, tmp_path):
        config = self.single(tmp_path)
        config.processing.mode = "mindmap"
        assert any("暂不支持 mindmap" in e for e in validate_config(config))

    def test_smart_detection_rejected(self, tmp_path):
        config = self.single(tmp_path)
        config.processing.chapterDetectionMode = "smart"
        assert any("chapterDetectionMode=smart" in e for e in validate_config(config))

    def test_epub_toc_accepted_with_depth(self, tmp_path):
        config = self.single(tmp_path, "  chapterDetectionMode: epub-toc\n  epubTocDepth: 2")
        assert config.processing.epubTocDepth == 2
        assert validate_config(config) == []

    def test_misc_errors(self, tmp_path):
        config = self.single(tmp_path)
        config.ai.provider = "ollama"
        config.ai.apiKey = ""
        config.ai.model = ""
        config.batch.concurrency = 0
        config.batch.maxRetries = -1
        config.batch.sourcePath = ""
        config.webdav.serverUrl = ""
        config.webdav.username = ""
        config.prompts.currentVersion = "v9"
        errors = "\n".join(validate_config(config))
        for needle in ("ollama", "apiKey", "model", "concurrency", "maxRetries", "sourcePath",
                       "serverUrl", "username", "v9"):
            assert needle in errors

    def test_defaults_aligned_with_frontend(self, tmp_path):
        config = self.single(tmp_path)
        assert config.batch.concurrency == 3
        assert config.prompts.currentVersion == "v2"
        assert config.advanced.requestTimeout == 120

    def test_advanced_fields(self, tmp_path):
        config = self.single(tmp_path, extra="advanced:\n  exchangeRate: 7.2\n  requestTimeout: 30\n  promptsDir: /p")
        assert config.advanced.exchangeRate == 7.2
        assert config.advanced.requestTimeout == 30.0
        assert config.advanced.promptsDir == "/p"


@pytest.fixture(autouse=True)
def _no_dotenv(monkeypatch):
    """main() 会加载仓库 .env，测试中禁用以免污染其他用例的环境变量"""
    from src.cli import main as main_mod
    monkeypatch.setattr(main_mod, "_load_env", lambda: None)


class TestMainStartup:
    def test_batch_runs_processor_and_maps_exit_code(self, tmp_path, monkeypatch):
        from unittest.mock import patch
        from src.cli import main as main_mod
        from src.cli.models import BatchResult
        path = tmp_path / "c.yaml"
        path.write_text(providers_yaml("currentModelId: 2"), encoding="utf-8")
        monkeypatch.setattr("sys.argv", ["fastreader", "batch", "-c", str(path)])
        with patch.object(main_mod, "BatchProcessor") as bp:
            bp.return_value.run.return_value = BatchResult(total=1, success=1)
            assert main_mod.main() == 0
            bp.return_value.run.return_value = BatchResult(total=1, failed=1)
            assert main_mod.main() == 1
            bp.return_value.run.side_effect = KeyboardInterrupt
            assert main_mod.main() == 130
            bp.return_value.run.side_effect = RuntimeError("x")
            assert main_mod.main() == 1

    def test_validation_failure_exits_1(self, tmp_path, capsys, monkeypatch):
        from src.cli import main as main_mod
        monkeypatch.delenv(UNDEFINED, raising=False)
        path = tmp_path / "c.yaml"
        path.write_text(providers_yaml("currentModelId: 1"), encoding="utf-8")
        monkeypatch.setattr("sys.argv", ["fastreader", "batch", "-c", str(path)])
        assert main_mod.main() == 1
        assert UNDEFINED in capsys.readouterr().out

    def test_out_of_range_index_exits_1_without_crash(self, tmp_path, capsys, monkeypatch):
        from src.cli import main as main_mod
        path = tmp_path / "c.yaml"
        path.write_text(providers_yaml("currentModelId: 5"), encoding="utf-8")
        monkeypatch.setattr("sys.argv", ["fastreader", "batch", "-c", str(path)])
        assert main_mod.main() == 1
        assert "越界" in capsys.readouterr().out

    def test_dry_run_ok(self, tmp_path, monkeypatch):
        from src.cli import main as main_mod
        path = tmp_path / "c.yaml"
        path.write_text(providers_yaml("currentModelId: 2"), encoding="utf-8")
        monkeypatch.setattr("sys.argv", ["fastreader", "batch", "-c", str(path), "--dry-run"])
        assert main_mod.main() == 0

    def test_missing_file_and_version(self, monkeypatch):
        from src.cli import main as main_mod
        monkeypatch.setattr("sys.argv", ["fastreader", "batch", "-c", "nope.yaml"])
        assert main_mod.main() == 1
        monkeypatch.setattr("sys.argv", ["fastreader", "version"])
        assert main_mod.main() == 0
        monkeypatch.setattr("sys.argv", ["fastreader"])
        assert main_mod.main() == 0


def test_example_config_is_valid(monkeypatch):
    """仓库根 config.example.yaml 在设置所需环境变量后可直接通过校验"""
    from pathlib import Path
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.setenv("JIANGUOYUN_PASSWORD", "y")
    example = Path(__file__).resolve().parents[2] / "config.example.yaml"
    config = ConfigLoader(str(example)).load()
    assert validate_config(config) == []
    monkeypatch.delenv("GEMINI_API_KEY")
    assert any("GEMINI_API_KEY" in e for e in validate_config(ConfigLoader(str(example)).load()))
