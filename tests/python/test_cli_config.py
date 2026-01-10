"""
CLI 配置测试
测试配置加载功能，包括多提供商配置和嵌套结构
"""

import os
import sys
import tempfile
import pytest
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from src.cli.config import ConfigLoader, Config, AIConfig, PromptConfig


def write_config_file(config_content):
    """辅助函数：写入配置文件并返回路径"""
    f = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False, encoding='utf-8')
    f.write(config_content)
    f.flush()
    f_name = f.name
    f.close()
    return f_name


def cleanup_config_file(f_name):
    """辅助函数：清理配置文件"""
    try:
        os.unlink(f_name)
    except PermissionError:
        pass  # Windows 文件锁定问题


class TestConfigLoader:
    """配置加载器测试"""

    def test_load_simple_config(self):
        """测试加载简单配置文件"""
        config_content = """
webdav:
  serverUrl: "https://dav.example.com/dav/"
  username: "test@example.com"
  password: "test123"
  syncPath: "/books"

ai:
  provider: "gemini"
  apiKey: "test-api-key"
  model: "gemini-1.5-pro"
  temperature: 0.7

processing:
  mode: "summary"
  bookType: "non-fiction"
  chapterDetectionMode: "normal"
  outputLanguage: "zh"

batch:
  sourcePath: "/my-books"
  maxFiles: 10
  skipProcessed: true
  order: "sequential"
  concurrency: 1
  maxRetries: 3
  retryDelays: [60, 120, 240]

output:
  localDir: "output/"
  logDir: "log/"
  syncToWebDAV: true

advanced:
  exchangeRate: 7.0
  debug: false
  queuePrefetchCount: 10
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            assert config is not None
            assert config.webdav.serverUrl == "https://dav.example.com/dav/"
            assert config.webdav.username == "test@example.com"
            assert config.webdav.syncPath == "/books"

            assert config.ai.provider == "gemini"
            assert config.ai.apiKey == "test-api-key"
            assert config.ai.model == "gemini-1.5-pro"

            assert config.processing.mode == "summary"
            assert config.processing.bookType == "non-fiction"
            assert config.processing.outputLanguage == "zh"

            assert config.batch.sourcePath == "/my-books"
            assert config.batch.maxFiles == 10
            assert config.batch.skipProcessed is True

            assert config.output.localDir == "output/"
            assert config.output.syncToWebDAV is True
        finally:
            cleanup_config_file(f_name)

    def test_load_nested_config(self):
        """测试加载嵌套配置文件（如 Web UI 导出格式）"""
        config_content = """
aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "gemini-key"
      model: "gemini-1.5-pro"
      temperature: 0.7
    - provider: openai
      apiKey: "openai-key"
      model: "gpt-4o"
      apiUrl: "https://api.openai.com/v1"
      temperature: 0.7
  currentModelId: 1

webdavConfig:
  serverUrl: "https://dav.jianguoyun.com/dav/"
  username: "test@example.com"
  password: "test123"
  syncPath: "/fastReader"

processingOptions:
  processingMode: "summary"
  bookType: "non-fiction"
  outputLanguage: "zh"
  chapterDetectionMode: "epub-toc"

currentPromptVersion: v2

promptVersionConfig:
  v1:
    chapterSummary:
      fiction: " fiction prompt v1"
      nonFiction: "non-fiction prompt v1"
    connectionAnalysis: "connection prompt v1"
    overallSummary: "summary prompt v1"
  v2:
    chapterSummary:
      fiction: "fiction prompt v2"
      nonFiction: "non-fiction prompt v2"
    connectionAnalysis: "connection prompt v2"
    overallSummary: "summary prompt v2"
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            assert config is not None

            # 测试多提供商解析
            assert len(config.ai.providers) == 2
            assert config.ai.currentProviderIndex == 0  # currentModelId: 1 → index 0

            current = config.ai.providers[config.ai.currentProviderIndex]
            assert current.provider == "gemini"
            assert current.model == "gemini-1.5-pro"

            # 测试 WebDAV 解析
            assert config.webdav.serverUrl == "https://dav.jianguoyun.com/dav/"

            # 测试处理选项解析
            assert config.processing.mode == "summary"
            assert config.processing.chapterDetectionMode == "epub-toc"

            # 测试 Prompt 解析
            assert "v1" in config.prompts.versions
            assert "v2" in config.prompts.versions
            assert config.prompts.currentVersion == "v2"
        finally:
            cleanup_config_file(f_name)

    def test_currentModelId_index_conversion(self):
        """测试 currentModelId 索引转换（1-based → 0-based）"""
        config_content = """
aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "key1"
      model: "model1"
    - provider: openai
      apiKey: "key2"
      model: "model2"
    - provider: 302.ai
      apiKey: "key3"
      model: "model3"
  currentModelId: 2

webdavConfig:
  serverUrl: "https://example.com/dav/"
  username: "user"
  password: "pass"
  syncPath: "/books"
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            # currentModelId: 2 应该转换为 index 1 (第二个提供商)
            assert config.ai.currentProviderIndex == 1
            assert config.ai.providers[config.ai.currentProviderIndex].model == "model2"
        finally:
            cleanup_config_file(f_name)

    def test_environment_variable_substitution(self):
        """测试环境变量替换"""
        # 设置环境变量
        os.environ["TEST_API_KEY"] = "env-api-key-123"
        os.environ["TEST_PASSWORD"] = "env-password-456"

        config_content = """
webdavConfig:
  serverUrl: "https://example.com/dav/"
  username: "user"
  password: "${TEST_PASSWORD}"
  syncPath: "/books"

aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "${TEST_API_KEY}"
      model: "model1"
  currentModelId: 1

processingOptions:
  processingMode: "summary"
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            assert config.ai.providers[0].apiKey == "env-api-key-123"
            assert config.webdav.password == "env-password-456"
        finally:
            # 清理环境变量
            del os.environ["TEST_API_KEY"]
            del os.environ["TEST_PASSWORD"]
            cleanup_config_file(f_name)

    def test_missing_config_file(self):
        """测试加载不存在的配置文件"""
        loader = ConfigLoader("/nonexistent/path/config.yaml")
        config = loader.load()
        assert config is None

    def test_empty_config_file(self):
        """测试加载空配置文件"""
        f_name = write_config_file("")
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()
            assert config is None
        finally:
            cleanup_config_file(f_name)


class TestPromptTemplates:
    """Prompt 模板测试"""

    def test_default_prompts_v2_non_fiction(self):
        """测试 v2 非小说默认 Prompt"""
        from src.cli.ai_client import PromptTemplates

        prompts = PromptTemplates(prompt_config=None)
        prompt = prompts.get_prompt('chapterSummary', 'non-fiction')

        assert prompt != ""
        assert "角色" in prompt or "summarize" in prompt.lower()

    def test_default_prompts_v2_fiction(self):
        """测试 v2 小说默认 Prompt"""
        from src.cli.ai_client import PromptTemplates

        prompts = PromptTemplates(prompt_config=None)
        prompt = prompts.get_prompt('chapterSummary', 'fiction')

        assert prompt != ""

    def test_config_prompts_override_defaults(self):
        """测试配置中的 Prompt 覆盖默认值"""
        config_content = """
aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "key"
      model: "model"
  currentModelId: 1

webdavConfig:
  serverUrl: "https://example.com/dav/"
  username: "user"
  password: "pass"

processingOptions:
  processingMode: "summary"

currentPromptVersion: v1

promptVersionConfig:
  v1:
    chapterSummary:
      nonFiction: "CUSTOM NON-FICTION PROMPT v1"
      fiction: "CUSTOM FICTION PROMPT v1"
    connectionAnalysis: "CUSTOM CONNECTION PROMPT"
    overallSummary: "CUSTOM SUMMARY PROMPT"
  v2:
    chapterSummary:
      nonFiction: "CUSTOM NON-FICTION PROMPT v2"
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            from src.cli.ai_client import PromptTemplates
            prompts = PromptTemplates(prompt_config=config.prompts)

            # v1 non-fiction 应该使用自定义 prompt
            prompt = prompts.get_prompt('chapterSummary', 'non-fiction')
            assert "CUSTOM NON-FICTION PROMPT v1" in prompt
        finally:
            cleanup_config_file(f_name)

    def test_format_prompt(self):
        """测试 Prompt 格式化"""
        from src.cli.ai_client import PromptTemplates

        prompts = PromptTemplates(prompt_config=None)
        template = "Hello {{name}}, your score is {{score}}"
        formatted = prompts.format_prompt(template, name="Alice", score=95)

        assert "Alice" in formatted
        assert "95" in formatted
        assert "{{name}}" not in formatted


class TestConfigValidation:
    """配置验证测试"""

    def test_valid_config(self):
        """测试有效配置"""
        config_content = """
webdavConfig:
  serverUrl: "https://example.com/dav/"
  username: "user"
  password: "pass"

aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "api-key"
      model: "model"
  currentModelId: 1

processingOptions:
  processingMode: "summary"

batch:
  sourcePath: "/books"
"""
        f_name = write_config_file(config_content)
        try:
            from src.cli.config import validate_config
            loader = ConfigLoader(f_name)
            config = loader.load()

            errors = validate_config(config)
            # 有效配置应该没有严重错误
            assert isinstance(errors, list)
        finally:
            cleanup_config_file(f_name)


class TestRealConfigFiles:
    """使用真实配置文件测试"""

    def test_load_v2_config(self):
        """测试加载 Web UI 导出的 v2 配置文件"""
        config_path = project_root / "ebook-to-mindmap-config-v2.yaml"

        if not config_path.exists():
            pytest.skip("ebook-to-mindmap-config-v2.yaml not found")

        loader = ConfigLoader(str(config_path))
        config = loader.load()

        assert config is not None
        assert len(config.ai.providers) == 7
        assert config.ai.currentProviderIndex == 1  # currentModelId: 2
        assert "v1" in config.prompts.versions
        assert "v2" in config.prompts.versions

    def test_load_v1_config_if_exists(self):
        """测试加载 Web UI 导出的 v1 配置文件（如果存在）"""
        config_path = project_root / "ebook-to-mindmap-config-v1.yaml"

        if not config_path.exists():
            pytest.skip("ebook-to-mindmap-config-v1.yaml not found")

        loader = ConfigLoader(str(config_path))
        config = loader.load()

        assert config is not None
        assert len(config.ai.providers) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
