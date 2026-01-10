"""
AI 客户端测试
测试 AI 客户端创建和多提供商支持
"""

import os
import sys
import tempfile
import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from src.cli.config import ConfigLoader, AIConfig, AIProviderConfig
from src.cli.ai_client import (
    AIClient, GeminiClient, OpenAIClient, PromptTemplates,
    create_ai_client, AIResponse
)
from src.cli.logger import Logger


class TestAIClientCreation:
    """AI 客户端创建测试"""

    def test_create_gemini_client(self):
        """测试创建 Gemini 客户端"""
        config = Mock()
        config.provider = "gemini"
        config.model = "gemini-1.5-pro"
        config.apiKey = "test-key"
        config.temperature = 0.7
        config.apiUrl = ""
        config.providers = None  # 单提供商模式
        config.currentProviderIndex = 0

        logger = Logger()
        prompts = PromptTemplates()

        client = create_ai_client(config, logger, prompts)
        assert client is not None
        assert isinstance(client, GeminiClient)
        assert client.model == "gemini-1.5-pro"

    def test_create_openai_client(self):
        """测试创建 OpenAI 客户端"""
        config = Mock()
        config.provider = "openai"
        config.model = "gpt-4o"
        config.apiKey = "test-key"
        config.temperature = 0.5
        config.apiUrl = "https://api.openai.com/v1"
        config.providers = None  # 单提供商模式
        config.currentProviderIndex = 0

        logger = Logger()
        prompts = PromptTemplates()

        client = create_ai_client(config, logger, prompts)
        assert client is not None
        assert isinstance(client, OpenAIClient)
        assert client.model == "gpt-4o"

    def test_create_302ai_client(self):
        """测试创建 302.ai 客户端（使用 OpenAI 兼容接口）"""
        config = Mock()
        config.provider = "302.ai"
        config.model = "glm-4"
        config.apiKey = "test-key"
        config.temperature = 0.7
        config.apiUrl = "http://35.208.227.162:8317/v1"
        config.providers = None  # 单提供商模式
        config.currentProviderIndex = 0

        logger = Logger()
        prompts = PromptTemplates()

        client = create_ai_client(config, logger, prompts)
        assert client is not None
        assert isinstance(client, OpenAIClient)
        assert client.api_url == "http://35.208.227.162:8317/v1"

    def test_multi_provider_config(self):
        """测试多提供商配置"""
        config = AIConfig(
            providers=[
                AIProviderConfig(provider="gemini", apiKey="key1", model="gemini-1"),
                AIProviderConfig(provider="openai", apiKey="key2", model="gpt-4o"),
                AIProviderConfig(provider="302.ai", apiKey="key3", model="glm-4")
            ],
            currentProviderIndex=1  # 选择第二个（openai）
        )

        logger = Logger()
        prompts = PromptTemplates()

        client = create_ai_client(config, logger, prompts)
        assert client is not None
        assert isinstance(client, OpenAIClient)
        assert client.model == "gpt-4o"

    def test_unsupported_provider(self):
        """测试不支持的提供商"""
        config = Mock()
        config.provider = "unsupported-provider"
        config.model = "model"
        config.apiKey = "key"
        config.temperature = 0.7
        config.apiUrl = ""
        config.providers = None  # 单提供商模式
        config.currentProviderIndex = 0

        logger = Logger()
        prompts = PromptTemplates()

        client = create_ai_client(config, logger, prompts)
        assert client is None


class TestAIResponse:
    """AI 响应测试"""

    def test_success_response(self):
        """测试成功响应"""
        response = AIResponse(
            success=True,
            content="Test content",
            input_tokens=100,
            output_tokens=200
        )

        assert response.success is True
        assert response.content == "Test content"
        assert response.input_tokens == 100
        assert response.output_tokens == 200
        assert response.error is None

    def test_error_response(self):
        """测试错误响应"""
        response = AIResponse(
            success=False,
            content="",
            error="API error: rate limit exceeded"
        )

        assert response.success is False
        assert response.content == ""
        assert response.error == "API error: rate limit exceeded"


def write_config_file(config_content):
    """辅助函数：写入配置文件并返回路径（Windows 兼容）"""
    f = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False, encoding='utf-8')
    f.write(config_content)
    f.flush()
    f_name = f.name
    f.close()
    return f_name


class TestPromptTemplatesWithRealConfig:
    """使用真实配置测试 Prompt 模板"""

    def test_load_prompts_from_v2_config(self):
        """测试从 v2 配置加载 Prompt"""
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

currentPromptVersion: v2

promptVersionConfig:
  v1:
    chapterSummary:
      fiction: "v1 fiction prompt"
      nonFiction: "v1 non-fiction prompt"
    connectionAnalysis: "v1 connection prompt"
    overallSummary: "v1 summary prompt"
  v2:
    chapterSummary:
      fiction: "v2 fiction prompt"
      nonFiction: "v2 non-fiction prompt"
    connectionAnalysis: "v2 connection prompt"
    overallSummary: "v2 summary prompt"
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            assert config is not None
            assert "v1" in config.prompts.versions
            assert "v2" in config.prompts.versions
            assert config.prompts.currentVersion == "v2"

            prompts = PromptTemplates(prompt_config=config.prompts)

            # v2 non-fiction 应该使用 v2 的 prompt
            prompt = prompts.get_prompt('chapterSummary', 'non-fiction')
            assert "v2 non-fiction prompt" in prompt

            # v2 fiction 应该使用 v2 的 prompt
            prompt = prompts.get_prompt('chapterSummary', 'fiction')
            assert "v2 fiction prompt" in prompt

            # connectionAnalysis 应该使用 v2 的 prompt
            prompt = prompts.get_prompt('connectionAnalysis')
            assert "v2 connection prompt" in prompt
        finally:
            if os.path.exists(f_name):
                os.unlink(f_name)


class TestGeminiClientWithRealConfig:
    """使用真实配置测试 Gemini 客户端"""

    def test_gemini_client_with_nested_config(self):
        """测试 Gemini 客户端使用嵌套配置"""
        config_content = """
aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "real-api-key"
      model: "gemini-1.5-pro"
      temperature: 0.7
    - provider: openai
      apiKey: "openai-key"
      model: "gpt-4o"
  currentModelId: 1

webdavConfig:
  serverUrl: "https://example.com/dav/"
  username: "user"
  password: "pass"

processingOptions:
  processingMode: "summary"
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            prompts = PromptTemplates(prompt_config=config.prompts)
            client = create_ai_client(config.ai, Logger(), prompts)

            assert client is not None
            assert isinstance(client, GeminiClient)
            assert client.model == "gemini-1.5-pro"
            assert client.api_key == "real-api-key"
            assert client.temperature == 0.7
        finally:
            if os.path.exists(f_name):
                os.unlink(f_name)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
