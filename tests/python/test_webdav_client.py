"""
WebDAV 客户端和批量处理器测试
真实场景测试 - 需要有效的 WebDAV 服务器配置
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

from src.cli.config import ConfigLoader, Config
from src.cli.webdav_client import WebDAVClientWrapper
from src.cli.logger import Logger
from src.cli.batch_processor import BatchProcessor


def write_config_file(config_content):
    """辅助函数：写入配置文件并返回路径（Windows 兼容）"""
    f = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False, encoding='utf-8')
    f.write(config_content)
    f.flush()
    f_name = f.name
    f.close()
    return f_name


class TestWebDAVClient:
    """WebDAV 客户端测试"""

    def test_webdav_client_creation_with_mock(self):
        """测试 WebDAV 客户端创建（使用 Mock）"""
        config = Mock()
        config.serverUrl = "https://example.com/dav/"
        config.username = "testuser"
        config.password = "testpass"
        config.syncPath = "/test"

        logger = Logger()

        # Mock WebDAV 客户端
        with patch('src.cli.webdav_client._WebDAVClient') as mock_client:
            mock_instance = MagicMock()
            mock_client.return_value = mock_instance
            mock_instance.exists.return_value = True

            wrapper = WebDAVClientWrapper(config, logger)
            result = wrapper.connect()

            # 验证客户端创建时使用了正确的参数 (webdav4 使用 auth 关键字参数)
            call_args = mock_client.call_args[0]
            call_kwargs = mock_client.call_args[1]
            assert call_args[0] == "https://example.com/dav"  # base_url 无尾部斜杠
            assert call_kwargs['auth'] == ("testuser", "testpass")  # auth 元组

            # 验证连接检查
            mock_instance.exists.assert_called()

    def test_webdav_client_connection_failure_path_not_exists(self):
        """测试 WebDAV 客户端连接失败（路径不存在）"""
        config = Mock()
        config.serverUrl = "https://example.com/dav/"
        config.username = "testuser"
        config.password = "testpass"
        config.syncPath = "/nonexistent"

        logger = Logger()

        with patch('src.cli.webdav_client._WebDAVClient') as mock_client:
            mock_instance = MagicMock()
            mock_client.return_value = mock_instance
            mock_instance.exists.return_value = False  # 路径不存在

            wrapper = WebDAVClientWrapper(config, logger)
            result = wrapper.connect()

            assert result is False
            mock_instance.exists.assert_called()

    def test_webdav_client_list_files(self):
        """测试 WebDAV 客户端列出文件"""
        config = Mock()
        config.serverUrl = "https://example.com/dav/"
        config.username = "testuser"
        config.password = "testpass"
        config.syncPath = "/books"

        logger = Logger()

        with patch('src.cli.webdav_client._WebDAVClient') as mock_client:
            mock_instance = MagicMock()
            mock_client.return_value = mock_instance
            mock_instance.exists.return_value = True
            # webdav4 的 ls 返回完整路径列表
            mock_instance.ls.return_value = ['books/book1.epub', 'books/book2.pdf', 'books/folder/']
            mock_instance.info.return_value = {'size': 1024, 'modified': '2024-01-01T00:00:00'}

            wrapper = WebDAVClientWrapper(config, logger)
            wrapper.connect()

            files = wrapper.list_files('/books')
            assert len(files) == 3
            assert 'books/book1.epub' in files
            assert 'books/folder/' in files


class TestWebDAVClientWithRealConfig:
    """使用真实配置文件测试 WebDAV 客户端"""

    def test_load_webdav_config_from_nested_format(self):
        """测试从嵌套格式配置加载 WebDAV 配置"""
        config_content = """
webdavConfig:
  serverUrl: "https://dav.jianguoyun.com/dav/"
  username: "test@example.com"
  password: "test_password"
  appName: "fastReader"
  syncPath: "/test_path"
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            assert config.webdav is not None
            assert config.webdav.serverUrl == "https://dav.jianguoyun.com/dav/"
            assert config.webdav.username == "test@example.com"
            assert config.webdav.syncPath == "/test_path"
        finally:
            if os.path.exists(f_name):
                os.unlink(f_name)

    def test_load_webdav_config_from_simple_format(self):
        """测试从简单格式配置加载 WebDAV 配置"""
        config_content = """
webdav:
  serverUrl: "https://dav.example.com/dav/"
  username: "user"
  password: "pass"
  syncPath: "/documents"
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            assert config.webdav is not None
            assert config.webdav.serverUrl == "https://dav.example.com/dav/"
            assert config.webdav.username == "user"
            assert config.webdav.syncPath == "/documents"
        finally:
            if os.path.exists(f_name):
                os.unlink(f_name)


class TestBatchProcessorWithMock:
    """使用 Mock 测试批量处理器"""

    def test_batch_processor_initialization(self):
        """测试批量处理器初始化"""
        config_content = """
aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "test-key"
      model: "gemini-1.5-pro"
  currentModelId: 1

webdavConfig:
  serverUrl: "https://example.com/dav/"
  username: "user"
  password: "pass"
  syncPath: "/books"

processingOptions:
  processingMode: "summary"

batch:
  sourcePath: "/books"
  maxFiles: 5
  skipProcessed: true
  order: "sequential"

output:
  localDir: "output/"
  syncToWebDAV: false
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            logger = Logger()

            with patch('src.cli.batch_processor.WebDAVClientWrapper') as mock_webdav, \
                 patch('src.cli.batch_processor.create_ai_client') as mock_ai:

                mock_webdav_instance = MagicMock()
                mock_webdav.return_value = mock_webdav_instance
                mock_webdav_instance.connect.return_value = True

                mock_ai_instance = MagicMock()
                mock_ai.return_value = mock_ai_instance

                processor = BatchProcessor(config, logger)

                # 验证 WebDAV 客户端和 AI 客户端已创建
                mock_webdav.assert_called_once()
                mock_ai.assert_called_once()
                assert processor.webdav is mock_webdav_instance
                assert processor.ai_client is mock_ai_instance
        finally:
            if os.path.exists(f_name):
                os.unlink(f_name)

    def test_batch_processor_webdav_connection_failure(self):
        """测试批量处理器在 WebDAV 连接失败时的行为"""
        config_content = """
aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "test-key"
      model: "gemini-1.5-pro"
  currentModelId: 1

webdavConfig:
  serverUrl: "https://example.com/dav/"
  username: "user"
  password: "pass"
  syncPath: "/books"

batch:
  sourcePath: "/books"
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            logger = Logger()

            with patch('src.cli.batch_processor.WebDAVClientWrapper') as mock_webdav:
                mock_webdav_instance = MagicMock()
                mock_webdav.return_value = mock_webdav_instance
                mock_webdav_instance.connect.return_value = False  # WebDAV 连接失败

                processor = BatchProcessor(config, logger)
                result = processor.run()

                # 验证返回失败结果
                assert result.failed == 1
                assert 'WebDAV 连接失败' in result.failed_books[0]['error']
        finally:
            if os.path.exists(f_name):
                os.unlink(f_name)

    def test_batch_processor_no_books_found(self):
        """测试批量处理器在没有找到书籍时的行为"""
        config_content = """
aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "test-key"
      model: "gemini-1.5-pro"
  currentModelId: 1

webdavConfig:
  serverUrl: "https://example.com/dav/"
  username: "user"
  password: "pass"
  syncPath: "/books"

batch:
  sourcePath: "/books"
  skipProcessed: false
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            logger = Logger()

            with patch('src.cli.batch_processor.WebDAVClientWrapper') as mock_webdav, \
                 patch('src.cli.batch_processor.create_ai_client') as mock_ai, \
                 patch('builtins.input'):  # Mock 输入

                mock_webdav_instance = MagicMock()
                mock_webdav.return_value = mock_webdav_instance
                mock_webdav_instance.connect.return_value = True
                mock_webdav_instance.list_books.return_value = []  # 没有找到书籍

                mock_ai_instance = MagicMock()
                mock_ai.return_value = mock_ai_instance

                processor = BatchProcessor(config, logger)
                result = processor.run()

                # 验证返回空结果
                assert result.total == 0
                assert result.skipped == 0
        finally:
            if os.path.exists(f_name):
                os.unlink(f_name)


class TestBatchProcessorIntegration:
    """批量处理器集成测试（需要真实环境）"""

    def test_config_with_empty_source_path(self):
        """测试配置中 sourcePath 为空的情况"""
        config_content = """
aiConfigManager:
  providers:
    - provider: gemini
      apiKey: "test-key"
      model: "gemini-1.5-pro"
  currentModelId: 1

webdavConfig:
  serverUrl: "https://example.com/dav/"
  username: "user"
  password: "pass"
  syncPath: "/books"

batch:
  sourcePath: ""
  skipProcessed: true
"""
        f_name = write_config_file(config_content)
        try:
            loader = ConfigLoader(f_name)
            config = loader.load()

            # 验证 batch 配置被正确解析
            assert config.batch is not None
            assert config.batch.sourcePath == ""
            assert config.batch.skipProcessed is True
        finally:
            if os.path.exists(f_name):
                os.unlink(f_name)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
