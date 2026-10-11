"""
BatchProcessor 主流程测试（只 mock AI 与 WebDAV 的网络边界，章节提取/格式化/断点均为真实逻辑）
"""

import json
import re
import shutil
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from conftest import build_epub, long_body
from src.cli.ai_client import AIClient
from src.cli.batch_processor import BatchProcessor
from src.cli.config import (
    AdvancedConfig, AIConfig, AIProviderConfig, BatchConfig, Config, OutputConfig,
    ProcessingConfig, PromptConfig, WebDAVConfig,
)
from src.cli.logger import Logger
from src.cli.models import BookFile
from src.cli.prompts import PromptTemplates
from src.cli.retry import RetryPolicy
from src.cli.webdav_client import WebDAVProbeError

TITLES = ["第一章 出发", "第二章 途中", "第三章 抵达"]


class FakeAI(AIClient):
    """按标题决定成功/失败的假 AI；_call 之外全部真实逻辑"""

    def __init__(self, fail_titles=()):
        cfg = SimpleNamespace(model="gemini-1.5-flash", temperature=0.5)
        super().__init__(cfg, Logger(), PromptTemplates(), retry_policy=RetryPolicy(max_retries=0),
                         exchange_rate=7.0)
        self.fail_titles = set(fail_titles)
        self.prompts_seen = []

    def _call(self, prompt, system, max_tokens):
        self.prompts_seen.append(prompt)
        for title in self.fail_titles:
            if f"章节标题：{title}" in prompt:
                err = Exception(f"bad request for {title}")
                err.status_code = 400
                raise err
        if "章节内容" in prompt:
            title = re.search(r"章节标题：(.+)", prompt).group(1).strip()
            return f"《{title}》的摘要", 100, 20
        if "全面的总结报告" in prompt:
            return "全书总结正文", 300, 60
        return "章节关联正文", 200, 40


def make_config(tmp_path, **batch):
    return Config(
        webdav=WebDAVConfig(serverUrl="https://dav.example.com/dav/", username="u", password="p",
                            syncPath="/fastReader"),
        ai=AIConfig(providers=[AIProviderConfig(provider="gemini", apiKey="a", model="gemini-1.5-pro"),
                               AIProviderConfig(provider="gemini", apiKey="b", model="gemini-1.5-flash")],
                    currentProviderIndex=1),
        processing=ProcessingConfig(outputLanguage="zh"),
        batch=BatchConfig(sourcePath="/books", skipProcessed=False, **batch),
        output=OutputConfig(localDir=str(tmp_path / "out"), logDir=str(tmp_path / "log"), syncToWebDAV=True),
        advanced=AdvancedConfig(exchangeRate=7.0),
        prompts=PromptConfig(),
    )


@pytest.fixture
def epub_file(tmp_path):
    return build_epub(tmp_path / "src.epub", [(t, long_body(t)) for t in TITLES], title="旅程")


def run(tmp_path, epub_file, fake_ai, upload_ok=True, **batch):
    """跑一次完整批处理，返回 (result, webdav mock)"""
    config = make_config(tmp_path, **batch)
    with patch("src.cli.batch_processor.WebDAVClientWrapper") as webdav_cls, \
         patch("src.cli.batch_processor.create_ai_client", return_value=fake_ai):
        webdav = webdav_cls.return_value
        webdav.connect.return_value = True
        webdav.list_books.return_value = [BookFile(
            name="旅程.EPUB", path="/books/旅程.EPUB", extension=".epub", size=1,
            last_modified=datetime(2024, 1, 1))]
        webdav.download_file.side_effect = lambda remote, local: bool(shutil.copy(epub_file, local))
        webdav.cache_path_for.side_effect = lambda book: f"/fastReader/{book.cache_file_name}"
        webdav.upload_file.return_value = upload_ok
        processor = BatchProcessor(config, Logger(log_dir=str(tmp_path / "log")))
        result = processor.run()
    return result, webdav, processor


def uploaded(webdav):
    path, content = webdav.upload_file.call_args.args
    return path, content


class TestHappyPath:
    def test_full_book(self, tmp_path, epub_file):
        ai = FakeAI()
        result, webdav, processor = run(tmp_path, epub_file, ai)
        assert (result.total, result.success, result.failed) == (1, 1, 0)

        path, content = uploaded(webdav)
        assert path == "/fastReader/旅程-完整摘要.md"      # 文件名对齐前端 sanitize
        # 真实章节标题 + 关联分析写入 + 分节顺序
        assert [h for h in re.findall(r"^### (.+)$", content, re.M)] == TITLES
        assert re.findall(r"^## (.+)$", content, re.M) == ["全书总结", "章节关联分析", "章节摘要"]
        assert "章节关联正文" in content and "全书总结正文" in content
        assert not content.rstrip().endswith("*")          # 无尾部时间戳行
        assert "model: gemini-1.5-flash" in content       # 多 provider 取实际使用的 model
        assert "isPartial: false" in content and "skippedChapters: 0" in content
        assert "selectedChapters: 1,2,3" in content

        # token：3 章 + 关联 + 全书
        assert "inputTokens: 800" in content and "outputTokens: 160" in content
        assert result.total_cost_usd == processor.ai_client.calculate_cost(800, 160)[0]

        # 关联/全书只喂章节摘要，不喂原文
        post = [p for p in ai.prompts_seen if "章节内容" not in p]
        assert len(post) == 2
        assert all("这是一段用于测试的正文内容" not in p for p in post)
        assert all("《第一章 出发》的摘要" in p for p in post)

        # 本地产物与云端一致；成功后断点文件清除
        local = (tmp_path / "out" / "旅程-完整摘要.md").read_text(encoding="utf-8")
        assert local == content
        meta = json.loads((tmp_path / "out" / "旅程.meta.json").read_text(encoding="utf-8"))
        assert meta["isPartial"] is False
        assert not list((tmp_path / "out" / ".checkpoints").glob("*.json"))

    def test_concurrency_keeps_order(self, tmp_path, epub_file):
        result, webdav, _ = run(tmp_path, epub_file, FakeAI(), concurrency=3)
        _, content = uploaded(webdav)
        assert re.findall(r"^### (.+)$", content, re.M) == TITLES

    def test_progress_log_appends(self, tmp_path, epub_file):
        run(tmp_path, epub_file, FakeAI())
        run(tmp_path, epub_file, FakeAI())
        log = next((tmp_path / "log").glob("batch_progress_*.log")).read_text(encoding="utf-8")
        assert log.count("# fastReader 批量处理进度日志") == 2


class TestPartialFailure:
    def test_minority_failure_marked_partial_and_uploaded(self, tmp_path, epub_file):
        ai = FakeAI(fail_titles=["第二章 途中"])
        result, webdav, _ = run(tmp_path, epub_file, ai)
        assert result.success == 1
        _, content = uploaded(webdav)
        assert "isPartial: true" in content
        assert "【处理失败】bad request for 第二章 途中" in content
        # 后处理不包含失败章节
        post = [p for p in ai.prompts_seen if "章节内容" not in p]
        assert all("【处理失败】" not in p for p in post)
        assert all("第二章 途中" not in p for p in post)

    def test_majority_failure_not_uploaded_and_resumable(self, tmp_path, epub_file):
        ai = FakeAI(fail_titles=["第一章 出发", "第二章 途中"])
        result, webdav, _ = run(tmp_path, epub_file, ai)
        assert (result.success, result.failed) == (0, 1)
        assert "超过 50%" in result.failed_books[0]["error"]
        webdav.upload_file.assert_not_called()
        assert not (tmp_path / "out" / "旅程-完整摘要.md").exists()
        checkpoint = json.loads(next((tmp_path / "out" / ".checkpoints").glob("*.json")).read_text(encoding="utf-8"))
        assert [v["title"] for v in checkpoint.values()] == ["第三章 抵达"]
        # 错误日志写入 logDir
        assert "超过 50%" in next((tmp_path / "log").glob("batch_*.log")).read_text(encoding="utf-8")

        # 重跑：第三章复用断点，不再调用 AI
        ai2 = FakeAI()
        result2, webdav2, _ = run(tmp_path, epub_file, ai2)
        assert result2.success == 1
        chapter_calls = [p for p in ai2.prompts_seen if "章节内容" in p]
        assert len(chapter_calls) == 2
        assert all("第三章 抵达" not in p for p in chapter_calls)
        _, content = uploaded(webdav2)
        assert "《第三章 抵达》的摘要" in content and "isPartial: false" in content

    def test_upload_failure_is_book_failure(self, tmp_path, epub_file):
        result, _, _ = run(tmp_path, epub_file, FakeAI(), upload_ok=False)
        assert result.failed == 1 and "WebDAV 上传失败" in result.failed_books[0]["error"]
        assert (tmp_path / "out" / "旅程-完整摘要.md").exists()


class TestStartup:
    def test_no_input_prompt_when_not_tty(self, tmp_path, epub_file, monkeypatch):
        monkeypatch.setattr("sys.stdin", SimpleNamespace(isatty=lambda: False))
        with patch("builtins.input", side_effect=AssertionError("不应阻塞")):
            result, _, _ = run(tmp_path, epub_file, FakeAI())
        assert result.success == 1

    def test_tty_waits_for_enter(self, tmp_path, epub_file, monkeypatch):
        monkeypatch.setattr("sys.stdin", SimpleNamespace(isatty=lambda: True))
        with patch("builtins.input") as fake_input:
            run(tmp_path, epub_file, FakeAI())
        fake_input.assert_called_once()

    def test_ai_client_missing_fails_fast(self, tmp_path, epub_file):
        result, webdav, _ = run(tmp_path, epub_file, None)
        assert result.failed == 1 and "AI 客户端" in result.failed_books[0]["error"]
        webdav.connect.assert_not_called()

    def test_skip_processed_filters_cached(self, tmp_path, epub_file):
        config = make_config(tmp_path)
        config.batch.skipProcessed = True
        with patch("src.cli.batch_processor.WebDAVClientWrapper") as webdav_cls, \
             patch("src.cli.batch_processor.create_ai_client", return_value=FakeAI()):
            webdav = webdav_cls.return_value
            webdav.connect.return_value = True
            webdav.list_books.return_value = [BookFile(
                name="旅程.EPUB", path="/books/旅程.EPUB", extension=".epub", size=1,
                last_modified=datetime(2024, 1, 1))]
            webdav.list_cache_files.return_value = {"旅程-完整摘要.md"}
            result = BatchProcessor(config, Logger(log_dir=str(tmp_path / "log"))).run()
        assert (result.total, result.skipped) == (0, 1)
        webdav.download_file.assert_not_called()

    def test_download_and_extract_failures(self, tmp_path, epub_file):
        bad = tmp_path / "bad.epub"
        bad.write_bytes(b"broken")
        result, _, _ = run(tmp_path, str(bad), FakeAI())
        assert "章节提取失败" in result.failed_books[0]["error"]

        config = make_config(tmp_path)
        with patch("src.cli.batch_processor.WebDAVClientWrapper") as webdav_cls, \
             patch("src.cli.batch_processor.create_ai_client", return_value=FakeAI()):
            webdav = webdav_cls.return_value
            webdav.connect.return_value = True
            webdav.list_books.return_value = [BookFile(
                name="x.epub", path="/books/x.epub", extension=".epub", size=1, last_modified=datetime(2024, 1, 1))]
            webdav.download_file.return_value = False
            result = BatchProcessor(config, Logger(log_dir=str(tmp_path / "log"))).run()
        assert result.failed_books[0]["error"] == "下载书籍失败"

    def test_probe_error_aborts(self, tmp_path):
        config = make_config(tmp_path)
        config.batch.skipProcessed = True
        with patch("src.cli.batch_processor.WebDAVClientWrapper") as webdav_cls, \
             patch("src.cli.batch_processor.create_ai_client", return_value=FakeAI()):
            webdav = webdav_cls.return_value
            webdav.connect.return_value = True
            webdav.list_books.return_value = [BookFile(
                name="x.epub", path="/books/x.epub", extension=".epub", size=1, last_modified=datetime(2024, 1, 1))]
            webdav.list_cache_files.side_effect = WebDAVProbeError("503")
            result = BatchProcessor(config, Logger(log_dir=str(tmp_path / "log"))).run()
        assert "探测失败" in result.failed_books[0]["error"]

    def test_format_time(self, tmp_path):
        with patch("src.cli.batch_processor.WebDAVClientWrapper"), \
             patch("src.cli.batch_processor.create_ai_client", return_value=FakeAI()):
            p = BatchProcessor(make_config(tmp_path), Logger())
        assert p._format_time(5) == "5.0秒"
        assert p._format_time(125) == "2分5秒"
        assert p._format_time(7300) == "2小时1分"
