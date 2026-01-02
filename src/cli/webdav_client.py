"""
WebDAV 客户端封装
"""

from typing import Optional
from pathlib import Path
from datetime import datetime
import os

# 尝试导入 webdav 库
_webdav_available = False
try:
    from webdav.client import Client as _WebDAVClient
    _webdav_available = True
except ImportError:
    _WebDAVClient = None

from .models import BookFile
from .logger import Logger


class WebDAVClientWrapper:
    """WebDAV 客户端封装"""

    SUPPORTED_EXTENSIONS = {'.epub', '.pdf'}

    def __init__(self, config, logger: Logger):
        """
        初始化 WebDAV 客户端

        Args:
            config: WebDAV 配置对象
            logger: 日志器
        """
        self.config = config
        self.logger = logger
        self.client = None
        self._connected = False

    def connect(self) -> bool:
        """连接到 WebDAV 服务器"""
        if not _webdav_available:
            self.logger.error("webdav 库未安装，请运行: pip install webdav")
            return False

        try:
            # 构建 WebDAV URL
            server_url = self.config.serverUrl.rstrip('/')
            if not server_url.endswith('/'):
                server_url += '/'

            # 创建客户端
            self.client = _WebDAVClient(
                base_url=server_url,
                username=self.config.username,
                password=self.config.password
            )

            # 测试连接 - 检查同步路径是否存在
            sync_path = self.config.syncPath
            if not sync_path.startswith('/'):
                sync_path = '/' + sync_path

            if self.client.check(sync_path):
                self._connected = True
                self.logger.success(f"WebDAV 连接成功: {server_url}")
                return True
            else:
                self.logger.error(f"WebDAV 连接失败: 无法访问路径 {sync_path}")
                return False

        except Exception as e:
            self.logger.error(f"WebDAV 连接失败: {e}")
            return False

    def disconnect(self):
        """断开连接"""
        self._connected = False
        self.client = None

    def is_connected(self) -> bool:
        """检查是否已连接"""
        return self._connected and self.client is not None

    def list_files(self, path: str) -> list[str]:
        """列出路径下的文件和文件夹"""
        if not self.is_connected():
            return []

        try:
            # 确保路径以 / 开头
            if not path.startswith('/'):
                path = '/' + path

            files = self.client.list(path)
            return [f for f in files if f not in ['.', '..']]
        except Exception as e:
            self.logger.error(f"列出文件失败: {e}")
            return []

    def list_books(self, source_path: str) -> list[BookFile]:
        """列出源路径下的电子书文件"""
        if not self.is_connected():
            return []

        books = []
        full_path = source_path
        if not full_path.startswith('/'):
            full_path = '/' + full_path

        try:
            files = self.list_files(full_path)

            for file_name in files:
                ext = Path(file_name).suffix.lower()
                if ext in self.SUPPORTED_EXTENSIONS:
                    file_path = f"{full_path}/{file_name}" if not full_path.endswith('/') else f"{full_path}{file_name}"

                    # 获取文件信息
                    info = self.get_file_info(file_path)

                    books.append(BookFile(
                        name=file_name,
                        path=file_path,
                        extension=ext,
                        size=info.get('size', 0),
                        last_modified=datetime.fromisoformat(info.get('modified', '2000-01-01T00:00:00'))
                    ))

        except Exception as e:
            self.logger.error(f"扫描电子书失败: {e}")

        return books

    def get_file_info(self, path: str) -> dict:
        """获取文件信息"""
        if not self.is_connected():
            return {}

        try:
            # webdav 库使用 info 方法
            info = self.client.info(path)
            return {
                'size': getattr(info, 'size', 0) or 0,
                'modified': getattr(info, 'mtime', '2000-01-01T00:00:00') or '2000-01-01T00:00:00'
            }
        except Exception:
            return {}

    def file_exists(self, path: str) -> bool:
        """检查文件是否存在"""
        if not self.is_connected():
            return False

        try:
            return self.client.check(path)
        except Exception:
            return False

    def download_file(self, remote_path: str, local_path: str) -> bool:
        """下载文件"""
        if not self.is_connected():
            return False

        try:
            # 确保本地目录存在
            local_dir = Path(local_path).parent
            local_dir.mkdir(parents=True, exist_ok=True)

            # 下载文件
            self.client.download_sync(remote_path=remote_path, local_path=local_path)
            return os.path.exists(local_path)
        except Exception as e:
            self.logger.error(f"下载文件失败: {e}")
            return False

    def download_file_as_text(self, remote_path: str) -> tuple[bool, str]:
        """下载文件作为文本"""
        if not self.is_connected():
            return False, "未连接"

        try:
            content = self.client.download(remote_path)
            return True, content
        except Exception as e:
            self.logger.error(f"下载文件失败: {e}")
            return False, str(e)

    def upload_file(self, remote_path: str, content: str) -> bool:
        """上传文件"""
        if not self.is_connected():
            return False

        try:
            # 确保目录存在
            remote_dir = str(Path(remote_path).parent)
            if remote_dir and remote_dir != '/' and not self.client.check(remote_dir):
                self.client.mkdir(remote_dir)

            # 上传文件
            self.client.upload_sync(remote_path=remote_path, local_path=None, content=content.encode('utf-8'))
            return True
        except Exception as e:
            self.logger.error(f"上传文件失败: {e}")
            return False

    def mkdir(self, path: str) -> bool:
        """创建目录"""
        if not self.is_connected():
            return False

        try:
            if not self.client.check(path):
                self.client.mkdir(path)
            return True
        except Exception as e:
            self.logger.error(f"创建目录失败: {e}")
            return False

    def check_cache_exists(self, book: BookFile) -> bool:
        """检查缓存是否存在"""
        sync_path = self.config.syncPath
        if not sync_path.startswith('/'):
            sync_path = '/' + sync_path

        cache_file = f"{book.sanitized_name}-完整摘要.md"
        cache_path = f"{sync_path}/{cache_file}"

        return self.file_exists(cache_path)
