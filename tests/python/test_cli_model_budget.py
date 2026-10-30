"""模型参数自动化：与前端 tests/aiModelBudget.test.ts 共读 tests/fixtures/model-budget-cases.json"""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.cli.ai_client import AIClient, OpenAIClient
from src.cli.config import AIProviderConfig, ConfigLoader
from src.cli.model_budget import (
    is_max_tokens_param_error,
    is_temperature_param_error,
    parse_max_tokens_cap,
    resolve_input_budget,
    resolve_max_output_tokens,
    resolve_post_process_limits,
    split_by_budget,
)
from src.cli.models import ChapterInfo

CASES = json.loads((Path(__file__).parents[1] / "fixtures" / "model-budget-cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("c", CASES["inputBudget"], ids=lambda c: c["name"])
def test_input_budget(c):
    assert resolve_input_budget(c["context"], c["output"]) == c["expected"]


@pytest.mark.parametrize("c", CASES["postProcessLimits"], ids=lambda c: c["name"])
def test_post_process_limits(c):
    assert resolve_post_process_limits(c["context"], c["output"]) == c["expected"]


@pytest.mark.parametrize("c", CASES["split"], ids=lambda c: c["name"])
def test_split(c):
    got = split_by_budget(c["text"], c["budget"])
    assert got == c["expected"]
    assert all(len(x) <= c["budget"] for x in got)


@pytest.mark.parametrize("c", CASES["outputCap"], ids=lambda c: c["name"])
def test_output_cap(c):
    assert resolve_max_output_tokens(c["output"], c["context"], c["prompt"]) == c["expected"]


@pytest.mark.parametrize("c", CASES["maxTokensCap"], ids=lambda c: c["body"][:40])
def test_max_tokens_cap(c):
    assert parse_max_tokens_cap(c["body"], c["current"]) == c["expected"]


@pytest.mark.parametrize("c", CASES["maxTokensParamName"], ids=lambda c: c["body"][:40])
def test_max_tokens_param_name(c):
    assert is_max_tokens_param_error(c["status"], c["body"]) is c["expected"]


@pytest.mark.parametrize("c", CASES["temperatureError"], ids=lambda c: c["body"][:30])
def test_temperature_error(c):
    assert is_temperature_param_error(c["status"], c["body"]) is c["expected"]


def test_split_keeps_all_content():
    text = "\n\n".join(f"第{i}段。" + "内容" * 150 + "。" for i in range(800))
    chunks = split_by_budget(text, 96256)
    assert len(chunks) > 1 and all(len(c) <= 96256 for c in chunks)
    assert "".join(chunks).replace("\n", "") == text.replace("\n", "")


# ---- 温度 / 思考强度适配（OpenAI 兼容客户端，SDK 打桩）----


class _Err(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status_code = status


def _client(**cfg):
    c = OpenAIClient(AIProviderConfig(provider="openai", apiKey="k", apiUrl="https://x/v1", model="m", **cfg), MagicMock())
    calls = []
    replies = []

    def create(**kwargs):
        calls.append(kwargs)
        r = replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    c._client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    ok = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="总结"))],
                         usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1))
    return c, calls, replies, ok


def test_no_temperature_when_catalog_says_unsupported():
    c, calls, replies, ok = _client(supportsTemperature=False)
    replies.append(ok)
    c._call("p", "s", 100)
    assert "temperature" not in calls[0]


def test_temperature_rejected_then_dropped_and_remembered():
    c, calls, replies, ok = _client()
    replies.extend([_Err(400, "Unsupported value: 'temperature' does not support 0.7 with this model."), ok, ok])
    c._call("p", "s", 100)
    assert "temperature" in calls[0] and "temperature" not in calls[1]
    c._call("p", "s", 100)  # 之后的请求不再发
    assert "temperature" not in calls[2]


def test_no_reasoning_effort_for_non_reasoning_model():
    c, calls, replies, ok = _client(supportsReasoning=False)
    replies.append(ok)
    c._call("p", "s", 100, low_reasoning=True)
    assert "reasoning_effort" not in calls[0]


def test_other_errors_propagate():
    c, calls, replies, ok = _client()
    replies.append(_Err(401, "invalid api key"))
    with pytest.raises(_Err):
        c._call("p", "s", 100)


def test_meta_flags_parsed(tmp_path):
    cfg = tmp_path / "c.yaml"
    cfg.write_text(
        """
version: 2.0.0
config:
  ai:
    providers:
      - id: o
        type: openai
        baseUrl: https://api.openai.com/v1
        apiKey: k
        models:
          - { id: o5, enabled: true, meta: { temperature: false, reasoning: true } }
          - { id: plain, enabled: true, meta: { reasoning: false } }
          - { id: unknown, enabled: true }
    active: { providerId: o, modelId: o5 }
  webdav: { serverUrl: "https://dav.example.com/dav/", username: u, password: p }
""",
        encoding="utf-8",
    )
    ps = {p.model: p for p in ConfigLoader(str(cfg)).load().ai.providers}
    assert (ps["o5"].supportsTemperature, ps["o5"].supportsReasoning) == (False, None)
    assert (ps["plain"].supportsTemperature, ps["plain"].supportsReasoning) == (None, False)
    assert (ps["unknown"].supportsTemperature, ps["unknown"].supportsReasoning) == (None, None)


# ---- 超长章节分段总结（CLI）----


class _Scripted(AIClient):
    def __init__(self, **cfg):
        super().__init__(AIProviderConfig(provider="openai", apiKey="k", apiUrl="u", model="m", **cfg), logger=MagicMock())
        self.prompts_seen = []
        self.fail_on = None

    def _call(self, prompt, system, max_tokens, low_reasoning=False):
        self.prompts_seen.append(prompt)
        if self.fail_on and self.fail_on in prompt:
            raise _Err(500, "boom")
        return (f"分段总结{len(self.prompts_seen)}", 10, 5)


LONG = "\n\n".join(f"第{i}段。" + "字" * 900 for i in range(10))


def _chapter(content=LONG):
    return ChapterInfo(id="1", title="长章", content=content)


def test_segmented_summary_small_context():
    c = _Scripted(contextWindow=8192, maxOutputTokens=2048)  # 输入预算 4096
    r = c.summarize_chapter(_chapter(), "non-fiction", "zh")
    assert r.success
    assert len(c.prompts_seen) >= 4  # ≥3 段 + 合并
    for i in range(10):
        assert any(f"第{i}段。" in p for p in c.prompts_seen)
    assert "（第 1/" in c.prompts_seen[0]
    assert "分段总结合并" in c.prompts_seen[-1] and "【第 1/" in c.prompts_seen[-1]
    # token 累加了所有分段与合并调用
    assert r.input_tokens == 10 * len(c.prompts_seen)


def test_no_split_without_context_meta():
    c = _Scripted()
    assert c.summarize_chapter(_chapter(), "non-fiction", "zh").success
    assert len(c.prompts_seen) == 1


def test_segment_failure_fails_chapter():
    c = _Scripted(contextWindow=8192, maxOutputTokens=2048)
    c.fail_on = "第 2/"
    c.retry_policy.max_retries = 0
    r = c.summarize_chapter(_chapter(), "non-fiction", "zh")
    assert not r.success and "分段 2/" in r.error


def test_post_process_limit_follows_context():
    c = _Scripted(contextWindow=8192, maxOutputTokens=2048)
    big = [(f"章{i}", "摘" * 3000) for i in range(6)]
    assert c.analyze_connections(big, "zh").success
    assert len(c.prompts_seen[0]) < 6000


def test_openai_reasoning_model_falls_back_to_max_completion_tokens_and_remembers():
    """审查发现：CLI 原先遇到 o 系列 / gpt-5 的「请用 max_completion_tokens」直接整章失败"""
    c, calls, replies, ok = _client()
    replies.extend([
        _Err(400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."),
        ok, ok,
    ])
    c._call("p", "s", 100)
    assert "max_tokens" in calls[0] and "max_completion_tokens" in calls[1] and "max_tokens" not in calls[1]
    c._call("p", "s", 100)  # 整批记住
    assert "max_completion_tokens" in calls[2] and len(calls) == 3


def test_unrelated_400_does_not_drop_reasoning():
    c, calls, replies, ok = _client()
    replies.append(_Err(400, "context length exceeded"))
    with pytest.raises(_Err):
        c._call("p", "s", 100, low_reasoning=True)
    assert c.supports_reasoning is True


def test_learned_output_cap_reused_across_calls():
    c = _Scripted(maxOutputTokens=393216)
    seen = []

    def call(prompt, system, max_tokens, low_reasoning=False):
        seen.append(max_tokens)
        if max_tokens > 384000:
            raise _Err(400, "field MaxTokens invalid, should be in [1, 384000]")
        return ("总结", 10, 100)

    c._call = call
    long_prompt = "x" * 100_000  # 估算 125000 token → 输出给到模型上限 393216
    assert c._generate(long_prompt, "zh").success
    assert c._generate(long_prompt, "zh").success
    assert seen == [393216, 384000, 384000]  # 第二次直接用学到的上限


# ---- 0.8× 退避（最多 3 次）+ 只存档验证成功的值 + 后端存档 ----
from src.cli.model_budget import next_output_cap  # noqa: E402
from src.cli.model_quirks import QuirkStore, merge_quirk, quirk_key  # noqa: E402


@pytest.mark.parametrize("c", CASES["nextOutputCap"], ids=lambda c: c["name"])
def test_next_output_cap_contract(c):
    assert next_output_cap(c["status"], c["body"], c["current"]) == c["expected"]


class _RecordingStore(QuirkStore):
    def __init__(self):
        super().__init__()
        self.reported = []

    def remember(self, key, patch):
        self.reported.append((key, dict(patch)))
        super().remember(key, patch)


def _quirk_client(fail_until_below=None, always_fail=False):
    store = _RecordingStore()
    c = _Scripted(maxOutputTokens=100_000)
    c.quirks = store
    c.quirk_key = quirk_key("gw", "u", "m")
    seen = []

    def call(prompt, system, max_tokens, low_reasoning=False):
        seen.append(max_tokens)
        if always_fail or (fail_until_below and max_tokens > fail_until_below):
            raise _Err(400, "max_tokens is too large for this model")
        return ("总结", 10, 100)

    c._call = call
    c.retry_policy.max_retries = 0
    return c, store, seen


LONG_PROMPT = "x" * 100_000  # 估算 125000 token → 输出预算给到模型上限 100000


def test_backoff_then_success_remembers_and_reports():
    c, store, seen = _quirk_client(fail_until_below=70_000)
    assert c._generate(LONG_PROMPT, "zh").success
    assert seen == [100_000, 80_000, 64_000]
    assert store.reported == [(quirk_key("gw", "u", "m"), {"outputCap": 64_000})]
    assert c.learned_output_cap == 64_000


def test_backoff_at_most_three_times_and_failure_not_archived():
    c, store, seen = _quirk_client(always_fail=True)
    r = c._generate(LONG_PROMPT, "zh")
    assert not r.success
    assert seen == [100_000, 80_000, 64_000, 51_200]  # 首发 + 3 次退避，不会有第 4 次
    assert store.reported == [] and c.learned_output_cap is None


def test_quirk_store_monotonic_merge():
    assert merge_quirk({"outputCap": 40_000, "noTemperature": True}, {"outputCap": 90_000, "noTemperature": False}) == {
        "outputCap": 40_000, "noTemperature": True}
    assert merge_quirk({"tokenParam": "max_completion_tokens"}, {"tokenParam": "max_tokens"}) == {
        "tokenParam": "max_completion_tokens"}


def test_loaded_archive_applies_on_first_request():
    store = QuirkStore()
    store.entries[quirk_key("gw", "u", "m")] = {"outputCap": 50_000, "noTemperature": True,
                                                "tokenParam": "max_completion_tokens"}
    c = OpenAIClient(AIProviderConfig(provider="openai", providerId="gw", apiKey="k", apiUrl="u", model="m",
                                      maxOutputTokens=100_000), MagicMock(), quirks=store)
    assert c.learned_output_cap == 50_000 and c.send_temperature is False and c.token_param == "max_completion_tokens"


def test_param_fallback_only_remembered_on_success():
    c, calls, replies, ok = _client()
    store = _RecordingStore()
    c.quirks = store
    replies.extend([_Err(400, "Unsupported parameter: 'temperature' is not supported with this model."),
                    _Err(500, "upstream down")])
    with pytest.raises(_Err):
        c._call("p", "s", 100)
    assert store.reported == [] and c.send_temperature is True  # 降级后仍失败：不记住


def test_quirk_store_backend_roundtrip(monkeypatch):
    """配置了后端：启动 load 读存档；remember 上报 append（打桩 HTTP，不走网络）"""
    store = QuirkStore("https://x.test", "pw")
    calls = []

    def fake_request(method, path, body=None):
        calls.append((method, path, body))
        if method == "GET":
            return {"value": {"data": {"entries": {"gw|m": {"outputCap": 50_000}}}}}
        return {"ok": True}

    monkeypatch.setattr(store, "_request", fake_request)
    assert store.load() == 1 and store.get("gw|m") == {"outputCap": 50_000}
    store.remember("gw|m", {"outputCap": 60_000})  # 更大：无变化，不上报
    store.remember("gw|m", {"outputCap": 40_000})
    assert calls[1:] == [("POST", "/api/state/modelQuirks/append", {"patch": {"entries": {"gw|m": {"outputCap": 40_000}}}})]
