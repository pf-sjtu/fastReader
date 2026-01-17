"""
WebDAV 客户端封装
使用 webdav4 库 (https://github.com/skshetry/webdav4)
"""

from typing import Optional, Any, List


from pathlib import Path
from datetime import datetime
import os
import time

# 尝试导入 webdav4 库
_webdav_available = False
try:
    from webdav4.client import Client as _WebDAVClient
    from webdav4.client import HTTPError

    _webdav_available = True
except ImportError:
    _WebDAVClient = None
    HTTPError = Exception

from .models import BookFile
from .logger import Logger


class WebDAVClientWrapper:
    """WebDAV 客户端封装"""

    SUPPORTED_EXTENSIONS = {".epub", ".pdf"}

    # 重试配置
    MAX_RETRIES = 3
    RETRY_DELAY = 5  # 秒

    def __init__(self, config, logger: Logger):
        """
        初始化 WebDAV 客户端

        Args:
            config: WebDAV 配置对象
            logger: 日志器
        """
        self.config = config
        self.logger = logger
        self.client: Optional[Any] = None

        self._connected = False

    def _with_retry(self, func, operation_name: str = "操作") -> bool:
        """带重试的函数执行"""
        last_error = None
        for attempt in range(self.MAX_RETRIES):
            try:
                return func()
            except HTTPError as e:
                error_msg = str(e)
                # 检查是否是 503 错误（服务暂时不可用）
                if "503" in error_msg:
                    last_error = e
                    if attempt < self.MAX_RETRIES - 1:
                        wait_time = self.RETRY_DELAY * (attempt + 1)
                        self.logger.warning(
                            f"{operation_name} 失败 (503), {wait_time}秒后重试..."
                        )
                        time.sleep(wait_time)
                    else:
                        self.logger.error(f"{operation_name} 多次失败: {e}")
                else:
                    raise
            except Exception as e:
                raise

        return False

    def connect(self) -> bool:
        """连接到 WebDAV 服务器"""
        if not _webdav_available:
            self.logger.error("webdav4 库未安装，请运行: pip install webdav4")
            return False

        try:
            # 构建 WebDAV URL（webdav4 会自动处理尾部斜杠）
            server_url = self.config.serverUrl.rstrip("/")

            # 创建客户端（使用 auth 元组）
            assert _WebDAVClient is not None
            self.client = _WebDAVClient(
                server_url, auth=(self.config.username, self.config.password)
            )

            # 测试连接 - 检查同步路径是否存在（带重试）
            sync_path = self.config.syncPath
            if not sync_path.startswith("/"):
                sync_path = "/" + sync_path

            def check_connection():
                assert self.client is not None
                return self.client.exists(sync_path)

            if self._with_retry(check_connection, "WebDAV 连接"):
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

    def list_files(self, path: str, detail: bool = False) -> List[Any]:
        """列出路径下的文件和文件夹"""
        if not self.is_connected():
            return []

        try:
            # 确保路径不以 / 开头（webdav4 相对路径）
            if path.startswith("/"):
                path = path[1:]

            # webdav4 的 ls 方法
            assert self.client is not None
            files = self.client.ls(path, detail=detail)
            # 过滤掉 . 和 ..
            return [f for f in files if f not in [".", ".."]]
        except Exception as e:
            self.logger.error(f"列出文件失败: {e}")
            return []

    def list_books(self, source_path: str) -> List[BookFile]:
        """列出源路径下的电子书文件"""
        if not self.is_connected():
            return []

        books = []
        full_path = source_path
        if not full_path.startswith("/"):
            full_path = "/" + full_path

        try:
            items = self.list_files(full_path, detail=True)

            for item in items:
                if isinstance(item, str):
                    file_name = item
                    size = 0
                    modified = "2000-01-01T00:00:00"
                else:
                    file_name = item.get("name") or item.get("path") or ""
                    size = item.get("size", 0) or 0
                    modified = (
                        item.get("modified", "2000-01-01T00:00:00")
                        or "2000-01-01T00:00:00"
                    )

                ext = Path(file_name).suffix.lower()
                if ext in self.SUPPORTED_EXTENSIONS:
                    # webdav4 返回完整路径，需要提取文件名
                    file_name_only = Path(file_name).name
                    if full_path.endswith("/"):
                        file_path = f"{full_path}{file_name_only}"
                    else:
                        file_path = f"{full_path}/{file_name_only}"

                    books.append(
                        BookFile(
                            name=file_name_only,
                            path=file_path,
                            extension=ext,
                            size=size,
                            last_modified=datetime.fromisoformat(modified),
                        )
                    )

        except Exception as e:
            self.logger.error(f"扫描电子书失败: {e}")

        return books

    def get_file_info(self, path: str) -> dict:
        """获取文件信息"""
        if not self.is_connected():
            return {}

        try:
            # webdav4 的 info 方法返回字典
            # path 需要是完整路径
            if not path.startswith("/"):
                path = "/" + path

            assert self.client is not None
            info = self.client.info(path)
            if info:
                return {
                    "size": info.get("size", 0) or 0,
                    "modified": info.get("modified", "2000-01-01T00:00:00")
                    or "2000-01-01T00:00:00",
                }
            return {}
        except Exception:
            return {}

    def file_exists(self, path: str) -> bool:
        """检查文件是否存在"""
        if not self.is_connected():
            return False

        try:
            # path 需要以 / 开头
            if not path.startswith("/"):
                path = "/" + path
            assert self.client is not None
            return self.client.exists(path)

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

            # 下载文件 - webdav4 使用 download_file
            assert self.client is not None
            self.client.download_file(remote_path, local_path)

            return os.path.exists(local_path)
        except Exception as e:
            self.logger.error(f"下载文件失败: {e}")
            return False

    def download_file_as_text(self, remote_path: str) -> tuple[bool, str]:
        """下载文件作为文本"""
        if not self.is_connected():
            return False, "未连接"

        try:
            # webdav4 的 download 返回 bytes，需要解码
            assert self.client is not None
            content_bytes = self.client.download(remote_path)

            if isinstance(content_bytes, bytes):
                content = content_bytes.decode("utf-8")
            else:
                content = str(content_bytes)
            return True, content
        except Exception as e:
            self.logger.error(f"下载文件失败: {e}")
            return False, str(e)

    def upload_file(self, remote_path: str, content: str) -> bool:
        """上传文件"""
        if not self.is_connected():
            return False

        try:
            # 确保目录存在 - webdav4 的 mkdir 会递归创建
            assert self.client is not None
            remote_dir = str(Path(remote_path).parent)
            if remote_dir and remote_dir != "/" and not self.client.exists(remote_dir):
                self.client.mkdir(remote_dir, create_parents=True)

            # 上传文件 - webdav4 使用 upload
            self.client.upload(remote_path, content.encode("utf-8"))
            return True

        except Exception as e:
            self.logger.error(f"上传文件失败: {e}")
            return False

    def mkdir(self, path: str) -> bool:
        """创建目录"""
        if not self.is_connected():
            return False

        try:
            assert self.client is not None
            if not self.client.exists(path):
                self.client.mkdir(path, create_parents=True)
            return True

        except Exception as e:
            self.logger.error(f"创建目录失败: {e}")
            return False

    def check_cache_exists(self, book: BookFile) -> bool:
        """检查缓存是否存在"""
        sync_path = self.config.syncPath
        if not sync_path.startswith("/"):
            sync_path = "/" + sync_path

        cache_file = f"{book.sanitized_name}-完整摘要.md"
        cache_path = f"{sync_path}/{cache_file}"

        return self.file_exists(cache_path)

    def list_cache_files(self) -> set[str]:
        """列出云端缓存文件名集合（{sanitizedName}-完整摘要.md）"""
        sync_path = self.config.syncPath
        if not sync_path.startswith("/"):
            sync_path = "/" + sync_path

        cached = set()
        items = self.list_files(sync_path, detail=True)
        for item in items:
            if isinstance(item, str):
                file_name = Path(item).name
            else:
                file_name = Path(item.get("name") or item.get("path") or "").name

            if file_name.endswith("-完整摘要.md"):
                cached.add(file_name)

        return cached
