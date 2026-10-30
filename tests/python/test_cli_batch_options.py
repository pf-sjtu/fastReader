"""CLI 批量处理新选项：指定书目（include）、小书优先、按配置单价计费、2.0.0 的 meta → 单价。"""
from datetime import datetime
from unittest.mock import MagicMock


from src.cli.ai_client import AIClient, calculate_cost
from src.cli.batch_processor import BatchProcessor
from src.cli.config import AIProviderConfig, BatchConfig, ConfigLoader
from src.cli.models import BookFile


def _book(name: str, size: int) -> BookFile:
    return BookFile(name=name, path=f"/EBook/{name}", extension=".epub", size=size, last_modified=datetime(2026, 1, 1))


class _FakeClient(AIClient):
    def _call(self, prompt, system, max_tokens, low_reasoning=False):  # pragma: no cover - 不会被调用
        raise NotImplementedError


def _client(**cfg):
    config = AIProviderConfig(provider="openai", apiKey="k", apiUrl="https://x/v1", model=cfg.pop("model", "MiniMax-M3.1-Flash"), **cfg)
    return _FakeClient(config, logger=MagicMock())


class TestPricing:
    def test_meta_price_from_config_wins(self):
        """2.0.0 配置里 models[].meta 的单价（来自 models.dev）优先于内置表"""
        client = _client(inputCost=0.1494, outputCost=0.5976)
        assert client.get_pricing() == {"input": 0.1494, "output": 0.5976}
        usd, cny = client.calculate_cost(1_000_000, 1_000_000)
        assert usd == round(0.1494 + 0.5976, 5)
        assert cny == round(usd * client.exchange_rate, 5)

    def test_unknown_model_without_meta_is_unpriced(self):
        client = _client(model="totally-unknown")
        assert client.get_pricing() is None
        assert client.calculate_cost(1_000_000, 1_000_000) == (0.0, 0.0)
        assert calculate_cost("totally-unknown", 10, 10) == (0.0, 0.0)


class TestV2MetaParsing:
    def test_meta_carried_into_provider_config(self, tmp_path):
        cfg = tmp_path / "c.yaml"
        cfg.write_text(
            """
version: 2.0.0
config:
  ai:
    providers:
      - id: minimax
        name: MiniMax
        type: openai
        baseUrl: https://api.minimaxi.com/v1
        apiKey: k
        models:
          - id: MiniMax-M3.1-Flash
            enabled: true
            meta: { inputCost: 0.1494, outputCost: 0.5976, context: 1000000 }
          - id: disabled-one
            enabled: false
    active: { providerId: minimax, modelId: MiniMax-M3.1-Flash }
  webdav: { serverUrl: "https://dav.example.com/dav/", username: u, password: p }
  processingOptions: { processingMode: summary }
""",
            encoding="utf-8",
        )
        loaded = ConfigLoader(str(cfg)).load()
        assert loaded is not None
        # 停用的模型不进入 CLI 的提供商列表
        assert [p.model for p in loaded.ai.providers] == ["MiniMax-M3.1-Flash"]
        assert loaded.ai.providers[0].inputCost == 0.1494
        assert loaded.ai.providers[0].outputCost == 0.5976


class TestBatchSelection:
    def test_parse_include_and_order(self, tmp_path):
        cfg = tmp_path / "c.yaml"
        cfg.write_text(
            """
webdav: { serverUrl: "https://dav.example.com/dav/", username: u, password: p }
ai: { provider: openai, apiKey: k, model: m }
batch:
  sourcePath: /EBook
  order: smallest-first
  include: ["b.epub", "a.epub"]
""",
            encoding="utf-8",
        )
        loaded = ConfigLoader(str(cfg)).load()
        assert loaded.batch.order == "smallest-first"
        assert loaded.batch.include == ["b.epub", "a.epub"]


class TestSelectBooks:
    def _processor(self, **batch):
        # select_books 只读 config.batch：用最小桩，不必构造完整 Config
        from types import SimpleNamespace
        p = BatchProcessor.__new__(BatchProcessor)
        p.config = SimpleNamespace(batch=BatchConfig(**batch))
        return p

    BOOKS = [_book("c.epub", 300), _book("a.epub", 100), _book("b.epub", 200)]

    def test_include_only_named_books(self):
        books, _ = self._processor(include=["b.epub", "missing.epub"]).select_books(self.BOOKS, set())
        assert [b.name for b in books] == ["b.epub"]

    def test_smallest_first(self):
        books, _ = self._processor(order="smallest-first").select_books(self.BOOKS, set())
        assert [b.name for b in books] == ["a.epub", "b.epub", "c.epub"]

    def test_sequential_by_name_and_max_files(self):
        books, _ = self._processor(order="sequential", maxFiles=2).select_books(self.BOOKS, set())
        assert [b.name for b in books] == ["a.epub", "b.epub"]

    def test_skip_processed_counts(self):
        cached = {self.BOOKS[1].cache_file_name}  # a.epub 已有完整摘要
        books, skipped = self._processor(skipProcessed=True).select_books(self.BOOKS, cached)
        assert skipped == 1 and "a.epub" not in [b.name for b in books]

    def test_input_list_not_mutated(self):
        original = list(self.BOOKS)
        self._processor(order="smallest-first").select_books(self.BOOKS, set())
        assert self.BOOKS == original


class TestUnattendedConfirm:
    """Windows 上 NUL 设备 isatty() 为 True：计划任务 / 后台运行时 input() 直接 EOFError，整批崩掉（实测）。"""

    def _run(self, monkeypatch, auto_confirm, stdin_isatty, input_side_effect):
        import sys as _sys
        from types import SimpleNamespace
        p = BatchProcessor.__new__(BatchProcessor)
        p.config = SimpleNamespace(batch=BatchConfig(), webdav=SimpleNamespace(serverUrl="s", syncPath="/f"))
        p.auto_confirm = auto_confirm
        p.logger = MagicMock()
        p.ai_client = object()
        p.webdav = MagicMock()
        p.webdav.connect.return_value = True
        p.webdav.list_books.return_value = [_book("a.epub", 1)]
        monkeypatch.setattr(p, "_load_cached_file_names", lambda: set(), raising=False)
        monkeypatch.setattr(p, "_init_progress_log", lambda: "log.txt", raising=False)
        monkeypatch.setattr(p, "_print_config_summary", lambda: None, raising=False)
        called = {}
        monkeypatch.setattr(p, "_process_books", lambda books, log, cached: called.setdefault("ran", len(books)) and MagicMock(), raising=False)
        monkeypatch.setattr(p, "_finish", lambda *a, **k: None, raising=False)
        monkeypatch.setattr(_sys.stdin, "isatty", lambda: stdin_isatty, raising=False)
        prompts = []
        def fake_input(prompt=""):
            prompts.append(prompt)
            if input_side_effect:
                raise input_side_effect
            return ""
        monkeypatch.setattr("builtins.input", fake_input)
        try:
            p.run()
        except Exception:
            pass
        return called.get("ran"), prompts

    def test_eof_on_tty_does_not_abort(self, monkeypatch):
        ran, prompts = self._run(monkeypatch, auto_confirm=False, stdin_isatty=True, input_side_effect=EOFError())
        assert prompts and ran == 1

    def test_yes_skips_prompt(self, monkeypatch):
        ran, prompts = self._run(monkeypatch, auto_confirm=True, stdin_isatty=True, input_side_effect=None)
        assert prompts == [] and ran == 1


class TestReasoningBudgetExhausted:
    """真实复现：MiniMax-M3.1-Flash 对 4.8 万字单章，reasoning=4095/4096、content 为空 → 整本书失败。"""

    class _Scripted(AIClient):
        def __init__(self, replies):
            super().__init__(AIProviderConfig(provider="openai", apiKey="k", apiUrl="https://x/v1", model="m"), logger=MagicMock())
            self.replies = list(replies)
            self.calls = []

        def _call(self, prompt, system, max_tokens, low_reasoning=False):
            self.calls.append((max_tokens, low_reasoning))
            return self.replies.pop(0)

    def test_retries_with_double_budget_and_low_reasoning(self):
        c = self._Scripted([("", 100, 8192), ("总结正文", 100, 3000)])
        r = c._generate("p", "zh")
        assert r.success and r.content == "总结正文"
        assert c.calls == [(8192, False), (16384, True)]
        # 两次调用都已计费：token 累加
        assert (r.input_tokens, r.output_tokens) == (200, 11192)

    def test_no_retry_when_empty_but_budget_not_exhausted(self):
        """内容为空但没顶满上限（如被过滤），翻倍预算无济于事，不重试"""
        c = self._Scripted([("", 100, 10)])
        r = c._generate("p", "zh")
        assert not r.success and r.error == "AI 返回空内容"
        assert len(c.calls) == 1

    def test_still_empty_after_retry_reports_failure(self):
        c = self._Scripted([("", 100, 8192), ("", 100, 16384)])
        r = c._generate("p", "zh")
        assert not r.success and r.output_tokens == 8192 + 16384


class TestModelMaxOutput:
    """输出上限自动取模型最大值（与前端 outputBudget.ts 同语义）"""

    def test_resolve(self):
        from src.cli.ai_client import resolve_max_output_tokens as r
        assert r(None, 1_000_000, 10) is None
        # 不按模型最大值预占：给到输入的 4 倍（至少 32768），不超模型上限
        assert r(524288, 1_000_000, 50_000) == 200_000
        assert r(524288, 1_000_000, 5_000) == 32768
        assert r(98304, 131072, 60_000) == 131072 - 60_000 - 1024
        assert r(64000, 200_000, 199_900) == 1024

    def test_meta_output_parsed_and_used(self, tmp_path):
        cfg = tmp_path / "c.yaml"
        cfg.write_text(
            """
version: 2.0.0
config:
  ai:
    providers:
      - id: minimax
        type: openai
        baseUrl: https://api.minimaxi.com/v1
        apiKey: k
        models:
          - { id: MiniMax-M3.1-Flash, enabled: true, meta: { output: 524288, context: 1000000 } }
    active: { providerId: minimax, modelId: MiniMax-M3.1-Flash }
  webdav: { serverUrl: "https://dav.example.com/dav/", username: u, password: p }
""",
            encoding="utf-8",
        )
        p = ConfigLoader(str(cfg)).load().ai.providers[0]
        assert (p.maxOutputTokens, p.contextWindow) == (524288, 1000000)

        c = TestReasoningBudgetExhausted._Scripted([("总结", 10, 100), ("总结", 10, 100)])
        c.config.maxOutputTokens, c.config.contextWindow = p.maxOutputTokens, p.contextWindow
        assert c._generate("p" * 1000, "zh").success
        assert c.calls[0][0] == 32768  # 短提示：封顶 32768，不按 524288 预占限速 / 额度
        assert c._generate("p" * 200_000, "zh").success
        assert c.calls[1][0] == 524288  # 长提示：放宽到模型上限

    def test_at_model_max_retry_does_not_exceed_limit(self):
        """已是模型最大输出时，补救重试只降推理强度，不翻倍（翻倍会被服务商以超限拒绝）"""
        c = TestReasoningBudgetExhausted._Scripted([("", 10, 8192), ("总结", 10, 3000)])
        c.config.maxOutputTokens = 8192
        r = c._generate("p", "zh")
        assert r.success and c.calls == [(8192, False), (8192, True)]

    def test_unknown_meta_falls_back_to_default(self):
        from src.cli.ai_client import DEFAULT_MAX_OUTPUT_TOKENS
        c = TestReasoningBudgetExhausted._Scripted([("总结", 10, 100)])
        c._generate("p", "zh")
        assert c.calls[0][0] == DEFAULT_MAX_OUTPUT_TOKENS


class TestMaxTokensCapRetry:
    def test_parse(self):
        from src.cli.ai_client import parse_max_tokens_cap as p
        assert p("field MaxTokens invalid, should be in [1, 384000]", 393216) == 384000
        assert p("does not support max tokens > 524288 (2013)", 600000) == 524288
        assert p("invalid api key 12345", 16384) is None

    def test_call_retries_with_provider_cap(self):
        class E(Exception):
            status_code = 400

        c = TestReasoningBudgetExhausted._Scripted([])
        seen = []

        def call(prompt, system, max_tokens, low_reasoning=False):
            seen.append(max_tokens)
            if max_tokens > 384000:
                raise E("Error code: 400 - field MaxTokens invalid, should be in [1, 384000]")
            return ("总结", 10, 100)

        c._call = call
        c.config.maxOutputTokens = 393216
        assert c._generate("x" * 100_000, "zh").success  # 长提示 → 输出给到模型上限
        assert seen == [393216, 384000]
