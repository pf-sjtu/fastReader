"""
AI 客户端
负责与 AI API 交互，处理章节内容

Prompt 组装统一走 prompts.PromptTemplates（与前端共享 YAML），
各 provider 只实现一次底层调用 _call；重试/超时/错误归一在基类完成。
"""

import re
from typing import Optional
from dataclasses import dataclass

from .models import ChapterInfo
from .logger import Logger
from .prompts import (
    PromptTemplates,
    RESULT_PREFIX,
    CONNECTIONS_NOT_ENOUGH,
    OVERALL_NO_CHAPTERS,
    get_language_instruction,
    prepare_post_process_chapters,
)
from .retry import RetryPolicy, call_with_retry

__all__ = [
    "AIResponse", "AIClient", "GeminiClient", "OpenAIClient", "PromptTemplates",
    "create_ai_client", "calculate_cost", "MODEL_PRICING",
]

# AI 模型定价（每百万 Token 美元），与前端 metadataFormatter.ts MODEL_PRICING 保持一致
MODEL_PRICING = {
    # Gemini models
    'gemini-1.5-pro': {'input': 1.25, 'output': 18.75},
    'gemini-1.5-flash': {'input': 0.075, 'output': 1.125},
    'gemini-1.0-pro': {'input': 0.5, 'output': 1.5},
    # OpenAI models
    'gpt-4o': {'input': 5.0, 'output': 15.0},
    'gpt-4o-mini': {'input': 0.15, 'output': 0.6},
    'gpt-4': {'input': 30.0, 'output': 60.0},
    'gpt-3.5-turbo': {'input': 0.5, 'output': 1.5},
    # Ollama（本地模型，通常免费）
    'llama3': {'input': 0, 'output': 0},
    'llama3.1': {'input': 0, 'output': 0},
    'qwen2': {'input': 0, 'output': 0},
    # 302.ai（OpenAI 兼容定价）
    'openai/gpt-4o': {'input': 5.0, 'output': 15.0},
    'openai/gpt-4o-mini': {'input': 0.15, 'output': 0.6},
}
# 未登记模型不再拿别的模型估价（曾按 gemini-1.5-pro，系统性失真）：费用记 0，由 is_priced() 区分。
# 需要准确费用时在配置里用 ai.pricing 显式给单价。
FALLBACK_PRICING_MODEL = None

DEFAULT_TIMEOUT = 120.0
DEFAULT_EXCHANGE_RATE = 7.0
# 模型元数据缺失时的单次输出上限。推理模型的「思考」也算输出 token：4096 对长章节偏紧
DEFAULT_MAX_OUTPUT_TOKENS = 8192
# 与前端 services/ai/outputBudget.ts 同语义
CONTEXT_SAFETY_MARGIN = 1024
MIN_OUTPUT_TOKENS = 1024


def parse_max_tokens_cap(message: str, current: int) -> Optional[int]:
    """从「输出上限超出范围」的报错里读出真实上限（与前端 parseMaxTokensCap 同语义）"""
    if not message or not re.search(r'max.?tokens|max_completion_tokens|max_output_tokens', message, re.I):
        return None
    nums = [int(n) for n in re.findall(r'\d{3,}', message) if MIN_OUTPUT_TOKENS <= int(n) < current]
    return max(nums) if nums else None


def resolve_max_output_tokens(output_limit: Optional[int], context_window: Optional[int],
                              prompt_tokens: int) -> Optional[int]:
    """输出上限取模型最大输出（meta.output），并保证「输入 + 输出」不超过上下文窗口。

    未知上限返回 None（调用方用 DEFAULT_MAX_OUTPUT_TOKENS）。prompt_tokens 按字符数粗估，宁可高估。
    """
    if not output_limit or output_limit <= 0:
        return None
    budget = int(output_limit)
    if context_window and context_window > 0:
        room = int(context_window - prompt_tokens - CONTEXT_SAFETY_MARGIN)
        if room < budget:
            budget = max(room, MIN_OUTPUT_TOKENS)
    return budget
# 前端 aiService.summarizeChapter：内容不足 100 字视为非实质章节，直接跳过不调用 AI
MIN_CHAPTER_CHARS = 100
SKIPPED_SHORT_TEXT = f"{RESULT_PREFIX['chapterSkipped']}内容太短，可能是非实质性章节"


_LEADING_THINK = re.compile(r"^\s*<(think|thinking|reasoning)>[\s\S]*?</\1>\s*", re.I)
_UNCLOSED_THINK = re.compile(r"^\s*<(think|thinking|reasoning)>", re.I)


def strip_thinking(content: str) -> str:
    """剥掉开头混进正文的 <think>…</think>（语义与前端 services/ai/stripThinking.ts 一致）。

    未闭合的开头思考块视为整段都是思考，返回空串，由上层按「AI 返回空内容」失败重试。
    """
    if not content:
        return content
    out = content
    for _ in range(5):
        if not _LEADING_THINK.match(out):
            break
        out = _LEADING_THINK.sub("", out, count=1)
    if _UNCLOSED_THINK.match(out):
        return ""
    return out


def is_priced(model: str) -> bool:
    """模型是否有登记单价（无单价时费用记 0，报告里应标「未计价」）"""
    return model in MODEL_PRICING


def calculate_cost(model: str, input_tokens: int, output_tokens: int,
                   exchange_rate: float = DEFAULT_EXCHANGE_RATE) -> tuple[float, float]:
    """计算费用 (USD, CNY)，保留 5 位小数（与前端一致）；未登记单价的模型返回 (0, 0)"""
    pricing = MODEL_PRICING.get(model)
    if not pricing:
        return 0.0, 0.0
    cost_usd = (pricing['input'] / 1_000_000) * input_tokens + \
               (pricing['output'] / 1_000_000) * output_tokens
    cost_cny = cost_usd * exchange_rate
    return round(cost_usd, 5), round(cost_cny, 5)


@dataclass
class AIResponse:
    """AI 响应"""
    success: bool
    content: str
    input_tokens: int = 0
    output_tokens: int = 0
    error: Optional[str] = None
    skipped: bool = False


class AIClient:
    """AI 客户端基类：子类只需实现 _call"""

    MODEL_PRICING = MODEL_PRICING

    def __init__(self, config, logger: Logger, prompt_templates: PromptTemplates = None,
                 retry_policy: Optional[RetryPolicy] = None,
                 timeout: float = DEFAULT_TIMEOUT,
                 exchange_rate: float = DEFAULT_EXCHANGE_RATE):
        self.config = config
        self.logger = logger
        self.model = config.model
        self.temperature = config.temperature
        self.prompts = prompt_templates or PromptTemplates()
        self.retry_policy = retry_policy or RetryPolicy()
        self.timeout = timeout
        self.exchange_rate = exchange_rate

    def get_pricing(self) -> Optional[dict]:
        """获取模型定价：配置里的单价（2.0.0 的 models[].meta）优先，其次内置表；未登记返回 None"""
        inp = getattr(self.config, 'inputCost', None)
        out = getattr(self.config, 'outputCost', None)
        if isinstance(inp, (int, float)) and isinstance(out, (int, float)):
            return {'input': float(inp), 'output': float(out)}
        return MODEL_PRICING.get(self.model)

    def calculate_cost(self, input_tokens: int, output_tokens: int) -> tuple:
        """计算处理费用（使用配置的汇率）；优先用配置里的单价"""
        pricing = self.get_pricing()
        if not pricing:
            return 0.0, 0.0
        usd = (pricing['input'] / 1_000_000) * input_tokens + (pricing['output'] / 1_000_000) * output_tokens
        return round(usd, 5), round(usd * self.exchange_rate, 5)

    # ---- 底层调用 ----

    def _call(self, prompt: str, system: str, max_tokens: int, low_reasoning: bool = False) -> tuple[str, int, int]:
        """返回 (content, input_tokens, output_tokens)；失败直接抛 SDK 异常。

        low_reasoning：请求服务商少花推理 token（OpenAI 兼容端点用 reasoning_effort=low，
        不支持的服务商由实现自行忽略）。只在「推理把输出预算吃光」后的补救重试里用。
        """
        raise NotImplementedError

    def _call_once(self, prompt: str, system: str, max_tokens: int, low_reasoning: bool) -> tuple[str, int, int]:
        def attempt():
            try:
                return self._call(prompt, system, max_tokens, low_reasoning)
            except Exception as e:
                # 元数据高于服务商真实上限（如目录 393216、实际 384000）：按报错里的上限重发一次
                cap = parse_max_tokens_cap(str(e), max_tokens) if getattr(e, 'status_code', None) in (400, 422) else None
                if not cap:
                    raise
                self.logger.warning(f"{type(self).__name__}: 输出上限 {max_tokens} 超出服务商范围，按 {cap} 重试")
                return self._call(prompt, system, cap, low_reasoning)
        return call_with_retry(
            attempt,
            self.retry_policy,
            operation=f"{type(self).__name__} 调用",
            on_retry=self.logger.warning,
        )

    def max_output_tokens(self, prompt: str, system: str = '') -> tuple[int, bool]:
        """本次请求的输出上限，以及它是否已是模型最大值（是则补救重试不再翻倍）"""
        resolved = resolve_max_output_tokens(
            getattr(self.config, 'maxOutputTokens', None),
            getattr(self.config, 'contextWindow', None),
            len(prompt) + len(system),
        )
        return (resolved, True) if resolved else (DEFAULT_MAX_OUTPUT_TOKENS, False)

    def _generate(self, prompt: str, language: str, max_tokens: Optional[int] = None) -> AIResponse:
        system = get_language_instruction(language)
        at_model_max = False
        if max_tokens is None:
            max_tokens, at_model_max = self.max_output_tokens(prompt, system)
        try:
            content, in_tok, out_tok = self._call_once(prompt, system, max_tokens, False)
            # 推理模型可能把整个输出预算都花在思考上：内容为空、输出 token 顶满上限。
            # 实测 MiniMax-M3.1-Flash 对 4.8 万字单章：reasoning=4095/4096、content 为空。
            # 补救一次：降低推理强度；预算未到模型上限时再翻倍。token 两次都计入（都已计费）。
            if not (content or '').strip() and out_tok >= max_tokens * 0.95:
                retry_tokens = max_tokens if at_model_max else max_tokens * 2
                self.logger.warning(
                    f"{type(self).__name__}: 输出预算 {max_tokens} 被推理耗尽，以 {retry_tokens} 并降低推理强度重试"
                )
                content, in2, out2 = self._call_once(prompt, system, retry_tokens, True)
                in_tok, out_tok = in_tok + in2, out_tok + out2
        except Exception as e:
            self.logger.error(f"{type(self).__name__} API 调用失败: {e}")
            return AIResponse(success=False, content='', error=str(e))
        if not (content or '').strip():
            return AIResponse(success=False, content='', error="AI 返回空内容",
                              input_tokens=in_tok, output_tokens=out_tok)
        return AIResponse(success=True, content=content, input_tokens=in_tok, output_tokens=out_tok)

    # ---- 业务方法 ----

    def summarize_chapter(self, chapter: ChapterInfo, book_type: str, language: str) -> AIResponse:
        """总结章节（原文过短则直接标记跳过）"""
        if len((chapter.content or '').strip()) < MIN_CHAPTER_CHARS:
            return AIResponse(success=True, content=SKIPPED_SHORT_TEXT, skipped=True)
        prompt = self.prompts.build_chapter_prompt(chapter.title, chapter.content, book_type)
        return self._generate(prompt, language)

    def analyze_connections(self, chapters: list[tuple[str, str]], language: str) -> AIResponse:
        """分析章节关联；chapters 为 (标题, 章节摘要)，只使用可用摘要"""
        items = prepare_post_process_chapters(chapters)
        if len(items) < 2:
            return AIResponse(success=True, content=CONNECTIONS_NOT_ENOUGH)
        return self._generate(self.prompts.build_connections_prompt(items), language)

    def generate_overall_summary(self, title: str, chapters: list[tuple[str, str]],
                                 connections: str, language: str) -> AIResponse:
        """生成全书总结；chapters 为 (标题, 章节摘要)"""
        items = prepare_post_process_chapters(chapters)
        if not items:
            return AIResponse(success=True, content=OVERALL_NO_CHAPTERS)
        prompt = self.prompts.build_overall_prompt(title, items, connections)
        return self._generate(prompt, language)


class GeminiClient(AIClient):
    """Gemini API 客户端"""

    def __init__(self, config, logger: Logger, prompt_templates: PromptTemplates = None, **kwargs):
        super().__init__(config, logger, prompt_templates, **kwargs)
        self.api_key = config.apiKey
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from google import genai
            except ImportError as e:
                raise RuntimeError("未安装 google-genai 库") from e
            # http_options.timeout 单位为毫秒
            self._client = genai.Client(
                api_key=self.api_key,
                http_options={'timeout': int(self.timeout * 1000)},
            )
        return self._client

    def _call(self, prompt: str, system: str, max_tokens: int, low_reasoning: bool = False) -> tuple[str, int, int]:
        # Gemini 无对应的推理强度参数：low_reasoning 只靠调用方翻倍的 max_tokens 生效
        response = self._get_client().models.generate_content(
            model=self.model,
            contents=prompt,
            config={
                'temperature': self.temperature,
                'max_output_tokens': max_tokens,
                'system_instruction': system,
            },
        )
        content = getattr(response, 'text', None) or ''
        usage = getattr(response, 'usage_metadata', None)
        in_tok = getattr(usage, 'prompt_token_count', 0) or 0
        out_tok = getattr(usage, 'candidates_token_count', 0) or 0
        return content, in_tok, out_tok


class OpenAIClient(AIClient):
    """OpenAI 兼容 API 客户端（包括自定义端点和 302.ai）"""

    def __init__(self, config, logger: Logger, prompt_templates: PromptTemplates = None, **kwargs):
        super().__init__(config, logger, prompt_templates, **kwargs)
        self.api_key = config.apiKey
        self.api_url = config.apiUrl.rstrip('/') if config.apiUrl else 'https://api.openai.com/v1'
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from openai import OpenAI
            except ImportError as e:
                raise RuntimeError("未安装 openai 库") from e
            # 重试由统一 helper 负责，SDK 内置重试关闭以免叠加
            self._client = OpenAI(
                api_key=self.api_key,
                base_url=self.api_url,
                timeout=self.timeout,
                max_retries=0,
            )
        return self._client

    def _call(self, prompt: str, system: str, max_tokens: int, low_reasoning: bool = False) -> tuple[str, int, int]:
        kwargs = dict(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=self.temperature,
            max_tokens=max_tokens,
        )
        if low_reasoning:
            try:
                response = self._get_client().chat.completions.create(**kwargs, reasoning_effort="low")
            except Exception as e:
                # 不认识 reasoning_effort 的网关：去掉参数再试（与前端 services/ai/reasoning.ts 同策略）
                if getattr(e, 'status_code', None) in (400, 422):
                    response = self._get_client().chat.completions.create(**kwargs)
                else:
                    raise
        else:
            response = self._get_client().chat.completions.create(**kwargs)
        content = strip_thinking(response.choices[0].message.content or "")
        usage = getattr(response, 'usage', None)
        in_tok = getattr(usage, 'prompt_tokens', 0) or 0
        out_tok = getattr(usage, 'completion_tokens', 0) or 0
        return content, in_tok, out_tok


def create_ai_client(config, logger: Logger, prompt_templates: PromptTemplates = None,
                     **client_kwargs) -> Optional[AIClient]:
    """创建 AI 客户端（支持多提供商）。client_kwargs: retry_policy / timeout / exchange_rate"""
    if hasattr(config, 'providers') and config.providers:
        if 0 <= config.currentProviderIndex < len(config.providers):
            provider_config = config.providers[config.currentProviderIndex]
            logger.info(f"使用多提供商配置，当前提供商: {provider_config.provider}, 模型: {provider_config.model}")
        else:
            logger.warning(f"提供商索引 {config.currentProviderIndex} 超出范围，使用第一个提供商")
            provider_config = config.providers[0]
        return _create_client_for_provider(provider_config, config, logger, prompt_templates, **client_kwargs)

    # 单提供商模式
    return _create_client_for_provider(config, config, logger, prompt_templates, **client_kwargs)


def _create_client_for_provider(provider_config, full_config, logger: Logger,
                                prompt_templates: PromptTemplates = None,
                                **client_kwargs) -> Optional[AIClient]:
    """根据提供商配置创建客户端"""
    provider = provider_config.provider.lower()
    provider_config.model = getattr(provider_config, 'model', '') or full_config.model

    if provider == 'gemini':
        return GeminiClient(provider_config, logger, prompt_templates, **client_kwargs)
    if provider in ('openai', '302.ai'):
        # OpenAI 兼容 API（包括自定义端点如 302.ai）
        return OpenAIClient(provider_config, logger, prompt_templates, **client_kwargs)
    if provider == 'ollama':
        logger.warning("Ollama 客户端待实现")
        return None
    logger.error(f"不支持的 AI 提供商: {provider}")
    return None
