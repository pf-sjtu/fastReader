"""
WebDAV 客户端封装
使用 webdav4 库 (https://github.com/skshetry/webdav4)

远程路径一律用 posixpath 处理（Windows 上 pathlib 会产生反斜杠）。
"""

from typing import Optional, Any, List, NoReturn

import posixpath
from pathlib import Path
from datetime import datetime
import os

from .models import BookFile, CACHE_FILE_SUFFIX
from .logger import Logger
from .retry import RetryPolicy, call_with_retry


class WebDAVProbeError(Exception):
    """WebDAV 探测失败（网络/鉴权/服务端错误），不得当作「资源不存在」。"""


# 尝试导入 webdav4 库
_webdav_available = False
try:
    from webdav4.client import Client as _WebDAVClient
    from webdav4.client import HTTPError, ResourceNotFound

    _webdav_available = True
except ImportError:
    _WebDAVClient = None

    class HTTPError(Exception):
        """webdav4 未安装时的占位。"""

        status_code: Optional[int] = None

    class ResourceNotFound(Exception):
        """webdav4 未安装时的占位。"""


def _patch_propfind_defaults(client: Any) -> None:
    """修正 webdav4 propfind 的两个对真实服务器不友好的默认值（仅作用于这一个实例）。

    1. follow_redirects=False：InfiniCLOUD 等对「不带尾斜杠的目录」返回 301（带斜杠版本），
       exists("/dir") 会抛 HTTPError(301)、连接直接失败 → 默认跟随重定向。
    2. 不带 Depth 头：按 RFC 4918 缺省为 infinity，服务器对集合通常拒绝（403）→ 默认 Depth: 0。
    """
    propfind = client.propfind

    def wrapped(path, data=None, headers=None, follow_redirects=True):
        merged = {"Depth": "0", **(headers or {})}
        return propfind(path, data, merged, follow_redirects)

    client.propfind = wrapped


# WebDAV 默认重试：比 AI 短（3 次，5/10/20 秒 + 抖动）
DEFAULT_WEBDAV_RETRY = RetryPolicy(max_retries=3, delays=[5, 10, 20])


def _is_not_found_error(exc: BaseException) -> bool:
    """404 / ResourceNotFound 视为资源确实不存在。"""
    if isinstance(exc, ResourceNotFound):
        return True
    status = getattr(exc, "status_code", None)
    try:
        return int(status) == 404
    except (TypeError, ValueError):
        return False


def remote_join(base: str, name: str) -> str:
    """拼接远程路径：保证以 / 开头、无重复斜杠"""
    base = "/" + base.strip("/") if base.strip("/") else "/"
    return posixpath.join(base, name.lstrip("/"))


class WebDAVClientWrapper:
    """WebDAV 客户端封装"""

    SUPPORTED_EXTENSIONS = {".epub", ".pdf"}

    def __init__(self, config, logger: Logger, retry_policy: Optional[RetryPolicy] = None):
        """
        初始化 WebDAV 客户端

        Args:
            config: WebDAV 配置对象
            logger: 日志器
            retry_policy: 重试策略（缺省 DEFAULT_WEBDAV_RETRY）
        """
        self.config = config
        self.logger = logger
        self.client: Optional[Any] = None
        self.retry_policy = retry_policy or DEFAULT_WEBDAV_RETRY

        self._connected = False

    def _retry(self, func, operation_name: str):
        """可重试错误（408/429/5xx/网络）按策略重试；404 等直接抛出"""
        return call_with_retry(func, self.retry_policy, operation_name, on_retry=self.logger.warning)

    def connect(self) -> bool:
        """连接到 WebDAV 服务器"""
        if not _webdav_available:
            self.logger.error("webdav4 库未安装，请运行: uv sync")
            return False

        try:
            # 构建 WebDAV URL（webdav4 会自动处理尾部斜杠）
            server_url = self.config.serverUrl.rstrip("/")

            # 创建客户端（使用 auth 元组）；关闭 webdav4 内置重试，统一由 retry helper 负责
            assert _WebDAVClient is not None
            self.client = _WebDAVClient(
                server_url, auth=(self.config.username, self.config.password), retry=False
            )
            _patch_propfind_defaults(self.client)

            # 测试连接 - 检查同步路径是否存在（带重试）
            sync_path = remote_join(self.config.syncPath, "")

            def check_connection():
                assert self.client is not None
                return self.client.exists(sync_path)

            if self._retry(check_connection, "WebDAV 连接"):
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

    def _require_connected(self, operation: str) -> None:
        if not self.is_connected():
            raise WebDAVProbeError(f"WebDAV 未连接，无法{operation}")

    def _raise_probe_error(
        self, operation: str, path: str, exc: BaseException
    ) -> NoReturn:
        if isinstance(exc, WebDAVProbeError):
            raise exc
        msg = f"{operation}失败: {path}: {exc}"
        self.logger.error(msg)
        raise WebDAVProbeError(msg) from exc

    def list_files(self, path: str, detail: bool = False) -> List[Any]:
        """列出路径下的文件和文件夹。目录不存在返回空列表；探测失败抛 WebDAVProbeError。"""
        self._require_connected("列出文件")

        try:
            # 确保路径不以 / 开头（webdav4 相对路径）
            if path.startswith("/"):
                path = path[1:]

            assert self.client is not None
            files = self._retry(lambda: self.client.ls(path, detail=detail), "列出文件")
            # 过滤掉 . 和 ..
            return [f for f in files if f not in [".", ".."]]
        except Exception as e:
            if _is_not_found_error(e):
                return []
            self._raise_probe_error("列出文件", path, e)

    def list_books(self, source_path: str) -> List[BookFile]:
        """列出源路径下的电子书文件"""
        self._require_connected("扫描电子书")

        books = []
        full_path = remote_join(source_path, "")

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

                file_name_only = posixpath.basename(file_name.rstrip("/"))
                ext = posixpath.splitext(file_name_only)[1].lower()
                if ext in self.SUPPORTED_EXTENSIONS:
                    if isinstance(modified, datetime):
                        last_modified = modified
                    else:
                        last_modified = datetime.fromisoformat(str(modified))
                    books.append(
                        BookFile(
                            name=file_name_only,
                            path=remote_join(full_path, file_name_only),
                            extension=ext,
                            size=size,
                            last_modified=last_modified,
                        )
                    )

        except WebDAVProbeError:
            raise
        except Exception as e:
            self.logger.error(f"扫描电子书失败: {e}")

        return books

    def get_file_info(self, path: str) -> dict:
        """获取文件信息。资源不存在返回空 dict；探测失败抛 WebDAVProbeError。"""
        self._require_connected("获取文件信息")

        try:
            # path 需要是完整路径
            if not path.startswith("/"):
                path = "/" + path

            assert self.client is not None
            info = self._retry(lambda: self.client.info(path), "获取文件信息")
            if info:
                return {
                    "size": info.get("size", 0) or 0,
                    "modified": info.get("modified", "2000-01-01T00:00:00")
                    or "2000-01-01T00:00:00",
                }
            return {}
        except Exception as e:
            if _is_not_found_error(e):
                return {}
            self._raise_probe_error("获取文件信息", path, e)

    def file_exists(self, path: str) -> bool:
        """检查文件是否存在。不存在返回 False；探测失败抛 WebDAVProbeError。"""
        self._require_connected("探测文件是否存在")

        try:
            # path 需要以 / 开头
            if not path.startswith("/"):
                path = "/" + path
            assert self.client is not None
            return self._retry(lambda: self.client.exists(path), "探测文件是否存在")

        except Exception as e:
            if _is_not_found_error(e):
                return False
            self._raise_probe_error("探测文件是否存在", path, e)

    def download_file(self, remote_path: str, local_path: str) -> bool:
        """下载文件"""
        if not self.is_connected():
            return False

        try:
            # 确保本地目录存在
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)

            assert self.client is not None
            self._retry(lambda: self.client.download_file(remote_path, local_path), "下载文件")

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
            # 确保目录存在 - 远程路径用 posixpath，避免 Windows 产生 \\fastReader
            assert self.client is not None
            self._ensure_dir(posixpath.dirname(remote_path))

            data = content.encode("utf-8")

            def do_upload():
                import io
                self.client.upload_fileobj(io.BytesIO(data), remote_path, overwrite=True)

            self._retry(do_upload, "上传文件")
            return True

        except Exception as e:
            self.logger.error(f"上传文件失败: {e}")
            return False

    def _ensure_dir(self, remote_dir: str) -> None:
        """逐级创建远程目录（webdav4 的 mkdir 不支持递归）"""
        assert self.client is not None
        current = "/"
        for part in [p for p in remote_dir.split("/") if p]:
            current = posixpath.join(current, part)
            if not self._retry(lambda: self.client.exists(current), "探测目录"):
                self._retry(lambda: self.client.mkdir(current), "创建目录")

    def mkdir(self, path: str) -> bool:
        """创建目录"""
        if not self.is_connected():
            return False

        try:
            self._ensure_dir(path)
            return True

        except Exception as e:
            self.logger.error(f"创建目录失败: {e}")
            return False

    def cache_path_for(self, book: BookFile) -> str:
        """云端缓存文件完整路径"""
        return remote_join(self.config.syncPath, book.cache_file_name)

    def check_cache_exists(self, book: BookFile) -> bool:
        """检查缓存是否存在"""
        return self.file_exists(self.cache_path_for(book))

    def list_cache_files(self) -> set[str]:
        """列出云端缓存文件名集合（{sanitizedName}-完整摘要.md）"""
        sync_path = remote_join(self.config.syncPath, "")

        cached = set()
        items = self.list_files(sync_path, detail=True)
        for item in items:
            if isinstance(item, str):
                file_name = posixpath.basename(item)
            else:
                file_name = posixpath.basename(item.get("name") or item.get("path") or "")

            if file_name.endswith(CACHE_FILE_SUFFIX):
                cached.add(file_name)

        return cached
