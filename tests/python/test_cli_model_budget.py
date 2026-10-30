"""模型参数自动化：与前端 tests/aiModelBudget.test.ts 共读 tests/fixtures/model-budget-cases.json"""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.cli.ai_client import AIClient, OpenAIClient
from src.cli.config import AIProviderConfig, ConfigLoader
from src.cli.model_budget import (
    is_temperature_param_error,
    resolve_input_budget,
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
