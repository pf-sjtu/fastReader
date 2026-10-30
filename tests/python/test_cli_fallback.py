"""内容审核兜底：只有「被审核拦截」才换模型，其它错误不换；用量按各自单价分别计费。"""
from unittest.mock import MagicMock

from src.cli.ai_client import AIResponse
from src.cli.config import resolve_fallback_providers
from src.cli.fallback_client import FallbackAIClient, is_content_filter_error

FILTERED = "Error code: 422 - {'error': {'type': 'unprocessable_entity_error', 'message': 'output new_sensitive (1027)'}}"


class Fake:
    """最小 AIClient 桩：按脚本返回结果，记录调用"""

    def __init__(self, model, replies, price=(1.0, 2.0)):
        self.model = model
        self.replies = list(replies)
        self.price = price
        self.calls = []
        self.prompts = MagicMock()

    def _next(self, call):
        self.calls.append(call)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    def summarize_chapter(self, *a, **k):
        return self._next("summarize_chapter")

    def analyze_connections(self, *a, **k):
        return self._next("analyze_connections")

    def generate_overall_summary(self, *a, **k):
        return self._next("generate_overall_summary")

    def calculate_cost(self, input_tokens, output_tokens):
        usd = (self.price[0] * input_tokens + self.price[1] * output_tokens) / 1_000_000
        return round(usd, 5), round(usd * 7, 5)

    def get_pricing(self):
        return {"input": self.price[0], "output": self.price[1]}


def ok(text="摘要", i=100, o=50):
    return AIResponse(success=True, content=text, input_tokens=i, output_tokens=o)


def failed(error, i=100, o=0):
    return AIResponse(success=False, content="", error=error, input_tokens=i, output_tokens=o)


def make(primary_replies, fb_replies, fb2_replies=None):
    primary = Fake("minimax-M3.1", primary_replies, price=(0.15, 0.6))
    fallbacks = [Fake("navira/deepseek-flash", fb_replies, price=(0.3, 1.2))]
    if fb2_replies is not None:
        fallbacks.append(Fake("opendesign/gpt-6-luna", fb2_replies, price=(1.0, 4.0)))
    return FallbackAIClient(primary, fallbacks, MagicMock()), primary, fallbacks


class TestContentFilterDetection:
    def test_recognises_real_provider_messages(self):
        assert is_content_filter_error(FILTERED)
        assert is_content_filter_error("Error code: 422 - input new_sensitive (1026)")
        assert is_content_filter_error("This request was blocked by the safety system")
        assert is_content_filter_error("content_policy_violation")

    def test_ignores_other_failures(self):
        for error in ["Error code: 429 - rate limit", "Error code: 401 - invalid api key",
                      "APITimeoutError", "AI 返回空内容", "", None]:
            assert not is_content_filter_error(error)


class TestFallback:
    def test_success_needs_no_fallback(self):
        client, primary, (fb,) = make([ok()], [])
        assert client.summarize_chapter().content == "摘要"
        assert fb.calls == [] and client.used_models == []

    def test_filtered_chapter_retried_on_fallback(self):
        client, primary, (fb,) = make([failed(FILTERED)], [ok("兜底摘要", 200, 80)])
        result = client.summarize_chapter()
        assert result.success and result.content == "兜底摘要"
        # token 汇总：主模型失败也计费 + 兜底模型
        assert (result.input_tokens, result.output_tokens) == (300, 80)
        assert client.used_models == ["navira/deepseek-flash"]

    def test_non_filter_error_not_retried(self):
        client, primary, (fb,) = make([failed("Error code: 429 - rate limit")], [ok()])
        result = client.summarize_chapter()
        assert not result.success and "429" in result.error
        assert fb.calls == []

    def test_chain_continues_past_filtered_fallback(self):
        client, _, fallbacks = make([failed(FILTERED)], [failed(FILTERED, 10, 0)], [ok("第三家", 30, 20)])
        result = client.summarize_chapter()
        assert result.success and result.content == "第三家"
        assert client.used_models == ["navira/deepseek-flash", "opendesign/gpt-6-luna"]

    def test_all_blocked_reports_failure_with_usage(self):
        client, _, _ = make([failed(FILTERED)], [failed(FILTERED, 10, 0)])
        result = client.summarize_chapter()
        assert not result.success and "均失败" in result.error

    def test_post_process_also_falls_back(self):
        client, _, (fb,) = make([failed(FILTERED)], [ok("关联")])
        assert client.analyze_connections(["a", "b"], "zh").content == "关联"
        client.reset_usage()
        client.primary.replies.append(failed(FILTERED))
        fb.replies.append(ok("全书总结"))
        assert client.generate_overall_summary("t", [], "", "zh").content == "全书总结"

    def test_cost_split_by_model_price(self):
        client, _, _ = make([failed(FILTERED, 100, 0)], [ok("x", 1_000_000, 0)])
        client.summarize_chapter()
        # 主模型：0 输入（失败那 100 已计入兜底之外的主模型用量），兜底：1M 输入 × 0.3
        usd, _ = client.calculate_cost(1_000_100, 0)
        # 主模型的 100 token 按主模型单价（0.15/M），兜底的 1M 按兜底单价（0.3/M），分别计算后相加
        assert usd == 0.30002

    def test_reset_usage_per_book(self):
        client, _, (fb,) = make([failed(FILTERED)], [ok()])
        client.summarize_chapter()
        assert client.used_models
        client.reset_usage()
        assert client.used_models == []


class TestFallbackConfig:
    def test_parse_and_resolve(self, tmp_path):
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
        models: [{ id: MiniMax-M3.1-Flash, enabled: true }]
      - id: navira
        type: openai
        baseUrl: https://navira.blog/v1
        apiKey: k2
        models: [{ id: sensenova/deepseek-flash, enabled: true }]
    active: { providerId: minimax, modelId: MiniMax-M3.1-Flash }
  webdav: { serverUrl: "https://dav.example.com/dav/", username: u, password: p }
  batch: { fallbackModels: ["navira/sensenova/deepseek-flash", "nope/missing"] }
""",
            encoding="utf-8",
        )
        from src.cli.config import ConfigLoader

        loaded = ConfigLoader(str(cfg)).load()
        assert loaded.batch.fallbackModels == ["navira/sensenova/deepseek-flash", "nope/missing"]
        resolved = resolve_fallback_providers(loaded.ai, loaded.batch.fallbackModels)
        assert [(p.providerId, p.model) for p in resolved] == [("navira", "sensenova/deepseek-flash")]

    def test_env_string_form(self, tmp_path, monkeypatch):
        monkeypatch.setenv("FASTREADER_FALLBACK_MODELS", "a/m1, b/m2 ,bad,  a/m1")
        cfg = tmp_path / "c.yaml"
        cfg.write_text(
            """
webdav: { serverUrl: "https://dav.example.com/dav/", username: u, password: p }
ai: { provider: openai, apiKey: k, model: m }
""",
            encoding="utf-8",
        )
        from src.cli.config import ConfigLoader

        assert ConfigLoader(str(cfg)).load().batch.fallbackModels == ["a/m1", "b/m2"]
