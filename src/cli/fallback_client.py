"""被内容审核拦下时改用备用模型重跑。

国产服务商（MiniMax / 智谱 / 商汤等）对政治、历史题材有内容审核：实测 MiniMax 对
《共和国部长访谈录》的章节返回 422 `output new_sensitive (1027)`，整本书会因此判失败。
这里在章节级 / 后处理级加一条兜底链：只对「内容审核」类错误换备用模型重跑，其它错误不换
（换模型也解决不了限流、密钥问题，反而多花钱）。

成本按各自模型单价分别计算（备用模型用量单独记账）。
"""
from __future__ import annotations

import re
from typing import Optional

from .ai_client import AIClient, AIResponse
from .logger import Logger

# 内容审核类错误：MiniMax/SenseNova 的 new_sensitive(1027)/new_sensitive(1026)、OpenAI 的
# content_policy_violation、各家通用的 safety / content filter 表述
_CONTENT_FILTER = re.compile(
    r"new_sensitive|data_inspection|content[_ ]?polic|content[_ ]?filter|safety[_ ]?system|"
    r"responsible[_ ]?ai|sensitive content|\b10[0-9]{2}\b.*sensitive|内容审核|敏感",
    re.I,
)


def is_content_filter_error(message: Optional[str]) -> bool:
    """是否是「内容被审核拦截」导致的失败（只有这类才值得换模型重试）"""
    return bool(message and _CONTENT_FILTER.search(message))


class FallbackAIClient:
    """主客户端 + 备用模型链；仅内容审核错误时切换，其余错误原样返回。

    与 AIClient 的公开接口保持一致（summarize_chapter / analyze_connections /
    generate_overall_summary / calculate_cost），可直接替换进现有流程。
    """

    def __init__(self, primary: AIClient, fallbacks: list[AIClient], logger: Logger):
        self.primary = primary
        self.fallbacks = fallbacks
        self.logger = logger
        # 每本书的备用模型用量：(模型名, 输入 token, 输出 token)
        self._usage: list[tuple[str, int, int]] = []

    # ---- 用量记账 ----

    def reset_usage(self) -> None:
        self._usage = []

    @property
    def used_models(self) -> list[str]:
        """本书实际用到的备用模型（去重保序），写进产物元数据"""
        seen: list[str] = []
        for model, _, _ in self._usage:
            if model not in seen:
                seen.append(model)
        return seen

    def _record(self, client: AIClient, response: AIResponse) -> None:
        self._usage.append((getattr(client, "model", "?"), response.input_tokens, response.output_tokens))

    def calculate_cost(self, input_tokens: int, output_tokens: int) -> tuple:
        """主模型按扣除备用用量后的 token 计费，备用模型按各自单价计费，最后相加"""
        fb_in = sum(u[1] for u in self._usage)
        fb_out = sum(u[2] for u in self._usage)
        usd, cny = self.primary.calculate_cost(max(input_tokens - fb_in, 0), max(output_tokens - fb_out, 0))
        by_model: dict[str, list[int]] = {}
        for model, i, o in self._usage:
            acc = by_model.setdefault(model, [0, 0])
            acc[0] += i
            acc[1] += o
        for client in self.fallbacks:
            acc = by_model.get(getattr(client, "model", "?"))
            if acc:
                u, c = client.calculate_cost(acc[0], acc[1])
                usd, cny = usd + u, cny + c
        return round(usd, 5), round(cny, 5)

    def get_pricing(self) -> Optional[dict]:
        return self.primary.get_pricing()

    # ---- 调用转发 ----

    def _with_fallback(self, call: str, *args, **kwargs) -> AIResponse:
        response = getattr(self.primary, call)(*args, **kwargs)
        if response.success or response.skipped or not is_content_filter_error(response.error):
            return response

        self.logger.warning("主模型被内容审核拦截，改用备用模型重跑")
        total_in, total_out = response.input_tokens, response.output_tokens
        last_error = response.error
        for client in self.fallbacks:
            model = getattr(client, "model", "?")
            self.logger.info(f"备用模型重试: {model}（章节/段落超长会自动分段）")
            fb = getattr(client, call)(*args, **kwargs)
            total_in += fb.input_tokens
            total_out += fb.output_tokens
            if fb.success or fb.skipped:
                self._record(client, fb)
                return AIResponse(success=fb.success, content=fb.content, skipped=fb.skipped,
                                  input_tokens=total_in, output_tokens=total_out)
            last_error = fb.error
            if not is_content_filter_error(fb.error):
                # 备用模型的失败与内容无关（限流/网络）：记下用量后继续试下一个备用
                self._record(client, fb)
                self.logger.warning(f"备用模型 {model} 失败（非内容审核）: {fb.error}")
            else:
                self._record(client, fb)
                self.logger.warning(f"备用模型 {model} 也被内容审核拦截")
        return AIResponse(success=False, content="", error=f"主模型及备用模型均失败: {last_error}",
                          input_tokens=total_in, output_tokens=total_out)

    def summarize_chapter(self, *args, **kwargs) -> AIResponse:
        return self._with_fallback("summarize_chapter", *args, **kwargs)

    def analyze_connections(self, *args, **kwargs) -> AIResponse:
        return self._with_fallback("analyze_connections", *args, **kwargs)

    def generate_overall_summary(self, *args, **kwargs) -> AIResponse:
        return self._with_fallback("generate_overall_summary", *args, **kwargs)

    def repair_rich_blocks(self, *args, **kwargs):
        """富内容块修复：改的是模型自己刚写的块（不涉及原文内容审核），不走备用模型"""
        return self.primary.repair_rich_blocks(*args, **kwargs)

    @property
    def prompts(self):  # 供 batch_processor 读取提示词版本等
        return self.primary.prompts

    @property
    def model(self) -> str:
        return getattr(self.primary, "model", "")
