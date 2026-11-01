"""
WebDAV 客户端：posix 远程路径、统一重试（503 重试 / 401 立即失败）、上传用 webdav4 真实 API
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pytest

from src.cli.logger import Logger
from src.cli.models import BookFile
from src.cli.retry import RetryPolicy
from src.cli.webdav_client import WebDAVClientWrapper, WebDAVProbeError, remote_join


class Status(Exception):
    def __init__(self, code):
        super().__init__(f"received {code}")
        self.status_code = code


def wrapper(sync_path="/fastReader", retries=2):
    cfg = SimpleNamespace(serverUrl="https://dav.example.com/dav/", username="u", password="p", syncPath=sync_path)
    w = WebDAVClientWrapper(cfg, Logger(), retry_policy=RetryPolicy(max_retries=retries, delays=[0]))
    w.client = MagicMock()
    w._connected = True
    return w


class TestRemotePath:
    @pytest.mark.parametrize("base,name,expected", [
        ("/fastReader", "a.md", "/fastReader/a.md"),
        ("fastReader/", "a.md", "/fastReader/a.md"),
        ("/", "a.md", "/a.md"),
        ("", "a.md", "/a.md"),
        ("/a/b", "", "/a/b/"),
    ])
    def test_remote_join(self, base, name, expected):
        assert remote_join(base, name) == expected

    def test_cache_path_uses_frontend_sanitize(self):
        book = BookFile(name="Book.EPUB", path="/b/Book.EPUB", extension=".epub", size=1,
                        last_modified=datetime(2024, 1, 1))
        assert wrapper("fastReader/").cache_path_for(book) == "/fastReader/Book-完整摘要.md"


class TestUpload:
    def test_upload_creates_dirs_with_posix_paths(self):
        w = wrapper()
        w.client.exists.return_value = False
        assert w.upload_file("/fastReader/sub/书-完整摘要.md", "内容") is True
        assert w.client.mkdir.call_args_list == [call("/fastReader"), call("/fastReader/sub")]
        for c in w.client.exists.call_args_list + w.client.mkdir.call_args_list:
            assert "\\" not in c.args[0]
        fileobj, path = w.client.upload_fileobj.call_args.args
        assert path == "/fastReader/sub/书-完整摘要.md"
        assert fileobj.read() == "内容".encode("utf-8")
        assert w.client.upload_fileobj.call_args.kwargs["overwrite"] is True

    def test_upload_retries_503_then_succeeds(self):
        w = wrapper()
        w.client.exists.return_value = True
        w.client.upload_fileobj.side_effect = [Status(503), None]
        assert w.upload_file("/fastReader/a.md", "x") is True
        assert w.client.upload_fileobj.call_count == 2

    def test_upload_auth_error_not_retried(self):
        w = wrapper()
        w.client.exists.return_value = True
        w.client.upload_fileobj.side_effect = Status(401)
        assert w.upload_file("/fastReader/a.md", "x") is False
        assert w.client.upload_fileobj.call_count == 1

    def test_upload_disconnected(self):
        w = wrapper()
        w._connected = False
        assert w.upload_file("/a.md", "x") is False
        assert w.mkdir("/a") is False


class TestProbeRetry:
    def test_exists_503_retried_then_ok(self):
        w = wrapper()
        w.client.exists.side_effect = [Status(503), True]
        assert w.file_exists("/fastReader/a.md") is True
        assert w.client.exists.call_count == 2

    def test_exists_503_exhausted_raises_probe_error(self):
        w = wrapper(retries=2)
        w.client.exists.side_effect = Status(503)
        with pytest.raises(WebDAVProbeError):
            w.file_exists("a.md")
        assert w.client.exists.call_count == 3

    def test_list_403_not_retried(self):
        w = wrapper()
        w.client.ls.side_effect = Status(403)
        with pytest.raises(WebDAVProbeError):
            w.list_files("/x")
        assert w.client.ls.call_count == 1

    def test_download_retried(self, tmp_path):
        w = wrapper()
        target = tmp_path / "b.epub"
        target.write_bytes(b"x")  # 模拟第二次下载成功落盘
        w.client.download_file.side_effect = [TimeoutError(), None]
        assert w.download_file("/b.epub", str(target)) is True
        assert w.client.download_file.call_count == 2

    def test_mkdir_and_list_books(self):
        w = wrapper()
        w.client.exists.return_value = True
        assert w.mkdir("/a/b") is True
        w.client.ls.return_value = [
            {"name": "books/A.EPUB", "size": 3, "modified": datetime(2024, 1, 2)},
            {"name": "books/readme.txt"},
            {"name": "books/笔记.md"},
            {"name": "books/old.mobi"},
            "books/b.pdf",
        ]
        books = w.list_books("books")
        # .txt / .md 现在是支持的书（纯文本，与前端 browse.ts 的扩展名集合对齐）；.mobi 仍被跳过
        assert [(b.name, b.path, b.extension) for b in books] == [
            ("A.EPUB", "/books/A.EPUB", ".epub"),
            ("readme.txt", "/books/readme.txt", ".txt"),
            ("笔记.md", "/books/笔记.md", ".md"),
            ("b.pdf", "/books/b.pdf", ".pdf"),
        ]
        assert books[0].last_modified == datetime(2024, 1, 2)


class TestConnect:
    def test_connect_disables_webdav4_builtin_retry_and_retries_probe(self):
        cfg = SimpleNamespace(serverUrl="https://dav.example.com/dav/", username="u", password="p", syncPath="fr")
        w = WebDAVClientWrapper(cfg, Logger(), retry_policy=RetryPolicy(max_retries=1, delays=[0]))
        with patch("src.cli.webdav_client._WebDAVClient") as ctor:
            ctor.return_value.exists.side_effect = [Status(502), True]
            assert w.connect() is True
        assert ctor.call_args.kwargs["retry"] is False
        assert ctor.return_value.exists.call_args.args[0] == "/fr/"


class TestMisc:
    def test_download_as_text_and_cache_listing(self):
        w = wrapper()
        w.client.download.return_value = "正文".encode("utf-8")
        assert w.download_file_as_text("/a.md") == (True, "正文")
        w.client.download.side_effect = RuntimeError("x")
        assert w.download_file_as_text("/a.md")[0] is False
        w._connected = False
        assert w.download_file_as_text("/a.md") == (False, "未连接")

        w = wrapper()
        w.client.ls.return_value = [{"name": "fastReader/书-完整摘要.md"}, "fastReader/其他.md", "fastReader/乙-完整摘要.md"]
        assert w.list_cache_files() == {"书-完整摘要.md", "乙-完整摘要.md"}

    def test_check_cache_exists_and_info(self):
        w = wrapper()
        w.client.exists.return_value = True
        book = BookFile(name="a.pdf", path="/b/a.pdf", extension=".pdf", size=1, last_modified=datetime(2024, 1, 1))
        assert w.check_cache_exists(book) is True
        assert w.client.exists.call_args.args[0] == "/fastReader/a-完整摘要.md"
        w.client.info.return_value = {"size": 3, "modified": "2024-01-01"}
        assert w.get_file_info("x") == {"size": 3, "modified": "2024-01-01"}
        w.client.info.return_value = None
        assert w.get_file_info("x") == {}
