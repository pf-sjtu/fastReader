"""
Prompt 共享 / AI 客户端测试
- 模板来自前端 YAML，默认版本 v1，配置可覆盖，目录可覆盖
- 章节摘要与后处理的输入组装对齐前端（后处理只喂摘要 JSON）
- 统一 _generate：语言指令走 system、重试、空内容判失败
- 费用：定价表对齐前端、汇率来自配置
- Gemini / OpenAI 的 SDK 调用参数（超时、关闭 SDK 自带重试）
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from src.cli.ai_client import (
    AIClient, GeminiClient, OpenAIClient, MODEL_PRICING, SKIPPED_SHORT_TEXT,
    calculate_cost, create_ai_client,
)
from src.cli.config import AIProviderConfig, PromptConfig, PromptVersionConfig, AIConfig
from src.cli.logger import Logger
from src.cli.models import ChapterInfo
from src.cli.prompts import (
    CONNECTIONS_NOT_ENOUGH, OVERALL_NO_CHAPTERS, LANGUAGE_INSTRUCTIONS, PromptTemplates,
    get_language_instruction, load_yaml_prompts, prepare_post_process_chapters,
)
from src.cli.retry import RetryPolicy


class FakeClient(AIClient):
    """只替换底层 _call，其余走真实逻辑"""

    def __init__(self, replies=None, prompts=None, **kwargs):
        cfg = SimpleNamespace(model=kwargs.pop("model", "gemini-1.5-flash"), temperature=0.3)
        super().__init__(cfg, Logger(), prompts or PromptTemplates(),
                         retry_policy=kwargs.pop("retry_policy", RetryPolicy(max_retries=0)), **kwargs)
        self.replies = list(replies or [])
        self.calls = []

    def _call(self, prompt, system, max_tokens):
        self.calls.append({"prompt": prompt, "system": system, "max_tokens": max_tokens})
        reply = self.replies.pop(0) if self.replies else ("回复", 10, 5)
        if isinstance(reply, BaseException):
            raise reply
        return reply


class TestYamlPrompts:
    def test_both_versions_load_from_shared_yaml(self):
        for version in ("v1", "v2"):
            data = load_yaml_prompts(version)
            assert data["chapterSummary"]["fiction"]
            assert data["connectionAnalysis"]
            assert data["overallSummary"]

    def test_v2_bom_is_stripped(self):
        assert "chapterSummary" in load_yaml_prompts("v2")

    def test_missing_dir_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError, match="promptsDir"):
            load_yaml_prompts("v1", str(tmp_path))

    def test_prompts_dir_override(self, tmp_path):
        (tmp_path / "v1-prompts.yaml").write_text(
            "chapterSummary:\n  fiction: F\n  nonFiction: N\nconnectionAnalysis: C\noverallSummary: O\n",
            encoding="utf-8")
        templates = PromptTemplates(prompts_dir=str(tmp_path))
        assert templates.get_prompt("chapterSummary", "fiction") == "F"
        assert templates.get_prompt("overallSummary") == "O"

    def test_config_override_beats_yaml(self):
        cfg = PromptConfig(versions={"v2": PromptVersionConfig(chapterSummary_fiction="自定义小说")},
                           currentVersion="v2")
        templates = PromptTemplates(prompt_config=cfg)
        assert templates.get_prompt("chapterSummary", "fiction") == "自定义小说"
        # 未覆盖的类型回落到 YAML
        assert "角色" in templates.get_prompt("chapterSummary", "non-fiction")

    def test_no_builtin_default_prompts(self):
        import src.cli.ai_client as mod
        assert not hasattr(mod.PromptTemplates, "DEFAULT_PROMPTS")


class TestPromptAssembly:
    def test_chapter_prompt_substitutes_placeholders_v1(self):
        prompt = PromptTemplates().build_chapter_prompt("标题甲", "正文乙", "non-fiction")
        assert "章节标题：标题甲" in prompt and "正文乙" in prompt
        assert "{{" not in prompt

    def test_chapter_prompt_v2_substitutes(self):
        templates = PromptTemplates(prompt_config=PromptConfig(currentVersion="v2"))
        prompt = templates.build_chapter_prompt("标题甲", "正文乙", "non-fiction")
        assert "章节标题：标题甲" in prompt and "{{" not in prompt

    def test_chapter_prompt_appends_when_no_placeholder(self):
        """自定义模板无占位符时按前端 aiService 的方式追加标题与正文"""
        cfg = PromptConfig(versions={"v1": PromptVersionConfig(chapterSummary_nonFiction="请总结")})
        prompt = PromptTemplates(prompt_config=cfg).build_chapter_prompt("标题甲", "正文乙", "non-fiction")
        assert prompt == "请总结\n\n章节标题: 标题甲\n\n章节内容:\n正文乙"

    def test_connections_prompt_uses_summary_json(self):
        items = prepare_post_process_chapters([("一", "摘要一"), ("二", "摘要二")])
        prompt = PromptTemplates().build_connections_prompt(items)
        assert json.dumps(items, ensure_ascii=False, indent=2) in prompt
        assert "{{chapterSummaries}}" not in prompt

    def test_connections_prompt_appends_without_placeholder(self, tmp_path):
        (tmp_path / "v1-prompts.yaml").write_text("connectionAnalysis: 分析\n", encoding="utf-8")
        prompt = PromptTemplates(prompts_dir=str(tmp_path)).build_connections_prompt([{"index": 1}])
        assert prompt.startswith("分析\n\n已处理的章节列表:\n")

    def test_overall_prompt_both_styles(self, tmp_path):
        items = [{"index": 1, "title": "一", "summary": "s"}]
        prompt = PromptTemplates().build_overall_prompt("书名X", items, "关联Y")
        assert "《书名X》" in prompt and "关联Y" in prompt and '"summary": "s"' in prompt
        (tmp_path / "v1-prompts.yaml").write_text("overallSummary: 总结\n", encoding="utf-8")
        prompt = PromptTemplates(prompts_dir=str(tmp_path)).build_overall_prompt("书名X", items, "关联Y")
        assert prompt.startswith("总结\n\n书名: 书名X\n\n已处理的章节列表:\n")
        assert prompt.endswith("章节关联分析:\n关联Y")

    def test_post_process_filters_placeholders_and_truncates(self):
        rows = [("一", "【处理失败】x"), ("二", "【已跳过】y"), ("三", "  "), ("四", "好" * 1000), ("五", "好" * 1000)]
        assert [r["title"] for r in prepare_post_process_chapters(rows)] == ["四", "五"]
        truncated = prepare_post_process_chapters(rows, soft_limit=1000)
        assert all(len(r["summary"]) <= 500 for r in truncated)
        assert truncated[0]["summary"].endswith("…")
        assert truncated[0]["index"] == 1

    def test_language_instruction_matches_frontend_and_auto(self):
        assert get_language_instruction("zh") == "请用中文回复。"
        assert get_language_instruction("en") == "Please respond in English."
        assert "原书" in get_language_instruction("auto")
        assert get_language_instruction("xx") == LANGUAGE_INSTRUCTIONS["auto"]


class TestAIClientFlow:
    def test_summarize_sends_language_as_system(self):
        client = FakeClient(replies=[("摘要", 100, 20)])
        resp = client.summarize_chapter(ChapterInfo(id="1", title="T", content="字" * 200), "fiction", "en")
        assert resp.success and resp.content == "摘要" and resp.input_tokens == 100
        assert client.calls[0]["system"] == "Please respond in English."
        assert "字" * 200 in client.calls[0]["prompt"]

    def test_short_chapter_skipped_without_call(self):
        client = FakeClient()
        resp = client.summarize_chapter(ChapterInfo(id="1", title="T", content="短"), "fiction", "zh")
        assert resp.skipped and resp.content == SKIPPED_SHORT_TEXT and client.calls == []

    def test_error_becomes_failed_response(self):
        err = Exception("boom")
        err.status_code = 400
        client = FakeClient(replies=[err])
        resp = client.summarize_chapter(ChapterInfo(id="1", title="T", content="字" * 200), "fiction", "zh")
        assert resp.success is False and "boom" in resp.error

    def test_retry_then_success(self):
        err = Exception("busy")
        err.status_code = 503
        client = FakeClient(replies=[err, ("好", 1, 1)], retry_policy=RetryPolicy(max_retries=2, delays=[0]))
        resp = client.summarize_chapter(ChapterInfo(id="1", title="T", content="字" * 200), "fiction", "zh")
        assert resp.success and len(client.calls) == 2

    def test_empty_reply_is_failure(self):
        client = FakeClient(replies=[("   ", 5, 0)])
        resp = client.summarize_chapter(ChapterInfo(id="1", title="T", content="字" * 200), "fiction", "zh")
        assert resp.success is False and resp.error == "AI 返回空内容"

    def test_connections_need_two_usable(self):
        client = FakeClient()
        resp = client.analyze_connections([("一", "摘要"), ("二", "【处理失败】x")], "zh")
        assert resp.content == CONNECTIONS_NOT_ENOUGH and client.calls == []
        resp = client.analyze_connections([("一", "摘要一"), ("二", "摘要二")], "zh")
        assert resp.success and "摘要二" in client.calls[0]["prompt"]

    def test_overall_uses_summaries_not_raw(self):
        client = FakeClient()
        assert client.generate_overall_summary("书", [], "", "zh").content == OVERALL_NO_CHAPTERS
        client.generate_overall_summary("书", [("一", "摘要一")], "关联", "zh")
        assert "摘要一" in client.calls[0]["prompt"] and "关联" in client.calls[0]["prompt"]

    def test_base_call_not_implemented(self):
        client = AIClient(SimpleNamespace(model="m", temperature=0), Logger())
        with pytest.raises(NotImplementedError):
            client._call("p", "s", 1)


class TestCost:
    def test_pricing_table_covers_frontend_entries(self):
        for model in ("gpt-3.5-turbo", "llama3", "llama3.1", "qwen2", "openai/gpt-4o", "openai/gpt-4o-mini"):
            assert model in MODEL_PRICING

    def test_exchange_rate_from_config(self):
        client = FakeClient(model="gpt-4o-mini", exchange_rate=7.3)
        usd, cny = client.calculate_cost(1_000_000, 1_000_000)
        assert usd == 0.75 and cny == round(0.75 * 7.3, 5)

    def test_unknown_model_falls_back(self):
        assert calculate_cost("unknown", 1_000_000, 0) == (1.25, 8.75)
        assert FakeClient(model="unknown").get_pricing() == MODEL_PRICING["gemini-1.5-pro"]

    def test_local_model_free(self):
        assert calculate_cost("llama3", 10**6, 10**6) == (0, 0)


class TestProviderClients:
    def test_openai_call_params(self):
        cfg = AIProviderConfig(provider="openai", apiKey="k", model="gpt-4o", apiUrl="https://x/v1/")
        client = OpenAIClient(cfg, Logger(), timeout=33)
        fake_resp = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="答"))],
            usage=SimpleNamespace(prompt_tokens=7, completion_tokens=3),
        )
        with patch("openai.OpenAI") as ctor:
            ctor.return_value.chat.completions.create.return_value = fake_resp
            resp = client.summarize_chapter(ChapterInfo(id="1", title="T", content="字" * 200), "fiction", "zh")
        assert resp.success and resp.content == "答" and resp.input_tokens == 7
        kwargs = ctor.call_args.kwargs
        assert kwargs["timeout"] == 33 and kwargs["max_retries"] == 0 and kwargs["base_url"] == "https://x/v1"
        messages = ctor.return_value.chat.completions.create.call_args.kwargs["messages"]
        assert messages[0] == {"role": "system", "content": "请用中文回复。"}

    def test_gemini_call_params(self):
        cfg = AIProviderConfig(provider="gemini", apiKey="k", model="gemini-1.5-pro")
        client = GeminiClient(cfg, Logger(), timeout=12)
        fake_resp = SimpleNamespace(text="答", usage_metadata=SimpleNamespace(prompt_token_count=9, candidates_token_count=4))
        with patch("google.genai.Client") as ctor:
            ctor.return_value.models.generate_content.return_value = fake_resp
            resp = client.analyze_connections([("一", "a"), ("二", "b")], "auto")
        assert resp.success and resp.output_tokens == 4
        assert ctor.call_args.kwargs["http_options"] == {"timeout": 12000}
        config = ctor.return_value.models.generate_content.call_args.kwargs["config"]
        assert config["system_instruction"] == LANGUAGE_INSTRUCTIONS["auto"]

    def test_create_client_kwargs_and_index_bounds(self):
        ai = AIConfig(providers=[AIProviderConfig(provider="openai", apiKey="k", model="gpt-4o")],
                      currentProviderIndex=5)
        client = create_ai_client(ai, Logger(), timeout=9, exchange_rate=6.5)
        assert isinstance(client, OpenAIClient) and client.timeout == 9 and client.exchange_rate == 6.5

    def test_ollama_not_supported(self):
        cfg = MagicMock(provider="ollama", model="llama3", providers=None)
        assert create_ai_client(cfg, Logger()) is None
